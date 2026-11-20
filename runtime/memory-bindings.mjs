import {inspectHome} from './home.mjs';
import {associatedProjectIds} from './projects.mjs';
import {selectSource} from './guidance.mjs';
import {bytesDigest,canonical,DomainError,fail} from './json.mjs';
import {sameRef} from './authority.mjs';
import * as core from './semantic-core.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const exact=(value,required,optional=[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||required.some(x=>!Object.hasOwn(value,x))||Object.keys(value).some(x=>![...required,...optional].includes(x)))fail('INVALID_ARGUMENT','Unexpected memory binding shape');};
const id=value=>{if(typeof value!=='string'||!uuid.test(value))fail('INVALID_ARGUMENT','A memory binding requires canonical resource identities');};
const text=(value,maximum)=>{if(typeof value!=='string'||!value.trim().length||Buffer.byteLength(value)>maximum)fail('INVALID_ARGUMENT','Invalid memory binding description');};
const reference=value=>{exact(value,['systemId','contextId','id']);for(const part of Object.values(value))id(part);};

/** Shape checks do not confer authority. The service supplies the independent current reader. */
export function validateMemoryBindings(value) {
  if(value.work!==undefined&&value.work!==null){
    exact(value.work,['systemId','contextId'],['projectId','incidentId']);for(const part of Object.values(value.work))id(part);
  }
  if(value.guidance!==undefined){
    if(!Array.isArray(value.guidance)||value.guidance.length>8)fail('INVALID_ARGUMENT','Select at most eight guidance bindings');
    const identities=new Set();
    for(const item of value.guidance){
      exact(item,['source','capture','contentDigest','representation','applicability','materialOmissions'],['bodyRange']);reference(item.source);reference(item.capture);
      if(!core.sameScope(item.source,item.capture))fail('INVALID_ARGUMENT','A guidance capture must belong to its selected source context');
      if(!/^sha256:[a-f0-9]{64}$/.test(item.contentDigest)||!['whole','selected'].includes(item.representation))fail('INVALID_ARGUMENT','Invalid guidance representation or content identity');
      if(item.bodyRange!==undefined){exact(item.bodyRange,['offset','byteLength']);const {offset,byteLength}=item.bodyRange;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(byteLength)||byteLength<0||byteLength>131072)fail('INVALID_ARGUMENT','Invalid guidance UTF-8 range');}
      text(item.applicability,2048);
      if(!Array.isArray(item.materialOmissions)||item.materialOmissions.length>8)fail('INVALID_ARGUMENT','Bound material omissions to eight descriptions');
      for(const omission of item.materialOmissions)text(omission,512);
      const identity=canonical(item);
      if(identities.has(identity))fail('INVALID_ARGUMENT','Duplicate guidance selection');identities.add(identity);
    }
  }
}

/** Same authorized domain reader for admission and serving; no self-RPC or model call. */
export function createMemoryBindings({root,kernel,principalId}) {
  const domain=(method,input)=>{const result=kernel.call(method,input,principalId);if(!result.ok)throw new DomainError(result.error.code,result.error.message,result.error.retry);return result.value;};
  const work=target=>{
    if(!core.sameText(target.systemId,kernel.store.systemId))fail('NOT_FOUND','Work binding is unavailable in this system');
    const context=domain('context.get',{contextId:target.contextId});
    if(target.projectId){
      const home=inspectHome({override:root});
      if(!core.sameText(home.registry?.systemId??'',target.systemId))fail('NOT_FOUND','Project and work association is unavailable');
      if(!core.memoryProject(home.registry,target,associatedProjectIds(home,target.contextId)))fail('NOT_FOUND','Project and work association is unavailable');
    }
    const incident=target.incidentId?domain('incident.get',{contextId:target.contextId,incidentId:target.incidentId}):undefined;
    return {target,contextState:context.state,...(incident?{incidentStatus:incident.value.status}:{})};
  };
  const guidance=binding=>{
    if(!core.sameText(binding.capture.systemId,kernel.store.systemId))fail('NOT_FOUND','Guidance binding is unavailable in this system');
    const packet=domain('guidance.read',{contextId:binding.capture.contextId,captureIds:[binding.capture.id],representation:binding.representation,...(binding.bodyRange?{bodyRange:binding.bodyRange}:{}),maximumBytes:262144,limit:1});
    const capture=packet.captures.find(x=>sameRef(x.stored.ref,binding.capture));
    if(!capture)fail('CAPABILITY_UNAVAILABLE','Guidance capture metadata is unavailable within the component bound');
    if(!sameRef(capture.stored.value.source,binding.source))fail('IDENTITY_CONFLICT','Guidance source and capture disagree');
    let bytes;
    if(capture.text!==undefined)bytes=Buffer.from(capture.text);
    else {
      // Authority and dependencies were checked by guidance.read. A response-byte
      // omission need not prevent bounded validation of that immutable body.
      const value=capture.stored.value;
      try{bytes=kernel.guidance.bodies.get(binding.representation==='whole'?value.wholeDigest:value.capture.contentDigest);}
      catch(error){if(error instanceof DomainError)throw error;throw new DomainError('CAPABILITY_UNAVAILABLE','Retained guidance bytes are unavailable');}
      if(binding.bodyRange)bytes=selectSource(bytes,{kind:'utf8-range',...binding.bodyRange}).bytes;
    }
    if(bytesDigest(bytes)!==binding.contentDigest)fail('IDENTITY_CONFLICT','Guidance bytes disagree with the selected content digest');
    return {binding,freshness:capture.freshness??'historical'};
  };
  return {
    validate(value){validateMemoryBindings(value);if(value.work)work(value.work);for(const binding of value.guidance??[])guidance(binding);},
    read(value){
      validateMemoryBindings(value);const packet={guidance:[],omitted:[]};
      const unavailable=(kind,error,index)=>{if(!(error instanceof DomainError))throw error;packet.omitted.push({kind,...(index===undefined?{}:{index}),reason:{MemoryBindingIntegrity:'integrity',MemoryBindingUnavailable:'unavailable',MemoryBindingComponent:'component-unavailable'}[core.memoryBindingError(error.code)]});};
      if(value.work)try{packet.work=work(value.work);}catch(error){unavailable('work',error);}
      for(const [index,binding] of (value.guidance??[]).entries())try{packet.guidance.push({index,...guidance(binding)});}catch(error){unavailable('guidance',error,index);}
      return packet;
    },
  };
}
