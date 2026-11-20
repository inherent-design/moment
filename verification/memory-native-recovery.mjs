// Explicit real-native cancellation/result-recovery qualification; no primary state.
import {mkdtempSync,mkdirSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {SessionMemory} from '../runtime/session-memory.mjs';import {MemoryWorker} from '../runtime/memory-worker.mjs';import {CodexMemoryProvider} from '../runtime/codex-memory.mjs';import {writeCheckpoint} from '../runtime/home.mjs';import {digest} from '../runtime/json.mjs';
const [credentialFile,binary,evidenceFile]=process.argv.slice(2);if(!credentialFile||!binary||!evidenceFile)throw Error('Select private credential source, installed binary and evidence destination');
const root=mkdtempSync(join(tmpdir(),'mnr-')),results=[];let complete=false;
const prepare=label=>{const directory=join(root,label);mkdirSync(directory,{mode:0o700});const systemId=randomUUID(),filename=join(directory,'memory.sqlite'),memory=new SessionMemory(filename,systemId),session={runtimeId:'native-recovery-fixture',sessionId:randomUUID()};
 const initial=memory.observe({session,deliveryId:randomUUID(),message:{text:'Controlled baseline: retain original wording and proposal status.',authorship:'unknown'}}),seed=memory.claim({id:'explicit-test-setup',model:'scripted'});memory.finish(seed.id,{kind:'replace',explanation:'Scripted fixture assessment.',entries:[{sourceId:initial.sourceIds[0],weight:0.7,note:'Controlled initial state, not a model-quality claim.'}]});
 const next=memory.observe({session,deliveryId:randomUUID(),message:{text:'Tentative proposal: use a session-local memory cache, and preserve uncertainty. Installation remains deferred.',authorship:'unknown'}});return {directory,systemId,filename,memory,session,initial,next,provider:new CodexMemoryProvider(directory,{credentialFile,binary,model:'gpt-6-luna'})};};
try{
 const f=prepare('interrupted');let native,dispatch,cancelled,terminal,usage,invokeError,cancelWorker;
 try{
  const identity=await f.provider.ready();native=f.provider.native;dispatch=f.memory.claim(identity);const controller=new AbortController();let interrupted=false;
  const preparation=f.provider.prepare(dispatch);f.memory.prepareProfile(dispatch.id,preparation);dispatch.nativePreparation=preparation;
  native.events.on('turn/started',params=>{if(interrupted)return;interrupted=true;cancelled=f.memory.cancel(f.session,f.next.sequence);controller.abort();});
  native.events.on('turn/completed',params=>terminal=params.turn);native.events.on('thread/tokenUsage/updated',params=>usage=params.tokenUsage?.total);
  try{await f.provider.invoke(dispatch,controller.signal);}catch(error){invokeError={message:error.message,notStarted:error.notStarted??false};}
  const before=f.memory.read({session:f.session}),job=JSON.parse(readFileSync(f.provider.jobPath(dispatch.id),'utf8'));
  const observation={case:'actual-native-interruption',dispatchId:dispatch.id,cancelled,terminal:terminal??null,usage:usage??null,invokeError:invokeError??null,nativeJob:job,before,nativeExited:native.child.exitCode!==null||native.child.signalCode!==null};results.push(observation);
  if(!cancelled || cancelled.status!=='unknown' || before.cacheRevision!==1 || before.pending[0]?.status!=='unknown')throw Error('Possible native cancellation did not preserve old cache and unknown dispatch');
  if(terminal?.status!=='interrupted')throw Error('Native interruption terminal event was not observed');
  let readyCalls=0;f.provider.ready=async()=>{readyCalls++;throw Error('Cancellation recovery must not invoke another model');};
  cancelWorker=new MemoryWorker(f.memory,{provider:f.provider,recover:true});cancelWorker.wake();await new Promise(setImmediate);await cancelWorker.running;await new Promise(setImmediate);await cancelWorker.running;
  observation.after=f.memory.read({session:f.session});observation.readyCalls=readyCalls;observation.oldInstanceRemoved=!existsSync(job.instance);
  observation.assessment=f.memory.readAssessments({session:f.session,assessmentId:dispatch.id,maximumBytes:262144});
  if(observation.after.processedThrough!==f.next.sequence || observation.after.gaps[0]?.status!=='cancelled' || readyCalls || !observation.oldInstanceRemoved)throw Error('Observed native interruption was not automatically reconciled and cleaned');
 }finally{await cancelWorker?.close();await f.provider.close();f.memory.close();}
 writeCheckpoint(evidenceFile,{formatVersion:1,root,complete:false,results});
 const r=prepare('published-result');let active,newMemory,newProvider,worker,readyCalls=0;
 try{
  const identity=await r.provider.ready(),dispatch=r.memory.claim(identity),preparation=r.provider.prepare(dispatch);r.memory.prepareProfile(dispatch.id,preparation);dispatch.nativePreparation=preparation;const observed=await r.provider.invoke(dispatch,new AbortController().signal);
  if(observed.failure)throw Error('Native observed result failed before recovery test');r.memory.unknown(dispatch.id,'Controlled interruption after native result publication and before cache commit');
  await r.provider.close();r.memory.close();
  newMemory=new SessionMemory(r.filename,r.systemId);active=newMemory.active();newProvider=new CodexMemoryProvider(r.directory,{credentialFile:join(r.directory,'intentionally-absent-auth.json'),binary,model:'gpt-6-luna'});
  const originalReady=newProvider.ready.bind(newProvider);newProvider.ready=async()=>{readyCalls++;return originalReady();};
  worker=new MemoryWorker(newMemory,{provider:newProvider,recover:true});worker.wake();await new Promise(setImmediate);await worker.running;await new Promise(setImmediate);await worker.running;
  const packet=newMemory.read({session:r.session});if(packet.processedThrough!==r.next.sequence||readyCalls!==0||newMemory.active())throw Error('Observed result was not recovered independently of new inference/authentication');
  const expected=observed.output.kind==='unchanged'?[{sourceId:r.initial.sourceIds[0],weight:0.7,note:'Controlled initial state, not a model-quality claim.'}]:observed.output.entries;if(digest(packet.entries)!==digest(expected))throw Error('Recovered cache differs from the durably observed result');
  const assessment=newMemory.readAssessments({session:r.session,assessmentId:dispatch.id,maximumBytes:262144});
  const job=JSON.parse(readFileSync(newProvider.jobPath(dispatch.id),'utf8'));results.push({case:'actual-observed-result-recovery',dispatchId:dispatch.id,observed,packet,assessment,readyCalls,oldInstanceRemoved:!existsSync(job.instance),job});
 }finally{await worker?.close();await newProvider?.close();await r.provider.close();try{newMemory?.close();}catch{}try{r.memory.close();}catch{}}
 writeCheckpoint(evidenceFile,{formatVersion:1,complete:true,results,scope:'Owned installed Codex through its consumed API contract; observed version remains in prepared/native evidence. No primary state mutation or new API provider.'});complete=true;console.log(JSON.stringify({cases:results.map(r=>({case:r.case,terminal:r.terminal?.status,readyCalls:r.readyCalls,oldInstanceRemoved:r.oldInstanceRemoved}))}));
}finally{if(complete)rmSync(root,{recursive:true,force:true});else{writeCheckpoint(evidenceFile,{formatVersion:1,complete:false,root,results});console.error('Owned recovery evidence retained: '+root);}}
