import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../runtime/json.mjs';
import {writeSnapshot} from '../runtime/snapshot-values.mjs';
import {setup} from './helpers.mjs';
const maximum=Number.MAX_SAFE_INTEGER;
function exhaustRevision(f,revision=maximum) {const value=f.store.read(f.contextId);value.context.revision=revision;f.store.db.exec('BEGIN IMMEDIATE');try{writeSnapshot(f.store.db,value);f.store.db.exec('COMMIT');}catch(error){f.store.db.exec('ROLLBACK');throw error;}return value;}

test('an exhausted context revision remains readable and replayable but refuses a fresh mutation',t=>{
 const f=setup(t),original={contextId:f.contextId,expectedRevision:1,idempotencyKey:'retained-before-exhaustion',changes:[]},first=f.call('graph.transact',original);assert.equal(first.ok,true);
 const before=exhaustRevision(f);assert.equal(f.call('context.get',{contextId:f.contextId}).value.revision,maximum);assert.deepEqual(f.call('graph.transact',original),first);
 const result=f.write('graph.transact',{changes:[]});assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,'LIMIT_EXCEEDED');
 assert.equal(canonical(f.store.read(f.contextId)),canonical(before));assert.deepEqual(f.call('graph.transact',original),first);
});

test('the last exact context revision succeeds and remains retryable after exhaustion',t=>{
 const f=setup(t);exhaustRevision(f,maximum-1);
 const request={contextId:f.contextId,expectedRevision:maximum-1,idempotencyKey:'last-context-step',changes:[]},result=f.call('graph.transact',request);
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.revision,maximum);assert.equal(f.write('graph.transact',{changes:[]}).error.code,'LIMIT_EXCEEDED');
 f.reopen();assert.deepEqual(f.call('graph.transact',request),result);assert.equal(f.call('context.get',{contextId:f.contextId}).value.revision,maximum);
});

test('the last exact event sequence succeeds, is readable, and cannot wrap on another commit',t=>{
 const f=setup(t),source=f.store.events(f.contextId)[0],event={...source,id:randomUUID(),sequence:maximum-1};
 f.store.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(f.contextId,maximum-1,event.id,canonical(event));
 const request={contextId:f.contextId,expectedRevision:1,idempotencyKey:'last-event-step',changes:[]},result=f.call('graph.transact',request);
 assert.equal(result.ok,true,JSON.stringify(result));const read=f.call('events.read',{contextId:f.contextId,limit:10,waitMillis:0});assert.equal(read.ok,true);assert.equal(read.value.items.at(-1).sequence,maximum);
 assert.equal(f.write('graph.transact',{changes:[]}).error.code,'LIMIT_EXCEEDED');f.reopen();assert.deepEqual(f.call('graph.transact',request),result);assert.equal(f.store.read(f.contextId).context.revision,2);
});
test('the trusted commit port also refuses exhausted revisions without a receipt or state change',t=>{
 const f=setup(t),before=exhaustRevision(f),mutation={contextId:f.contextId,expectedRevision:maximum,idempotencyKey:'trusted-exhaustion',changes:[]};
 const result=f.store.commit({mutation,principalId:f.ownerId,requestDigest:digest(mutation),changes:[],controlChanges:[],events:[],outbox:[],response:{kind:'commit-receipt'}});
 assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,'LIMIT_EXCEEDED');assert.equal(canonical(f.store.read(f.contextId)),canonical(before));
 assert.equal(f.store.receipt(f.ownerId,f.contextId,'graph.transact',mutation.idempotencyKey,digest(mutation)),undefined);
});
test('event sequence exhaustion refuses the entire commit before storing an unsafe event',t=>{
 const f=setup(t),source=f.store.events(f.contextId)[0],event={...source,id:randomUUID(),sequence:maximum};
 f.store.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(f.contextId,maximum,event.id,canonical(event));
 const before=f.store.read(f.contextId),rows=f.store.db.prepare('SELECT count(*) AS count FROM events').get().count;
 const result=f.write('graph.transact',{changes:[]});assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,'LIMIT_EXCEEDED');assert.equal(canonical(f.store.read(f.contextId)),canonical(before));assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM events').get().count,rows);
 f.reopen();assert.equal(f.call('events.read',{contextId:f.contextId,limit:10,waitMillis:0}).ok,true);
});
