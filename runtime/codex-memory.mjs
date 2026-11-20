import {mkdirSync,mkdtempSync,realpathSync,openSync,closeSync,fstatSync,readSync,existsSync,rmSync,accessSync,lstatSync,readdirSync,constants} from 'node:fs';
import {join,delimiter,isAbsolute,dirname,basename} from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import {openCodexTransport} from './codex-transport.mjs';
import {writeCheckpoint} from './home.mjs';
import {replacePrivate,readPrivateJson as privateNativeJson} from './private-files.mjs';
import {canonical,digest,bytesDigest,fail} from './json.mjs';
import {renderMemoryPrompt,memorySelection} from './session-memory.mjs';
import {parseJson} from './wire.mjs';

import {observeCodexVersion,assertCodexThread,codexApiError,codexApiContractDigest} from './codex-api.mjs';
const memoryNativeSchema={type:'object',properties:{kind:{type:'string',enum:['unchanged','replace']},entries:{type:'array',maxItems:32,items:{type:'object',properties:{sourceId:{type:'string'},weight:{type:'number',minimum:0,maximum:1},generality:{type:['number','null'],minimum:0,maximum:1},note:{type:['string','null'],maxLength:2048}},required:['sourceId','weight','generality','note'],additionalProperties:false}},explanation:{type:'string',minLength:1,maxLength:512,pattern:'\\S'}},required:['kind','entries','explanation'],additionalProperties:false};
const validNative=new Ajv({strict:true,ownProperties:true}).compile(memoryNativeSchema);
function decodeNativeOutput(text) {
  const value=parseJson(text);if(!validNative(value) || value.kind==='unchanged' && value.entries.length)throw Error('Invalid native structured output');
  return value.kind==='unchanged'?{kind:'unchanged',explanation:value.explanation}:{kind:'replace',explanation:value.explanation,entries:value.entries.map(entry=>({sourceId:entry.sourceId,weight:entry.weight,...(entry.generality===null?{}:{generality:entry.generality}),...(entry.note===null?{}:{note:entry.note})}))};
}
function nativeSchemaFor(dispatch) {
  const entries=memoryNativeSchema.properties.entries,{selectableSourceIds:eligible,maximumEntries}=memorySelection(dispatch.request);
  return {...memoryNativeSchema,properties:{...memoryNativeSchema.properties,entries:{...entries,maxItems:maximumEntries,items:{...entries.items,properties:{...entries.items.properties,sourceId:{type:'string',enum:eligible}}}}}};
}
const baseInstructions="Maintain source-attributed conversation memory for faithful continuation. Use selectable original messages as cache units, with separately attributed exchanges as context for meaning, wording and status. Describe clear preferences and decisions as stated, and carry qualifications with their actual scope.";
const developerInstructions="Perform one memory assessment using the supplied evidence. The workspace is empty and read-only, and memory hooks are absent. Return unchanged with an empty entries array, or replace with the complete retained list. Each selected original source has one entry containing sourceId, weight, generality and note. Select distinct IDs from selectableSourceIds, with at most maximumEntries entries. Referenced exchanges stay context with their own attribution. Use null for unknown generality or an unnecessary note. Existing notes and scores are previous assessments to reconsider against original text.";

export {privateNativeJson};
export function readMemoryAccessSession(filename) {
  const source=privateNativeJson(filename),accessToken=source.tokens?.access_token,chatgptAccountId=source.tokens?.account_id;
  if(typeof accessToken!=='string' || typeof chatgptAccountId!=='string') fail('UNAUTHENTICATED','Selected native source has no access-token session');
  let claims;try {claims=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url'));} catch {fail('UNAUTHENTICATED','Selected native access session cannot be qualified');}
  if(!Number.isFinite(claims.exp) || claims.exp*1000<Date.now()+300000) fail('UNAUTHENTICATED','Selected native access session expires too soon; refresh remains in its owning host');
  return {accessToken,chatgptAccountId};
}
function ownedEnvironment(directory) {
  const env={PATH:process.env.PATH??'',HOME:join(directory,'home'),CODEX_HOME:join(directory,'state'),TMPDIR:join(directory,'tmp')};
  for(const [key,name] of [['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data'],['XDG_CACHE_HOME','cache'],['XDG_RUNTIME_DIR','run']]) env[key]=join(directory,name);
  for(const path of Object.values(env).slice(1)) mkdirSync(path,{recursive:true,mode:0o700});return env;
}
function executable(path) {
  const selected=path??(process.env.PATH??'').split(delimiter).map(path=>join(path,'codex')).find(path=>{try{accessSync(path,constants.X_OK);return true;}catch{return false;}});
  if(!selected) fail('CAPABILITY_UNAVAILABLE','Installed Codex is unavailable');return realpathSync(selected);
}
function usageOf(value,latencyMillis) {
  const result={latencyMillis};
  for(const [key,source] of [['modelTokens','totalTokens'],['inputTokens','inputTokens'],['outputTokens','outputTokens'],['cachedInputTokens','cachedInputTokens']]) if(Number.isSafeInteger(value?.[source]) && value[source]>=0) result[key]=value[source];
  return result;
}

/** One isolated native process for a pending input. No idle polling or primary state writes. */
export class CodexMemoryProvider {
  constructor(root,{credentialFile,model='gpt-6-luna',binary,timeoutMillis=120000,maximumJournals=4096,maximumJournalBytes=16777216}={},assessment) {
    if(typeof credentialFile!=='string' || !isAbsolute(credentialFile) || typeof model!=='string' || !model.length || model.length>256 || !Number.isInteger(timeoutMillis) || timeoutMillis<1000 || timeoutMillis>120000) fail('INVALID_ARGUMENT','Native memory profile needs a selected private credential source, model and 1–120 second deadline');
    if(!Number.isSafeInteger(maximumJournals) || maximumJournals<1 || maximumJournals>1048576 || !Number.isSafeInteger(maximumJournalBytes) || maximumJournalBytes<131072 || maximumJournalBytes>1073741824)fail('INVALID_ARGUMENT','Invalid native memory journal bounds');
    this.root=realpathSync(root);this.profile={credentialFile,model,binary,timeoutMillis,maximumJournals,maximumJournalBytes};this.closed=false;
    this.assessment=assessment??{id:'codex-memory/app-server-v2/6',version:6,kind:'memory',directory:'session-memory-native',baseInstructions,developerInstructions,schemaFor:nativeSchemaFor,render:dispatch=>renderMemoryPrompt(dispatch.request),decode:decodeNativeOutput};
    // Raw text may expand sixfold when JSON-escaped; reserve its encoded
    // journal as well as the decoded result and bounded native metadata.
    this.maximumJobBytes=this.assessment.kind==='memory'?524288:131072;
    this.directory=join(this.root,'runtime',this.assessment.directory);
  }
  async ready() {
    if(this.closed) fail('CAPABILITY_UNAVAILABLE','Native memory provider is closed');
    if(this.native) return {id:this.assessment.id,model:this.profile.model};
    const accessSession=readMemoryAccessSession(this.profile.credentialFile);
    mkdirSync(this.directory,{recursive:true,mode:0o700});mkdirSync(join(this.directory,'jobs'),{recursive:true,mode:0o700});
    if(readdirSync(this.directory).filter(name=>name.startsWith('instance-')).length>=64)fail('LIMIT_EXCEEDED','Owned native instance retention is full; inspect preparation/recovery markers before new inference');
    const journals=readdirSync(join(this.directory,'jobs'));let journalBytes=0;
    for(const name of journals){const stat=lstatSync(join(this.directory,'jobs',name));if(!stat.isFile() || stat.uid!==process.getuid() || stat.mode&0o077)fail('IDENTITY_CONFLICT','Native journal custody needs inspection');journalBytes+=stat.size;}
    if(journals.length>=this.profile.maximumJournals || journalBytes+this.maximumJobBytes>this.profile.maximumJournalBytes)fail('LIMIT_EXCEEDED','Native memory journal retention is full; inspect retained recovery evidence before starting new inference');
    this.instance=realpathSync(mkdtempSync(join(this.directory,'instance-')));const env=ownedEnvironment(this.instance),workspace=join(this.instance,'workspace');mkdirSync(workspace,{mode:0o700});
    this.environment=env;this.workspace=workspace;
    writeCheckpoint(join(env.CODEX_HOME,'profile.json'),{formatVersion:1,kind:'moment-owned-memory-worker',model:this.profile.model});
    const {writeFileSync}=await import('node:fs');
    writeFileSync(join(env.CODEX_HOME,'config.toml'),'cli_auth_credentials_store = "ephemeral"\nweb_search = "disabled"\ndefault_permissions = "moment-memory"\n[features]\nhooks = false\nshell_tool = false\napps = false\nplugins = false\n[agents]\nenabled = false\n[permissions.moment-memory.filesystem]\n":minimal" = "read"\n[permissions.moment-memory.filesystem.":workspace_roots"]\n"." = "read"\n[permissions.moment-memory.network]\nenabled = false\n',{mode:0o600});
    try {
      this.binary=executable(this.profile.binary);
      this.nativeVersion=observeCodexVersion(this.binary,{cwd:workspace,env});
      this.native=await openCodexTransport({binary:this.binary,env,workspace,version:this.nativeVersion});
      if(this.closed)fail('CAPABILITY_UNAVAILABLE','Native memory provider closed during preparation');
      const login=await this.native.call('account/login/start',{type:'chatgptAuthTokens',...accessSession});
      if(this.closed)fail('CAPABILITY_UNAVAILABLE','Native memory provider closed during authentication');
      if(login.type!=='chatgptAuthTokens')throw codexApiError('account/login/start','the selected chatgptAuthTokens mode',this.nativeVersion);
      if(!(await this.native.call('account/read',{refreshToken:false})).account || existsSync(join(env.CODEX_HOME,'auth.json'))) fail('UNAUTHENTICATED','Native ephemeral access-session qualification failed');
      const models=await this.native.call('model/list',{limit:100});
      if(this.closed)fail('CAPABILITY_UNAVAILABLE','Native memory provider closed during qualification');
      if(!models.data.some(model=>model?.model===this.profile.model))throw codexApiError('model/list','the selected checker model '+this.profile.model+' without fallback',this.nativeVersion);
      return {id:this.assessment.id,model:this.profile.model};
    } catch(error) {await this.dispose(true);throw error;}
  }
  jobPath(id) {if(!/^[0-9a-f-]{36}$/.test(id)) fail('INVALID_ARGUMENT','Invalid native memory dispatch identity');return join(this.directory,'jobs',id+'.json');}
  save(job) {const bytes=JSON.stringify(job,null,2)+'\n';if(Buffer.byteLength(bytes)>this.maximumJobBytes)fail('LIMIT_EXCEEDED','Native memory journal exceeds its individual bound');replacePrivate(this.jobPath(job.dispatchId),bytes);}
  prepare(dispatch) {
    if(this.assessment.kind!=='memory')fail('CAPABILITY_UNAVAILABLE','This native assessment uses its own preparation owner');
    if(!this.native)throw Object.assign(Error('Native provider was not prepared'),{notStarted:true});
    return {profile:{kind:'codex-memory',version:this.assessment.version,renderer:this.assessment.kind==='memory'&&this.assessment.version>=6?'moment-memory-native/2':'moment-memory-native/1',baseInstructions:this.assessment.baseInstructions,developerInstructions:this.assessment.developerInstructions,outputSchema:memoryNativeSchema,nativeVersion:this.nativeVersion,apiContractDigest:codexApiContractDigest,parameters:{model:this.profile.model,allowProviderModelFallback:false,approvalPolicy:'never',permissions:'moment-memory',ephemeral:false,environments:[],dynamicTools:[],effort:'low'}},request:{inputDigest:bytesDigest(this.assessment.render(dispatch)),schemaDigest:digest(this.assessment.schemaFor(dispatch)),cwd:this.workspace}};
  }
  async invoke(dispatch,signal) {
    if(!this.native) throw Object.assign(Error('Native provider was not prepared'),{notStarted:true});
    if(dispatch.nativePreparation&&digest(this.prepare(dispatch))!==digest(dispatch.nativePreparation))throw Object.assign(Error('Native preparation changed before possible dispatch'),{notStarted:true});
    const started=performance.now(),outputSchema=this.assessment.schemaFor(dispatch),job={formatVersion:1,profileVersion:this.assessment.version,component:this.assessment.kind,dispatchId:dispatch.id,inputDigest:dispatch.inputDigest,session:dispatch.request.session,sequence:dispatch.sequence,model:this.profile.model,nativeVersion:this.nativeVersion,apiContractDigest:codexApiContractDigest,instance:this.instance,pid:this.native.child.pid,state:'prepared',nativeSchemaDigest:digest(outputSchema),baseInstructionsDigest:bytesDigest(this.assessment.baseInstructions),developerInstructionsDigest:bytesDigest(this.assessment.developerInstructions)};
    this.currentJob=job;
    try {this.save(job);writeCheckpoint(join(this.environment.CODEX_HOME,'profile.json'),{formatVersion:1,kind:'moment-owned-memory-worker',model:this.profile.model,dispatchId:job.dispatchId,inputDigest:job.inputDigest});} catch(error) {error.notStarted=true;await this.dispose(false);throw error;}
    let completed,outputText='',tokenUsage,notify,failed,transportFailure;
    const completion=new Promise(resolve=>completed=resolve);
    const save=()=>this.save(job);
    notify=(method,params)=>{
      if(method==='thread/started' && !job.threadId) {job.threadId=params.thread.id;save();}
      if(params?.threadId!==job.threadId) return;
      const eventTurn=params.turnId??params.turn?.id;
      if(job.turnId && eventTurn && job.turnId!==eventTurn)return;
      if(method==='turn/started') {job.turnId=params.turn.id;save();}
      if(method==='thread/tokenUsage/updated') tokenUsage=params.tokenUsage?.total;
      if(method==='item/completed' && params.item.type==='agentMessage') {
        if(Buffer.byteLength(params.item.text)>65536) {failed='Native checker output exceeds its bound';completed({status:'failed'});} else {
          outputText=params.item.text;job.nativeOutputDigest=bytesDigest(outputText);job.rawOutput=outputText;
          try{job.output=this.assessment.decode(outputText,dispatch);job.outputDigest=digest(job.output);delete job.invalidNativeOutput;}
          catch{delete job.output;delete job.outputDigest;job.invalidNativeOutput=true;}
          save();
        }
      }
      if(method==='turn/completed') {job.terminalTurn={id:params.turn.id,status:params.turn.status};job.usage=usageOf(tokenUsage,Math.round(performance.now()-started));save();completed(params.turn);}
    };
    const onFailure=error=>{transportFailure=error;completed({status:'unknown'});};this.native.events.on('failure',onFailure);
    const eventNames=['thread/started','turn/started','thread/tokenUsage/updated','item/completed','turn/completed'];
    const listeners=eventNames.map(method=>{const listener=params=>notify(method,params);this.native.events.on(method,listener);return [method,listener];});
    let timer;const aborted=()=>completed({status:'unknown'});signal?.addEventListener('abort',aborted,{once:true});
    try {
      job.state='thread-start-sent';save();
      const thread=await this.native.call('thread/start',{cwd:this.workspace,model:this.profile.model,allowProviderModelFallback:false,approvalPolicy:'never',permissions:'moment-memory',ephemeral:false,baseInstructions:this.assessment.baseInstructions,developerInstructions:this.assessment.developerInstructions,environments:[],dynamicTools:[]});
      job.threadId=thread.thread.id;job.state='thread-started';save();
      assertCodexThread(thread,{model:this.profile.model,permissionProfileId:'moment-memory',version:this.nativeVersion});
      const instruction=this.assessment.render(dispatch);
      job.nativePromptDigest=bytesDigest(instruction);job.state='turn-start-sent';save();
      const turn=await this.native.call('turn/start',{threadId:job.threadId,clientUserMessageId:dispatch.id,input:[{type:'text',text:instruction}],outputSchema,effort:'low',permissions:'moment-memory'});
      job.turnId=turn.turn.id;job.state='turn-started';save();
      const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'unknown'}),this.profile.timeoutMillis);});
      const done=await Promise.race([completion,deadline]);
      if(done.status!=='completed') {
        if(done.status==='failed') {
          job.state='failure-observed';job.failure={code:'NATIVE_TURN_FAILED',message:failed??'Native checker returned a failed terminal turn'};job.usage=usageOf(tokenUsage,Math.round(performance.now()-started));save();
          return {failure:job.failure,usage:job.usage,...(job.rawOutput===undefined?{}:{rawOutput:job.rawOutput})};
        }
        job.state='completion-unknown';save();
        await this.native.call('turn/interrupt',{threadId:job.threadId,turnId:job.turnId},3000).catch(()=>{});
        await this.dispose(false);throw transportFailure?.codexDiagnostic?transportFailure:codexApiError('turn/completed','an attributable terminal result; reconcile the retained dispatch',this.nativeVersion);
      }
      let output;
      try {output=this.assessment.decode(outputText,dispatch);}
      catch {job.state='failure-observed';job.failure={code:'OUTPUT_INVALID',message:'Completed native checker returned invalid structured output'};job.usage=usageOf(tokenUsage,Math.round(performance.now()-started));save();return {failure:job.failure,usage:job.usage,...(job.rawOutput===undefined?{}:{rawOutput:job.rawOutput})};}
      job.state='result-observed';job.output=output;job.outputDigest=digest(output);job.nativeOutputDigest=bytesDigest(outputText);job.usage=usageOf(tokenUsage,Math.round(performance.now()-started));save();
      return {output,usage:job.usage,rawOutput:outputText};
    } catch(error) {
      if(error.codexDiagnostic){job.compatibilityFailure=error.codexDiagnostic;save();}
      const beforeTurn=!['turn-start-sent','turn-started','completion-unknown','result-observed','failure-observed'].includes(job.state);
      if(beforeTurn || ['turn-start-sent'].includes(job.state) && [-32601,-32602].includes(error.rpcCode)) {job.state='not-started';save();error.notStarted=true;}
      await this.dispose(false);throw error;
    } finally {
      clearTimeout(timer);signal?.removeEventListener('abort',aborted);
      if(this.native) {for(const [name,listener] of listeners)this.native.events.off(name,listener);this.native.events.off('failure',onFailure);}
    }
  }
  recover(dispatch) {
    const path=this.jobPath(dispatch.id);if(!existsSync(path)) return;
    const job=privateNativeJson(path,this.maximumJobBytes);
    if(job.dispatchId!==dispatch.id || job.inputDigest!==dispatch.inputDigest) fail('IDENTITY_CONFLICT','Native result journal does not match retained input');
    const frozen=dispatch.nativePreparation?.profile,legacy=this.assessment.kind==='memory'&&job.profileVersion===5&&frozen?.kind==='codex-memory'&&frozen.version===5&&frozen.renderer==='moment-memory-native/1';
    if((job.profileVersion!==this.assessment.version&&!legacy) || (job.component??'memory')!==this.assessment.kind || job.nativeSchemaDigest!==digest(this.assessment.schemaFor(dispatch))) fail('UNSUPPORTED_VERSION','Retained native result has a different checker profile or output contract');
    if(job.baseInstructionsDigest!==bytesDigest(this.assessment.baseInstructions) || job.developerInstructionsDigest!==bytesDigest(this.assessment.developerInstructions))fail('UNSUPPORTED_VERSION','Retained native result has different instruction identities');
    if(job.rawOutput!==undefined && (typeof job.rawOutput!=='string' || bytesDigest(job.rawOutput)!==job.nativeOutputDigest))fail('IDENTITY_CONFLICT','Retained raw native result has changed bytes');
    if(job.state==='result-observed' && digest(job.output)===job.outputDigest) return {kind:'observed',output:job.output,usage:job.usage,...(job.rawOutput===undefined?{}:{rawOutput:job.rawOutput})};
    if(job.state==='not-started') return {kind:'not_started',evidence:'Owned native dispatch journal confirms no turn/start was sent or that the request was rejected before admission.'};
    if(job.state==='failure-observed') return {kind:'failed',...job.failure,usage:job.usage,...(job.rawOutput===undefined?{}:{rawOutput:job.rawOutput}),evidence:'Owned native journal retained the observed terminal failure.'};
    if(job.terminalTurn?.status==='interrupted')return {kind:'cancelled',evidence:'Owned native turn/completed reported interruption for '+job.terminalTurn.id+'; its exact dispatch basis is retained.'};
    if(job.terminalTurn?.status==='failed')return {kind:'failed',code:'NATIVE_TURN_FAILED',message:'Native checker returned a failed terminal turn',usage:job.usage,evidence:'Owned native journal retained the observed failed terminal turn.'};
    if(job.terminalTurn?.status==='completed'){
      if(job.output!==undefined && digest(job.output)===job.outputDigest)return {kind:'observed',output:job.output,usage:job.usage,...(job.rawOutput===undefined?{}:{rawOutput:job.rawOutput})};
      return {kind:'failed',code:'OUTPUT_INVALID',message:'Completed native checker did not retain valid structured output',usage:job.usage,...(job.rawOutput===undefined?{}:{rawOutput:job.rawOutput}),evidence:'Native terminal completion is observed; its last output is invalid or absent.'};
    }
  }
  async cancelled(dispatch) {
    const job=privateNativeJson(this.jobPath(dispatch.id),this.maximumJobBytes);
    if(job.dispatchId!==dispatch.id || job.inputDigest!==dispatch.inputDigest)fail('IDENTITY_CONFLICT','Cancelled native journal does not match the reconciled dispatch');
    job.state='cancelled';job.receiptStatus='cancelled';this.save(job);
    if(this.currentJob?.dispatchId===dispatch.id){await this.dispose(true);this.currentJob=undefined;}
    else this.cleanTerminatedInstance(job);
  }
  async settled(receipt) {
    const path=this.jobPath(receipt.dispatchId),job=privateNativeJson(path,this.maximumJobBytes);
    const legacy=this.assessment.kind==='memory'&&job.profileVersion===5&&receipt.provider?.id==='codex-memory/app-server-v2/5'&&job.baseInstructionsDigest===bytesDigest(this.assessment.baseInstructions)&&job.developerInstructionsDigest===bytesDigest(this.assessment.developerInstructions);
    if(job.dispatchId!==receipt.dispatchId || job.inputDigest!==receipt.inputDigest || job.profileVersion!==this.assessment.version&&!legacy || (job.component??'memory')!==this.assessment.kind)fail('IDENTITY_CONFLICT','Native settlement disagrees with the retained dispatch/profile');
    if(receipt.nativeOutputDigest!==undefined&&receipt.nativeOutputDigest!==job.nativeOutputDigest)fail('IDENTITY_CONFLICT','Native settlement disagrees with the retained raw result');
    job.state='committed';job.cacheRevision=receipt.cacheRevision;job.receiptStatus=receipt.status;
    if(receipt.status==='succeeded')delete job.output;else if(receipt.error)job.validationError=receipt.error;
    if(this.assessment.kind==='memory'&&receipt.evidenceRetained){if(receipt.nativeOutputDigest)delete job.rawOutput;delete job.output;job.assessmentId=receipt.dispatchId;}
    this.save(job);
    if(job.instance!==this.instance)this.cleanTerminatedInstance(job);
    await this.dispose(true);this.currentJob=undefined;
  }
  cleanTerminatedInstance(job) {
    // A retained PID is never a process handle. Remove old state only after
    // observing no such process and matching this component's private marker.
    if(typeof job.instance!=='string' || dirname(job.instance)!==this.directory || !/^instance-[a-zA-Z0-9]+$/.test(basename(job.instance)) || !Number.isSafeInteger(job.pid) || job.pid<1)return;
    try{process.kill(job.pid,0);return;}catch(error){if(error.code!=='ESRCH')return;}
    try{
      const stat=lstatSync(job.instance);if(!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077)return;
      const marker=privateNativeJson(join(job.instance,'state/profile.json'));
      if(marker.kind!=='moment-owned-memory-worker' || marker.dispatchId!==job.dispatchId || marker.inputDigest!==job.inputDigest)return;
      rmSync(job.instance,{recursive:true,force:true});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async notStarted(dispatchId) {
    if(this.currentJob?.dispatchId===dispatchId) {await this.dispose(true);this.currentJob=undefined;}
    else {const path=this.jobPath(dispatchId);if(existsSync(path))this.cleanTerminatedInstance(privateNativeJson(path,this.maximumJobBytes));if(!this.currentJob)await this.dispose(true);}
  }
  async dispose(remove) {
    const native=this.native;this.native=undefined;await native?.close();
    if(remove && this.instance) {rmSync(this.instance,{recursive:true,force:true});this.instance=undefined;}
  }
  async idle() {if(!this.currentJob) await this.dispose(true);}
  async close() {this.closed=true;await this.dispose(!this.currentJob);}
}

export function configuredMemoryProvider(root) {
  const path=join(root,'runtime/session-memory.json');if(!existsSync(path)) return;
  try {
    const config=privateNativeJson(path);
    if(config.formatVersion!==1 || typeof config.enabled!=='boolean' || Object.keys(config).some(key=>!['formatVersion','enabled','provider'].includes(key))) fail('INVALID_ARGUMENT','Invalid memory configuration');
    if(!config.enabled) return;
    const provider=config.provider;
    if(!provider || provider.kind!=='codex' || Object.keys(provider).some(key=>!['kind','credentialFile','model','binary','timeoutMillis','maximumJournals','maximumJournalBytes'].includes(key))) fail('INVALID_ARGUMENT','Unsupported memory provider configuration');
    const {kind,...profile}=provider;return new CodexMemoryProvider(root,profile);
  } catch {return {unavailableReason:'Session-memory configuration is invalid; inspect the private owner configuration',async ready(){throw Error('Invalid session-memory configuration');},async invoke(){throw Error('Unqualified provider');}};}
}
