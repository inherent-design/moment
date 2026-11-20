import {captureRead,retainedCapture} from './captures.mjs';
import { join } from 'node:path';
import { inspectHome } from './home.mjs';
import { identifyProject,associatedProjectIds } from './projects.mjs';
import { createClient } from './client.mjs';
import { readCredential } from './credentials.mjs';
import { createService } from './service.mjs';
import { catalog, catalogIdentity, bindingMap, discoverBindings, exposedOperations, validateBoundary } from './bindings.mjs';
import { validateInput } from './validation.mjs';
import { managedMethods } from './operations.mjs';
import { canonical, fail, DomainError, resultError } from './json.mjs';

const notFound=()=>fail('NOT_FOUND','Selected work is not accessible');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Adapter routing is explicit; no connection-global current incident or actor. */
export function createManaged({root,credentialFile=process.env.MOMENT_CREDENTIAL_FILE,profile='continuity',service=createService({root,credentialFile})}={}) {
  const exposed=exposedOperations(profile);
  async function session() {
    const ready=await service.ensure();if(!ready.ok) throw Object.assign(new DomainError(ready.error.code,ready.error.message,ready.error.retry),{details:ready.error.details});
    let credential;
    try {credential=readCredential(credentialFile??join(ready.value.home,'runtime/owner.json'));}
    catch {fail('UNAUTHENTICATED','Selected credential is unavailable; no owner fallback');}
    const client=createClient(ready.value.home,{token:credential.token});
    const domain=async(method,input)=>{
      const result=await client.call(method,input);
      if(!result.ok) throw Object.assign(new DomainError(result.error.code,result.error.message,result.error.retry),{details:result.error.details});
      return result.value;
    };
    const description=await domain('system.describe',{protocolVersion:'0.1'});
    if(description.catalog?.digest!==catalogIdentity.digest || !description.principalId) fail('UNSUPPORTED_VERSION','Service cannot supply this catalog and authenticated attribution');
    const home=inspectHome({override:ready.value.home});
    return {home,domain,description};
  }
  async function attach(s,input) {
    const {home,domain,description}=s,projects=home.registry.projects;
    const accessible=async id=>{
      try { return await domain('context.get',{contextId:id}); }
      catch(error) { if(['NOT_FOUND','FORBIDDEN','POLICY_INDETERMINATE'].includes(error.code)) return;throw error; }
    };
    const projectById=id=>projects.find(p=>p.id===id);
    if(input.projectId && !projectById(input.projectId)) notFound();
    let projectIds=input.projectId?[input.projectId]:undefined,unresolvedLocation=false;
    if(input.location) {
      const identified=identifyProject(home.registry,input.location);
      const ids=identified.status==='matched'?[identified.projectId]:identified.candidateIds??[];
      if(projectIds && !projectIds.every(id=>ids.includes(id))) fail('INVALID_ARGUMENT','Project and location selectors disagree');
      projectIds=projectIds??ids;unresolvedLocation=identified.status!=='matched';
    }
    if(!Object.keys(input).length) return {kind:'needs_selection',reason:'no_context',candidates:[],more:false};
    let ids;
    if(input.contextId) ids=[input.contextId];
    else if(projectIds) ids=projectIds.flatMap(id=>projectById(id)?.contextIds??[]);
    else ids=description.grants?Object.keys(description.grants):projects.flatMap(p=>p.contextIds??[]);
    ids=[...new Set(ids)].filter(id=>typeof id==='string' && uuid.test(id));
    if(ids.length>256) fail('LIMIT_EXCEEDED','Context selection exceeds its bounded candidate set; select a context explicitly');
    const contexts=[];
    for(const id of ids) {
      const context=await accessible(id);
      if(context) contexts.push(context);
      else if(input.contextId) notFound();
    }
    if(input.contextId && projectIds && !projectIds.some(id=>(projectById(id)?.contextIds??[]).includes(input.contextId) && associatedProjectIds(home,input.contextId).includes(id))) fail('INVALID_ARGUMENT','Context and project associations disagree');
    const options=[];
    for(const context of contexts) {
      let incident;
      if(input.incidentId) {
        try { incident=await domain('incident.get',{contextId:context.id,incidentId:input.incidentId}); }
        catch(error) { if(['NOT_FOUND','FORBIDDEN','POLICY_INDETERMINATE'].includes(error.code)) continue;throw error; }
      }
      const associated=projectIds?.filter(id=>(projectById(id)?.contextIds??[]).includes(context.id) && associatedProjectIds(home,context.id).includes(id));
      if(projectIds && !associated?.length) continue;
      const projectId=associated?.length===1?associated[0]:undefined;
      options.push({contextId:context.id,...(incident?{incidentId:incident.ref.id}:{}),...(projectId?{projectId}:{}),label:incident?.value.purpose??context.label});
    }
    if(input.incidentId && !options.length) notFound();
    const selection=(reason,candidates)=>({kind:'needs_selection',reason,candidates:candidates.slice(0,20),more:candidates.length>20});
    if(!options.length) return selection('no_context',[]);
    if(unresolvedLocation) return selection('ambiguous_project',options);
    if(options.length>1) return selection(projectIds?.length>1?'ambiguous_project':'ambiguous_context',options);
    const selected=options[0];
    if(!selected.incidentId) {
      const incidents=await domain('incident.list',{contextId:selected.contextId,statuses:['open','resting'],limit:21});
      if(incidents.items.length>1 || incidents.nextCursor) return selection('ambiguous_incident',incidents.items.map(item=>({...selected,incidentId:item.ref.id,label:item.value.purpose})));
      if(incidents.items.length===1) selected.incidentId=incidents.items[0].ref.id;
    }
    const {label,...target}=selected;
    return {kind:'attached',attachment:{...target,systemId:description.systemId,principalId:description.principalId,...(description.grants?.[target.contextId]?{grant:description.grants[target.contextId]}:{}),catalog:catalogIdentity}};
  }
  async function read(s,input) {
    const {domain,description,home}=s,{target}=input;
    if(target.systemId!==description.systemId) notFound();
    const context=await domain('context.get',{contextId:target.contextId});
    if(target.projectId && (!home.registry.projects.some(p=>p.id===target.projectId && p.contextIds?.includes(target.contextId)) || !associatedProjectIds(home,target.contextId).includes(target.projectId))) notFound();
    const incident=target.incidentId?await domain('incident.get',{contextId:target.contextId,incidentId:target.incidentId}):undefined;
    const attachment={...target,principalId:description.principalId,...(description.grants?.[target.contextId]?{grant:description.grants[target.contextId]}:{}),catalog:catalogIdentity};
    const packet={attachment,context,...(incident?{incident}:{}),records:[],messages:[],omittedRefs:[],instructions:{text:catalog.instructions,directives:bindingMap.get('workspace.read').directives},catalog:catalogIdentity};
    if(target.incidentId){try{const retained=await retainedCapture(home.root,{systemId:target.systemId,contextId:target.contextId,incidentId:target.incidentId},domain);if(retained)packet.captureDisposition={availability:'registered',generation:retained.head.generation,manifestDigest:retained.head.digest,record:retained.head.record};}catch(error){if(!(error instanceof DomainError))throw error;packet.captureDisposition={availability:'unavailable',reason:error.code};}}
    const maximumBytes=input.maximumBytes??16384,limit=input.limit??20;
    const size=()=>Buffer.byteLength(canonical(packet));
    if(size()>maximumBytes) fail('LIMIT_EXCEEDED','Required context exceeds the byte budget; request a larger maximumBytes');
    const local=ref=>{if(ref.systemId!==target.systemId || ref.contextId!==target.contextId) notFound();};
    const query=async refs=>{
      refs.forEach(local);
      return domain('graph.query',{contextId:target.contextId,selector:{ids:refs.map(ref=>ref.id),assertionStatus:'any'},limit:100});
    };
    const checked=new Set();let dependencyChecks=0;
    async function readable(ref) {
      local(ref);
      if(checked.has(ref.id)) return;
      if(++dependencyChecks>256) fail('LIMIT_EXCEEDED','Dependency admission exceeds the bounded context packet; request fewer records');
      if((await query([ref])).items.some(item=>item.record.ref.id===ref.id)) {checked.add(ref.id);return;}
      try { await domain('control.get',{contextId:target.contextId,ref}); }
      catch(error) {if(['FORBIDDEN','NOT_FOUND'].includes(error.code)) notFound();throw error;}
      checked.add(ref.id);
    }
    async function dependencies(item) {
      if(item.record.value.kind==='relation') for(const ref of Object.values(item.record.value.roles).flat()) await readable(ref);
      for(const support of item.support) for(const ref of support.assertion.value.evidence.sources) await readable(ref);
    }
    const explicit=input.detailRefs??[];
    // Check all explicit access before any byte/record omission, including entries
    // beyond the selected page. Never silently turn denied detail into omission.
    const details=[];
    for(const ref of explicit) {
      await readable(ref);
      const item=(await query([ref])).items.find(item=>item.record.ref.id===ref.id);
      if(item) await dependencies(item);
      details.push({ref,item});
    }
    const continuation=(incident?.value.continuation??[]).filter(ref=>!explicit.some(item=>item.id===ref.id));
    const page=continuation.length?await query(continuation.slice(0,100)):explicit.length?{items:[]}:await domain('graph.query',{contextId:target.contextId,selector:{assertionStatus:'any'},limit});
    const byId=new Map(page.items.map(item=>[item.record.ref.id,item])),seen=new Set();
    const automatic=continuation.length?continuation.map(ref=>({ref,item:byId.get(ref.id)})):page.items.map(item=>({ref:item.record.ref,item}));
    const candidates=[...details,...automatic].filter(({ref})=>{if(seen.has(ref.id))return false;seen.add(ref.id);return true;});
    const messages=input.includeMessages?(await domain('messages.read',{contextId:target.contextId,limit,includeAcknowledged:false})).items.filter(message=>!target.incidentId || message.value.incidentId===target.incidentId):[];
    // Reserve every visible omission before selecting bodies. Returning an item
    // replaces its reference; later omissions cannot invalidate an earlier fit.
    const omissionRefs=[...candidates.map(item=>item.ref),...messages.map(message=>message.ref)],included=new Set();
    packet.omittedRefs=omissionRefs;
    if(size()>maximumBytes) fail('LIMIT_EXCEEDED','Selected context and omission references exceed the byte budget; reduce detail or request a larger maximumBytes');
    const include=(field,item,index)=>{
      const previous=packet.omittedRefs;
      packet.omittedRefs=omissionRefs.filter((_,i)=>!included.has(i) && i!==index);
      packet[field].push(item);
      if(size()>maximumBytes) {packet[field].pop();packet.omittedRefs=previous;}
      else included.add(index);
    };
    for(const [index,{ref,item}] of candidates.entries()) {
      if(!item) continue;
      if(!explicit.some(x=>x.id===ref.id)) {
        try { await dependencies(item); } catch(error) { if(error.code==='NOT_FOUND') continue;throw error; }
      }
      if(packet.records.length<limit) include('records',item,index);
    }
    for(const [index,message] of messages.entries()) include('messages',message,candidates.length+index);
    // Keep the final bound explicit if the packet gains fields in the future.
    if(size()>maximumBytes) fail('LIMIT_EXCEEDED','Selected context and omission references exceed the byte budget; reduce detail or request a larger maximumBytes');
    return packet;
  }
  async function call(operation,input) {
    try {
      if(!exposed.includes(operation)) fail('FORBIDDEN','Operation is not exposed in this profile; inspect moment agents');
      // Kernel input admission stays in the authenticated native boundary so
      // its exact faults survive every projection. Local adapters share the
      // generated validator rather than inventing a transport-specific shape.
      if(managedMethods.includes(operation)) validateInput(operation,input);
      let value;
      if(operation==='bindings.discover') value=discoverBindings(input,profile);
      else {
        const s=await session();
        if(operation==='captures.read'){if(input.target.systemId!==s.description.systemId)notFound();value=await captureRead(s.home.root,input,s.domain);}
        else if(operation==='workspace.attach') value=await attach(s,input);
        else if(operation==='workspace.read') value=await read(s,input);
        else value=await s.domain(operation,input);
      }
      validateBoundary(operation,'output',value);
      return {ok:true,value};
    } catch(error) {
      if(error instanceof DomainError) {const result=resultError(error);if(error.details!==undefined) result.error.details=error.details;return result;}
      return {ok:false,error:{code:'INTERNAL',message:'Managed operation failed; inspect the selected service without resetting state',retry:'never',details:null}};
    }
  }
  return {call,service};
}
