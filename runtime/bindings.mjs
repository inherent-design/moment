import Ajv from 'ajv/dist/2020.js';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import generated from './generated/bindings.json' with { type: 'json' };
import { canonical, digest, bytesDigest, fail } from './json.mjs';
import { continuityProfile, kernelMethods, managedMethods, serviceMethods, internalOperations } from './operations.mjs';

function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze);Object.freeze(value); }return value; }
export const catalog = freeze(generated);
export const catalogIdentity = catalog.identity;
export const bindingMap = new Map(catalog.operations.map(operation => [operation.id, operation]));
const { digest: expected, ...identity } = catalog.identity;
if (expected !== digest({ ...catalog, identity })) throw new Error('Corrupt installed binding catalog');
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
for(const source of catalog.sources) {
  let path=resolve(sourceRoot,source.path);
  // Package managers omit the root lockfile. The generated distribution copy
  // preserves its exact bytes; an existing checkout lockfile is never bypassed.
  if(source.path==='pnpm-lock.yaml' && !lstatSync(path,{throwIfNoEntry:false})) path=resolve(sourceRoot,'runtime/generated/source-lock.yaml');
  if(!path.startsWith(sourceRoot.endsWith(sep)?sourceRoot:sourceRoot+sep) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || bytesDigest(readFileSync(path))!==source.digest) throw new Error('Bindings are stale; run pnpm generate:bindings before starting this build');
}
const implemented = catalog.operations.filter(o => o.availability === 'implemented').map(o => o.id).sort();
if (canonical(implemented) !== canonical([...kernelMethods, ...managedMethods, ...serviceMethods].sort())) throw new Error('Installed binding/handler mismatch');

const ajv = new Ajv({ strict: true, ownProperties: true });
const validators = new Map();
export function validateSurface(name,value) {
  if(!catalog.surfaceSchemas[name]) fail('INVALID_ARGUMENT','Unknown presentation schema');
  const key='surface:'+name;
  if(!validators.has(key)) validators.set(key,ajv.compile(catalog.surfaceSchemas[name]));
  if(!validators.get(key)(value)) fail('INTERNAL','Presentation does not match its contract');
}
export function validateBoundary(id, kind, value) {
  const binding = bindingMap.get(id);
  if (!binding) fail('INVALID_ARGUMENT', 'Unknown operation');
  try { canonical(value); } catch { fail('INVALID_ARGUMENT', `Invalid ${id} ${kind} JSON`); }
  const key = `${id}:${kind}`;
  if (!validators.has(key)) validators.set(key, ajv.compile(kind === 'envelope' ? binding.envelopeSchema : binding[`${kind}Schema`].document));
  if (!validators.get(key)(value)) fail('INVALID_ARGUMENT', `Invalid ${id} ${kind}`);
}
export function exposedOperations(profile = 'continuity') {
  if (!['continuity', 'operator'].includes(profile)) fail('INVALID_ARGUMENT', 'Unknown tool profile');
  const ids = profile === 'operator' ? implemented : continuityProfile;
  return ids.filter(id => bindingMap.get(id)?.availability === 'implemented' && !internalOperations.includes(id));
}
export function publicBinding(binding) {
  const { mcpName, envelopeSchema, ...record } = binding;return record;
}
export function discoverBindings({ operationId, limit = 20, cursor } = {}, profile = 'continuity') {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_ARGUMENT', 'Discovery limit must be 1–100');
  const exposed = exposedOperations(profile);
  let offset = 0;
  const query = { catalog: catalog.identity.digest, profile, operationId: operationId ?? null };
  if (cursor) {
    try {
      if (cursor.length > 2048) throw new Error();
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (canonical(decoded.query) !== canonical(query) || !Number.isInteger(decoded.offset) || decoded.offset < 0) throw new Error();
      offset = decoded.offset;
    } catch { fail('CURSOR_EXPIRED', 'Discovery changed or cursor is invalid; start discovery again'); }
  }
  const selected = operationId ? [bindingMap.get(operationId)] : catalog.operations.filter(o=>o.availability==='implemented');
  if (selected.some(o => !o)) fail('NOT_FOUND', 'Operation is not declared in this build');
  const page = { catalog: catalog.identity, exposedOperations: exposed, operations: [] };
  let count = 0;
  for (const item of selected.slice(offset, offset + limit)) {
    const record = publicBinding(item);
    page.operations.push(record);
    if (Buffer.byteLength(JSON.stringify(page)) > 260000) { page.operations.pop();break; }
    count++;
  }
  if (!count && selected.length > offset) fail('LIMIT_EXCEEDED', 'Selected binding exceeds discovery bound');
  if (offset + count < selected.length) page.nextCursor = Buffer.from(JSON.stringify({ query, offset: offset + count })).toString('base64url');
  return page;
}
