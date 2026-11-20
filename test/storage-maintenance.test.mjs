import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {openHome} from '../runtime/home.mjs';
import {credentials,serve} from '../runtime/server.mjs';
import {Store} from '../runtime/store.mjs';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {planStorage,migrateStorage} from '../runtime/storage-maintenance.mjs';
import {fingerprintMemory,fingerprintStorage} from '../runtime/storage-migration.mjs';
import {assertMigrationReady,migrationJournal} from '../runtime/migration-state.mjs';
import {canonical,digest} from '../runtime/json.mjs';
import {legacyMemoryFixture} from './legacy-memory-fixture.mjs';
import {createClient} from '../runtime/client.mjs';

function fixture(t,{kernelVersion=1,memoryVersion=1,unknown=false}={}){
  const directory=mkdtempSync(join(tmpdir(),'mst-')),home=openHome({home:directory,override:join(directory,'s')}),auth=credentials(home.root);
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(home.root,'runtime/store.sqlite'),store=new Store(path,home.registry.systemId),contextId=randomUUID();
  const created=store.create({id:contextId,label:'Retained history',policy:{systemId:home.registry.systemId,contextId,id:randomUUID()},imports:[],limits:{concurrentExecutions:1,cpuMillis:1000,memoryBytes:10000,outputBytes:1000,modelTokens:0,apiSpendMicrounits:0,currency:'USD'}},auth.principalId,'fixture',digest('fixture'));
  assert.equal(created.ok,true);const state=store.read(contextId);store.close();
  if(kernelVersion===1){const db=new DatabaseSync(path);db.exec('CREATE TABLE snapshots(context_id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(context_id,revision))');
    db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run(contextId,1,canonical(state));db.exec('DROP TABLE context_revisions; DROP TABLE snapshot_values; PRAGMA user_version=1');db.close();}
  const memoryPath=join(home.root,'runtime/session-memory.sqlite'),session={runtimeId:'owned-codex',sessionId:randomUUID()},memoryFixture=legacyMemoryFixture(memoryPath,home.registry.systemId,{version:memoryVersion,session,unknown});
  return {root:home.root,systemId:home.registry.systemId,path,memoryPath,session,contextId,state,memoryFixture};
}

test('falsy private records remain present and refuse startup or migration without replacement',async t=>{
  for(const value of [null,false,0,'']){
    const f=fixture(t,{kernelVersion:2,memoryVersion:2}),plan=planStorage(f.root),path=migrationJournal(f.root),bytes=canonical(value)+'\n';
    writeFileSync(path,bytes,{mode:0o600});
    assert.throws(()=>assertMigrationReady(f.root),{code:'CAPABILITY_UNAVAILABLE'});
    await assert.rejects(migrateStorage(f.root,plan),{code:'UNSUPPORTED_VERSION'});
    assert.equal(readFileSync(path,'utf8'),bytes);
    const g=fixture(t,{kernelVersion:2,memoryVersion:2}),laborPlan=planStorage(g.root),laborPath=join(g.root,'runtime/native-labor.json');
    writeFileSync(laborPath,bytes,{mode:0o600});
    await assert.rejects(migrateStorage(g.root,laborPlan),{code:'OUTCOME_UNKNOWN'});
    assert.equal(readFileSync(laborPath,'utf8'),bytes);
    const after=planStorage(g.root);assert.deepEqual(after.kernel,laborPlan.kernel);assert.deepEqual(after.memory,laborPlan.memory);
  }
});

for(const cutoff of ['before-create','memory-initialized','enrollment-requested'])test('absent memory initialization recovers after process death at '+cutoff,async t=>{
  const f=fixture(t,{kernelVersion:2,memoryVersion:2});
  for(const path of [f.memoryPath,f.memoryPath+'-wal',f.memoryPath+'-shm'])rmSync(path,{force:true});
  const plan=planStorage(f.root,{enroll:[f.session]}),input=join(f.root,'absent-plan.json');assert.equal(plan.from.memory,null);writeFileSync(input,canonical(plan),{mode:0o600});
  const script=`import {readFileSync} from 'node:fs';import {migrateStorage} from ${JSON.stringify(new URL('../runtime/storage-maintenance.mjs',import.meta.url).href)};
    let verified=0;await migrateStorage(process.argv[1],JSON.parse(readFileSync(process.argv[2],'utf8')),{onStage(stage){if(stage==='verified')verified++;if(process.argv[3]==='before-create'&&stage==='verified'&&verified===2||process.argv[3]==='memory-initialized'&&stage==='memory-initialized'||process.argv[3]==='enrollment-requested'&&stage==='verified'&&verified===3)process.kill(process.pid,'SIGKILL');}});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.root,input,cutoff],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const retained=JSON.parse(readFileSync(migrationJournal(f.root),'utf8'));assert.deepEqual(retained.initialization,{formatVersion:1,component:'memory',systemId:f.systemId,planDigest:digest(plan)});
  assert.throws(()=>assertMigrationReady(f.root),{code:'CAPABILITY_UNAVAILABLE'});
  if(cutoff==='before-create'){
    for(const initialization of [null,false,{...retained.initialization,formatVersion:99},{...retained.initialization,component:'kernel'},{...retained.initialization,systemId:randomUUID()},{...retained.initialization,planDigest:digest('other')}]){
      const bytes=canonical({...retained,initialization})+'\n';writeFileSync(migrationJournal(f.root),bytes,{mode:0o600});
      await assert.rejects(migrateStorage(f.root,plan),{code:'IDENTITY_CONFLICT'});assert.equal(readFileSync(migrationJournal(f.root),'utf8'),bytes);
    }
    writeFileSync(migrationJournal(f.root),canonical(retained)+'\n',{mode:0o600});
  }
  const unrelated={runtimeId:'owned-other',sessionId:randomUUID()},principal=credentials(f.root).principalId;
  if(cutoff!=='before-create'){
    const memory=new SessionMemory(f.memoryPath,f.systemId);memory.configure({session:unrelated,expectedRevision:0,idempotencyKey:'new-write',enabled:true},principal);memory.close();
  }
  const result=await migrateStorage(f.root,plan);assert.equal(result.formats.memory,3);assertMigrationReady(f.root);
  const memory=new SessionMemory(f.memoryPath,f.systemId);try{assert.equal(memory.subscription(f.session).revision,1);assert.equal(memory.subscription(f.session).enabled,true);if(cutoff!=='before-create')assert.equal(memory.subscription(unrelated).enabled,true);}finally{memory.close();}
  assert.deepEqual(await migrateStorage(f.root,plan),result);
});

test('unknown unversioned and extended current kernel layouts refuse without initializing or discarding schema',t=>{
  const directory=mkdtempSync(join(tmpdir(),'moment-unknown-kernel-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'unknown.sqlite');writeFileSync(path,'',{mode:0o600});
  let db=new DatabaseSync(path);db.exec("CREATE TABLE authored(value TEXT);INSERT INTO authored VALUES ('preserve me')");db.close();
  assert.throws(()=>new Store(path,'unknown-system'),{code:'UNSUPPORTED_VERSION'});
  db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);assert.equal(db.prepare('SELECT value FROM authored').get().value,'preserve me');assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name),['authored']);}finally{db.close();}
  for(const change of ['CREATE TABLE unexpected(value TEXT)', 'CREATE TRIGGER extra AFTER INSERT ON metadata BEGIN SELECT 1; END', 'CREATE INDEX extra ON events(sequence)', 'ALTER TABLE imports ADD COLUMN unexpected TEXT']){
    const f=fixture(t,{kernelVersion:2,memoryVersion:2}),current=new DatabaseSync(f.path);current.exec(change);current.close();
    assert.throws(()=>planStorage(f.root),{code:'UNSUPPORTED_VERSION'});
    assert.throws(()=>new Store(f.path,f.systemId),{code:'UNSUPPORTED_VERSION'});
    const observed=new DatabaseSync(f.path,{readOnly:true});try{assert.equal(observed.prepare('PRAGMA user_version').get().user_version,2);assert.equal(observed.prepare("SELECT value FROM metadata WHERE key='systemId'").get().value,f.systemId);}finally{observed.close();}
  }
});

test('operator plan, backup, all-history conversion, preserved enrollment and exact completed retry',async t=>{
  const f=fixture(t),before=readFileSync(f.path),plan=planStorage(f.root,{enroll:[f.session]});
  assert.equal(plan.from.kernel,1);assert.equal(plan.from.memory,1);assert.deepEqual(readFileSync(f.path),before);
  const result=await migrateStorage(f.root,plan);assert.equal(result.formats.kernel,2);assert.equal(result.formats.memory,3);assert.equal(result.kernel.snapshots,1);assert.deepEqual(result.memory.originalFingerprint,plan.memory);assertMigrationReady(f.root);
  const store=new Store(f.path,f.systemId);assert.deepEqual(store.read(f.contextId,1),f.state);store.close();
  const memory=new SessionMemory(f.memoryPath,f.systemId);
  assert.equal(memory.subscription(f.session).enabled,true);assert.equal(memory.read({session:f.session}).processedThrough,1);assert.equal(memory.read({session:f.session}).sources[0].text,'Preserve exact history.');memory.close();
  const original=new DatabaseSync(join(result.recovery,'store.sqlite'),{readOnly:true});assert.equal(original.prepare('PRAGMA user_version').get().user_version,1);assert.deepEqual(fingerprintStorage(original,f.systemId,{includeOwnership:false}),plan.kernel);original.close();
  const a=new Store(f.path,f.systemId);a.db.prepare('INSERT INTO metadata VALUES (?,?)').run('accepted-after-migration','preserve this new write');a.close();
  assert.deepEqual(await migrateStorage(f.root,plan),result);
  const after=new DatabaseSync(f.path,{readOnly:true});assert.equal(after.prepare("SELECT value FROM metadata WHERE key='accepted-after-migration'").get().value,'preserve this new write');after.close();
});

test('stale plan and live ownership refuse before backup or journal creation',async t=>{
  const f=fixture(t),plan=planStorage(f.root),db=new DatabaseSync(f.path);
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('competing','new state');db.close();
  await assert.rejects(migrateStorage(f.root,plan),{code:'REVISION_CONFLICT'});
  const fresh=planStorage(f.root),owned=new DatabaseSync(f.path);owned.prepare('INSERT INTO metadata VALUES (?,?)').run('daemonClaim',canonical({pid:process.pid,nonce:randomUUID()}));owned.close();
  await assert.rejects(migrateStorage(f.root,fresh),{code:'CAPABILITY_UNAVAILABLE'});
  assertMigrationReady(f.root);
});

for(const stage of ['before-commit','kernel-committed','memory-committed','verified'])test('actual process death at '+stage+' recovers forward without service admission',async t=>{
  const f=fixture(t),plan=planStorage(f.root,{enroll:[f.session]}),input=join(f.root,'plan.json');writeFileSync(input,canonical(plan),{mode:0o600});
  const script=`import {readFileSync} from 'node:fs';import {migrateStorage} from ${JSON.stringify(new URL('../runtime/storage-maintenance.mjs',import.meta.url).href)};
    await migrateStorage(process.argv[1],JSON.parse(readFileSync(process.argv[2],'utf8')),{onStage:stage=>{if(stage===process.argv[3])process.kill(process.pid,'SIGKILL');}});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.root,input,stage],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  assert.throws(()=>assertMigrationReady(f.root),{code:'CAPABILITY_UNAVAILABLE'});
  await assert.rejects(serve(f.root,f.systemId),{code:'CAPABILITY_UNAVAILABLE'});
  const result=await migrateStorage(f.root,plan);assert.equal(result.formats.kernel,2);assertMigrationReady(f.root);
  const memory=new SessionMemory(f.memoryPath,f.systemId);assert.equal(memory.subscription(f.session).revision,1);assert.equal(memory.read({session:f.session}).processedThrough,1);memory.close();
  const store=new Store(f.path,f.systemId);assert.deepEqual(store.read(f.contextId),f.state);store.close();
});

test('unknown memory layout and retained unsettled dispatch refuse without resetting state',async t=>{
  const f=fixture(t),db=new DatabaseSync(f.memoryPath);db.exec('CREATE TABLE unexpected(value TEXT)');db.close();
  assert.throws(()=>planStorage(f.root),{code:'UNSUPPORTED_VERSION'});
  const repair=new DatabaseSync(f.memoryPath);repair.exec('DROP TABLE unexpected');repair.close();
  const plan=planStorage(f.root),active=new DatabaseSync(f.memoryPath);active.prepare('INSERT INTO dispatches VALUES (?,?)').run(randomUUID(),canonical({status:'unknown'}));active.close();
  await assert.rejects(migrateStorage(f.root,plan),{code:'OUTCOME_UNKNOWN'});
});

test('retired managed child is not mistaken for its still-live bridge parent; uncertain startup is retained',async t=>{
  const f=fixture(t),dead=spawnSync(process.execPath,['-e',''],{encoding:'utf8'}).pid;assert.throws(()=>process.kill(dead,0),{code:'ESRCH'});
  const db=new DatabaseSync(f.path);db.prepare('INSERT INTO metadata VALUES (?,?)').run('managedStartup',canonical({pid:dead,nonce:randomUUID()}));db.close();
  await assert.rejects(migrateStorage(f.root,planStorage(f.root)),{code:'OUTCOME_UNKNOWN'});
  const recovered=new DatabaseSync(f.path);recovered.prepare("UPDATE metadata SET value=? WHERE key='managedStartup'").run(canonical({pid:process.pid,childPid:dead,nonce:randomUUID()}));recovered.close();
  const result=await migrateStorage(f.root,planStorage(f.root));assert.equal(result.formats.kernel,2);
});

test('memory-only migration preserves matching unknown labor and starts with readable custody instead of another dispatch',async t=>{
  const f=fixture(t,{kernelVersion:2,memoryVersion:2,unknown:true}),dispatch=f.memoryFixture.active;
  const labor={formatVersion:1,holder:{component:'memory',dispatchId:dispatch.id,inputDigest:dispatch.inputDigest}};
  writeFileSync(join(f.root,'runtime/native-labor.json'),canonical(labor),{mode:0o600});
  const plan=planStorage(f.root),result=await migrateStorage(f.root,plan);assert.equal(result.formats.memory,3);assert.deepEqual(JSON.parse(readFileSync(join(f.root,'runtime/native-labor.json'))),labor);
  const memory=new SessionMemory(f.memoryPath,f.systemId);assert.deepEqual(memory.active(),dispatch);assert.equal(memory.read({session:f.session}).pending[0].status,'unknown');memory.close();
  let calls=0;const server=await serve(f.root,f.systemId,{memoryProvider:{async ready(){calls++;throw Error('Unknown work must not dispatch');},async invoke(){calls++;throw Error('No inference');}}});
  try{
    const read=await createClient(f.root).call('memory.read',{session:f.session});assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.value.pending[0].dispatchId,dispatch.id);assert.equal(read.value.worker.state,'unknown');assert.equal(calls,0);
  }finally{await server.close();}
  assert.deepEqual(JSON.parse(readFileSync(join(f.root,'runtime/native-labor.json'))),labor);assert.equal(calls,0);
});

test('a completed older migration is archived before the new plan and both exact receipts survive later writes',async t=>{
  const f=fixture(t,{kernelVersion:2,memoryVersion:2}),fresh=planStorage(f.root),id=randomUUID(),recovery=join(f.root,'runtime/recovery',id);
  mkdirSync(recovery,{recursive:true,mode:0o700});
  const oldPlan={formatVersion:1,id,root:f.root,systemId:f.systemId,createdAt:'2026-11-01T00:00:00.000Z',from:{kernel:1,memory:1},to:{kernel:2,memory:2},kernel:fresh.kernel,memory:fresh.memory,owner:fresh.owner,enroll:[],requirements:[]};
  const oldResult={systemId:f.systemId,formats:{kernel:2,memory:2},recovery,enrollments:[],newWritesAccepted:false};
  const oldJournal={formatVersion:1,planDigest:digest(oldPlan),plan:oldPlan,recovery,stage:'complete',result:oldResult};writeFileSync(migrationJournal(f.root),canonical(oldJournal),{mode:0o600});
  assert.deepEqual(await migrateStorage(f.root,oldPlan),oldResult);
  const result=await migrateStorage(f.root,fresh);assert.equal(result.formats.memory,3);
  assert.deepEqual(JSON.parse(readFileSync(join(recovery,'completed-journal.json'),'utf8')),oldJournal);
  const memory=new SessionMemory(f.memoryPath,f.systemId);memory.observe({session:f.session,deliveryId:'accepted-after-upgrade',message:{text:'Preserve this subsequent input.',authorship:'unknown'}});memory.close();
  assert.deepEqual(await migrateStorage(f.root,oldPlan),oldResult);assert.deepEqual(await migrateStorage(f.root,fresh),result);
  const current=new SessionMemory(f.memoryPath,f.systemId);assert.equal(current.read({session:f.session}).observedThrough,2);current.close();
});

test('changed operator limits invalidate a plan and unsafe retained backup locations never receive source data',async t=>{
  const f=fixture(t),plan=planStorage(f.root),settings=join(f.root,'runtime/session-memory-limits.json');
  writeFileSync(settings,canonical({formatVersion:1,limits:{maxAutomaticBytes:2048}}),{mode:0o600});
  await assert.rejects(migrateStorage(f.root,plan),{code:'REVISION_CONFLICT'});
  const fresh=planStorage(f.root);assert.equal(fresh.memoryLimits.maxAutomaticBytes,2048);
  await assert.rejects(migrateStorage(f.root,fresh,{onStage:stage=>{if(stage==='prepared')throw Error('Owned preparation interruption');}}),/Owned preparation interruption/);
  const journal=JSON.parse(readFileSync(migrationJournal(f.root),'utf8')),escape=join(journal.recovery,'../outside-memory.sqlite');journal.backups.memory=escape;writeFileSync(migrationJournal(f.root),canonical(journal),{mode:0o600});
  await assert.rejects(migrateStorage(f.root,fresh),{code:'IDENTITY_CONFLICT'});
  const exists=await import('node:fs');assert.equal(exists.existsSync(escape),false);
  const original=new DatabaseSync(f.memoryPath);assert.equal(original.prepare('PRAGMA user_version').get().user_version,1);assert.deepEqual(fingerprintMemory(original,f.systemId),fresh.memory);original.close();
});

test('an unsupported retained journal version refuses forward mutation and preserves recovery',async t=>{
 const f=fixture(t,{kernelVersion:2,memoryVersion:2}),plan=planStorage(f.root),recovery=join(f.root,'runtime/recovery',plan.id);mkdirSync(recovery,{recursive:true,mode:0o700});
 const journal={formatVersion:99,planDigest:digest(plan),plan,recovery,stage:'prepared',backups:{kernel:join(recovery,'store.sqlite'),memory:join(recovery,'session-memory.sqlite')}};writeFileSync(migrationJournal(f.root),canonical(journal),{mode:0o600});
 const before=readFileSync(migrationJournal(f.root));await assert.rejects(migrateStorage(f.root,plan),{code:'UNSUPPORTED_VERSION'});assert.deepEqual(readFileSync(migrationJournal(f.root)),before);
 const db=new DatabaseSync(f.memoryPath,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);db.close();
});

test('a cancellation request still requires observed execution settlement before storage conversion',async t=>{
 const f=fixture(t),db=new DatabaseSync(f.path),state=structuredClone(f.state);state.controlState.executions={[randomUUID()]:{value:{state:'cancel_requested'}}};db.prepare('UPDATE snapshots SET value=? WHERE context_id=?').run(canonical(state),f.contextId);db.close();
 const plan=planStorage(f.root);await assert.rejects(migrateStorage(f.root,plan),{code:'OUTCOME_UNKNOWN'});assertMigrationReady(f.root);
 const source=new DatabaseSync(f.path,{readOnly:true});assert.equal(source.prepare('PRAGMA user_version').get().user_version,1);source.close();
});

test('recovered configuration cannot enroll a different session from the retained plan',async t=>{
 const f=fixture(t,{kernelVersion:2,memoryVersion:2}),plan=planStorage(f.root,{enroll:[f.session]});await assert.rejects(migrateStorage(f.root,plan,{onStage:stage=>{if(stage==='verified')throw Error('Owned pause at verified storage');}}),/Owned pause/);
 const other={runtimeId:'owned-fixture',sessionId:randomUUID()},path=migrationJournal(f.root),journal=JSON.parse(readFileSync(path));journal.configurationRequests=[{session:other,expectedRevision:0,idempotencyKey:'migration:'+plan.id,enabled:true}];writeFileSync(path,canonical(journal),{mode:0o600});const before=readFileSync(path);
 await assert.rejects(migrateStorage(f.root,plan),{code:'IDENTITY_CONFLICT'});assert.deepEqual(readFileSync(path),before);const memory=new SessionMemory(f.memoryPath,f.systemId);try{assert.equal(memory.subscription(f.session).enabled,false);assert.equal(memory.subscription(other).enabled,false);}finally{memory.close();}
});
