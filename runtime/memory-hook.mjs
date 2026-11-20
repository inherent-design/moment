// Native hook entry: an unenrolled session loads no service, schemas or provider.
import {readJsonInput} from './input.mjs';
import {parseJson} from './wire.mjs';
import {inspectHome} from './home.mjs';
import {enrollmentHint} from './memory-enrollment.mjs';

async function run(){
  if(process.argv.length!==3)throw Error('Select the generated hook configuration');
  const config=parseJson(process.argv[2]);
  if(!config || Object.keys(config).some(key=>!['runtimeId','codexHome','sessionId'].includes(key)) || typeof config.runtimeId!=='string' || !config.runtimeId.length || Buffer.byteLength(config.runtimeId)>256 || typeof config.codexHome!=='string' || !config.codexHome.length || config.sessionId!==undefined && (typeof config.sessionId!=='string' || !config.sessionId.length || Buffer.byteLength(config.sessionId)>256))throw Error('Invalid hook configuration');
  const event=await readJsonInput('-');
  if(!event || event.agent_id || !['UserPromptSubmit','SessionStart'].includes(event.hook_event_name) || config.sessionId!==undefined && config.sessionId!==event.session_id)return {};
  if(typeof event.session_id!=='string' || !event.session_id.length || Buffer.byteLength(event.session_id)>256)throw Error('Missing native session identity');
  const home=inspectHome(),session={runtimeId:config.runtimeId,sessionId:event.session_id};
  if(!home.registry || !enrollmentHint(home.root,home.registry.systemId,session))return {};
  return (await import('./memory-commands.mjs')).handleMemoryHook(event,config);
}
try{console.log(JSON.stringify(await run()));}
catch(error){console.log(JSON.stringify({systemMessage:'Moment session memory is unavailable ('+(error.code??'INPUT_ERROR')+'); the current conversation can continue.'}));}
