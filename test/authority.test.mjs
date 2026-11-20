import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grantChain, limitedPolicy, attenuates } from '../runtime/authority.mjs';
const limits={ concurrentExecutions:1,cpuMillis:10,memoryBytes:10,outputBytes:10,modelTokens:0,apiSpendMicrounits:0,currency:'USD' };
const truth={ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } };

test('grant chain checks expiration, missing ancestors and cycles under a specified clock observation',()=>{
  const contextId=randomUUID(),systemId=randomUUID(),principalId=randomUUID(),id=randomUUID();
  const ref={ systemId,contextId,id };
  const grant={ id,principalId,expiresAt:'2026-11-12T12:00:00Z' };
  const snapshot={ context:{ id:contextId,systemId },controlState:{ grants:{ [id]:{ value:grant } } } };
  assert.equal(grantChain(snapshot,ref,principalId,Date.parse('2026-11-12T11:59:59Z')).length,1);
  assert.throws(()=>grantChain(snapshot,ref,principalId,Date.parse(grant.expiresAt)),{ code:'FORBIDDEN' });
  grant.parentGrant=ref;
  assert.throws(()=>grantChain(snapshot,ref,principalId,0),{ code:'FORBIDDEN' });
  grant.parentGrant={ ...ref,id:randomUUID() };
  assert.throws(()=>grantChain(snapshot,ref,principalId,0),{ code:'FORBIDDEN' });
});

test('delegated policy activation preserves denies and cannot expand a newly narrowed policy budget',()=>{
  const permit={ id:'permit',effect:'permit',actions:['read'],when:truth };
  const deny={ id:'deny',effect:'deny',actions:['read'],when:truth };
  const current={ rules:[permit,deny],limits:{ ...limits,cpuMillis:1 } };
  const grant={ actions:['read'],limits };
  assert.throws(()=>limitedPolicy({ rules:[permit],limits:current.limits },current,grant),{ code:'FORBIDDEN' });
  assert.throws(()=>limitedPolicy({ rules:current.rules,limits },current,grant),{ code:'FORBIDDEN' });
  assert.doesNotThrow(()=>limitedPolicy({ rules:current.rules,limits:current.limits },current,grant));
});

test('native grant lookup uses the core for depth, principal, full scope and current ancestor revocation',()=>{
  const systemId=randomUUID(),contextId=randomUUID(),principalId=randomUUID(),ids=Array.from({length:33},()=>randomUUID()),ref=id=>({systemId,contextId,id});
  const grants=Object.fromEntries(ids.map((id,i)=>[id,{value:{id,principalId:i?randomUUID():principalId,...(i<31?{parentGrant:ref(ids[i+1])}:{})}}]));
  const snapshot={context:{id:contextId,systemId},controlState:{grants,revokedGrants:{}}};
  assert.equal(grantChain(snapshot,ref(ids[0]),principalId,200).length,32);
  assert.throws(()=>grantChain(snapshot,ref(ids[0]),randomUUID(),200),{code:'FORBIDDEN',message:'Grant belongs to another principal'});
  for(const foreign of [{...ref(ids[0]),systemId:randomUUID()},{...ref(ids[0]),contextId:randomUUID()}])assert.throws(()=>grantChain(snapshot,foreign,principalId,200),{code:'FORBIDDEN',message:'Invalid or excessive grant chain'});
  snapshot.controlState.revokedGrants[ids[20]]=true;
  assert.throws(()=>grantChain(snapshot,ref(ids[0]),principalId,200),{code:'FORBIDDEN',message:'Grant is unavailable'});
  delete snapshot.controlState.revokedGrants[ids[20]];
  grants[ids[31]].value.parentGrant=ref(ids[32]);
  assert.throws(()=>grantChain(snapshot,ref(ids[0]),principalId,200),{code:'FORBIDDEN',message:'Invalid or excessive grant chain'});
  assert.throws(()=>grantChain(snapshot,undefined,principalId,200),{code:'FORBIDDEN',message:'A bound grant is required'});
});

test('attenuation retains exact resource scope, incident bounds, delegation and budget units',()=>{
  const resource={systemId:randomUUID(),contextId:randomUUID(),id:randomUUID()},incidentId=randomUUID();
  const parent={limits,actions:['read','write'],incidentIds:[incidentId],resourceRefs:[resource],expiresAt:'2026-11-20T12:00:00Z',delegable:true};
  const child={...parent,actions:['read'],limits:{...limits,cpuMillis:5}};
  assert.doesNotThrow(()=>attenuates(child,parent));
  for(const [patch,message] of [
    [{actions:['delete']},'Delegation widens actions'],[{incidentIds:'all'},'Delegation widens incidents'],
    [{resourceRefs:[{...resource,contextId:randomUUID()}]},'Delegation widens resources'],
    [{expiresAt:undefined},'Delegation widens lifetime'],[{limits:{...limits,currency:'EUR'}},'Budget currencies differ'],
    [{limits:{...limits,cpuMillis:11}},'Requested budget exceeds its envelope']
  ])assert.throws(()=>attenuates({...child,...patch},parent),{code:'FORBIDDEN',message});
  assert.throws(()=>attenuates(child,{...parent,delegable:false}),{code:'FORBIDDEN',message:'Parent grant cannot delegate'});
});

test('delegated policy narrowing preserves canonical denies, condition scope and issuer sets',()=>{
  const permit={id:'permit',effect:'permit',actions:['read','write'],when:truth},deny={id:'deny',effect:'deny',actions:['read'],when:truth};
  const current={rules:[permit,deny],limits,authorityIssuers:['a','b']},grant={limits,actions:['read','write']};
  const candidate={...current,rules:[{...permit,actions:['read']},deny],authorityIssuers:['b','a','a']};
  assert.doesNotThrow(()=>limitedPolicy(candidate,current,grant));
  assert.throws(()=>limitedPolicy({...candidate,authorityIssuers:['a']},current,grant),{code:'FORBIDDEN',message:'Delegated activation cannot change authorization issuers'});
  assert.throws(()=>limitedPolicy({...candidate,rules:[candidate.rules[0],{...deny,id:'new-id'}]},current,grant),{code:'FORBIDDEN',message:'Delegated policy cannot remove a deny'});
  const different={kind:'equal',left:{kind:'literal',value:1},right:{kind:'literal',value:1}};
  assert.throws(()=>limitedPolicy({...candidate,rules:[{...permit,when:different},deny]},current,grant),{code:'FORBIDDEN',message:'Delegated policy cannot introduce a broader permit'});
  assert.throws(()=>limitedPolicy(candidate,current,{...grant,actions:[]}),{code:'FORBIDDEN',message:'Policy exceeds activation grant'});
});
