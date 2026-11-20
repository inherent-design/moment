import {mkdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {readCodexExchange,readCodexHistory} from './memory-sources.mjs';
import {parseJson} from './wire.mjs';
import {createService} from './service.mjs';
import {createClient} from './client.mjs';
import {readJsonInput} from './input.mjs';
import {publishPrivate} from './private-files.mjs';
import {catalogIdentity,validateBoundary} from './bindings.mjs';
import {inspectHome} from './home.mjs';
import {enrollmentHint} from './memory-enrollment.mjs';
import {argumentsFor} from './commands.mjs';
import {canonical,DomainError,fail} from './json.mjs';
import {memoryMap} from './memory-presentation.mjs';

const safe=value=>String(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
async function connect() {
  const ready=await createService().ensure();
  if(!ready.ok) throw new DomainError(ready.error.code,ready.error.message,ready.error.retry);
  const client=createClient(ready.value.home),description=await client.call('system.describe',{protocolVersion:'0.1'});
  if(!description.ok) throw new DomainError(description.error.code,description.error.message,description.error.retry);
  if(description.value.catalog?.digest!==catalogIdentity.digest) fail('UNSUPPORTED_VERSION','Memory commands require the matching service catalog');
  return {root:ready.value.home,client};
}
async function call(client,method,input) {
  const result=await client.call(method,input);
  if(!result.ok) throw Object.assign(new DomainError(result.error.code,result.error.message,result.error.retry),{details:result.error.details});
  return result.value;
}
export function memoryHookDefinitions(runtimeId,codexHome=process.env.CODEX_HOME??join(homedir(),'.codex'),momentHome,sessionId) {
  if(typeof runtimeId!=='string' || !runtimeId.length || Buffer.byteLength(runtimeId)>256) fail('INVALID_ARGUMENT','Select an explicit runtime identity');
  if(sessionId!==undefined)validateBoundary('memory.read','input',{session:{runtimeId,sessionId}});
  const command=(momentHome?'MOMENT_HOME='+quote(momentHome)+' ':'')+[process.execPath,fileURLToPath(new URL('./memory-hook.mjs',import.meta.url)),canonical({runtimeId,codexHome,...(sessionId===undefined?{}:{sessionId})})].map(quote).join(' ');
  return {description:'Moment source-attributed session memory. Review and trust these exact hooks before use.',hooks:{
    UserPromptSubmit:[{hooks:[{type:'command',command,timeout:10,statusMessage:'Moment: capture enabled session memory',additionalContextLimit:5000}]}],
    SessionStart:[{matcher:'startup|resume|compact|clear|fork',hooks:[{type:'command',command,timeout:10,statusMessage:'Moment: restore enabled session memory',additionalContextLimit:5000}]}],
  }};
}
function hookOutput(event,packet,maximumBytes) {
  const warning=['unavailable','unknown'].includes(packet.worker?.state)?{systemMessage:'Moment session memory: '+packet.worker.reason}:{};
  const meaningfulFocus=packet.bindings||packet.omittedFields?.includes('/bindings')||packet.workingSet&&(packet.workingSet.purposeKey!=='default'||packet.workingSet.purpose||packet.workingSet.returnPoint||packet.workingSet.basisSourceIds.length);
  if(!packet.entries.length && !packet.gaps.length && !packet.pending.length && !packet.lastAssessment && !meaningfulFocus) return warning;
  const additionalContext=memoryMap(packet,maximumBytes);
  return {...warning,hookSpecificOutput:{hookEventName:event.hook_event_name,additionalContext}};
}
export async function handleMemoryHook(event,{runtimeId,sessionId,maximumBytes,codexHome=process.env.CODEX_HOME??join(homedir(),'.codex')}) {
  // Root session hooks only. A child's parent session_id cannot identify its own cache.
  if(!event || event.agent_id || !['UserPromptSubmit','SessionStart'].includes(event.hook_event_name)) return {};
  const bound=maximumBytes===undefined?{}:{maximumBytes};
  if(sessionId!==undefined){validateBoundary('memory.read','input',{session:{runtimeId,sessionId},...bound});if(event.session_id!==sessionId)return {};}
  const session={runtimeId,sessionId:event.session_id};
  validateBoundary('memory.read','input',{session,...bound});
  const home=inspectHome();
  if(!home.registry)return {};
  const hint=enrollmentHint(home.root,home.registry.systemId,session);
  if(!hint)return {};
  const {root,client}=await connect();
  const before=await call(client,'memory.read',{session,maximumBytes:262144});
  if(!before.subscription.enabled || before.subscription.revision!==hint.revision)return {};
  if(event.hook_event_name==='UserPromptSubmit') {
    const selected=readCodexExchange({codexHome,transcriptPath:event.transcript_path,sessionId:event.session_id});
    const input={session,deliveryId:randomUUID(),automatic:{subscriptionRevision:before.subscription.revision},message:{text:event.prompt,authorship:'unknown',...(typeof event.turn_id==='string'?{turnId:event.turn_id}:{})},...(selected.exchange.length?{exchange:selected.exchange}:{})};
    // A hook submission is not by itself independent proof of human authorship.
    validateBoundary('memory.observe','input',input);
    const directory=join(root,'runtime/session-memory-intake');mkdirSync(directory,{recursive:true,mode:0o700});
    const journal=join(directory,input.deliveryId+'.json');publishPrivate(journal,canonical(input)+'\n');
    try {await call(client,'memory.observe',input);unlinkSync(journal);}
    catch(error) {
      if(error.retry!=='reconcile') unlinkSync(journal);
      else process.stderr.write('Moment retained an uncertain intake for exact reconciliation: '+journal+'\n');
      throw error;
    }
  }
  const packet=await call(client,'memory.read',{session,maximumBytes:262144});
  return packet.subscription.enabled?hookOutput(event,packet,maximumBytes):{};
}
/** Human/operator projection; hook inference never runs in this command process. */
export async function runMemoryCommand(args) {
  try{return await memoryCommand(args);}
  catch(error){
    if(!args.includes('--json') || args[0]==='hook')throw error;
    console.log(JSON.stringify({ok:false,error:{code:error.code??'INVALID_ARGUMENT',message:error.message,retry:error.retry??'never',details:error.details??null}}));process.exitCode=1;return true;
  }
}
async function memoryCommand(args) {
  const [operation,...rest]=args;
  const {options,positionals}=argumentsFor(rest,['--runtime','--session','--maximum-bytes','--sources','--file','--codex-home','--moment-home','--working-set'],['--json','--sets']);
  if(positionals.length) fail('INVALID_ARGUMENT','Unexpected memory command arguments');
  const allowed={on:['--runtime','--session','--json'],off:['--runtime','--session','--json'],read:['--runtime','--session','--maximum-bytes','--sources','--working-set','--sets','--json'],status:['--runtime','--session','--maximum-bytes','--sources','--working-set','--sets','--json'],assessments:['--runtime','--session','--maximum-bytes','--file','--json'],hooks:['--runtime','--session','--codex-home','--moment-home','--json'],hook:['--runtime','--session','--codex-home','--maximum-bytes'],select:['--runtime','--codex-home','--file','--json']};
  const accepted=allowed[operation]??(['focus','configure','observe','rebuild','cancel','reconcile'].includes(operation)?['--file','--json']:[]);
  if(Object.keys(options).some(key=>!accepted.includes(key)))fail('INVALID_ARGUMENT','Unsupported option for memory '+operation);
  const runtimeId=options['--runtime']??'codex',sessionId=options['--session']??process.env.CODEX_THREAD_ID;
  if(operation==='hooks') {console.log(JSON.stringify(memoryHookDefinitions(runtimeId,options['--codex-home'],options['--moment-home'],options['--session']),null,2));return true;}
  if(operation==='hook') {
    try {console.log(JSON.stringify(await handleMemoryHook(await readJsonInput('-'),{runtimeId,sessionId:options['--session'],codexHome:options['--codex-home'],maximumBytes:options['--maximum-bytes']?Number(options['--maximum-bytes']):undefined})));}
    catch(error) {console.log(JSON.stringify({systemMessage:'Moment session memory is unavailable ('+(error.code??'INPUT_ERROR')+'); the current conversation can continue.'}));}
    return true;
  }
  if(operation==='select') {
    if(!options['--file'])fail('INVALID_ARGUMENT','History selection needs --file PATH|- with destination session, expectedRevision and ordered selections');
    const selection=await readJsonInput(options['--file']);
    if(!selection || Object.keys(selection).some(key=>!['session','expectedRevision','workingSetId','expectedWorkingSetRevision','selections','maximumBytes','maximumCaptures'].includes(key)))fail('INVALID_ARGUMENT','Unexpected history selection fields');
    validateBoundary('memory.read','input',{session:selection.session});
    const revision=selection.workingSetId===undefined?{expectedRevision:selection.expectedRevision}:{workingSetId:selection.workingSetId,expectedWorkingSetRevision:selection.expectedWorkingSetRevision};
    if(selection.workingSetId!==undefined&&selection.expectedRevision!==undefined || selection.workingSetId===undefined&&selection.expectedWorkingSetRevision!==undefined)fail('INVALID_ARGUMENT','Use exactly one destination revision convention');
    validateBoundary('memory.rebuild','input',{session:selection.session,deliveryId:'validate-history-destination',sourceIds:[],...revision});
    const {captures,coverage}=readCodexHistory({runtimeId,codexHome:options['--codex-home']??process.env.CODEX_HOME??join(homedir(),'.codex'),selections:selection.selections,...(selection.maximumBytes===undefined?{}:{maximumBytes:selection.maximumBytes}),...(selection.maximumCaptures===undefined?{}:{maximumCaptures:selection.maximumCaptures})});
    const input={session:selection.session,...revision,deliveryId:randomUUID(),sourceIds:[],captures};validateBoundary('memory.rebuild','input',input);
    console.log(JSON.stringify({ok:true,value:{input:captures.length?input:null,coverage}}));return true;
  }
  if(!['on','off','focus','configure','read','status','assessments','observe','rebuild','cancel','reconcile'].includes(operation)) fail('INVALID_ARGUMENT','Use moment memory on|off|focus|configure|read|status|assessments|hooks|hook|select|observe|rebuild|cancel|reconcile');
  let input;
  if(['on','off'].includes(operation)) {
    input={session:{runtimeId,sessionId}};validateBoundary('memory.read','input',input);
  } else if(operation==='assessments') {
    if(options['--file']){
      if(['--runtime','--session','--maximum-bytes'].some(key=>Object.hasOwn(options,key)))fail('INVALID_ARGUMENT','Assessment --file input owns its complete selection; do not combine selectors');
      input=await readJsonInput(options['--file']);
    }else input={session:{runtimeId,sessionId},...(options['--maximum-bytes']?{maximumBytes:Number(options['--maximum-bytes'])}:{})};
    validateBoundary('memory.assessments.read','input',input);
  } else if(['read','status'].includes(operation)) {
    input={session:{runtimeId,sessionId},...(options['--maximum-bytes']?{maximumBytes:Number(options['--maximum-bytes'])}:{}),...(options['--sources']?{sourceIds:parseJson(options['--sources'])}:{}),...(options['--working-set']?{workingSetId:options['--working-set']}:{}),...(options['--sets']?{includeWorkingSets:true}:{})};
    validateBoundary('memory.read','input',input);
  } else {
    if(!options['--file']) fail('INVALID_ARGUMENT','Owner-local memory changes require --file PATH|- with the exact structured input');
    input=await readJsonInput(options['--file']);validateBoundary('memory.'+operation,'input',input);
  }
  const {root,client}=await connect();let value;
  if(['on','off'].includes(operation)) {
    const packet=await call(client,'memory.read',input);
    input={session:input.session,expectedRevision:packet.subscription.revision,idempotencyKey:randomUUID(),enabled:operation==='on'};
    const directory=join(root,'runtime/session-memory-configuration');mkdirSync(directory,{recursive:true,mode:0o700});
    const journal=join(directory,input.idempotencyKey+'.json');publishPrivate(journal,canonical(input)+'\n');
    try{value=await call(client,'memory.configure',input);unlinkSync(journal);}
    catch(error){
      if(error.retry!=='reconcile')unlinkSync(journal);
      else {error.details={...(error.details??{}),configurationRequest:journal};error.message+=' Exact retry: moment memory configure --file '+journal;}
      throw error;
    }
  } else if(operation==='focus'){
    const directory=join(root,'runtime/session-memory-focus');mkdirSync(directory,{recursive:true,mode:0o700});
    const journal=join(directory,randomUUID()+'.json');publishPrivate(journal,canonical(input)+'\n');
    try{value=await call(client,'memory.focus',input);unlinkSync(journal);}
    catch(error){if(error.retry!=='reconcile')unlinkSync(journal);else{error.details={...(error.details??{}),focusRequest:journal};error.message+=' Exact retry: moment memory focus --file '+journal;}throw error;}
  } else value=await call(client,'memory.'+(operation==='status'?'read':operation==='assessments'?'assessments.read':operation),input);
  if(options['--json']) console.log(JSON.stringify({ok:true,value}));
  else if(['read','status'].includes(operation)) {
    console.log(safe(`Automatic memory ${value.subscription.enabled?'on':'off'} (configuration ${value.subscription.revision}; ${value.automation.state}). ${value.automation.reason}`));
    console.log(safe(`Session memory revision ${value.cacheRevision}; processed ${value.processedThrough} of ${value.observedThrough} observed inputs; ${value.pending.length} pending; ${value.gapCount} gaps. ${value.worker?.reason??''}`));
    if(value.focus)console.log(safe(`Active working set ${value.focus.workingSetId}; focus revision ${value.focus.revision}. Selected ${value.workingSet.id}; set revision ${value.workingSet.revision}: ${value.workingSet.label}.`));
    if(value.bindings?.work)console.log(safe(`Referenced work: context ${value.bindings.work.target.contextId}${value.bindings.work.target.incidentId?'; incident '+value.bindings.work.target.incidentId:''} (${value.bindings.work.contextState}).`));
    if(value.bindings)console.log(safe(`Guidance bindings: ${value.bindings.guidance.length}; unavailable work/guidance references: ${value.bindings.omitted.length}. Current observation and historical qualifications remain in --json detail.`));
    if(operation==='read') for(const entry of value.entries) {
      console.log(safe(`Source ${entry.sourceId}; retention ${entry.weight}${entry.generality===undefined?'':'; generality '+entry.generality}${entry.note?'; '+entry.note:''}`));
      const source=value.sources.find(item=>item.id===entry.sourceId);if(source) console.log(safe(source.text));
    }
    if(value.omittedSourceIds.length) console.log(safe('Recover selected original sources with --sources and --maximum-bytes: '+value.omittedSourceIds.join(', ')));
    if(value.omittedFields?.length)console.log(safe('Optional memory metadata omitted ('+value.omittedFields.length+' fields); use --maximum-bytes for more detail.'));
    if(value.omittedWorkingSetIds?.length)console.log(safe('Working sets omitted; use --sets and --maximum-bytes: '+value.omittedWorkingSetIds.join(', ')));
  } else if(['on','off'].includes(operation))console.log(safe(`Automatic memory ${value.subscription.enabled?'on':'off'} for ${runtimeId}/${sessionId}; configuration ${value.subscription.revision}. ${value.subscription.enabled?'Future eligible inputs require the shared host hooks to be trusted and loaded; check memory status after an ordinary message.':'History and already-dispatched outcomes remain retained.'}`));
  else console.log(JSON.stringify({ok:true,value}));
  return true;
}
