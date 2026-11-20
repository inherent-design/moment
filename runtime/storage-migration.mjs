import * as core from './semantic-core.mjs';
import {createHash} from 'node:crypto';
import {canonical,bytesDigest,fail} from './json.mjs';
import {storageVersion,createSnapshotTables,writeSnapshot,readSnapshot,assertKernelLayout} from './snapshot-values.mjs';
import {legacyMemoryColumns,memoryContinuityColumns,memorySchemaColumns,createMemoryContinuityTables,MemoryContinuity} from './memory-continuity.mjs';
import {memoryDefaults,memorySessionKey,memoryStorageVersion} from './session-memory.mjs';

const versionOf=db=>db.prepare('PRAGMA user_version').get().user_version;
function identity(db,systemId) {
  if(db.prepare("SELECT value FROM metadata WHERE key='systemId'").get()?.value!==systemId)
    fail('IDENTITY_CONFLICT','Storage migration system identity differs from its selected store');
}
function legacy(db) {
  assertKernelLayout(db,{legacy:true});
}
function ownedRead(db,action) {
  const own=!db.isTransaction;
  if(own)db.exec('BEGIN');
  try{const result=action();if(own)db.exec('COMMIT');return result;}
  catch(error){if(own)try{db.exec('ROLLBACK');}catch{}throw error;}
}
function* states(db,version) {
  if(core.storageFormat('kernel',version)==='StorageLegacy'){
    for(const row of db.prepare('SELECT context_id,revision,value FROM snapshots ORDER BY context_id,revision').iterate()){
      let state;try{state=JSON.parse(row.value);}catch{fail('IDENTITY_CONFLICT','Legacy snapshot is not valid JSON');}
      if(state?.context?.id!==row.context_id || state?.context?.revision!==row.revision)
        fail('IDENTITY_CONFLICT','Legacy snapshot row and context identity disagree');
      yield {contextId:row.context_id,revision:row.revision,state};
    }
  } else if(core.storageFormat('kernel',version)==='StorageCurrent'){
    for(const row of db.prepare('SELECT context_id,revision FROM context_revisions ORDER BY context_id,revision').iterate())
      yield {contextId:row.context_id,revision:row.revision,state:readSnapshot(db,row.context_id,row.revision)};
  } else fail('UNSUPPORTED_VERSION','Storage fingerprint does not recognize this format');
}

/** Public state plus exact auxiliary values, with outbox logical ordering retained. */
export function fingerprintStorage(db,systemId,{includeOwnership=true}={}) {
  return ownedRead(db,()=>{
    const version=versionOf(db);if(core.storageFormat('kernel',version)==='StorageLegacy')legacy(db);else assertKernelLayout(db);identity(db,systemId);
    const stateHash=createHash('sha256'),otherHash=createHash('sha256'),revisions=new Map();let snapshots=0;
    for(const row of states(db,version)){
      const stateDigest=bytesDigest(canonical(row.state));
      stateHash.update(canonical({contextId:row.contextId,revision:row.revision,stateDigest})+'\n');
      revisions.set(row.contextId,row.revision);snapshots++;
    }
    const queries={
      metadata:includeOwnership?'SELECT key,value FROM metadata ORDER BY key':"SELECT key,value FROM metadata WHERE key NOT IN ('daemonClaim','managedStartup') ORDER BY key",
      receipts:'SELECT * FROM receipts ORDER BY principal_id,context_id,method,key',
      events:'SELECT * FROM events ORDER BY context_id,sequence',
      outbox:'SELECT context_id,execution_id,value FROM outbox ORDER BY rowid',
      imports:'SELECT id,digest,value FROM imports ORDER BY id'
    };
    const rows={};
    for(const [table,sql] of Object.entries(queries)){
      otherHash.update(table+'\n');rows[table]=0;
      for(const row of db.prepare(sql).iterate()){otherHash.update(canonical(row)+'\n');rows[table]++;}
    }
    return {systemId,snapshots,revisions:Object.fromEntries(revisions),stateDigest:'sha256:'+stateHash.digest('hex'),auxiliaryDigest:'sha256:'+otherHash.digest('hex'),rows};
  });
}

/** Trusted conversion port. Caller owns backup, quiescence, transaction and commit. */
export function convertLegacySnapshots(db,systemId) {
  if(!db.isTransaction)fail('INTERNAL','Storage conversion requires its owning transaction');
  const version=versionOf(db);
  if(core.storageFormat('kernel',version)==='StorageCurrent')return {changed:false,formatVersion:storageVersion,...fingerprintStorage(db,systemId)};
  if(core.storageFormat('kernel',version)!=='StorageLegacy')fail('UNSUPPORTED_VERSION','Only recognized legacy snapshot storage can be converted');
  legacy(db);identity(db,systemId);
  const before=fingerprintStorage(db,systemId);
  createSnapshotTables(db);
  // This is transactional: other connections see format 1 until commit.
  db.exec('PRAGMA user_version=2');
  let converted=0;
  for(const row of db.prepare('SELECT context_id,revision,value FROM snapshots ORDER BY context_id,revision').iterate()){
    let state;try{state=JSON.parse(row.value);}catch{fail('IDENTITY_CONFLICT','Legacy snapshot is not valid JSON');}
    if(state?.context?.id!==row.context_id || state?.context?.revision!==row.revision)
      fail('IDENTITY_CONFLICT','Legacy snapshot row and context identity disagree');
    const expected=canonical(state);
    writeSnapshot(db,state);
    if(canonical(readSnapshot(db,row.context_id,row.revision))!==expected)
      fail('IDENTITY_CONFLICT','Converted historical snapshot differs from its original canonical state');
    converted++;
  }
  // The legacy table disappears in the same owning transaction as publication.
  // Any failure below rolls it back together with the new representation.
  db.exec('DROP TABLE snapshots');
  const after=fingerprintStorage(db,systemId);
  if(canonical(before)!==canonical(after))fail('IDENTITY_CONFLICT','Converted storage fingerprint differs from retained state or auxiliary values');
  if(converted!==before.snapshots)fail('IDENTITY_CONFLICT','Converted historical coverage differs');
  // Old prepared SQL fails after cutover instead of writing the old layout.
  return {changed:true,formatVersion:storageVersion,converted,...after};
}

/** Exact retained memory bytes. Configuration is deliberately a later mutation. */
export function fingerprintMemory(db,systemId,{originalOnly=false}={}) {
  return ownedRead(db,()=>{
    const version=versionOf(db);
    if(!['StorageLegacy','StorageCurrent'].includes(core.storageFormat('memory',version)))fail('UNSUPPORTED_VERSION','Unrecognized session memory format');
    const actualColumns=core.storageFormat('memory',version)==='StorageCurrent'?memorySchemaColumns:legacyMemoryColumns;
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
    if(canonical(tables)!==canonical(Object.keys(actualColumns).sort()) || db.prepare("SELECT 1 FROM sqlite_schema WHERE type IN ('trigger','view') LIMIT 1").get())fail('UNSUPPORTED_VERSION','Session memory schema requires an explicit reviewed conversion');
    identity(db,systemId);const hash=createHash('sha256'),rows={};
    for(const [table,columns] of Object.entries(actualColumns)){
      if(canonical(db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name))!==canonical(columns))fail('UNSUPPORTED_VERSION','Unrecognized memory '+table+' columns');
    }
    const selected=core.storageFormat('memory',version)==='StorageCurrent'&&!originalOnly?{...legacyMemoryColumns,...memoryContinuityColumns}:legacyMemoryColumns;
    for(const [table,columns] of Object.entries(selected)){
      const physical=core.storageFormat('memory',version)==='StorageCurrent'&&table==='sessions'?'memory_sessions':table;
      hash.update(table+'\n');rows[table]=0;
      for(const row of db.prepare('SELECT * FROM '+physical+' ORDER BY '+columns.join(',')).iterate()){hash.update(canonical(row)+'\n');rows[table]++;}
    }
    return {systemId,rows,digest:'sha256:'+hash.digest('hex')};
  });
}
export function convertLegacyMemory(db,systemId,{limits=memoryDefaults}={}) {
  if(!db.isTransaction)fail('INTERNAL','Memory conversion requires its owning transaction');
  const before=fingerprintMemory(db,systemId,{originalOnly:true}),version=versionOf(db);
  if(core.storageFormat('memory',version)==='StorageCurrent'){const after=fingerprintMemory(db,systemId);return {changed:false,formatVersion:memoryStorageVersion,originalFingerprint:before,afterFingerprint:after};}
  const parse=(bytes,label)=>{try{const value=JSON.parse(bytes);canonical(value);return value;}catch{fail('IDENTITY_CONFLICT','Unrecognized retained memory '+label);}};
  const states=new Map(db.prepare('SELECT * FROM sessions ORDER BY key').all().map(row=>{
    const value=parse(row.value,'session');if(memorySessionKey(value.session)!==row.key||value.key!==row.key||!Array.isArray(value.entries))fail('IDENTITY_CONFLICT','Retained memory session identity disagrees');return [row.key,value];
  }));
  for(const row of db.prepare('SELECT * FROM sources').all()){
    const value=parse(row.value,'source');memorySessionKey(value.session);
    if(value.id!==row.id||typeof value.text!=='string'||bytesDigest(value.text)!==value.digest||Buffer.byteLength(row.value)!==row.bytes)fail('IDENTITY_CONFLICT','Retained memory source identity disagrees');
  }
  for(const row of db.prepare('SELECT * FROM associations').all())if(!states.has(row.session_key)||!db.prepare('SELECT 1 FROM sources WHERE id=?').get(row.source_id))fail('IDENTITY_CONFLICT','Retained memory source association is unavailable');
  // A renamed foundational table fences a stale format-2 session writer. Keep
  // every original row byte-identical; the fingerprint uses its logical name.
  db.exec('ALTER TABLE sessions RENAME TO memory_sessions');createMemoryContinuityTables(db);
  const continuity=new MemoryContinuity(db,{...memoryDefaults,...limits}),defaults=new Map();continuity.begin();
  try{
    for(const state of states.values()){
      for(const entry of state.entries)if(!entry||typeof entry.sourceId!=='string'||!db.prepare('SELECT 1 FROM associations WHERE session_key=? AND source_id=?').get(state.key,entry.sourceId))fail('IDENTITY_CONFLICT','Retained cache source is not associated with its session');
      defaults.set(state.key,continuity.createDefault(state));
    }
    const inputs=new Map();
    for(const row of db.prepare('SELECT * FROM inputs ORDER BY session_key,sequence').all()){
      const value=parse(row.value,'input'),state=states.get(row.session_key);
      if(!state||value.key!==row.session_key||memorySessionKey(value.session)!==row.session_key||value.sequence!==row.sequence||value.deliveryId!==row.delivery_id||value.digest!==row.digest||value.status!==row.status||!Array.isArray(value.primaryIds)||!Array.isArray(value.contextIds))fail('IDENTITY_CONFLICT','Retained memory input identity disagrees');
      for(const id of [...value.primaryIds,...value.contextIds])if(!db.prepare('SELECT 1 FROM associations WHERE session_key=? AND source_id=?').get(state.key,id))fail('IDENTITY_CONFLICT','Retained input source association is unavailable');
      continuity.bindInput(state.key,value.sequence,defaults.get(state.key).id,0);inputs.set(state.key+':'+value.sequence,value);
    }
    const legacy=(id,value,status,session)=>{
      const key=memorySessionKey(session),input=inputs.get(key+':'+value.sequence),target=defaults.get(key);
      if(!input||!target||typeof value.provider?.id!=='string'||typeof value.provider?.model!=='string')fail('IDENTITY_CONFLICT','Retained assessment cannot be associated with its input/provider');
      const manifest={id,key,session,sequence:value.sequence,status,incomingSourceIds:[...input.primaryIds],provider:value.provider,basisAvailability:'legacy',workingSetId:target.id,...(value.startedAt?{startedAt:value.startedAt}:{observedAt:input.observedAt}),...(value.finishedAt?{finishedAt:value.finishedAt}:{}),...(value.inputDigest?{inputDigest:value.inputDigest}:{}),...(value.promptDigest?{promptDigest:value.promptDigest}:{}),...(value.outputSchemaDigest?{outputSchemaDigest:value.outputSchemaDigest}:{})};
      continuity.putManifest(manifest);
    };
    for(const row of db.prepare('SELECT * FROM receipts ORDER BY rowid').all()){
      const value=parse(row.value,'receipt');if(value.dispatchId!==row.id||!core.storageMemoryReceipt(value.status))fail('IDENTITY_CONFLICT','Unrecognized retained assessment receipt');legacy(row.id,value,value.status,value.session);
    }
    for(const row of db.prepare('SELECT * FROM dispatches ORDER BY rowid').all()){
      const value=parse(row.value,'dispatch');if(value.id!==row.id||!core.storageMemoryDispatch(value.status)||!value.request?.session)fail('IDENTITY_CONFLICT','Unrecognized retained dispatch custody');legacy(row.id,value,value.status,value.request.session);
    }
    continuity.ensure('assessment');continuity.ensure('working');
    db.exec('PRAGMA user_version=3');
    if(canonical(fingerprintMemory(db,systemId,{originalOnly:true}))!==canonical(before))fail('IDENTITY_CONFLICT','Memory conversion changed an original row');
    const after=fingerprintMemory(db,systemId);
    return {changed:true,formatVersion:memoryStorageVersion,convertedSessions:states.size,boundInputs:inputs.size,originalFingerprint:before,afterFingerprint:after};
  }finally{continuity.end();}
}
