import { applyGraph } from './graph.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, fail, resultError } from './json.mjs';

/** Trusted storage port. Admission and wire validation belong to the kernel. */
export class Store {
  constructor(filename, systemId) {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.systemId = systemId;
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1) fail('UNSUPPORTED_VERSION', `Unsupported database version ${version}`);
      if (version === 0) this.db.exec(`
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE snapshots(context_id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(context_id, revision));
        CREATE TABLE receipts(principal_id TEXT NOT NULL, context_id TEXT NOT NULL, method TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, commit_value TEXT NOT NULL, PRIMARY KEY(principal_id, context_id, method, key));
        CREATE TABLE events(context_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE, value TEXT NOT NULL, PRIMARY KEY(context_id, sequence));
        CREATE TABLE outbox(context_id TEXT NOT NULL, execution_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(context_id, execution_id));
        CREATE TABLE imports(id TEXT PRIMARY KEY, digest TEXT NOT NULL, value TEXT NOT NULL);
        PRAGMA user_version=1;
      `);
      const identity = this.db.prepare("SELECT value FROM metadata WHERE key='systemId'").get();
      if (identity && identity.value !== systemId) fail('IDENTITY_CONFLICT', 'Database belongs to another system');
      if (!identity) this.db.prepare('INSERT INTO metadata VALUES (?, ?)').run('systemId', systemId);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {} this.db.close(); throw error;
    }
  }

  claimWriter() {
    const claim = { pid: process.pid, nonce: randomUUID() };
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const row = this.db.prepare("SELECT value FROM metadata WHERE key='daemonClaim'").get();
      if (row) {
        const prior = JSON.parse(row.value);
        if (!Number.isSafeInteger(prior.pid) || prior.pid < 1) fail('IDENTITY_CONFLICT', 'Invalid daemon ownership record');
        try { process.kill(prior.pid, 0); fail('IDENTITY_CONFLICT', 'A live process holds the daemon claim'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      this.db.prepare("INSERT OR REPLACE INTO metadata VALUES ('daemonClaim', ?)").run(canonical(claim));
      this.db.exec('COMMIT');
      return claim;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }
  releaseWriter(claim) {
    this.db.prepare("DELETE FROM metadata WHERE key='daemonClaim' AND value=?").run(canonical(claim));
  }

  close() { this.db.close(); }
  integrity() { return this.db.prepare('PRAGMA integrity_check').get().integrity_check; }

  read(contextId, revision) {
    const row = revision === undefined
      ? this.db.prepare('SELECT value FROM snapshots WHERE context_id=? ORDER BY revision DESC LIMIT 1').get(contextId)
      : this.db.prepare('SELECT value FROM snapshots WHERE context_id=? AND revision=?').get(contextId, revision);
    if (!row) fail('NOT_FOUND', 'Context snapshot not found');
    return JSON.parse(row.value);
  }

  receipt(principalId, contextId, method, key, requestDigest) {
    const row = this.db.prepare('SELECT * FROM receipts WHERE principal_id=? AND context_id=? AND method=? AND key=?').get(principalId, contextId, method, key);
    if (!row) return undefined;
    if (row.digest !== requestDigest) fail('IDEMPOTENCY_CONFLICT', 'Retry key has different input');
    return { response: JSON.parse(row.response), commit: JSON.parse(row.commit_value) };
  }

  create(context, principalId, key, requestDigest, controlState = {}) {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const prior = this.receipt(principalId, this.systemId, 'context.create', key, requestDigest);
      if (prior) { this.db.exec('COMMIT'); return { ok: true, value: prior.response }; }
      if (this.db.prepare('SELECT 1 FROM snapshots WHERE context_id=?').get(context.id)) fail('IDENTITY_CONFLICT', 'Context already exists');
      const value = { ...context, systemId: this.systemId, revision: 1, state: 'open' };
      const snapshot = { context: value, records: [], assertions: [], controlState };
      this.db.prepare('INSERT INTO snapshots VALUES (?, ?, ?)').run(context.id, 1, canonical(snapshot));
      const event = { id: randomUUID(), contextId: context.id, sequence: 1, revision: 1, type: 'context.created', subjectRefs: [], causeIds: [], recordedAt: new Date().toISOString(), payload: null };
      this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(context.id, 1, event.id, canonical(event));
      const commit = { transitionId: randomUUID(), contextId: context.id, previousRevision: 0, revision: 1, eventIds: [event.id] };
      this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(principalId, this.systemId, 'context.create', key, requestDigest, canonical(value), canonical(commit));
      this.db.exec('COMMIT');
      return { ok: true, value };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} return resultError(error); }
  }

  commit(batch, method = 'graph.transact') {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const { mutation: m, principalId } = batch;
      const prior = this.receipt(principalId, m.contextId, method, m.idempotencyKey, batch.requestDigest);
      if (prior) { this.db.exec('COMMIT'); return { ok: true, value: prior.commit }; }
      const snapshot = this.read(m.contextId);
      if (snapshot.context.revision !== m.expectedRevision) fail('REVISION_CONFLICT', 'Context changed since observation', 'refresh');
      const revision = m.expectedRevision + 1;
      const now = new Date().toISOString();
      const wrap = value => ({ value, ref: { systemId: this.systemId, contextId: m.contextId, id: value.id }, digest: digest(value), recordedAt: now, recordedBy: principalId, revision });
      applyGraph(snapshot,batch.changes,wrap,{ systemId:this.systemId,contextId:m.contextId,revision });
      for (const change of batch.controlChanges) {
        if (!Object.hasOwn(snapshot.controlState, change.namespace)) Object.defineProperty(snapshot.controlState, change.namespace, { value: {}, enumerable: true });
        const namespace = snapshot.controlState[change.namespace];
        Object.defineProperty(namespace, change.key, { value: change.value, enumerable: true, writable: true, configurable: true });
      }
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS sequence FROM events WHERE context_id=?').get(m.contextId);
      let sequence = row.sequence;
      const events = batch.events.map(event => ({ ...event, contextId: m.contextId, sequence: ++sequence, revision, recordedAt: now }));
      for (const event of events) this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(m.contextId, event.sequence, event.id, canonical(event));
      for (const intent of batch.outbox) {
        if (this.db.prepare('SELECT 1 FROM outbox WHERE context_id=? AND execution_id=?').get(m.contextId, intent.id)) fail('IDENTITY_CONFLICT', 'Execution identity already queued');
        this.db.prepare('INSERT INTO outbox VALUES (?, ?, ?)').run(m.contextId, intent.id, canonical(intent));
      }
      for (const [key, value] of Object.entries(snapshot.controlState.contextMetadata ?? {})) {
        if (!['policy', 'state'].includes(key)) fail('INVALID_ARGUMENT', 'Unsupported context metadata change');
        snapshot.context[key] = value;
      }
      snapshot.context.revision = revision;
      this.db.prepare('INSERT INTO snapshots VALUES (?, ?, ?)').run(m.contextId, revision, canonical(snapshot));
      const commit = { transitionId: batch.commitId ?? randomUUID(), contextId: m.contextId, previousRevision: m.expectedRevision, revision, eventIds: events.map(event => event.id) };
      this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(principalId, m.contextId, method, m.idempotencyKey, batch.requestDigest, canonical(batch.response), canonical(commit));
      this.db.exec('COMMIT');
      return { ok: true, value: commit };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} return resultError(error); }
  }

  events(contextId, after = 0, limit = 100) {
    return this.db.prepare('SELECT value FROM events WHERE context_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(contextId, after, limit).map(row => JSON.parse(row.value));
  }
  outbox(contextId) {
    return this.db.prepare('SELECT value FROM outbox WHERE context_id=? ORDER BY rowid').all(contextId).map(row => JSON.parse(row.value));
  }
  importBootstrap(id, bytes) {
    const requestDigest = digest(bytes);
    const value = { id, original: bytes, importedAt: new Date().toISOString(), digest: requestDigest };
    this.db.prepare('INSERT OR IGNORE INTO imports VALUES (?, ?, ?)').run(id, requestDigest, canonical(value));
    const previous = this.db.prepare('SELECT digest, value FROM imports WHERE id=?').get(id);
    if (previous.digest !== requestDigest) fail('IDENTITY_CONFLICT', 'Bootstrap input changed since import');
    return JSON.parse(previous.value);
  }
}
