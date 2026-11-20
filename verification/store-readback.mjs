import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,mkdirSync,openSync,closeSync,chmodSync,lstatSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Store} from '../runtime/store.mjs';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {fingerprintStorage,fingerprintMemory} from '../runtime/storage-migration.mjs';
import {canonical} from '../runtime/json.mjs';

// The source databases are online read-only observations. Each backup is a
// consistent SQLite snapshot; this is deliberately not a cross-database cutover.
const [homeArgument,baselineArgument,...extra]=process.argv.slice(2);
if(!homeArgument||!baselineArgument||extra.length||!homeArgument.startsWith('/')||!baselineArgument.startsWith('/'))throw Error('Use store-readback.mjs <absolute-moment-home> <absolute-baseline-repository>');
const home=resolve(homeArgument),baseline=resolve(baselineArgument),candidate=fileURLToPath(new URL('../',import.meta.url));
const scratch=mkdtempSync(join(tmpdir(),'moment-store-readback-'));chmodSync(scratch,0o700);
const owner=join(home,'runtime/owner.json'),ownerBefore=readFileSync(owner);
const report={kind:'moment-store-readback/1',startedAt:new Date().toISOString(),sourceHome:home,baseline,candidate,crossDatabaseAtomic:false,checks:[],limitations:['Online snapshots are individually consistent; no atomic cross-database epoch or production cutover is claimed','No credentials copied, provider dispatch, inference, daemon/config change, payload conversion or enrollment','Logical rows and interpreted histories are compared; this is not physical SQLite byte preservation or a raw-capture availability survey']};
const privateFile=path=>{const st=lstatSync(path);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&!(st.mode&0o077),'Expected a private owned regular database');};
async function copy(name) {
 const source=join(home,'runtime',name);privateFile(source);const db=new DatabaseSync(source,{readOnly:true}),path=join(scratch,name);
 const fd=openSync(path,'wx',0o600);closeSync(fd);
 try{await backup(db,path);privateFile(path);return path;}finally{db.close();}
}
function integrity(db){assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}
const fingerprint=(path,kind,systemId)=>{const db=new DatabaseSync(path,{readOnly:true});try{integrity(db);return kind==='kernel'?fingerprintStorage(db,systemId):fingerprintMemory(db,systemId);}finally{db.close();}};
let store,memory;
try {
 const kernel=await copy('store.sqlite'),memoryFile=await copy('session-memory.sqlite');
 const db=new DatabaseSync(kernel,{readOnly:true});const systemId=db.prepare("SELECT value FROM metadata WHERE key='systemId'").get().value;db.close();
 const before={kernel:fingerprint(kernel,'kernel',systemId),memory:fingerprint(memoryFile,'memory',systemId)};
 const oldStore=await import(pathToFileURL(join(baseline,'runtime/store.mjs'))),oldMemory=await import(pathToFileURL(join(baseline,'runtime/session-memory.mjs'))),oldFingerprint=await import(pathToFileURL(join(baseline,'runtime/storage-migration.mjs')));
 store=new oldStore.Store(kernel,systemId);memory=new oldMemory.SessionMemory(memoryFile,systemId);
 assert.equal(canonical(oldFingerprint.fingerprintStorage(store.db,systemId)),canonical(before.kernel));assert.equal(canonical(oldFingerprint.fingerprintMemory(memory.db,systemId)),canonical(before.memory));
 store.close();store=undefined;memory.close();memory=undefined;report.checks.push('Baseline constructors and fingerprints preserve both copied stores');
 store=new Store(kernel,systemId);memory=new SessionMemory(memoryFile,systemId);
 let histories=0,receipts=0,sessions=0,sets=0;
 for(const row of store.db.prepare('SELECT context_id,revision FROM context_revisions ORDER BY context_id,revision').iterate()) {
  const current=store.read(row.context_id,row.revision);assert.equal(current.context.id,row.context_id);assert.equal(current.context.revision,row.revision);histories++;
 }
 for(const row of store.db.prepare('SELECT * FROM receipts').iterate()) {
  assert.equal(canonical(store.receipt(row.principal_id,row.context_id,row.method,row.key,row.digest)),canonical({response:JSON.parse(row.response),commit:JSON.parse(row.commit_value)}));receipts++;
 }
 for(const row of memory.db.prepare('SELECT value FROM memory_sessions').iterate()) {
  const state=JSON.parse(row.value),packet=memory.readSnapshot({session:state.session,includeWorkingSets:true,maximumBytes:262144});assert.equal(canonical(packet.session),canonical(state.session));sessions++;
  for(const set of memory.continuity.workingSets(state.key)){memory.continuity.value(set.entries);sets++;}
 }
 assert.equal(canonical(fingerprintStorage(store.db,systemId)),canonical(before.kernel));assert.equal(canonical(fingerprintMemory(memory.db,systemId)),canonical(before.memory));
 report.readback={histories,receipts,sessions,workingSets:sets};report.checks.push('Candidate interprets all historical revisions, receipts, session packets and retained working-set values without changing logical storage');
 const claim=store.db.prepare("SELECT value FROM metadata WHERE key='daemonClaim'").get();
 if(claim){const held=JSON.parse(claim.value);let alive=false;try{process.kill(held.pid,0);alive=true;}catch(error){if(error.code!=='ESRCH')throw error;}
  if(alive){assert.throws(()=>store.claimWriter(),{code:'IDENTITY_CONFLICT'});assert.equal(canonical(fingerprintStorage(store.db,systemId)),canonical(before.kernel));report.checks.push('Copied live writer claim refuses takeover without logical changes');}
 }
 store.close();store=undefined;memory.close();memory=undefined;
 const env={PATH:process.env.PATH,HOME:scratch,CODEX_HOME:join(scratch,'codex')};mkdirSync(env.CODEX_HOME);
 const crash=(commit,key)=>{
  const code="import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run(process.argv[2],'owned readback crash fixture');if(process.argv[3]==='commit')db.exec('COMMIT');process.kill(process.pid,'SIGKILL');";
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,kernel,key,commit?'commit':'rollback'],{env,encoding:'utf8',timeout:10000});assert.equal(child.signal,'SIGKILL',child.error?.message??child.stderr);
 };
 crash(false,'readback-uncommitted-'+randomUUID());assert.equal(canonical(fingerprint(kernel,'kernel',systemId)),canonical(before.kernel));report.checks.push('Actual process death before commit preserves the entire copied kernel fingerprint');
 const marker='readback-committed-'+randomUUID();crash(true,marker);const recovered=new DatabaseSync(kernel);
 try{integrity(recovered);assert.equal(recovered.prepare('SELECT value FROM metadata WHERE key=?').get(marker)?.value,'owned readback crash fixture');
  // Compensate only this exact fixture row; never restore a prior database over
  // later writes. The full original logical fingerprint must then match.
  assert.equal(recovered.prepare('DELETE FROM metadata WHERE key=? AND value=?').run(marker,'owned readback crash fixture').changes,1);
 }finally{recovered.close();}
 assert.equal(canonical(fingerprint(kernel,'kernel',systemId)),canonical(before.kernel));assert.equal(canonical(fingerprint(memoryFile,'memory',systemId)),canonical(before.memory));report.checks.push('Actual process death after commit preserves its acknowledged-independent fixture row; exact fixture-only cleanup restores the original fingerprint');
 assert.deepEqual(readFileSync(owner),ownerBefore);report.checks.push('Original owner credential bytes remain unchanged and were never copied');
 report.fingerprints=before;report.finishedAt=new Date().toISOString();report.ok=true;
 rmSync(scratch,{recursive:true,force:true});report.scratchDisposition='Test-owned SQLite copies removed after successful readback; live originals retained';console.log(JSON.stringify(report));
} catch(error) {
 try{store?.close();}catch{}try{memory?.close();}catch{}
 writeFileSync(join(scratch,'failure.json'),JSON.stringify({...report,ok:false,error:{name:error.name,code:error.code,message:error.message}},null,2),{mode:0o600});
 console.error('Owned store readback failed; private copies and diagnostic retained at '+scratch);process.exitCode=1;
}
