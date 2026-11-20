import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {SessionMemory,memorySessionKey} from '../runtime/session-memory.mjs';
import {canonical} from '../runtime/json.mjs';

const provider={id:'owned-lifecycle-fixture',model:'scripted-output'};
const identity=()=>({runtimeId:'owned-lifecycle',sessionId:randomUUID()});
const observe=(memory,session,text,authorship='human')=>memory.observe({session,deliveryId:randomUUID(),message:{text,authorship}});
const select=(memory,session,revision,purposeKey)=>memory.focus({session,expectedFocusRevision:revision,idempotencyKey:randomUUID(),action:{kind:'select',purposeKey}},'owned-local-actor');
const unchanged={kind:'unchanged',explanation:'Keep the current source selection.'};
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'moment-memory-lifecycle-')),memory=new SessionMemory(join(directory,'memory.sqlite'),randomUUID());
 t.after(()=>{memory.close();rmSync(directory,{recursive:true,force:true});});return memory;
}
const retained=memory=>canonical(Object.fromEntries(['memory_sessions','memory_focus','memory_working_sets','memory_values','memory_focus_receipts','inputs','dispatches','receipts'].map(table=>[table,memory.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));

test('focus exhaustion permits an unchanged selection and atomically refuses a new destination',t=>{
 const memory=fixture(t),session=identity();observe(memory,session,'An original that must survive focus exhaustion.');
 memory.transaction(()=>memory.db.prepare('UPDATE memory_focus SET revision=? WHERE session_key=?').run(Number.MAX_SAFE_INTEGER,memorySessionKey(session)));
 const same=select(memory,session,Number.MAX_SAFE_INTEGER,'default');assert.equal(same.focus.revision,Number.MAX_SAFE_INTEGER);assert.equal(same.created,false);
 const before=retained(memory);assert.throws(()=>select(memory,session,Number.MAX_SAFE_INTEGER,'another-purpose'),{code:'LIMIT_EXCEEDED'});assert.equal(retained(memory),before);
 assert.equal(memory.read({session,includeWorkingSets:true}).workingSets.length,1);
});

test('cache-content exhaustion preserves the exact active dispatch when a replacement cannot commit',t=>{
 const memory=fixture(t),session=identity(),first=observe(memory,session,'First original.');
 memory.transaction(()=>{const state=memory.session(session);state.revision=Number.MAX_SAFE_INTEGER;memory.putSession(state);});
 const dispatch=memory.claim(provider);assert.equal(dispatch.request.incomingSourceIds[0],first.sourceIds[0]);assert.equal(memory.finish(dispatch.id,unchanged).status,'succeeded');
 const second=observe(memory,session,'Second original.'),next=memory.claim(provider),before=retained(memory);
 const replacement={kind:'replace',explanation:'Retain the supplied original.',entries:[{sourceId:second.sourceIds[0],weight:.9}]};
 assert.throws(()=>memory.finish(next.id,replacement),{code:'LIMIT_EXCEEDED'});assert.equal(retained(memory),before);assert.equal(memory.active().id,next.id);assert.equal(memory.claim(provider),null);
 assert.equal(memory.read({session,sourceIds:second.sourceIds}).sources.find(source=>source.id===second.sourceIds[0]).text,'Second original.');
});

test('global selection uses oldest eligible session heads and preserves unknown custody across sessions',t=>{
 const memory=fixture(t),a=identity(),b=identity();observe(memory,a,'Native control input.','harness');
 const first=observe(memory,a,'A head.'),other=observe(memory,b,'B head.');observe(memory,a,'A following input.');
 const active=memory.claim(provider);assert.deepEqual(active.request.incomingSourceIds,first.sourceIds);assert.equal(active.sequence,2);assert.equal(memory.hasPending(),true);
 assert.equal(memory.cancel(a,active.sequence).status,'unknown');assert.equal(memory.claim(provider),null);
 memory.reconcile(active.id,{kind:'cancelled',evidence:'Owned fixture never invoked a provider; its cancellation is observed.'});
 const next=memory.claim(provider);assert.deepEqual(next.request.incomingSourceIds,other.sourceIds);memory.finish(next.id,unchanged);
 assert.equal(memory.claim(provider).sequence,3);
});

test('session-head order retains signed SQLite ordinals beyond JavaScript safe integers',t=>{
 const memory=fixture(t),a=identity(),b=identity(),first=observe(memory,a,'First indexed original.'),second=observe(memory,b,'Second indexed original.');
 memory.transaction(()=>{
  memory.db.prepare('UPDATE inputs SET rowid=? WHERE session_key=?').run(-(1n<<63n),memorySessionKey(a));
  memory.db.prepare('UPDATE inputs SET rowid=? WHERE session_key=?').run((1n<<63n)-1n,memorySessionKey(b));
 });
 assert.equal(memory.hasPending(),true);assert.deepEqual(memory.nextInput().primaryIds,first.sourceIds);
 memory.cancel(a,first.sequence);assert.deepEqual(memory.nextInput().primaryIds,second.sourceIds);
});
