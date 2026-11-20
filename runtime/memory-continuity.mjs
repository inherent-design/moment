import {canonical,bytesDigest,digest,fail} from './json.mjs';
import {randomUUID} from 'node:crypto';
import * as core from './semantic-core.mjs';

export const legacyMemoryColumns=Object.freeze({metadata:['key','value'],sessions:['key','value'],sources:['id','value','bytes'],associations:['session_key','source_id'],inputs:['session_key','sequence','delivery_id','digest','status','value'],dispatches:['id','value'],receipts:['id','value']});
export const memoryContinuityColumns=Object.freeze({memory_values:['kind','digest','payload','bytes'],memory_assessments:['id','session_key','sequence','value','digest','bytes'],memory_focus:['session_key','working_set_id','revision'],memory_working_sets:['session_key','id','value','digest','bytes'],memory_focus_receipts:['session_key','id','value','digest','bytes'],memory_input_sets:['session_key','sequence','working_set_id','focus_revision']});
export const memorySchemaColumns=Object.freeze({...Object.fromEntries(Object.entries(legacyMemoryColumns).map(([name,columns])=>[name==='sessions'?'memory_sessions':name,columns])),...memoryContinuityColumns});

export function createMemoryContinuityTables(db) {
  db.exec(`
    CREATE TABLE memory_values(kind TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(kind,digest));
    CREATE TABLE memory_assessments(id TEXT PRIMARY KEY,session_key TEXT NOT NULL,sequence INTEGER NOT NULL,value TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL);
    CREATE TABLE memory_focus(session_key TEXT PRIMARY KEY,working_set_id TEXT NOT NULL,revision INTEGER NOT NULL);
    CREATE TABLE memory_working_sets(session_key TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(session_key,id));
    CREATE TABLE memory_focus_receipts(session_key TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(session_key,id));
    CREATE TABLE memory_input_sets(session_key TEXT NOT NULL,sequence INTEGER NOT NULL,working_set_id TEXT NOT NULL,focus_revision INTEGER NOT NULL,PRIMARY KEY(session_key,sequence));
  `);
}

const rowValue=row=>{
  if(!row)return undefined;
  if(bytesDigest(row.value)!==row.digest || Buffer.byteLength(row.value)!==row.bytes)fail('IDENTITY_CONFLICT','Memory continuity manifest integrity disagrees');
  try{return JSON.parse(row.value);}catch{fail('IDENTITY_CONFLICT','Memory continuity manifest is invalid');}
};
const time=()=>new Date().toISOString();
// These are native storage-format checks, not an inference about disposability.
// An unsupported root may contain references this reader cannot enumerate.
const assessmentFields=new Set(['id','key','session','sequence','status','incomingSourceIds','provider','promptVersion','inputDigest','promptDigest','outputSchemaDigest','startedAt','observedAt','finishedAt','workingSetId','basisAvailability','basis','profile','nativeProfile','preparation','outcome','raw','nativeOutputDigest','rawUnavailable','cacheRevision','retiredAt']);
const workingFields=new Set(['id','key','purposeKey','label','purpose','returnPoint','revision','basisSourceIds','entries','createdAt','updatedAt','lastAssessment','work','guidance']);
const valueFields=Object.freeze({basis:'basis',profile:'profile',nativeProfile:'profile',outcome:'outcome',raw:'raw',entries:'entries'});
function retentionRecord(row,fields){
  const value=rowValue(row);
  if(!value||typeof value!=='object'||Array.isArray(value))fail('IDENTITY_CONFLICT','Memory retention root is not a record');
  if(Object.keys(value).some(key=>!fields.has(key)))fail('UNSUPPORTED_VERSION','Unsupported memory retention metadata; preserve its possible references');
  if(value.id!==row.id||value.key!==row.session_key||('sequence' in row&&value.sequence!==row.sequence))fail('IDENTITY_CONFLICT','Memory retention root identity disagrees with its row');
  if(fields===workingFields&&!Object.hasOwn(value,'entries'))fail('IDENTITY_CONFLICT','Working-set retention root has no entries reference');
  if(fields===assessmentFields&&!['retained','legacy','retired'].includes(value.basisAvailability))fail('UNSUPPORTED_VERSION','Unsupported memory basis representation; preserve its evidence');
  for(const [key,kind] of Object.entries(valueFields))if(Object.hasOwn(value,key)){
    const ref=value[key];
    if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).length!==2||ref.kind!==kind||typeof ref.digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(ref.digest))fail('IDENTITY_CONFLICT','Memory retention reference format disagrees');
  }
  return value;
}
function pooledValue(row){
  if(!row||bytesDigest(row.payload)!==row.digest||Buffer.byteLength(row.payload)!==row.bytes)fail('IDENTITY_CONFLICT','Memory continuity value is missing or changed');
  try{return JSON.parse(row.payload);}catch{fail('IDENTITY_CONFLICT','Memory continuity value is invalid');}
}

/** Private immutable values and independently attributable manifests. The caller owns the SQLite transaction. */
export class MemoryContinuity {
  constructor(db,limits){this.db=db;this.limits=limits;this.pins=new Set();}
  begin(){this.pins.clear();}
  end(){this.pins.clear();}
  values(kind){return this.db.prepare('SELECT kind,digest,bytes FROM memory_values WHERE kind=? ORDER BY digest').all(kind);}
  focus(key){
    const row=this.db.prepare('SELECT working_set_id,revision FROM memory_focus WHERE session_key=?').get(key);
    if(!row)return undefined;
    if(!Number.isSafeInteger(row.revision)||row.revision<0||!this.workingSet(key,row.working_set_id))fail('IDENTITY_CONFLICT','Memory focus identity or revision is unavailable');
    return {workingSetId:row.working_set_id,revision:row.revision};
  }
  workingSet(key,id){return rowValue(this.db.prepare('SELECT * FROM memory_working_sets WHERE session_key=? AND id=?').get(key,id));}
  workingSets(key){
    const values=this.db.prepare('SELECT * FROM memory_working_sets WHERE session_key=? ORDER BY rowid').all(key).map(rowValue);
    if(new Set(values.map(x=>x.purposeKey)).size!==values.length)fail('IDENTITY_CONFLICT','Working-set purpose identities conflict');
    return values;
  }
  putWorkingSet(value){
    const text=canonical(value);
    this.db.prepare('INSERT INTO memory_working_sets VALUES (?,?,?,?,?) ON CONFLICT(session_key,id) DO UPDATE SET value=excluded.value,digest=excluded.digest,bytes=excluded.bytes').run(value.key,value.id,text,bytesDigest(text),Buffer.byteLength(text));
    this.ensure('working');
  }
  createDefault(state){
    const value={id:randomUUID(),key:state.key,purposeKey:'default',label:'Conversation',revision:state.revision,basisSourceIds:[],entries:this.putValue('entries',state.entries),createdAt:time(),...(state.lastAssessment?{lastAssessment:state.lastAssessment}:{})};
    this.putWorkingSet(value);this.db.prepare('INSERT INTO memory_focus VALUES (?,?,?)').run(state.key,value.id,0);this.ensure('working');return value;
  }
  bindInput(key,sequence,workingSetId,focusRevision){
    this.db.prepare('INSERT INTO memory_input_sets VALUES (?,?,?,?)').run(key,sequence,workingSetId,focusRevision);
    this.ensure('assessment');
  }
  inputBinding(key,sequence){
    const row=this.db.prepare('SELECT working_set_id,focus_revision FROM memory_input_sets WHERE session_key=? AND sequence=?').get(key,sequence);
    if(!row)fail('IDENTITY_CONFLICT','Memory input has no retained working-set binding');
    return {workingSetId:row.working_set_id,focusRevision:row.focus_revision};
  }
  focusReceipt(key,id){return rowValue(this.db.prepare('SELECT * FROM memory_focus_receipts WHERE session_key=? AND id=?').get(key,id));}
  putFocusReceipt(key,id,value){
    if(!core.resourceLessOrEqual(core.counterNext(this.db.prepare('SELECT count(*) AS n FROM memory_focus_receipts').get().n),this.limits.maxConfigurationReceipts))fail('LIMIT_EXCEEDED','Memory focus receipt retention is full; preserve uncertain exact requests');
    const text=canonical(value);this.db.prepare('INSERT INTO memory_focus_receipts VALUES (?,?,?,?,?)').run(key,id,text,bytesDigest(text),Buffer.byteLength(text));this.ensure('working');
  }
  value(ref){
    return pooledValue(this.db.prepare('SELECT digest,payload,bytes FROM memory_values WHERE kind=? AND digest=?').get(ref.kind,ref.digest));
  }
  usage(category){
    const bytes=table=>this.db.prepare('SELECT bytes FROM '+table).all().map(row=>row.bytes);
    return core.memoryRetentionUsage(category,{values:this.db.prepare('SELECT kind,bytes FROM memory_values').all(),assessments:bytes('memory_assessments'),working:bytes('memory_working_sets'),receipts:bytes('memory_focus_receipts'),focus:this.db.prepare('SELECT count(*) AS n FROM memory_focus').get().n,bindings:this.db.prepare('SELECT count(*) AS n FROM memory_input_sets').get().n});
  }
  protectedAssessments(){
    const ids=new Set(this.db.prepare('SELECT id FROM dispatches').all().map(x=>x.id));
    for(const row of this.db.prepare('SELECT value FROM memory_sessions').all()){
      const id=JSON.parse(row.value).lastAssessment?.dispatchId;if(id)ids.add(id);
    }
    for(const row of this.db.prepare('SELECT * FROM memory_working_sets').all()){
      const id=retentionRecord(row,workingFields).lastAssessment?.dispatchId;if(id)ids.add(id);
    }
    return ids;
  }
  putManifest(value){
    const bytes=canonical(value);
    this.db.prepare('INSERT INTO memory_assessments VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,digest=excluded.digest,bytes=excluded.bytes')
      .run(value.id,value.key,value.sequence,bytes,bytesDigest(bytes),Buffer.byteLength(bytes));
  }
  manifest(id){return rowValue(this.db.prepare('SELECT * FROM memory_assessments WHERE id=?').get(id));}
  manifests(key){return this.db.prepare('SELECT * FROM memory_assessments WHERE session_key=? ORDER BY sequence DESC,rowid DESC').all(key).map(rowValue);}
  collectValues(){
    const live=new Set(this.pins),states=[],roots=new Set();
    const add=ref=>{if(ref){const key=ref.kind+'\0'+ref.digest;live.add(key);roots.add(key);}};
    for(const row of this.db.prepare('SELECT * FROM memory_assessments').all()){
      const value=retentionRecord(row,assessmentFields);states.push(value.status);for(const key of ['basis','profile','nativeProfile','outcome','raw'])add(value[key]);
    }
    for(const row of this.db.prepare('SELECT * FROM memory_working_sets').all())add(retentionRecord(row,workingFields).entries);
    const values=this.db.prepare('SELECT * FROM memory_values').all(),available=new Set();
    for(const row of values){pooledValue(row);available.add(row.kind+'\0'+row.digest);}
    for(const key of roots)if(!available.has(key))fail('IDENTITY_CONFLICT','Memory retention root references unavailable bytes');
    for(const index of core.memoryCollectValues(values,[...live],states)){const row=values[index];this.db.prepare('DELETE FROM memory_values WHERE kind=? AND digest=?').run(row.kind,row.digest);}
  }
  retireOldest(key){
    const protectedIds=[...this.protectedAssessments()];
    const rows=(key?this.db.prepare('SELECT CAST(rowid AS TEXT) AS ordinal,* FROM memory_assessments WHERE session_key=?').all(key):this.db.prepare('SELECT CAST(rowid AS TEXT) AS ordinal,* FROM memory_assessments').all()).map(row=>({ordinal:row.ordinal,value:retentionRecord(row,assessmentFields)}));
    const index=core.memoryRetireAssessment(rows,protectedIds);if(index===undefined)return false;const value=rows[index].value;
    for(const field of ['basis','profile','nativeProfile','outcome','raw'])delete value[field];
    value.basisAvailability='retired';value.retiredAt=time();this.putManifest(value);this.collectValues();return true;
  }
  ensure(category,extra=0){
    for(;;){
      const pressure=core.memoryRetentionPressure(category,this.usage(category),extra,this.limits);if(pressure==='RetentionFits')return;
      if(pressure==='RetentionFull'||!this.retireOldest())fail('LIMIT_EXCEEDED','Protected memory '+category+' evidence exhausts its configured byte budget');
    }
  }
  putValue(kind,value){
    const category=core.memoryValueCategory(kind),payload=canonical(value),hash=bytesDigest(payload),ref={kind,digest:hash};
    this.pins.add(kind+'\0'+hash);
    const prior=this.db.prepare('SELECT payload FROM memory_values WHERE kind=? AND digest=?').get(kind,hash);
    if(prior){if(prior.payload!==payload)fail('IDENTITY_CONFLICT','Memory pooled digest conflicts with retained bytes');return ref;}
    this.ensure(category,core.counterAdd(Buffer.byteLength(payload),128));
    this.db.prepare('INSERT INTO memory_values VALUES (?,?,?,?)').run(kind,hash,payload,Buffer.byteLength(payload));return ref;
  }
  prepare(dispatch,profile,renderedInput){
    const request=dispatch.request;
    const basis={session:request.session,capacity:request.capacity,cache:request.cache,incomingSourceIds:request.incomingSourceIds,sourceIds:request.sources.map(x=>x.id),cacheRevision:dispatch.cacheRevision,processedThrough:dispatch.processedThrough,inputDigest:dispatch.inputDigest,renderedInputDigest:bytesDigest(renderedInput),promptDigest:dispatch.promptDigest,outputSchemaDigest:dispatch.outputSchemaDigest,...(request.workingSet?{workingSet:request.workingSet}:{}),...(request.focusSourceIds?{focusSourceIds:request.focusSourceIds}:{}),...(dispatch.workingSetId?{workingSetId:dispatch.workingSetId,workingSetRevision:dispatch.workingSetRevision,focusRevision:dispatch.focusRevision,admittedFocusRevision:dispatch.admittedFocusRevision}:{})};
    const manifest={id:dispatch.id,key:dispatch.key,session:request.session,sequence:dispatch.sequence,status:dispatch.status,incomingSourceIds:[...request.incomingSourceIds],provider:dispatch.provider,promptVersion:dispatch.promptVersion,inputDigest:dispatch.inputDigest,promptDigest:dispatch.promptDigest,outputSchemaDigest:dispatch.outputSchemaDigest,startedAt:dispatch.startedAt,...(dispatch.workingSetId?{workingSetId:dispatch.workingSetId}:{}),basisAvailability:'retained',basis:this.putValue('basis',basis),profile:this.putValue('profile',profile)};
    this.ensure('assessment',core.counterAdd(Buffer.byteLength(canonical(manifest)),192));this.putManifest(manifest);return manifest;
  }
  prepareNative(id,profile,preparation){
    const manifest=this.manifest(id);if(!manifest?.basis)fail('IDENTITY_CONFLICT','Prepared assessment basis is unavailable');
    const ref=this.putValue('profile',profile);
    if(manifest.nativeProfile && (canonical(manifest.nativeProfile)!==canonical(ref)||canonical(manifest.preparation)!==canonical(preparation)))fail('IDEMPOTENCY_CONFLICT','Native profile preparation changed');
    manifest.nativeProfile=ref;manifest.preparation=preparation;this.putManifest(manifest);this.ensure('assessment');
  }
  status(id,status){const manifest=this.manifest(id);if(manifest){manifest.status=status;this.putManifest(manifest);}}
  settle(id,receipt,output,rawOutput){
    const manifest=this.manifest(id);if(!manifest)return;
    const bounded=core.resourceLessOrEqual(Buffer.byteLength(canonical(output)),this.limits.maxOutputBytes);
    manifest.outcome=this.putValue('outcome',{receipt,...(bounded?{output}:{outputUnavailable:{reason:'oversize',digest:digest(output),bytes:Buffer.byteLength(canonical(output))}})});
    manifest.status=receipt.status;manifest.finishedAt=receipt.finishedAt;manifest.cacheRevision=receipt.cacheRevision;
    if(rawOutput!==undefined){
      if(typeof rawOutput!=='string')fail('INVALID_ARGUMENT','Native output evidence must be text');
      manifest.nativeOutputDigest=bytesDigest(rawOutput);
      if(core.resourceLessOrEqual(Buffer.byteLength(rawOutput),this.limits.maxOutputBytes))manifest.raw=this.putValue('raw',rawOutput);
      else manifest.rawUnavailable={reason:'oversize',digest:manifest.nativeOutputDigest,bytes:Buffer.byteLength(rawOutput)};
    }else manifest.rawUnavailable={reason:'not-supplied'};
    this.putManifest(manifest);this.ensure('assessment');
    while(core.memoryRetentionExcess(this.manifests(manifest.key).filter(x=>x.basis).length,this.limits.retainedAssessments)){if(!this.retireOldest(manifest.key))break;}
    this.collectValues();
  }
  summary(manifest){
    const result={assessmentId:manifest.id,session:manifest.session,sequence:manifest.sequence,status:manifest.status,incomingSourceIds:manifest.incomingSourceIds,basisAvailability:manifest.basisAvailability,provider:manifest.provider,...(manifest.startedAt?{startedAt:manifest.startedAt}:{}),...(manifest.observedAt?{observedAt:manifest.observedAt}:{}),...(manifest.finishedAt?{finishedAt:manifest.finishedAt}:{})};
    if(manifest.basis)result.basisDigest=manifest.basis.digest;
    if(manifest.workingSetId)result.workingSetId=manifest.workingSetId;
    result.nativeOutput={availability:core.memoryNativeAvailability(manifest),...(manifest.nativeOutputDigest?{digest:manifest.nativeOutputDigest}:{}),...(manifest.rawUnavailable?.bytes===undefined?{}:{bytes:manifest.rawUnavailable.bytes})};
    return result;
  }
}
