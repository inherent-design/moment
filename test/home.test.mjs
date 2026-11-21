import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, realpathSync,readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openHome, importIncident, readIncident } from '../runtime/home.mjs';
import { Store } from '../runtime/store.mjs';

function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'moment-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

test('central home setup is stable; overrides preserve existing alias and identity', t => {
  const home = setup(t);
  const first = openHome({ home });
  assert.equal(realpathSync(join(home, '.moment')), first.root);
  assert.deepEqual(openHome({ home }).registry, first.registry);
  const alternate = openHome({ home, override: join(home, 'elsewhere') });
  assert.notEqual(alternate.registry.systemId, first.registry.systemId);
  assert.equal(alternate.warnings.length, 1);
  assert.equal(realpathSync(join(home, '.moment')), first.root);
  assert.throws(() => openHome({ home, override: 'relative' }), { code: 'INVALID_ARGUMENT' });
  writeFileSync(join(alternate.root, 'registry.json'), JSON.stringify({ formatVersion: 2 }));
  assert.throws(() => openHome({ home, override: alternate.root }), { code: 'UNSUPPORTED_VERSION' });
});

test('existing directory is preserved; dangling aliases are refused', t => {
  const home = setup(t); mkdirSync(join(home, '.moment'));
  assert.equal(openHome({ home }).root, realpathSync(join(home, '.moment')));
  const other = setup(t); symlinkSync(join(other, 'missing'), join(other, '.moment'));
  assert.throws(() => openHome({ home: other }), { code: 'INVALID_ARGUMENT' });
});

test('an explicit store remains usable when an unrelated home alias is dangling',t=>{
  const home=setup(t),retired=join(home,'retired'),first=openHome({home,override:retired}),alias=join(home,'.moment');
  assert.equal(readlinkSync(alias),first.root);rmSync(retired,{recursive:true});
  assert.throws(()=>openHome({home}),{code:'INVALID_ARGUMENT'});
  const selected=openHome({home,override:join(home,'selected')});assert.equal(selected.root,realpathSync(join(home,'selected')));assert.equal(selected.warnings.length,1);
  assert.equal(readlinkSync(alias),first.root);assert.deepEqual(openHome({home,override:selected.root}).registry,selected.registry);
  assert.throws(()=>openHome({home,override:alias}),{code:'INVALID_ARGUMENT'});assert.throws(()=>openHome({home}),{code:'INVALID_ARGUMENT'});
});

test('bootstrap import retains exact bytes without activating work; changed imports and escaped content fail', t => {
  const home = setup(t), { root, registry } = openHome({ home });
  const id = randomUUID(), contextId = randomUUID(), projectId = randomUUID();
  const base = join(root, 'incidents', id);
  mkdirSync(base, { recursive: true }); mkdirSync(join(root, 'contexts', contextId), { recursive: true });
  registry.projects.push({ id: projectId, label: 'example', locations: [], origins: [], contextIds: [contextId] });
  writeFileSync(join(root, 'registry.json'), JSON.stringify(registry));
  writeFileSync(join(root, 'contexts', contextId, 'manifest.json'), JSON.stringify({ formatVersion: 1, id: contextId, label: 'example', projectIds: [projectId] }));
  const manifest = { formatVersion: 1, id, contextId, projectIds: [projectId], kind: 'implementation-intent', contentPath: 'intent.md', checkpointPath: 'checkpoint.json', status: 'ready', activation: 'manual' };
  writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(base, 'intent.md'), '# An intent\n\nOriginal bytes.\n');
  writeFileSync(join(base, 'checkpoint.json'), JSON.stringify({ formatVersion: 1, stage: 'ready', completed: [], next: 'invoke', blocker: null }));
  const store = new Store(join(root, 'runtime', 'store.sqlite'), registry.systemId);
  t.after(() => store.close());
  const imported = importIncident(store, root, id);
  assert.equal(imported.original.intent, readFileSync(join(base, 'intent.md'), 'utf8'));
  assert.deepEqual(importIncident(store, root, id), imported);
  assert.throws(() => store.read(contextId), { code: 'NOT_FOUND' });
  writeFileSync(join(base, 'intent.md'), 'Changed');
  assert.throws(() => importIncident(store, root, id), { code: 'IDENTITY_CONFLICT' });
  writeFileSync(join(base, 'manifest.json'), JSON.stringify({ ...manifest, contentPath: '../../registry.json' }));
  assert.throws(() => readIncident(root, id), { code: 'INVALID_ARGUMENT' });
  symlinkSync(join(root, 'registry.json'), join(base, 'escaped.json'));
  writeFileSync(join(base, 'manifest.json'), JSON.stringify({ ...manifest, contentPath: 'escaped.json' }));
  assert.throws(() => readIncident(root, id), { code: 'INVALID_ARGUMENT' });
});
