import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {canonical,digest,bytesDigest} from '../runtime/json.mjs';

/** Scripted historical rows in the actual seven-table format, independent of today's constructor. */
export function legacyMemoryFixture(filename,systemId,{version=2,session={runtimeId:'owned-legacy',sessionId:randomUUID()},unknown=false}={}){
  writeFileSync(filename,'',{mode:0o600});const db=new DatabaseSync(filename),key=digest(session),at='2026-11-01T00:00:00.000Z';
  db.exec(`
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sessions(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sources(id TEXT PRIMARY KEY,value TEXT NOT NULL,bytes INTEGER NOT NULL);
    CREATE TABLE associations(session_key TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(session_key,source_id));
    CREATE TABLE inputs(session_key TEXT NOT NULL,sequence INTEGER NOT NULL,delivery_id TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(session_key,sequence),UNIQUE(session_key,delivery_id));
    CREATE TABLE dispatches(id TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE receipts(id TEXT PRIMARY KEY,value TEXT NOT NULL);
  `);
  db.exec('PRAGMA user_version='+version);db.prepare('INSERT INTO metadata VALUES (?,?)').run('systemId',systemId);
  const source=text=>{const value={id:randomUUID(),session,text,digest:bytesDigest(text),authorship:'unknown',origin:'submission',observedAt:at,contextIds:[]};const bytes=canonical(value);db.prepare('INSERT INTO sources VALUES (?,?,?)').run(value.id,bytes,Buffer.byteLength(bytes));db.prepare('INSERT INTO associations VALUES (?,?)').run(key,value.id);return value;};
  const first=source('Preserve exact history.'),originalInput={session,deliveryId:'legacy-original',message:{text:first.text,authorship:'unknown'}};
  const addInput=(sequence,input,primaryIds,status)=>{const value={key,session,sequence,deliveryId:input.deliveryId,digest:digest({kind:'message',input}),kind:'message',primaryIds,contextIds:[],status,observedAt:at};db.prepare('INSERT INTO inputs VALUES (?,?,?,?,?,?)').run(key,sequence,value.deliveryId,value.digest,status,canonical(value));return value;};
  addInput(1,originalInput,[first.id],'succeeded');
  const entries=[{sourceId:first.id,weight:0.8}],provider={id:'owned-legacy-fixture',model:'scripted'},receiptId=randomUUID(),explanation='Scripted legacy fixture selection.';
  const request={session,capacity:5,cache:[],incomingSourceIds:[first.id],sources:[first]},output={kind:'replace',entries,explanation};
  const receipt={dispatchId:receiptId,session,sequence:1,status:'succeeded',cacheRevision:1,resultDigest:digest({output,usage:{}}),inputDigest:digest(request),promptDigest:bytesDigest('Scripted historical profile.'),promptVersion:'legacy-fixture/1',outputSchemaDigest:digest({type:'object'}),provider,usage:{},finishedAt:at,explanation};
  db.prepare('INSERT INTO receipts VALUES (?,?)').run(receiptId,canonical(receipt));
  const state={session,key,revision:1,processedThrough:1,nextSequence:2,entries,createdAt:at,lastAssessment:{dispatchId:receiptId,sequence:1,explanation}};
  let active;
  if(unknown){
    const next=source('Maybe change tasks; preserve the conditional meaning.'),input={session,deliveryId:'legacy-unknown',message:{text:next.text,authorship:'unknown'}};
    addInput(2,input,[next.id],'unknown');state.nextSequence=3;
    const request={session,capacity:5,cache:entries,incomingSourceIds:[next.id],sources:[first,next]};
    active={id:randomUUID(),key,sequence:2,cacheRevision:1,processedThrough:1,provider,promptVersion:receipt.promptVersion,promptDigest:receipt.promptDigest,outputSchemaDigest:receipt.outputSchemaDigest,inputDigest:digest(request),request,status:'unknown',startedAt:at,detail:'Scripted legacy completion observation was lost.'};
    db.prepare('INSERT INTO dispatches VALUES (?,?)').run(active.id,canonical(active));
  }
  db.prepare('INSERT INTO sessions VALUES (?,?)').run(key,canonical(state));db.close();
  return {session,key,first,originalInput,receipt,active,state};
}
