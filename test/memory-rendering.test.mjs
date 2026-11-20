import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {SessionMemory,renderMemoryInput,memoryPrompt,memoryOutputSchema} from '../runtime/session-memory.mjs';
import {bytesDigest} from '../runtime/json.mjs';

test('compact rendering preserves whole source meaning and attribution while omitting repeated locator metadata',()=>{
  const session={runtimeId:'codex',sessionId:'destination'},other={runtimeId:'codex',sessionId:'original'},text='Maybe use it for this release only; keep “not closed” literal. 🦉';
  const source={id:'user',authorship:'unknown',session:other,origin:'submission',observedAt:'2026-11-17T00:00:00Z',text,contextIds:['assistant'],digest:'sha256:'+'a'.repeat(64),selection:{path:'/private/NEVER_MODEL_LOCATOR',offset:123,byteLength:500,digest:'sha256:'+'b'.repeat(64),nativeTimestamp:'2026-11-16T00:00:00Z'}};
  const assistant={id:'assistant',authorship:'assistant',origin:'referenced-exchange',session:other,text:'A proposal, not a permission grant.'};
  const request={session,capacity:5,cache:[],incomingSourceIds:['user'],sources:[source,assistant]},before=structuredClone(request),current=renderMemoryInput(request),legacy=renderMemoryInput(request,undefined,'moment-memory-input/1');
  const selected=JSON.parse(current.split('Original source messages:\n')[1].split('\n\nPrevious cache assessments')[0]);
  assert.equal(selected[0].text,text);assert.equal(selected[1].text,assistant.text);assert.deepEqual(selected[0].session,other);assert.deepEqual(selected[0].contextIds,['assistant']);assert.equal(selected[1].authorship,'assistant');assert.equal(selected[0].nativeTimestamp,source.selection.nativeTimestamp);
  assert.equal(current.includes('NEVER_MODEL_LOCATOR'),false);assert.equal(legacy.includes('NEVER_MODEL_LOCATOR'),true);assert.ok(Buffer.byteLength(current)<Buffer.byteLength(legacy));assert.deepEqual(request,before);
  assert.throws(()=>renderMemoryInput(request,undefined,'invented-renderer'),{code:'UNSUPPORTED_VERSION'});
});

test('new and historical renderer profiles recover their own exact frozen bytes after reopening',t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-render-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file=join(root,'memory.sqlite'),systemId=randomUUID(),session={runtimeId:'codex',sessionId:randomUUID()},memory=new SessionMemory(file,systemId),expected=[];
  for(const renderer of ['moment-memory-input/1','moment-memory-input/2']){
    memory.observe({session,deliveryId:randomUUID(),message:{text:'Keep this conditional; do not broaden it.',authorship:'unknown'},exchange:[{text:'This is only a proposed future goal.',authorship:'assistant'}]});
    const dispatch=memory.claim({id:'fixture',model:'fixture'}),rendered=renderMemoryInput(dispatch.request,memoryPrompt,renderer);
    // Construct an older writer's committed profile without changing its request identity.
    memory.transaction(()=>memory.continuity.prepare(dispatch,{kind:'moment-memory',version:1,renderer,prompt:memoryPrompt,outputSchema:memoryOutputSchema},rendered));
    memory.finish(dispatch.id,{kind:'unchanged',explanation:'Retain the original conditional scope.'});expected.push({id:dispatch.id,rendered,request:dispatch.request});
  }
  memory.close();const reopened=new SessionMemory(file,systemId);t.after(()=>reopened.close());
  for(const item of expected){const a=reopened.readAssessments({session,assessmentId:item.id,maximumBytes:262144}).assessment;assert.equal(a.renderedInput,item.rendered);assert.equal(a.basis.renderedInputDigest,bytesDigest(item.rendered));assert.deepEqual(a.request,item.request);}
});
