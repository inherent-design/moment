import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBoundary,bindingMap} from '../runtime/bindings.mjs';

const session={runtimeId:'owned',sessionId:'actual-session'};
test('generated assessment selectors preserve exclusions from optional-never TypeScript branches',()=>{
  for(const input of [{session,limit:1},{session,assessmentId:'a'},{session,assessmentId:'a',part:'renderedInput',bodyRange:{offset:0,byteLength:8}}])assert.doesNotThrow(()=>validateBoundary('memory.assessments.read','input',input));
  for(const input of [{session,bodyRange:{offset:0,byteLength:8}},{session,assessmentId:'a',bodyRange:{offset:0,byteLength:8}},{session,assessmentId:'a',cursor:'another-selection'},{session,assessmentId:'a',limit:2}])assert.throws(()=>validateBoundary('memory.assessments.read','input',input),{code:'INVALID_ARGUMENT'});
  const binding=bindingMap.get('memory.assessments.read');assert.equal(binding.mode,'read');assert.deepEqual(binding.effects,['read-store']);
});

test('generated reconstruction and focus contracts distinguish independent revisions',()=>{
  const common={session,deliveryId:'retained-delivery',sourceIds:['an-original']};
  assert.doesNotThrow(()=>validateBoundary('memory.rebuild','input',{...common,expectedRevision:2}));
  assert.doesNotThrow(()=>validateBoundary('memory.rebuild','input',{...common,workingSetId:'a',expectedWorkingSetRevision:4}));
  for(const input of [{...common},{...common,workingSetId:'a',expectedRevision:2},{...common,workingSetId:'a',expectedRevision:2,expectedWorkingSetRevision:4}])assert.throws(()=>validateBoundary('memory.rebuild','input',input),{code:'INVALID_ARGUMENT'});
  assert.doesNotThrow(()=>validateBoundary('memory.focus','input',{session,expectedFocusRevision:0,idempotencyKey:'a',action:{kind:'select',purposeKey:'current'}}));
  assert.throws(()=>validateBoundary('memory.focus','input',{session,expectedRevision:0,idempotencyKey:'a',action:{kind:'select',purposeKey:'current'}}),{code:'INVALID_ARGUMENT'});
  assert.equal(bindingMap.get('memory.focus').retryIdentity,'session-revision-key');
});
