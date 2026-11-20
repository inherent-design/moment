import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCodexResponse,validateCodexNotification,assertCodexThread} from '../runtime/codex-api.mjs';

test('native boundaries accept additive response fields and unrelated notification methods',()=>{
  const value={thread:{id:'thread',futureMetadata:true},model:'selected',futureCapability:{enabled:true}};
  assert.equal(validateCodexResponse('thread/start',value,'codex-cli 0.999.0'),value);
  assert.doesNotThrow(()=>validateCodexNotification('future/event',{newShape:true},'codex-cli 0.999.0'));
  assert.throws(()=>validateCodexResponse('thread/start',{thread:{renamedId:'thread'},model:'selected'},'codex-cli 0.169.0'),error=>error.code==='CAPABILITY_UNAVAILABLE'&&error.message.includes('thread/start'));
  assert.throws(()=>validateCodexNotification('item/completed',{threadId:'thread',turnId:'turn',item:{type:'agentMessage',text:42}},'codex-cli 0.169.0'),error=>error.message.includes('item/completed'));
});
test('model and permission agreement is checked independently of the executable release',()=>{
  const value={thread:{id:'thread'},model:'selected',approvalPolicy:'never',activePermissionProfile:{id:'memory'},sandbox:{type:'readOnly',networkAccess:false}};
  const expected={model:'selected',permissionProfileId:'memory',version:'codex-cli 0.170.0'};
  assert.doesNotThrow(()=>assertCodexThread(value,expected));
  const withoutLegacy={...value};delete withoutLegacy.sandbox;assert.doesNotThrow(()=>assertCodexThread(withoutLegacy,expected));
  const legacy={...value};delete legacy.activePermissionProfile;assert.doesNotThrow(()=>assertCodexThread(legacy,expected));
  for(const changed of [{model:'fallback'},{approvalPolicy:'on-request'},{activePermissionProfile:{id:'other'}},{sandbox:{type:'dangerFullAccess'}},{sandbox:{type:'readOnly',networkAccess:true}}])assert.throws(()=>assertCodexThread({...value,...changed},expected),{code:'CAPABILITY_UNAVAILABLE'});
  assert.throws(()=>assertCodexThread({thread:{id:'thread'},model:'selected',approvalPolicy:'never'},expected),{code:'CAPABILITY_UNAVAILABLE'});
});
