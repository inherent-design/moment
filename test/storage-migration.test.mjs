import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {Store} from '../runtime/store.mjs';
import {canonical,digest} from '../runtime/json.mjs';
import {convertLegacySnapshots,fingerprintStorage} from '../runtime/storage-migration.mjs';

function legacy(t) {
  const dir=mkdtempSync(join(tmpdir(),'moment-migrate-')),filename=join(dir,'store.sqlite');
  const db=new DatabaseSync(filename);chmodSync(filename,0o600);
  t.after(()=>{try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE snapshots(context_id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(context_id,revision));
    CREATE TABLE receipts(principal_id TEXT NOT NULL,context_id TEXT NOT NULL,method TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,response TEXT NOT NULL,commit_value TEXT NOT NULL,PRIMARY KEY(principal_id,context_id,method,key));
    CREATE TABLE events(context_id TEXT NOT NULL,sequence INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,value TEXT NOT NULL,PRIMARY KEY(context_id,sequence));
    CREATE TABLE outbox(context_id TEXT NOT NULL,execution_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(context_id,execution_id));
    CREATE TABLE imports(id TEXT PRIMARY KEY,digest TEXT NOT NULL,value TEXT NOT NULL);
    PRAGMA user_version=1;
  `);
  const systemId=randomUUID(),principalId=randomUUID(),contextId=randomUUID(),second=randomUUID(),recordId=randomUUID(),schema={name:'legacy',version:'1',digest:digest({})};
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('systemId',systemId);
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('retained-observation',canonical({value:'preserve exact auxiliary text λ'}));
  const state=(id,revision)=>({context:{id,systemId,revision,state:'open',label:'Legacy λ',policy:{systemId,contextId:id,id:randomUUID()},imports:[],limits:{concurrentExecutions:1,cpuMillis:100,memoryBytes:100,modelTokens:0,apiSpendMicrounits:0,outputBytes:100,currency:'USD'}},records:[],assertions:[],controlState:{owners:{[principalId]:{principalId}},fixture:{right:{same:true},left:{same:true}}}});
  const wrap=(value,revision)=>({value,ref:{systemId,contextId,id:value.id},digest:digest(value),recordedAt:'2026-11-15T00:00:00.000Z',recordedBy:principalId,revision});
  const a=state(contextId,1),b=structuredClone(a);b.context.revision=2;
  b.records=[wrap({kind:'atom',id:recordId,schema,value:JSON.parse('{"__proto__":{"opaque":true},"values":[null,false,1,"1","λ"]}')},2),wrap({kind:'atom',id:randomUUID(),schema,value:'second, not sorted'},2)];
  const proof={id:randomUUID(),record:{systemId,contextId,id:recordId},evidence:{sources:[],method:'Independent support',artifactDigests:[]}};
  b.assertions=[{assertion:wrap(proof,2),status:'asserted'}];
  const c=structuredClone(b);c.context.revision=3;c.assertions[0].status='withdrawn';c.assertions[0].withdrawnAtRevision=3;c.controlState.fixture.left={same:false};
  const d=state(second,1),e=structuredClone(d);e.context.revision=2;e.context.state='closed';
  const states=[a,b,c,d,e];
  for(const s of states)db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run(s.context.id,s.context.revision,canonical(s));
  const requestDigest=digest({actual:'request'}),response={accepted:true,unicode:'λ'},commit={transitionId:randomUUID(),contextId,previousRevision:1,revision:2,eventIds:[]};
  db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?,?,?)').run(principalId,contextId,'graph.transact','retained',requestDigest,canonical(response),canonical(commit));
  db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(contextId,1,randomUUID(),canonical({sequence:1,extra:'exact original event'}));
  for(const value of ['z-first','a-second','m-third'])db.prepare('INSERT INTO outbox VALUES (?,?,?)').run(contextId,value,canonical({id:value}));
  db.prepare('DELETE FROM outbox WHERE execution_id=?').run('a-second');
  db.prepare('INSERT INTO outbox VALUES (?,?,?)').run(contextId,'b-last',canonical({id:'b-last'}));
  db.prepare('INSERT INTO imports VALUES (?,?,?)').run(randomUUID(),digest('source'),canonical({original:'preserve imported bytes'}));
  return {db,filename,systemId,principalId,contextId,states,requestDigest,response,commit};
}
function convert(f) {
  f.db.exec('BEGIN IMMEDIATE');
  try{const result=convertLegacySnapshots(f.db,f.systemId);f.db.exec('COMMIT');return result;}
  catch(error){f.db.exec('ROLLBACK');throw error;}
}

test('recognized legacy conversion preserves every revision, auxiliary row, retry and outbox ordering',t=>{
  const f=legacy(t),before=fingerprintStorage(f.db,f.systemId),result=convert(f);
  assert.equal(result.converted,5);assert.equal(result.changed,true);
  assert.deepEqual(fingerprintStorage(f.db,f.systemId),before);
  const store=new Store(f.filename,f.systemId);
  try{
    for(const state of f.states)assert.equal(canonical(store.read(state.context.id,state.context.revision)),canonical(state));
    assert.deepEqual(store.receipt(f.principalId,f.contextId,'graph.transact','retained',f.requestDigest),{response:f.response,commit:f.commit});
    assert.deepEqual(store.outbox(f.contextId).map(x=>x.id),['z-first','m-third','b-last']);
    assert.equal(Object.hasOwn(store.read(f.contextId,2).records[0].value.value,'__proto__'),true);
  } finally{store.close();}
  f.db.exec('VACUUM');
  assert.deepEqual(fingerprintStorage(f.db,f.systemId),before);
  const pool=f.db.prepare('SELECT count(*) AS count FROM snapshot_values').get().count;
  assert.equal(convert(f).changed,false);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM snapshot_values').get().count,pool);
});

test('legacy readers refuse normal open and prepared old-layout writes cannot survive cutover',t=>{
  const f=legacy(t);
  assert.throws(()=>new Store(f.filename,f.systemId),{code:'UNSUPPORTED_VERSION'});
  const stale=new DatabaseSync(f.filename),insert=stale.prepare('INSERT INTO snapshots VALUES (?,?,?)');
  try{
    convert(f);
    assert.throws(()=>insert.run(randomUUID(),1,'{}'),/no such table/);
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM context_revisions').get().count,5);
  } finally{stale.close();}
});

test('actual process death after conversion before commit restores the complete original format',t=>{
  const f=legacy(t),before=fingerprintStorage(f.db,f.systemId);
  const script=`import {DatabaseSync} from 'node:sqlite';import {convertLegacySnapshots} from ${JSON.stringify(new URL('../runtime/storage-migration.mjs',import.meta.url).href)};
    const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');convertLegacySnapshots(db,process.argv[2]);process.kill(process.pid,'SIGKILL');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.filename,f.systemId],{encoding:'utf8'});
  assert.equal(child.signal,'SIGKILL',child.stderr);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='snapshot_values'").get().count,0);
  assert.deepEqual(fingerprintStorage(f.db,f.systemId),before);
  assert.equal(convert(f).converted,5);
});

test('identity, unknown legacy extensions and inconsistent rows refuse without partial conversion',t=>{
  const f=legacy(t),before=fingerprintStorage(f.db,f.systemId);
  f.db.exec('BEGIN IMMEDIATE');
  assert.throws(()=>convertLegacySnapshots(f.db,randomUUID()),{code:'IDENTITY_CONFLICT'});
  f.db.exec('ROLLBACK');
  assert.deepEqual(fingerprintStorage(f.db,f.systemId),before);
  f.db.exec('CREATE TABLE unrelated(value TEXT)');
  assert.throws(()=>convert(f),{code:'UNSUPPORTED_VERSION'});
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,1);
  f.db.exec('DROP TABLE unrelated');
  const row=f.db.prepare('SELECT context_id,revision,value FROM snapshots LIMIT 1').get();
  const state=JSON.parse(row.value);state.context.revision=999;
  f.db.prepare('UPDATE snapshots SET value=? WHERE context_id=? AND revision=?').run(canonical(state),row.context_id,row.revision);
  assert.throws(()=>convert(f),{code:'IDENTITY_CONFLICT'});
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='context_revisions'").get().count,0);
});
