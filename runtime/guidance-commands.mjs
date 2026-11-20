import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createClient} from './client.mjs';
import {createService} from './service.mjs';
import {readCredential} from './credentials.mjs';
import {argumentsFor} from './commands.mjs';
import {readJsonInput} from './input.mjs';
import {validateBoundary} from './bindings.mjs';
import {canonical,fail} from './json.mjs';
import {guidanceCapabilityName,guidanceFeatures,guidanceInputSchema,guidanceOutputSchema,guidanceInputDocument,guidanceOutputDocument,guidanceJobLimits} from './guidance-profile.mjs';

/** Explicit owner setup: precise action admission, then a bounded provider/grant. No inference. */
export async function installGuidance(root,contextId,{actionsOnly=false,readOnly=false,additionalRefs=[],credentialFile=process.env.MOMENT_CREDENTIAL_FILE??join(root,'runtime/owner.json')}={}) {
  if(actionsOnly && readOnly)fail('INVALID_ARGUMENT','Select either read-only admission or the broader action profile');
  const owner=readCredential(join(root,'runtime/owner.json')),selected=readCredential(credentialFile);
  if(selected.principalId!==owner.principalId || selected.grants)fail('FORBIDDEN','Guidance setup requires the selected local operator credential; no owner fallback');
  const client=createClient(root,{credentialFile});
  const call=async(method,input)=>{const r=await client.call(method,input);if(!r.ok)fail(r.error.code,r.error.message,r.error.retry);return r.value;};
  const write=async(method,input)=>{const c=await call('context.get',{contextId});return call(method,{contextId,expectedRevision:c.revision,idempotencyKey:randomUUID(),...input});};
  const current=await call('context.get',{contextId}),policy=(await call('control.get',{contextId,ref:current.policy})).value;
  const when={kind:'equal',left:{kind:'binding',name:'principalId'},right:{kind:'literal',value:owner.principalId}},actions=readOnly?['guidance.read']:['context.limits','guidance.register','guidance.refresh','guidance.review','guidance.read',guidanceCapabilityName];
  const required=actions.filter(action=>!policy.rules.some(rule=>rule.effect==='permit' && rule.actions.includes(action) && canonical(rule.when)===canonical(when)));
  const evidence={sources:additionalRefs,artifactDigests:[guidanceInputSchema.digest,guidanceOutputSchema.digest],method:'explicit-owner-guidance-profile-setup/1'};
  validateBoundary('context.limits','input',{contextId,expectedRevision:current.revision,idempotencyKey:'setup-shape-preflight',limits:current.limits,evidence});
  const limits={...guidanceJobLimits(current.limits.currency),...(current.limits.deadline?{deadline:current.limits.deadline}:{})};
  const insufficient=Object.keys(limits).filter(key=>!['currency','deadline'].includes(key) && current.limits[key]<limits[key]);
  const install=readOnly || actionsOnly || insufficient.length?false:true;
  if(required.length || install && canonical(policy.limits)!==canonical(current.limits)) {
    const next=await write('policy.publish',{policy:{...policy,id:randomUUID(),parent:current.policy,limits:install?current.limits:policy.limits,rules:[...policy.rules,...(required.length?[{id:'installed-guidance-owner',effect:'permit',actions:required,when}]:[])]}});
    await write('policy.activate',{policy:next.ref,evidence});
  }
  if(readOnly)return {state:'read-admitted',contextId,note:'Only owner guidance.read was added where absent. Existing predicates, denies, limits and delegates remain in force. No registration, host refresh, labor grant or inference was added.'};
  if(!install)return {state:actionsOnly?'actions-admitted':'needs-resource-ceiling',contextId,requiredJobLimits:limits,insufficient,note:'Context ceiling, active policy and grants are separate. Revise the ceiling through context.limits with evidence, then run full setup. No inference was queued.'};
  for(const [schema,document] of [[guidanceInputSchema,guidanceInputDocument],[guidanceOutputSchema,guidanceOutputDocument]])await write('schema.publish',{schema,document});
  const cap=await write('capability.advertise',{capability:{id:randomUUID(),providerId:owner.principalId,name:guidanceCapabilityName,version:'1',inputSchema:guidanceInputSchema,outputSchema:guidanceOutputSchema,features:guidanceFeatures,platform:{os:process.platform,architecture:process.arch},isolation:'process',reconciliation:'lookup',evidence,expiresAt:new Date(Date.now()+86400000).toISOString()}});
  const packet=await call('guidance.read',{contextId,maximumBytes:262144});
  const resources=[cap.ref,...additionalRefs];for(const source of packet.sources){resources.push(source.ref,...source.value.definition.evidence.sources);if(source.value.definition.locator.kind==='record')resources.push(source.value.definition.locator.ref);}
  for(const {stored} of packet.captures)resources.push(stored.ref,...stored.value.capture.evidence.sources);
  const unique=[...new Map(resources.map(r=>[canonical(r),r])).values()];
  const grant=await write('grant.issue',{grant:{id:randomUUID(),principalId:owner.principalId,actions:['execution.request','guidance.review',guidanceCapabilityName],incidentIds:'all',resourceRefs:unique,delegable:false,limits:current.limits}});
  return {state:'ready',contextId,capability:cap.ref,grant:grant.ref,limits,sourceIds:packet.sources.map(s=>s.ref.id),note:'Setup does not refresh sources, assess, write or activate goals. This owner grant covers the selected current sources/basis; changed or new dependencies need a newly admitted grant.'};
}

export async function runGuidanceCommand(args) {
  const [command,...rest]=args;
  const {options,positionals}=argumentsFor(rest,['--context','--file','--location','--execution','--maximum-bytes','--refs'],['--json','--actions-only','--read-only']);
  if(positionals.length || !['setup','read','register','refresh','review'].includes(command))throw Error('Use moment guidance setup|read|register|refresh|review; see moment --help');
  const allowed=command==='setup'?['--context','--refs','--actions-only','--read-only','--json']:command==='read' && !options['--file']?['--context','--location','--execution','--maximum-bytes','--json']:['--file','--json'];
  if(Object.keys(options).some(k=>!allowed.includes(k)))throw Error('Options do not apply to this guidance command; use an exact --file request or the documented selectors');
  if(command==='read' && !options['--file'] && !options['--context'])throw Error('guidance read requires --context ID or --file PATH|-');
  const service=createService(),ready=await service.ensure();if(!ready.ok)fail(ready.error.code,ready.error.message,ready.error.retry);
  let value;
  if(command==='setup') {
    if(!options['--context'] || options['--file'])throw Error('Use moment guidance setup --context ID [--actions-only] [--refs FILE]');
    const additionalRefs=options['--refs']?await readJsonInput(options['--refs']):[];
    value=await installGuidance(ready.value.home,options['--context'],{actionsOnly:!!options['--actions-only'],readOnly:!!options['--read-only'],additionalRefs});
  } else {
    if(options['--actions-only'] || options['--refs'])throw Error('Setup options apply only to guidance setup');
    const input=options['--file']?await readJsonInput(options['--file']):command==='read'?{contextId:options['--context'],...(options['--location']?{location:options['--location']}:{}),...(options['--execution']?{executionId:options['--execution']}:{}),...(options['--maximum-bytes']?{maximumBytes:Number(options['--maximum-bytes'])}:{})}:undefined;
    if(!input)throw Error('Writes require an exact --file request with revision and retry key');
    const result=await createClient(ready.value.home).call('guidance.'+command,input);if(!result.ok)fail(result.error.code,result.error.message,result.error.retry);value=result.value;
  }
  // Structured output is the same domain response as MCP/raw API; no alternate lifecycle.
  console.log(JSON.stringify(value,null,options['--json']?0:2));return true;
}
