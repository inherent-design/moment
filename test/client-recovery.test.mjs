import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '../runtime/client.mjs';
import { digest } from '../runtime/json.mjs';
import { start, stop } from './daemon-fixture.mjs';
import { limits } from './helpers.mjs';

test('post-commit oversized response retains exact request and never repeats the write', async t => {
  const root = mkdtempSync(join(tmpdir(), 'moment-ambiguous-'));
  const child = await start(root);
  t.after(async () => { await stop(child); rmSync(root, { recursive: true, force: true }); });
  const client = createClient(root), contextId = randomUUID();
  assert.equal((await client.call('context.create', { id: contextId, label: 'Response recovery', bootstrapProfile: 'owner-local', idempotencyKey: 'bootstrap', limits })).ok, true);
  const document = { type: 'string', $comment: 'x'.repeat(1048190) };
  const schema = { name: 'fixture.oversized', version: '1', digest: digest(document) };
  const input = { contextId, expectedRevision: 1, idempotencyKey: 'oversized-write', schema, document };
  const result = await client.call('schema.publish', input);
  assert.equal(result.error?.code, 'OUTCOME_UNKNOWN');
  assert.equal(result.error.retry, 'reconcile');
  assert.deepEqual(result.error.details.params, input);
  assert.equal(result.error.details.method, 'schema.publish');
  assert.equal((await client.call('context.get', { contextId })).value.revision, 2);
  const db = new DatabaseSync(join(root, 'runtime/store.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT response FROM receipts WHERE context_id=? AND method=? AND key=?').get(contextId, 'schema.publish', input.idempotencyKey);
    assert.deepEqual(JSON.parse(row.response).value.document, document);
  } finally { db.close(); }
  const retry = await client.call(result.error.details.method, result.error.details.params);
  assert.equal(retry.error.code, 'OUTCOME_UNKNOWN');
  assert.equal((await client.call('context.get', { contextId })).value.revision, 2);
  const changed = await client.call('schema.publish', { ...input, document: { type: 'number' } });
  assert.equal(changed.error.code, 'IDEMPOTENCY_CONFLICT');
  // A second public call can use the exact admitted schema without retrieving its
  // oversized document. The retained durable receipt above proves exact bytes.
  const stored = await client.call('graph.transact', { contextId, expectedRevision: 2, idempotencyKey: 'schema-readback', changes: [{ kind: 'record.put', record: { kind: 'atom', id: randomUUID(), schema, value: 'schema admitted exactly once' } }] });
  assert.equal(stored.ok, true, JSON.stringify(stored));
  assert.equal(stored.value.revision, 3);
});

test('invalid and internal replies after dispatch preserve an immutable request without credentials', async t => {
  const root = mkdtempSync(join(tmpdir(), 'moment-reply-'));
  const { mkdirSync } = await import('node:fs');mkdirSync(join(root, 'runtime'));
  const server = net.createServer(socket => {
    let buffer = '';
    socket.on('data', bytes => {
      buffer += bytes;
      const lines = buffer.split('\n');if (lines.length < 3) return;
      const request = JSON.parse(lines[1]);
      const variants = {
        internal: { error: { code: -32603, message: 'Response lost after possible commit' } },
        invalid: { result: { ok: true } },
        wrongId: { result: { ok: true, value: {} }, id: 'wrong' },
      };
      socket.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...variants[request.params.idempotencyKey] }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(join(root, 'runtime/moment.sock'), resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve));rmSync(root, { recursive: true, force: true }); });
  for (const key of ['internal', 'invalid', 'wrongId']) {
    const input = { idempotencyKey: key, expectedRevision: 3, nested: { retain: 'original' } };
    const pending = createClient(root, { token: 'a'.repeat(64) }).call('graph.transact', input);
    input.nested.retain = 'caller changed this';
    const result = await pending;
    assert.equal(result.error.code, 'OUTCOME_UNKNOWN');
    assert.equal(result.error.details.params.nested.retain, 'original');
    assert.equal(result.error.details.params.idempotencyKey, key);
    assert.equal(JSON.stringify(result).includes('a'.repeat(64)), false);
  }
});
