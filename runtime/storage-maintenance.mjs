import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,openSync,closeSync,constants,lstatSync,readFileSync,existsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectHome} from './home.mjs';
import {readPrivateJson,publishPrivate,replacePrivate} from './private-files.mjs';
import {migrationJournal} from './migration-state.mjs';
import {canonical,digest,bytesDigest,fail} from './json.mjs';
import {fingerprintStorage,convertLegacySnapshots,fingerprintMemory,convertLegacyMemory} from './storage-migration.mjs';
import {SessionMemory} from './session-memory.mjs';
import {configuredMemoryLimits} from './memory-settings.mjs';
import {publishEnrollment} from './memory-enrollment.mjs';
import {startupStatus} from './store.mjs';

const version=db=>db.prepare('PRAGMA user_version').get().user_version;
function openPrivate(path,{readOnly=false,create=false}={}) {
  if(create){const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);closeSync(fd);}
  const stat=lstatSync(path);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077)fail('IDENTITY_CONFLICT','Maintenance requires a private owned regular database');
  const db=new DatabaseSync(path,{readOnly});db.exec('PRAGMA busy_timeout=1000');return db;
}
function optionalJson(path,maximum=262144) {try{return readPrivateJson(path,maximum);}catch(error){if(error.code==='ENOENT')return;throw error;}}
function currentOwner(db) {
  for(const key of ['daemonClaim','managedStartup']){
    const row=db.prepare('SELECT value FROM metadata WHERE key=?').get(key);if(!row)continue;
    let claim;try{claim=JSON.parse(row.value);}catch{fail('IDENTITY_CONFLICT','Unrecognized service ownership; inspect before migration');}
    if(key==='managedStartup'){
      const status=startupStatus(claim);
      if(status==='stale')continue;
      if(status==='uncertain')fail('OUTCOME_UNKNOWN','Startup custody is uncertain; retain it for inspection before migration','reconcile');
      fail('CAPABILITY_UNAVAILABLE','A managed Moment starter is live; wait for its attributable retirement');
    }
    for(const pid of [claim.pid]){
      if(!Number.isSafeInteger(pid) || pid<1)fail('IDENTITY_CONFLICT','Unrecognized service ownership');
      try{process.kill(pid,0);fail('CAPABILITY_UNAVAILABLE','Moment still has a live writer or starter; stop only the inspected Moment service before migration');}
      catch(error){if(error.code!=='ESRCH')throw error;}
    }
  }
}
function idle(root,kernel,memory,{preserveMemoryCustody=false}={}) {
  currentOwner(kernel);
  const labor=optionalJson(join(root,'runtime/native-labor.json'),8192);
  if(labor && (labor.formatVersion!==1 || labor.holder && (!preserveMemoryCustody||labor.holder.component!=='memory')))fail('OUTCOME_UNKNOWN','Native labor is retained or unrecognized; settle it before storage migration','reconcile');
  if(labor?.holder&&preserveMemoryCustody){
    const row=memory?.prepare('SELECT value FROM dispatches WHERE id=?').get(labor.holder.dispatchId),dispatch=row?JSON.parse(row.value):undefined;
    if(!dispatch||dispatch.inputDigest!==labor.holder.inputDigest)fail('OUTCOME_UNKNOWN','Retained memory labor has no matching dispatch; preserve its custody for inspection','reconcile');
  }
  if(memory && memory.prepare('SELECT 1 FROM dispatches LIMIT 1').get()&&!preserveMemoryCustody)fail('OUTCOME_UNKNOWN','A session memory dispatch requires settlement before migration','reconcile');
  const table=version(kernel)===1?'snapshots':'context_revisions';
  for(const row of kernel.prepare('SELECT context_id,MAX(revision) AS revision FROM '+table+' GROUP BY context_id').all()){
    let state;
    if(version(kernel)===1)state=JSON.parse(kernel.prepare('SELECT value FROM snapshots WHERE context_id=? AND revision=?').get(row.context_id,row.revision).value);
    else { // Decode through the same integrity-checking storage reader.
      state=readCurrent(kernel,row.context_id,row.revision);
    }
    if(Object.values(state.controlState?.executions??{}).some(item=>['running','unknown'].includes(item.value?.state)))fail('OUTCOME_UNKNOWN','An execution needs observed settlement before migration','reconcile');
  }
}
import {readSnapshot as readCurrent} from './snapshot-values.mjs';
function sourceFiles(root) {return {kernel:join(root,'runtime/store.sqlite'),memory:join(root,'runtime/session-memory.sqlite'),owner:join(root,'runtime/owner.json')};}
function memoryState(path,systemId) {
  if(!existsSync(path))return null;
  const db=openPrivate(path,{readOnly:true});try{return {formatVersion:version(db),fingerprint:fingerprintMemory(db,systemId)};}finally{db.close();}
}
/** Observational plan: never starts a service or changes storage. */
export function planStorage(root,{enroll=[]}={}) {
  const home=inspectHome({override:root});if(!home.registry)fail('NOT_FOUND','Select an initialized Moment store');
  const files=sourceFiles(home.root),owner=readPrivateJson(files.owner),db=openPrivate(files.kernel,{readOnly:true});
  try{
    for(const session of enroll){if(!session || Object.keys(session).length!==2 || !['runtimeId','sessionId'].every(k=>typeof session[k]==='string' && session[k].length && Buffer.byteLength(session[k])<=256))fail('INVALID_ARGUMENT','Explicit actual session identities are required for preserved enrollments');}
    if(enroll.length>128 || new Set(enroll.map(canonical)).size!==enroll.length)fail('INVALID_ARGUMENT','Select at most 128 distinct enrollments');
    const memory=memoryState(files.memory,home.registry.systemId),memoryLimits=configuredMemoryLimits(home.root);
    return {formatVersion:1,id:randomUUID(),root:home.root,systemId:home.registry.systemId,createdAt:new Date().toISOString(),
      from:{kernel:version(db),memory:memory?.formatVersion??null},to:{kernel:2,memory:3},memoryLimits,
      kernel:fingerprintStorage(db,home.registry.systemId,{includeOwnership:false}),memory:memory?.fingerprint??null,
      owner:{principalId:owner.principalId,digest:bytesDigest(readFileSync(files.owner))},enroll,
      requirements:['Stop only the inspected Moment service. A memory-only upgrade on kernel format 2 preserves matching uncertain memory custody without dispatching inference; other native work retains its settlement requirement.','The operation retains every historical revision, receipt, event, import, outbox item and original memory row.','Recovery moves forward from exact private backups and verified converted fingerprints; it never overwrites later accepted writes.']};
  }finally{db.close();}
}
function match(actual,expected,message){if(canonical(actual)!==canonical(expected))fail('REVISION_CONFLICT',message,'refresh');}
function verifyIntegrity(db){if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('IDENTITY_CONFLICT','Storage integrity check failed; retain original and recovery files');}
function acquire(root) {
  const path=join(root,'runtime/storage-migration-lock.sqlite');
  let db;
  try{db=openPrivate(path,{create:!existsSync(path)});db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');return db;}
  catch(error){try{db?.close();}catch{}if([5,6].includes(error.errcode&255))fail('CAPABILITY_UNAVAILABLE','Another storage maintenance operation holds the local lock');throw error;}
}
async function privateBackup(source,destination) {
  const fd=openSync(destination,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);closeSync(fd);
  await backup(source,destination);
}
function privateDirectory(path){
  try{mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077)fail('IDENTITY_CONFLICT','Migration directories must be private, owned and direct');
}
function completeJournal(root,systemId,journal,planDigest){
  if(!journal||journal.formatVersion!==1||journal.stage!=='complete'||!journal.plan||!journal.result||journal.planDigest!==planDigest||digest(journal.plan)!==planDigest||journal.plan.root!==root||journal.plan.systemId!==systemId||journal.result.systemId!==systemId||!/^[0-9a-f-]{36}$/.test(journal.plan.id??'')||journal.recovery!==join(root,'runtime/recovery',journal.plan.id)||journal.result.recovery!==journal.recovery||canonical(journal.result.formats)!==canonical(journal.plan.to))fail('IDENTITY_CONFLICT','Completed migration receipt has inconsistent identity');
  return journal;
}
function archivedComplete(root,systemId,plan){
  const hash=digest(plan),active=optionalJson(migrationJournal(root));
  if(active?.planDigest===hash&&active.stage!=='complete')return;
  const value=active?.planDigest===hash?active:optionalJson(join(root,'runtime/recovery',plan.id,'completed-journal.json'));
  return value?completeJournal(root,systemId,value,hash):undefined;
}

/** Explicit operator operation; the caller owns publishing matching code and stopping Moment. */
export async function migrateStorage(root,plan,{onStage=()=>{}}={}) {
  const home=inspectHome({override:root});
  if(!home.registry || plan?.formatVersion!==1 || home.root!==plan.root || home.registry.systemId!==plan.systemId || !/^[0-9a-f-]{36}$/.test(plan.id??''))fail('IDENTITY_CONFLICT','Migration plan does not identify this store');
  if(canonical(plan.to)===canonical({kernel:2,memory:2})){
    const historical=archivedComplete(home.root,plan.systemId,plan);
    if(historical)return historical.result;
    fail('UNSUPPORTED_VERSION','This retained plan targets memory format 2; preserve its journal/backups and recover it with its qualified original build before a format-3 plan');
  }
  if(canonical(plan.to)!==canonical({kernel:2,memory:3})||![1,2].includes(plan.from?.kernel)||![null,1,2,3].includes(plan.from?.memory))fail('IDENTITY_CONFLICT','Migration plan does not identify supported source and target formats');
  const files=sourceFiles(home.root),planDigest=digest(plan),lock=acquire(home.root);
  let kernel,memory,journal,priorCompleted;
  const custody={preserveMemoryCustody:plan.from.kernel===2};
  const save=stage=>{journal.stage=stage;replacePrivate(migrationJournal(home.root),canonical(journal)+'\n');onStage(stage);};
  try {
    journal=optionalJson(migrationJournal(home.root));
    if(journal){
      if(journal.planDigest!==planDigest){
        if(journal.stage!=='complete')fail('IDENTITY_CONFLICT','A different retained migration owns this journal; resume its original exact plan');
        priorCompleted=completeJournal(home.root,plan.systemId,journal,journal.planDigest);journal=undefined;
      }else if(journal.stage==='complete')return completeJournal(home.root,plan.systemId,journal,planDigest).result;
      else if(!['prepared','backed-up','converted','verified'].includes(journal.stage))fail('UNSUPPORTED_VERSION','Unknown migration recovery stage');
    }
    const owner=readPrivateJson(files.owner);match({principalId:owner.principalId,digest:bytesDigest(readFileSync(files.owner))},plan.owner,'Owner credential custody changed since the plan');
    match(configuredMemoryLimits(home.root),plan.memoryLimits,'Memory limits changed since the plan; create a fresh plan');
    kernel=openPrivate(files.kernel);memory=existsSync(files.memory)?openPrivate(files.memory):undefined;
    if(version(kernel)!==plan.from.kernel&&!(journal?.conversion?.kernel&&version(kernel)===plan.to.kernel))fail('REVISION_CONFLICT','Kernel format changed since the plan','refresh');
    if((memory?version(memory):null)!==plan.from.memory&&!(journal?.conversion?.memory&&memory&&version(memory)===plan.to.memory))fail('REVISION_CONFLICT','Memory format changed since the plan','refresh');
    idle(home.root,kernel,memory,custody);
    match(fingerprintStorage(kernel,plan.systemId,{includeOwnership:false}),plan.kernel,'Context history or auxiliary state changed since the plan; create a fresh plan');
    const expectedMemory=()=>memory&&version(memory)===3&&journal?.conversion?.memory?.afterFingerprint?journal.conversion.memory.afterFingerprint:plan.memory;
    if(journal?.stage!=='verified')match(memory?fingerprintMemory(memory,plan.systemId):null,expectedMemory(),'Session memory changed since the plan or converted cutoff; preserve accepted state');
    if(!journal){
      const recovery=join(home.root,'runtime/recovery',plan.id);privateDirectory(join(home.root,'runtime/recovery'));privateDirectory(recovery);
      journal={formatVersion:1,planDigest,plan,recovery,stage:'prepared',backups:{kernel:join(recovery,'store.sqlite'),...(memory?{memory:join(recovery,'session-memory.sqlite')}:{})}};
      if(priorCompleted){
        privateDirectory(priorCompleted.recovery);
        const archive=join(priorCompleted.recovery,'completed-journal.json'),bytes=canonical(priorCompleted)+'\n';
        if(existsSync(archive))match(readPrivateJson(archive),priorCompleted,'An immutable completed migration archive differs');else publishPrivate(archive,bytes);
        match(optionalJson(migrationJournal(home.root)),priorCompleted,'The completed migration pointer changed before archival');
        replacePrivate(migrationJournal(home.root),canonical(journal)+'\n');
      }else publishPrivate(migrationJournal(home.root),canonical(journal)+'\n');
      onStage('prepared');
    }
    if(journal.recovery!==join(home.root,'runtime/recovery',plan.id))fail('IDENTITY_CONFLICT','Retained recovery directory does not match this migration');
    if(journal.stage!=='verified'){
    for(const [component,source] of [['kernel',kernel],['memory',memory]])if(source){
      const path=journal.backups[component];
      if(!isAbsolute(path) || path!==join(journal.recovery,component==='kernel'?'store.sqlite':'session-memory.sqlite'))fail('IDENTITY_CONFLICT','Retained recovery path is invalid');
      if(!existsSync(path))await privateBackup(source,path);
      const copy=openPrivate(path,{readOnly:true});
      try{verifyIntegrity(copy);match(component==='kernel'?fingerprintStorage(copy,plan.systemId,{includeOwnership:false}):fingerprintMemory(copy,plan.systemId),plan[component],'Recovery backup differs from the planned source');}finally{copy.close();}
    }
    save('backed-up');
    kernel.exec('BEGIN IMMEDIATE');if(memory)memory.exec('BEGIN IMMEDIATE');
    idle(home.root,kernel,memory,custody);
    match(fingerprintStorage(kernel,plan.systemId,{includeOwnership:false}),plan.kernel,'A competing writer changed context state before cutover');
    match(memory?fingerprintMemory(memory,plan.systemId):null,expectedMemory(),'A competing writer changed session memory before cutover');
    const kernelResult=convertLegacySnapshots(kernel,plan.systemId),memoryResult=memory?(version(memory)===3&&journal.conversion?.memory?.afterFingerprint?journal.conversion.memory:convertLegacyMemory(memory,plan.systemId,{limits:plan.memoryLimits})):null;
    journal.conversion={kernel:kernelResult,memory:memoryResult};save('backed-up');
    onStage('before-commit');
    // Kernel first: old binaries refuse format 2 even if a crash leaves memory
    // awaiting its idempotent forward conversion. New services honor the journal.
    kernel.exec('COMMIT');onStage('kernel-committed');if(memory){memory.exec('COMMIT');onStage('memory-committed');}
    save('converted');
    verifyIntegrity(kernel);if(memory)verifyIntegrity(memory);
    match(fingerprintStorage(kernel,plan.systemId,{includeOwnership:false}),plan.kernel,'Committed context verification failed');
    match(memory?fingerprintMemory(memory,plan.systemId):null,journal.conversion.memory?.afterFingerprint??null,'Committed memory verification failed');
    kernel.exec('VACUUM');if(memory)memory.exec('VACUUM');
    match(fingerprintStorage(kernel,plan.systemId,{includeOwnership:false}),plan.kernel,'Compacted context verification failed');
    match(memory?fingerprintMemory(memory,plan.systemId):null,journal.conversion.memory?.afterFingerprint??null,'Compacted memory verification failed');
    kernel.exec('PRAGMA wal_checkpoint(TRUNCATE)');if(memory)memory.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    kernel.close();kernel=undefined;if(memory){memory.close();memory=undefined;}
    save('verified');
    }
    if(kernel){kernel.close();kernel=undefined;}if(memory){memory.close();memory=undefined;}
    const sessionMemory=new SessionMemory(files.memory,plan.systemId,plan.memoryLimits);
    const enrollments=[];
    try{
      journal.configurationRequests??=[];
      for(let i=0;i<plan.enroll.length;i++){
        const session=plan.enroll[i];
        if(!journal.configurationRequests[i]){const current=sessionMemory.subscription(session);journal.configurationRequests[i]={session,expectedRevision:current.revision,idempotencyKey:'migration:'+plan.id,enabled:true};save('verified');}
        enrollments.push(sessionMemory.configure(journal.configurationRequests[i],owner.principalId));
      }
      publishEnrollment(home.root,plan.systemId,sessionMemory.subscriptions());
    }finally{sessionMemory.close();}
    journal.result={systemId:plan.systemId,formats:{kernel:2,memory:3},...journal.conversion,enrollments,recovery:journal.recovery,
      bytes:{kernel:lstatSync(files.kernel).size,memory:lstatSync(files.memory).size},newWritesAccepted:false};
    save('complete');return journal.result;
  } finally {
    for(const db of [kernel,memory])if(db){try{if(db.isTransaction)db.exec('ROLLBACK');}finally{db.close();}}
    try{lock.exec('ROLLBACK');}finally{lock.close();}
  }
}
