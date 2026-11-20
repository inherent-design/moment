import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Store} from '../runtime/store.mjs';
import {writeSnapshot} from '../runtime/snapshot-values.mjs';
import {canonical,digest} from '../runtime/json.mjs';

function fixture(t,control={}) {
  const directory=mkdtempSync(join(tmpdir(),'moment-values-')),filename=join(directory,'store.sqlite');
  const systemId=randomUUID(),contextId=randomUUID(),principalId=randomUUID();
  const context={id:contextId,label:'Referenced history',policy:{systemId,contextId,id:randomUUID()},imports:[],limits:{concurrentExecutions:1,cpuMillis:1000,memoryBytes:1000,outputBytes:1000,modelTokens:0,apiSpendMicrounits:0,currency:'USD'}};
  const store=new Store(filename,systemId);
  assert.equal(store.create(context,principalId,'create',digest(context),control).ok,true);
  t.after(()=>{try{store.close();}catch{}rmSync(directory,{recursive:true,force:true});});
  const commit=(changes=[],controlChanges=[])=>{
    const revision=store.read(contextId).context.revision;
    const result=store.commit({mutation:{contextId,expectedRevision:revision,idempotencyKey:randomUUID()},principalId,requestDigest:digest({changes,controlChanges,revision}),changes,controlChanges,events:[],outbox:[],response:null});
    assert.equal(result.ok,true,JSON.stringify(result));return result;
  };
  return {store,filename,systemId,contextId,principalId,commit};
}

test('large unchanged values are retained once while every ordered historical revision remains exact',t=>{
  const f=fixture(t),large='preserved-source-λ;'.repeat(4096),schema={name:'fixture.value',version:'1',digest:digest({})};
  const records=[0,1].map(index=>({kind:'atom',id:randomUUID(),schema,value:{index,large}}));
  const ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
  const a={id:randomUUID(),record:ref(records[0].id),evidence:{sources:[],method:'independent observation',artifactDigests:[]}};
  f.commit([...records.map(record=>({kind:'record.put',record})),{kind:'assertion.put',assertion:a}]);
  const expected=new Map([[1,canonical(f.store.read(f.contextId,1))],[2,canonical(f.store.read(f.contextId,2))]]);
  for(let i=0;i<20;i++){
    f.commit(i===5?[{kind:'assertion.withdraw',assertionId:a.id,reason:'Retain earlier support'}]:[],[{namespace:'fixture',key:'current',value:{iteration:i}}]);
    const state=f.store.read(f.contextId);expected.set(state.context.revision,canonical(state));
  }
  for(const [revision,bytes] of expected)assert.equal(canonical(f.store.read(f.contextId,revision)),bytes);
  assert.deepEqual(f.store.read(f.contextId).records.map(x=>x.value.id),records.map(x=>x.id));
  assert.equal(f.store.read(f.contextId,2).assertions[0].status,'asserted');
  assert.equal(f.store.read(f.contextId).assertions[0].status,'withdrawn');
  const bodies=f.store.db.prepare('SELECT sum(length(CAST(bytes AS BLOB))) AS bytes FROM snapshot_values').get().bytes;
  const manifests=f.store.db.prepare('SELECT sum(length(CAST(manifest AS BLOB))) AS bytes FROM context_revisions').get().bytes;
  assert.ok(bodies+manifests<3*Buffer.byteLength(large),'Historical manifests must not repeatedly copy the large bodies');
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version,2);
  const cold=new Store(f.filename,f.systemId);
  try{for(const [revision,bytes] of expected)assert.equal(canonical(cold.read(f.contextId,revision)),bytes);}
  finally{cold.close();}
});

test('physical sharing does not alias mutable logical values or successive reads',t=>{
  const f=fixture(t,{fixture:{left:{items:['original']},right:{items:['original']}}});
  const state=f.store.read(f.contextId);
  state.controlState.fixture.left.items.push('caller-local');
  assert.deepEqual(state.controlState.fixture.right.items,['original']);
  assert.deepEqual(f.store.read(f.contextId).controlState.fixture.left.items,['original']);
  f.commit([],[{namespace:'fixture',key:'left',value:{items:['updated']}}]);
  assert.deepEqual(f.store.read(f.contextId,1).controlState.fixture.left.items,['original']);
  assert.deepEqual(f.store.read(f.contextId).controlState.fixture.right.items,['original']);
});

test('missing or corrupted representation bytes refuse a read without returning partial state',t=>{
  const f=fixture(t,{fixture:{value:{test:'retained'}}});
  const row=f.store.db.prepare('SELECT * FROM context_revisions WHERE context_id=?').get(f.contextId);
  f.store.db.prepare('UPDATE context_revisions SET manifest=? WHERE context_id=?').run('{}',f.contextId);
  assert.throws(()=>f.store.read(f.contextId),{code:'IDENTITY_CONFLICT'});
  f.store.db.prepare('UPDATE context_revisions SET manifest=? WHERE context_id=?').run(row.manifest,f.contextId);
  const id=JSON.parse(row.manifest).controlState.fixture.value;
  const original=f.store.db.prepare('SELECT bytes FROM snapshot_values WHERE id=?').get(id).bytes;
  f.store.db.prepare('UPDATE snapshot_values SET bytes=? WHERE id=?').run('null',id);
  assert.throws(()=>f.store.read(f.contextId),{code:'IDENTITY_CONFLICT'});
  f.store.db.prepare('UPDATE snapshot_values SET bytes=? WHERE id=?').run(original,id);
  assert.deepEqual(f.store.read(f.contextId).controlState.fixture.value,{test:'retained'});
  f.store.db.prepare('DELETE FROM snapshot_values WHERE id=?').run(id);
  assert.throws(()=>f.store.read(f.contextId),{code:'IDENTITY_CONFLICT'});
  assert.throws(()=>f.store.read(randomUUID()),{code:'NOT_FOUND'});
});

test('uncommitted value/root publication rolls back after actual child termination',t=>{
  const f=fixture(t),before=f.store.db.prepare('SELECT count(*) AS count FROM snapshot_values').get().count;
  assert.throws(()=>writeSnapshot(f.store.db,f.store.read(f.contextId)),{code:'INTERNAL'});
  const script=`import {DatabaseSync} from 'node:sqlite';import {readSnapshot,writeSnapshot} from ${JSON.stringify(new URL('../runtime/snapshot-values.mjs',import.meta.url).href)};
    const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');const state=readSnapshot(db,process.argv[2]);state.context.revision++;state.controlState.fixture={newValue:{never:'committed'}};writeSnapshot(db,state);process.kill(process.pid,'SIGKILL');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.filename,f.contextId],{encoding:'utf8'});
  assert.equal(child.signal,'SIGKILL',child.stderr);
  assert.equal(f.store.read(f.contextId).context.revision,1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM snapshot_values').get().count,before);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM context_revisions').get().count,1);
  assert.equal(f.store.integrity(),'ok');
});
