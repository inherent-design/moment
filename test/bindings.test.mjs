import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateBindings, outputPath } from '../scripts/generate-bindings.mjs';
import { compileContract } from '../scripts/schema-compiler.mjs';
import { canonical } from '../runtime/json.mjs';
import { catalog, discoverBindings, exposedOperations, validateBoundary } from '../runtime/bindings.mjs';
import { kernelMethods, serviceMethods, managedMethods } from '../runtime/operations.mjs';

test('catalog generation is deterministic and accounts for exact installed handler availability', () => {
  const first = canonical(generateBindings()) + '\n';
  assert.equal(first, canonical(generateBindings()) + '\n');
  assert.equal(first, readFileSync(outputPath, 'utf8'));
  const implemented = catalog.operations.filter(o => o.availability === 'implemented');
  assert.deepEqual(implemented.map(o => o.id).sort(), [...kernelMethods, ...serviceMethods, ...managedMethods].sort());
  assert.equal(new Set(catalog.operations.map(o => o.mcpName)).size, catalog.operations.length);
  assert.equal(discoverBindings({ operationId: 'artifact.put' }).operations[0].availability, 'declared');
  assert.equal(exposedOperations('operator').includes('artifact.put'), false);
  assert.equal(exposedOperations('operator').includes('service.stop'), false);
  assert.throws(() => discoverBindings({ operationId: 'not.present' }), { code: 'NOT_FOUND' });
});

test('generated shape schemas and admitted refinements reject incompatible data', () => {
  validateBoundary('system.describe', 'input', { protocolVersion: '0.1' });
  assert.throws(() => validateBoundary('system.describe', 'input', { protocolVersion: '0.2' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => validateBoundary('context.get', 'input', { contextId: 'not-a-uuid' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => validateBoundary('context.get', 'output', { id: 'wrong', revision: 1 }), { code: 'INVALID_ARGUMENT' });
  for (const operation of catalog.operations) {
    // Compiling all documents catches dangling/foreign refs and invalid schemas.
    assert.throws(() => validateBoundary(operation.id, 'output', undefined), { code: 'INVALID_ARGUMENT' });
  }
});

test('unsupported and unresolved contract types fail generation rather than widening schemas', t => {
  const root = mkdtempSync(join(tmpdir(), 'moment-schema-'));t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'contract.ts'), source = readFileSync(new URL('../contracts/index.ts', import.meta.url), 'utf8');
  writeFileSync(path, source.replace('label: string;', 'label: unknown;'));
  assert.throws(() => compileContract(path), /Unsupported boundary type/);
  writeFileSync(path, source.replace('label: string;', 'label: MissingType;'));
  assert.throws(() => compileContract(path), /MissingType/);
});

test('offline discovery pages are bounded and tied to catalog, profile and selection', () => {
  const first = discoverBindings({ limit: 1 });assert.equal(first.operations.length, 1);
  const next = discoverBindings({ limit: 1, cursor: first.nextCursor });
  assert.notEqual(next.operations[0].id, first.operations[0].id);
  assert.throws(() => discoverBindings({ cursor: first.nextCursor }, 'operator'), { code: 'CURSOR_EXPIRED' });
  assert.throws(() => discoverBindings({ cursor: first.nextCursor, operationId: 'context.get' }), { code: 'CURSOR_EXPIRED' });
  assert.ok(Buffer.byteLength(JSON.stringify(discoverBindings({ limit: 100 }))) <= 262144);
});

test('the actual generator refuses stale sources, missing dispatch coverage and tool collisions',t=>{
  const directory=mkdtempSync(join(tmpdir(),'moment-generation-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const root=fileURLToPath(new URL('../',import.meta.url));
  for(const path of ['contracts','runtime','scripts','package.json','pnpm-lock.yaml']) cpSync(join(root,path),join(directory,path),{recursive:true});
  symlinkSync(join(root,'node_modules'),join(directory,'node_modules'),'dir');
  const run=()=>execFileSync(process.execPath,[join(directory,'scripts/generate-bindings.mjs'),'--check'],{encoding:'utf8',stdio:'pipe',timeout:10000});
  assert.match(run(),/Checked deterministic/);
  const directive=join(directory,'runtime/directives.mjs'),before=readFileSync(directive,'utf8');writeFileSync(directive,before+'\n');
  assert.throws(run,/Bindings are stale/);writeFileSync(directive,before);
  const kernel=join(directory,'runtime/kernel.mjs'),dispatch=readFileSync(kernel,'utf8');writeFileSync(kernel,dispatch.replace("case 'graph.query'","case 'graph.missing'"));
  assert.throws(run,/dispatch\/registration mismatch/);writeFileSync(kernel,dispatch);
  const contract=join(directory,'contracts/index.ts'),source=readFileSync(contract,'utf8');
  writeFileSync(contract,source.replace('export interface ManagedMethods {','export interface ManagedMethods {\n  "workspace_attach": { input: {}; output: {} };'));
  assert.throws(run,/Tool name collision/);
});
