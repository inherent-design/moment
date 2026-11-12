import { realpathSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

const canonicalPath = value => { try { return realpathSync(value); } catch { return resolve(value); } };
export function normalizeOrigin(value) {
  const scp = value.match(/^(?:[^@/:]+@)?([^/:]+):(.+)$/);
  if (scp && !value.includes('://')) return `${scp[1].toLowerCase()}/${scp[2].replace(/\.git\/?$/, '').replace(/\/$/, '')}`;
  try {
    const url = new URL(value);
    return `${url.host.toLowerCase()}${url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '')}`;
  } catch { return value; }
}

function git(cwd, args) {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); }
  catch { return undefined; }
}
export function inspectProject(location) {
  const path = canonicalPath(location);
  const worktree = git(path, ['rev-parse', '--show-toplevel']);
  if (!worktree) return { path, kind: 'directory', origins: [] };
  const common = git(worktree, ['rev-parse', '--git-common-dir']);
  const origin = git(worktree, ['config', '--get', 'remote.origin.url']);
  return { path: canonicalPath(worktree), kind: 'git-worktree', commonDir: canonicalPath(isAbsolute(common) ? common : resolve(worktree, common)), origins: origin ? [normalizeOrigin(origin)] : [] };
}

/** Discovery reports candidates; it never relocates, merges, grants, or edits a project. */
export function identifyProject(registry, location) {
  const actual = inspectProject(location);
  const exact = registry.projects.filter(project => project.locations.some(entry => canonicalPath(entry.path) === actual.path));
  if (exact.length === 1) return { status: 'matched', projectId: exact[0].id, basis: 'location', actual };
  if (exact.length > 1) return { status: 'ambiguous', candidateIds: exact.map(project => project.id), basis: 'location', actual };
  const shared = actual.commonDir ? registry.projects.filter(project => project.locations.some(entry => {
    const inspected = inspectProject(entry.path);
    return inspected.commonDir === actual.commonDir;
  })) : [];
  if (shared.length === 1) return { status: 'matched', projectId: shared[0].id, basis: 'git-worktree', actual };
  if (shared.length > 1) return { status: 'ambiguous', candidateIds: shared.map(project => project.id), basis: 'git-worktree', actual };
  const candidates = registry.projects.filter(project => project.origins.some(origin => actual.origins.includes(normalizeOrigin(origin))));
  return { status: candidates.length ? 'unresolved' : 'unknown', candidateIds: candidates.map(project => project.id), basis: 'origin-hint', actual };
}
