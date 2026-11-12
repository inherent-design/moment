import { createService } from './service.mjs';
import { inspectHome } from './home.mjs';
import { createClient } from './client.mjs';
import { createManaged } from './managed.mjs';
import { discoverBindings,validateSurface } from './bindings.mjs';
import { runMcp } from './mcp.mjs';

const safe=value=>String(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
function argumentsFor(args,values=[],flags=[]) {
  const options={},positionals=[];
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg.startsWith('--')) {
      if(Object.hasOwn(options,arg)) throw new Error(`Repeated option ${arg}`);
      if(flags.includes(arg)) options[arg]=true;
      else if(values.includes(arg) && args[i+1] && !args[i+1].startsWith('--')) options[arg]=args[++i];
      else throw new Error(`Unknown option or missing value: ${arg}; use moment --help`);
    } else positionals.push(arg);
  }
  return {options,positionals};
}
function reportFault(result,json) {
  if(json) console.log(JSON.stringify(result));
  else console.log(safe(`${result.error.message}\n${result.error.retry==='reconcile'?'Reconcile the retained exact request and inspect moment status before retrying.':result.error.retry==='refresh'?'Read the current context or service identity before retrying.':'Check the selected context, credential and current policy with moment agents or the raw call interface.'}`));
  process.exitCode=1;
}

/** Returns false only for legacy operator commands owned by cli.mjs. */
export async function runManagedCommand(args) {
  const [command,...rest]=args;
  if(command==='mcp') {
    const {options,positionals}=argumentsFor(rest,['--profile']);
    if(positionals.length) throw new Error('moment mcp accepts no positional arguments');
    runMcp({profile:options['--profile']??'continuity'});return true;
  }
  if(command==='agents') {
    const {options,positionals}=argumentsFor(rest,['--limit','--cursor','--profile']);
    if(positionals.length>1) throw new Error('Select at most one operation with moment agents');
    const page=discoverBindings({...(positionals.length?{operationId:positionals[0]}:{}),...(options['--limit']?{limit:Number(options['--limit'])}:{}),...(options['--cursor']?{cursor:options['--cursor']}:{})},options['--profile']??'continuity');
    const records=[{formatVersion:1,kind:'manifest',catalog:page.catalog,exposedOperations:page.exposedOperations,...(page.nextCursor?{nextCursor:page.nextCursor}:{})}];
    for(const binding of page.operations) {
      const record=positionals.length?binding:{...binding,inputSchema:{ref:binding.inputSchema.ref},outputSchema:{ref:binding.outputSchema.ref}};
      records.push({formatVersion:1,kind:'operation',...record});
    }
    for(const record of records) validateSurface(record.kind==='manifest'?'AgentManifest':'AgentRecord',record);
    const bytes=records.map(record=>JSON.stringify(record)).join('\n')+'\n';
    if(Buffer.byteLength(bytes)>262144) throw new Error('Discovery exceeds 256 KiB; request fewer operations');
    process.stdout.write(bytes);return true;
  }
  if(!['status','show','stop'].includes(command)) return false;
  const {options,positionals}=argumentsFor(rest,['--context'],['--details','--json']);
  const json=options['--json'];
  if(command==='show'?(positionals.length!==1 || !options['--context']):positionals.length || (command==='stop'&&Object.keys(options).some(k=>k!=='--json'))) throw new Error(command==='show'?'Use moment show INCIDENT --context CONTEXT [--details] [--json]':'Invalid arguments; use moment --help');
  const service=createService();
  if(command==='show') {
    const home=inspectHome();
    if(!home.registry) {reportFault({ok:false,error:{code:'NOT_FOUND',message:'Selected Moment home has no retained context; select the existing MOMENT_HOME',retry:'never',details:null}},json);return true;}
    const result=await createManaged().call('workspace.read',{target:{systemId:home.registry.systemId,contextId:options['--context'],incidentId:positionals[0]},includeMessages:false});
    if(!result.ok) reportFault(result,json);
    else if(json) console.log(JSON.stringify(result));
    else {
      const packet=result.value,incident=packet.incident.value,status={open:'Active',resting:'Resting',completed:'Completed',cancelled:'Cancelled'}[incident.status];
      console.log(safe(`${status}: ${incident.purpose}`));
      if(incident.completionCriteria.length) console.log(safe('Completion requires: '+incident.completionCriteria.join('; ')));
      for(const {record} of packet.records) console.log(safe(typeof record.value.value==='string'?record.value.value:JSON.stringify(record.value)));
      if(packet.omittedRefs.length) console.log('Some selected detail did not fit. Use --json to inspect omitted references or request selected detail with workspace.read.');
      if(options['--details']) console.log(JSON.stringify({attachment:packet.attachment,revision:packet.context.revision,catalog:packet.catalog,omittedRefs:packet.omittedRefs},null,2));
    }
    return true;
  }
  const health=await service.inspect();
  if(command==='stop') {
    if(health.state==='stopped') {const report={ok:true,value:{accepted:false,retired:true,health}};validateSurface('StopEnvelope',report);console.log(json?JSON.stringify(report):'Moment is already stopped. Retained work is unchanged.');return true;}
    if(health.state!=='ready') {reportFault({ok:false,error:{code:'CAPABILITY_UNAVAILABLE',message:health.reason,retry:'reconcile',details:health}},json);return true;}
    const result=await service.stop(health.instanceId);
    if(!result.ok) {reportFault(result,json);return true;}
    const until=Date.now()+10000;let observed;
    do { observed=await service.inspect();if(observed.state==='stopped' || observed.instanceId && observed.instanceId!==health.instanceId) break;await new Promise(resolve=>setTimeout(resolve,50)); } while(Date.now()<until);
    const retired=observed.state==='stopped'||observed.instanceId&&observed.instanceId!==health.instanceId;
    const outcome={accepted:true,instanceId:health.instanceId,retired:!!retired,health:observed};
    validateSurface('StopEnvelope',{ok:true,value:outcome});
    if(json) console.log(JSON.stringify({ok:true,value:outcome}));
    else console.log(retired?'Moment stopped. Pending work and recovery evidence remain retained.':'Stop requested; retirement is not yet confirmed. Run moment status to inspect it.');
    if(!retired) process.exitCode=1;return true;
  }
  const value={health,contexts:[],incidents:[],issues:[]};
  if(health.state==='ready') {
    const home=inspectHome(),client=createClient(home.root);
    const ids=options['--context']?[options['--context']]:[...new Set(home.registry.projects.flatMap(p=>p.contextIds??[]))].slice(0,20);
    for(const contextId of ids) {
      const context=await client.call('context.get',{contextId});
      if(!context.ok) {if(options['--context'] || !['FORBIDDEN','NOT_FOUND'].includes(context.error.code)) value.issues.push(context.error);continue;}
      value.contexts.push(context.value);
      const incidents=await client.call('incident.list',{contextId,statuses:['open','resting'],limit:20});
      if(!incidents.ok) value.issues.push(incidents.error);
      else {value.incidents.push(...incidents.value.items);if(incidents.value.nextCursor) value.issues.push({code:'LIMIT_EXCEEDED',message:'More visible work is available; select a context and use incident.list',retry:'never',details:null});}
    }
  }
  validateSurface('StatusEnvelope',{ok:true,value});
  if(json) console.log(JSON.stringify({ok:true,value}));
  else {
    console.log(safe(`Moment is ${health.state}. ${health.reason}.`));
    for(const item of value.incidents) console.log(safe(`${item.value.status==='resting'?'Resting':'Active'}: ${item.value.purpose}`));
    if(health.state==='ready' && !value.incidents.length && !value.issues.length) console.log('No active work was found in the selected central associations. Use --context to inspect an explicit context.');
    for(const issue of value.issues) console.log(safe(`Some work could not be inspected: ${issue.message}`));
    if(health.state==='stopped') console.log('A domain tool can start the service, or run moment serve.');
    if(options['--details']) console.log(JSON.stringify(value,null,2));
  }
  if(value.issues.length || !['ready','stopped'].includes(health.state)) process.exitCode=1;
  return true;
}
