import { existsSync, lstatSync, realpathSync, mkdirSync, symlinkSync, readFileSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, isAbsolute, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './json.mjs';
import { publishPrivate } from './private-files.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const present = path => { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
export function runtimeSocket(root) {
  const path=join(root,'runtime/moment.sock'),maximum=process.platform==='darwin'?104:107;
  if(Buffer.byteLength(path)>maximum) fail('LIMIT_EXCEEDED',`Central path exceeds this host's Unix socket limit (${maximum} bytes); use a shorter central storage path while preserving existing state`);
  return path;
}
/** Observational resolution: never creates an alias, directory or registry. */
export function inspectHome({ home = homedir(), override = process.env.MOMENT_HOME } = {}) {
  const alias=join(home,'.moment');
  if (override==='~' || override?.startsWith('~/')) override=join(home,override.slice(2));
  if (override!==undefined && (!override || !isAbsolute(override))) fail('INVALID_ARGUMENT','MOMENT_HOME must be absolute');
  const selected=override ?? (present(alias)?alias:join(home,'.local/share/moment'));
  if (!present(selected)) return { root:selected,alias };
  if (!existsSync(selected)) fail('INVALID_ARGUMENT','Moment home link is dangling; repair it explicitly');
  const root=realpathSync(selected);
  if (!statSync(root).isDirectory()) fail('INVALID_ARGUMENT','Moment store must be a directory');
  const registry=present(join(root,'registry.json'))?readVersioned(join(root,'registry.json')):undefined;
  if (registry && (!uuid(registry.systemId) || !Array.isArray(registry.projects))) fail('INVALID_ARGUMENT','Invalid central registry');
  return { root,alias,registry };
}
export function openHome({ home = homedir(), override = process.env.MOMENT_HOME } = {}) {
  const alias = join(home, '.moment');
  if (override === '~' || override?.startsWith('~/')) override = join(home, override.slice(2));
  if (override !== undefined && (!override || !isAbsolute(override))) fail('INVALID_ARGUMENT', 'MOMENT_HOME must be absolute');
  if (present(alias) && !existsSync(alias)) fail('INVALID_ARGUMENT', 'The ~/.moment link is dangling; repair it explicitly');
  const selected = override ?? (present(alias) ? alias : join(home, '.local/share/moment'));
  mkdirSync(selected, { recursive: true, mode: 0o700 });
  const root = realpathSync(selected);
  if (!statSync(root).isDirectory()) fail('INVALID_ARGUMENT', 'Moment store must be a directory');
  if (!present(alias)) symlinkSync(root, alias, 'dir');
  const warnings = realpathSync(alias) === root ? [] : ['MOMENT_HOME differs from ~/.moment; existing alias preserved'];
  const registryPath = join(root, 'registry.json');
  if (!present(registryPath)) {
    try { publishPrivate(registryPath, JSON.stringify({ formatVersion: 1, systemId: randomUUID(), projects: [] }, null, 2) + '\n'); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const registry = readVersioned(registryPath);
  if (!uuid(registry.systemId) || !Array.isArray(registry.projects)) fail('INVALID_ARGUMENT', 'Invalid central registry');
  return { root, alias, registry, warnings };
}

export function readVersioned(path) {
  if (statSync(path).size > 1048576) fail('LIMIT_EXCEEDED', 'Bootstrap file exceeds 1 MiB');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.formatVersion !== 1) fail('UNSUPPORTED_VERSION', 'Unsupported bootstrap format');
  return value;
}

export function readIncident(root, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) fail('INVALID_ARGUMENT', 'Invalid incident ID');
  const base = realpathSync(join(root, 'incidents', id));
  const incidentRoot = realpathSync(join(root, 'incidents'));
  if (!base.startsWith(incidentRoot + sep)) fail('INVALID_ARGUMENT', 'Incident directory escapes store');
  const manifestPath = join(base, 'manifest.json');
  const manifest = readVersioned(manifestPath);
  if (manifest.id !== id || !uuid(manifest.contextId) || !Array.isArray(manifest.projectIds) || !manifest.projectIds.every(uuid) || manifest.activation !== 'manual') fail('INVALID_ARGUMENT', 'Invalid saved incident manifest');
  const confined = relative => {
    if (typeof relative !== 'string' || isAbsolute(relative)) fail('INVALID_ARGUMENT', 'Incident content path must be relative');
    const target = realpathSync(resolve(base, relative));
    if (!target.startsWith(base + sep)) fail('INVALID_ARGUMENT', 'Incident content escapes its directory');
    if (statSync(target).size > 1048576) fail('LIMIT_EXCEEDED', 'Incident content exceeds 1 MiB');
    return target;
  };
  const content = confined(manifest.contentPath);
  const checkpoint = confined(manifest.checkpointPath);
  readVersioned(checkpoint);
  return { manifest, original: { manifest: readFileSync(manifestPath, 'utf8'), intent: readFileSync(content, 'utf8'), checkpoint: readFileSync(checkpoint, 'utf8') } };
}

export function importIncident(store, root, id) {
  const input = readIncident(root, id);
  const registry = readVersioned(join(root, 'registry.json'));
  const contextRoot = realpathSync(join(root, 'contexts'));
  const contextFile = realpathSync(join(contextRoot, input.manifest.contextId, 'manifest.json'));
  if (!contextFile.startsWith(contextRoot + sep)) fail('INVALID_ARGUMENT', 'Context manifest escapes store');
  const context = readVersioned(contextFile);
  if (context.id !== input.manifest.contextId || input.manifest.projectIds.some(id => !registry.projects.some(project => project.id === id) || !context.projectIds.includes(id))) fail('INVALID_ARGUMENT', 'Unresolved incident project or context association');
  return store.importBootstrap(id, input.original);
}

/** Atomic file replacement for the caller's checkpoint, never an authorization grant. */
export function writeCheckpoint(path, value) {
  const temporary = `${path}.${randomUUID()}.writing`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally { if (present(temporary)) unlinkSync(temporary); }
}
