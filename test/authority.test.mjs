import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grantChain, limitedPolicy } from '../runtime/authority.mjs';
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
