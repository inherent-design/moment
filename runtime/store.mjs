import { applyGraph } from './graph.mjs';
import {storageVersion,assertStorageFormat,createSnapshotTables,writeSnapshot,readSnapshot} from './snapshot-values.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, openSync, closeSync, lstatSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { canonical, digest, fail, resultError } from './json.mjs';
import {counterNext} from './semantic-core.mjs';

/** A candidate is reclaimable only after its recorded child is observed dead. */
export function startupStatus(value) {
  if(value===undefined) return;
  if(!value || !Number.isSafeInteger(value.pid) || value.pid<1 || typeof value.nonce!=='string') return 'uncertain';
  if(value.childPid!==undefined) {
    if(!Number.isSafeInteger(value.childPid) || value.childPid<1) return 'uncertain';
    try {process.kill(value.childPid,0);return 'starting';} catch(error) {return error.code==='ESRCH'?'stale':'uncertain';}
  }
  try {process.kill(value.pid,0);return 'starting';} catch {return 'uncertain';}
}

/** Trusted storage port. Admission and wire validation belong to the kernel. */
export class Store {
  constructor(filename, systemId, { busyTimeoutMillis=5000 }={}) {
    if(!Number.isInteger(busyTimeoutMillis) || busyTimeoutMillis<0 || busyTimeoutMillis>5000) throw new Error('Invalid SQLite busy deadline');
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    // SQLite otherwise publishes a default-mode file before the later chmod.
    // Concurrent observational clients must never see a public database window.
    const fd=openSync(filename,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);closeSync(fd);
    const stat=lstatSync(filename);
    if(!stat.isFile() || stat.uid!==process.getuid() || stat.mode&0o077) fail('IDENTITY_CONFLICT','Database must be a private owned regular file');
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.systemId = systemId;
    this.notifications=new EventEmitter();this.notifications.setMaxListeners(0);
    try {
      this.db.exec(`PRAGMA busy_timeout=${busyTimeoutMillis}; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;`);
      this.db.exec('BEGIN IMMEDIATE');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== storageVersion) fail('UNSUPPORTED_VERSION', version===1?'Legacy snapshot storage requires an explicit qualified migration':`Unsupported database version ${version}`);
      if (version === 0) {this.db.exec(`
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE receipts(principal_id TEXT NOT NULL, context_id TEXT NOT NULL, method TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, commit_value TEXT NOT NULL, PRIMARY KEY(principal_id, context_id, method, key));
        CREATE TABLE events(context_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE, value TEXT NOT NULL, PRIMARY KEY(context_id, sequence));
        CREATE TABLE outbox(context_id TEXT NOT NULL, execution_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(context_id, execution_id));
        CREATE TABLE imports(id TEXT PRIMARY KEY, digest TEXT NOT NULL, value TEXT NOT NULL);
        PRAGMA user_version=2;
      `);createSnapshotTables(this.db);}
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
      assertStorageFormat(this.db);
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
  startupTransaction(change) {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      assertStorageFormat(this.db);
      const row=this.db.prepare("SELECT value FROM metadata WHERE key='managedStartup'").get(),prior=row?JSON.parse(row.value):undefined;
      const {next=prior,result}=change(prior);
      if(next!==prior) {
        if(next===null) this.db.prepare("DELETE FROM metadata WHERE key='managedStartup'").run();
        else this.db.prepare("INSERT OR REPLACE INTO metadata VALUES ('managedStartup', ?)").run(canonical(next));
      }
      this.db.exec('COMMIT');return result;
    } catch(error) {try{this.db.exec('ROLLBACK');}catch{}throw error;}
  }
  claimManagedStartup() {
    return this.startupTransaction(prior=>{
      const writer=this.db.prepare("SELECT value FROM metadata WHERE key='daemonClaim'").get();
      if(writer) {
        const value=JSON.parse(writer.value);
        if(!Number.isSafeInteger(value.pid) || value.pid<1) fail('IDENTITY_CONFLICT','Invalid daemon ownership');
        try {process.kill(value.pid,0);return {};} catch(error) {if(error.code!=='ESRCH') throw error;}
      }
      const state=startupStatus(prior);
      if(state==='starting') return {};
      if(state==='uncertain') fail('OUTCOME_UNKNOWN','Startup custody has insufficient evidence; preserve it for inspection','reconcile');
      const claim={pid:process.pid,nonce:randomUUID()};return {next:claim,result:claim};
    });
  }
  recordManagedCandidate(claim,pid) {
    if(!Number.isSafeInteger(pid) || pid<1) return;
    this.startupTransaction(prior=>{
      if(prior?.nonce!==claim.nonce || prior.pid!==claim.pid) fail('IDENTITY_CONFLICT','Managed startup custody changed');
      return {next:{...prior,childPid:pid}};
    });
  }
  releaseManagedStartup(claim) {
    this.startupTransaction(prior=>prior?.nonce===claim.nonce && prior.pid===claim.pid?{next:null}:{});
  }
  retireManagedStartup(instanceId) {
    this.startupTransaction(prior=>{
      const row=this.db.prepare("SELECT value FROM metadata WHERE key='daemonClaim'").get(),writer=row?JSON.parse(row.value):undefined;
      return prior && writer?.nonce===instanceId && prior.childPid===writer.pid?{next:null}:{};
    });
  }
  releaseWriter(claim) {
    this.db.prepare("DELETE FROM metadata WHERE key='daemonClaim' AND value=?").run(canonical(claim));
  }

  close() { this.db.close(); }
  integrity() { return this.db.prepare('PRAGMA integrity_check').get().integrity_check; }

  read(contextId, revision) {
    return readSnapshot(this.db,contextId,revision);
  }

  contextIds() {
    return this.db.prepare('SELECT DISTINCT context_id FROM context_revisions ORDER BY context_id').all().map(row=>row.context_id);
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
      assertStorageFormat(this.db);
      const prior = this.receipt(principalId, this.systemId, 'context.create', key, requestDigest);
      if (prior) { this.db.exec('COMMIT'); return { ok: true, value: prior.response }; }
      if (this.db.prepare('SELECT 1 FROM context_revisions WHERE context_id=?').get(context.id)) fail('IDENTITY_CONFLICT', 'Context already exists');
      const value = { ...context, systemId: this.systemId, revision: 1, state: 'open' };
      const snapshot = { context: value, records: [], assertions: [], controlState };
      writeSnapshot(this.db,snapshot);
      const event = { id: randomUUID(), contextId: context.id, sequence: 1, revision: 1, type: 'context.created', subjectRefs: [{ systemId:this.systemId,contextId:context.id,id:context.id }], causeIds: [], recordedAt: new Date().toISOString(), payload: null };
      this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(context.id, 1, event.id, canonical(event));
      const commit = { transitionId: randomUUID(), contextId: context.id, previousRevision: 0, revision: 1, eventIds: [event.id] };
      this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(principalId, this.systemId, 'context.create', key, requestDigest, canonical(value), canonical(commit));
      this.db.exec('COMMIT');
      this.notify(context.id,'context.create');
      return { ok: true, value };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} return resultError(error); }
  }

  commit(batch, method = 'graph.transact') {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      assertStorageFormat(this.db);
      const { mutation: m, principalId } = batch;
      const prior = this.receipt(principalId, m.contextId, method, m.idempotencyKey, batch.requestDigest);
      if (prior) { this.db.exec('COMMIT'); return { ok: true, value: prior.commit }; }
      const snapshot = this.read(m.contextId);
      if (snapshot.context.revision !== m.expectedRevision) fail('REVISION_CONFLICT', 'Context changed since observation', 'refresh');
      const revision = counterNext(m.expectedRevision,'Context revision');
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
      const events = batch.events.map(event => {sequence=counterNext(sequence,'Event sequence');return { ...event, contextId: m.contextId, sequence, revision, recordedAt: now };});
      for (const event of events) this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(m.contextId, event.sequence, event.id, canonical(event));
      for (const intent of batch.outbox) {
        if (this.db.prepare('SELECT 1 FROM outbox WHERE context_id=? AND execution_id=?').get(m.contextId, intent.id)) fail('IDENTITY_CONFLICT', 'Execution identity already queued');
        this.db.prepare('INSERT INTO outbox VALUES (?, ?, ?)').run(m.contextId, intent.id, canonical(intent));
      }
      for (const [key, value] of Object.entries(snapshot.controlState.contextMetadata ?? {})) {
        if (!['policy', 'state','limits'].includes(key)) fail('INVALID_ARGUMENT', 'Unsupported context metadata change');
        snapshot.context[key] = value;
      }
      snapshot.context.revision = revision;
      writeSnapshot(this.db,snapshot);
      const commit = { transitionId: batch.commitId ?? randomUUID(), contextId: m.contextId, previousRevision: m.expectedRevision, revision, eventIds: events.map(event => event.id) };
      this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(principalId, m.contextId, method, m.idempotencyKey, batch.requestDigest, canonical(batch.response), canonical(commit));
      this.db.exec('COMMIT');
      this.notify(m.contextId,method);
      return { ok: true, value: commit };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} return resultError(error); }
  }

  events(contextId, after = 0, limit = 100) {
    return this.db.prepare('SELECT value FROM events WHERE context_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(contextId, after, limit).map(row => JSON.parse(row.value));
  }
  event(contextId,id) {
    const row=this.db.prepare('SELECT value FROM events WHERE context_id=? AND event_id=?').get(contextId,id);
    return row?JSON.parse(row.value):undefined;
  }
  sequence(contextId,activityOnly=false) {
    return this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM events WHERE context_id=?"+(activityOnly?" AND json_extract(value,'$.type') NOT LIKE 'runtime.schedule.%' AND json_extract(value,'$.type') NOT LIKE 'runtime.provider.%'":'')).get(contextId).sequence;
  }
  notify(contextId,method) {
    try { this.notifications.emit('commit',{ contextId,method }); }
    catch { process.stderr.write('Moment commit notification failed; durable events remain available.\n'); }
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
