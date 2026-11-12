import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { Store } from '../runtime/store.mjs';
import { canonical, digest } from '../runtime/json.mjs';

const system = randomUUID(), contextId = randomUUID(), principalId = randomUUID();
const limits = { concurrentExecutions: 1, cpuMillis: 1000, memoryBytes: 1000, outputBytes: 1000, modelTokens: 0, apiSpendMicrounits: 0, currency: 'USD' };
const context = { id: contextId, label: 'test', policy: { systemId: system, contextId, id: randomUUID() }, limits, imports: [] };
const atom = () => ({ kind: 'atom', id: randomUUID(), schema: { name: 'test', version: '1', digest: digest({}) }, value: { sample: true } });
function batch(changes = [], revision = 1, key = randomUUID()) {
  return { mutation: { contextId, expectedRevision: revision, idempotencyKey: key }, principalId, requestDigest: digest({ changes, revision }), changes, controlChanges: [], events: [{ id: randomUUID(), contextId, type: 'graph.changed', subjectRefs: [], causeIds: [], payload: null }], outbox: [], response: { accepted: true } };
}
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'moment-store-'));
  const filename = join(directory, 'store.sqlite');
  const store = new Store(filename, system);
  assert.equal(store.create(context, principalId, 'bootstrap', digest(context)).ok, true);
  t.after(() => { try { store.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  return { store, filename };
}

test('atomic state/event/receipt/outbox survives a new process; exact retries cannot duplicate effects', t => {
  const { store, filename } = setup(t);
  const record = atom();
  const input = batch([{ kind: 'record.put', record }]);
  input.outbox = [{ id: randomUUID(), incidentId: randomUUID(), capability: context.policy, grant: context.policy, input: null, limits }];
  const first = store.commit(input);
  assert.equal(first.ok, true);
  assert.deepEqual(store.commit(input), first);
  assert.equal(store.read(contextId).records.length, 1);
  assert.equal(store.events(contextId).length, 2);
  assert.equal(store.outbox(contextId).length, 1);
  assert.deepEqual(store.receipt(principalId, contextId, 'graph.transact', input.mutation.idempotencyKey, input.requestDigest).response, { accepted: true });
  assert.equal(store.commit({ ...input, requestDigest: digest('changed') }).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(store.read(contextId, 1).records.length, 0);
  store.close();
  const script = `import {Store} from ${JSON.stringify(new URL('../runtime/store.mjs', import.meta.url).href)}; const s=new Store(process.argv[1],process.argv[2]); console.log(JSON.stringify([s.read(process.argv[3]),s.events(process.argv[3]),s.outbox(process.argv[3]),s.integrity()])); s.close();`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, filename, system, contextId], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const [snapshot, events, outbox, integrity] = JSON.parse(child.stdout);
  assert.equal(snapshot.context.revision, 2); assert.equal(events.length, 2); assert.equal(outbox.length, 1); assert.equal(integrity, 'ok');
});

test('identity conflicts roll back the entire candidate, including new records', t => {
  const { store } = setup(t);
  const record = atom();
  assert.equal(store.commit(batch([{ kind: 'record.put', record }])).ok, true);
  const next = batch([{ kind: 'record.put', record: atom() }, { kind: 'record.put', record: { ...record, value: false } }], 2);
  assert.equal(store.commit(next).error.code, 'IDENTITY_CONFLICT');
  assert.equal(store.read(contextId).context.revision, 2);
  assert.equal(store.read(contextId).records.length, 1);
  assert.equal(store.events(contextId).length, 2);
});

test('independent assertion support survives withdrawal and historical snapshots remain unchanged', t => {
  const { store } = setup(t); const record = atom();
  const ref = { systemId: system, contextId, id: record.id };
  const assertion = () => ({ id: randomUUID(), record: ref, evidence: { sources: [], method: 'observation', artifactDigests: [] } });
  const a = assertion(), b = assertion();
  assert.equal(store.commit(batch([{ kind: 'record.put', record }, { kind: 'assertion.put', assertion: a }, { kind: 'assertion.put', assertion: b }])).ok, true);
  assert.equal(store.commit(batch([{ kind: 'assertion.withdraw', assertionId: a.id, reason: 'retracted' }], 2)).ok, true);
  assert.deepEqual(store.read(contextId).assertions.map(a => a.status), ['withdrawn', 'asserted']);
  assert.deepEqual(store.read(contextId, 2).assertions.map(a => a.status), ['asserted', 'asserted']);
  assert.equal(store.commit(batch([{ kind: 'assertion.put', assertion: a }], 3)).error.code, 'IDENTITY_CONFLICT');
});

test('competing processes using one observed revision admit exactly one writer', async t => {
  const { filename } = setup(t);
  const script = `import {Store} from ${JSON.stringify(new URL('../runtime/store.mjs', import.meta.url).href)};const s=new Store(process.argv[1],process.argv[2]); console.log(JSON.stringify(s.commit(JSON.parse(process.argv[3]))));s.close();`;
  const run = input => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, filename, system, JSON.stringify(input)]);
    let output = '', errors = '';
    child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => errors += bytes);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)));
  });
  const results = await Promise.all([run(batch([{ kind: 'record.put', record: atom() }])), run(batch([{ kind: 'record.put', record: atom() }]))]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).error.code, 'REVISION_CONFLICT');
});

test('canonical JSON rejects unsupported values and retains exact JSON distinctions', () => {
  assert.equal(canonical({ b: 1, a: [null, true] }), '{"a":[null,true],"b":1}');
  for (const value of [undefined, NaN, Infinity, new Date(), [, 1], '\ud800', { '\udfff': 1 }]) assert.throws(() => canonical(value));
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.notEqual(digest('1'), digest(1));
});

test('a killed process leaves no partial snapshot, event or outbox transaction', t => {
  const { store, filename } = setup(t);
  const script = `import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(process.argv[1]); d.exec('BEGIN IMMEDIATE'); d.prepare('INSERT INTO outbox VALUES (?, ?, ?)').run(process.argv[2], 'interrupted', '{}'); process.kill(process.pid, 'SIGKILL');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, filename, contextId], { encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL');
  assert.equal(store.outbox(contextId).length, 0);
  assert.equal(store.read(contextId).context.revision, 1);
  assert.equal(store.integrity(), 'ok');
});

test('context bootstrap retry identity is scoped to the system, not caller-chosen new IDs', t => {
  const { store } = setup(t);
  const changed = { ...context, id: randomUUID() };
  assert.equal(store.create(changed, principalId, 'bootstrap', digest(changed)).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.throws(() => store.read(changed.id), { code: 'NOT_FOUND' });
});
