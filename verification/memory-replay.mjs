// Explicit opt-in, bounded model qualification. Cases and output remain private.
import {readFileSync,mkdtempSync,realpathSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {CodexMemoryProvider} from '../runtime/codex-memory.mjs';
import {writeCheckpoint} from '../runtime/home.mjs';
import {bytesDigest} from '../runtime/json.mjs';
const [caseFile,credentialFile,binary,evidenceFile,retainedRoot]=process.argv.slice(2),bytes=readFileSync(caseFile),cases=JSON.parse(bytes);
if(bytes.length>262144 || !Array.isArray(cases) || cases.length<1 || cases.length>12 || !credentialFile || !binary || !evidenceFile)throw Error('Select 1–12 bounded private cases, credential source, installed binary and evidence destination');
const root=realpathSync(retainedRoot??mkdtempSync(join(tmpdir(),'mr-')));let systemId=randomUUID();
if(retainedRoot){if(!root.startsWith(realpathSync(tmpdir())+'/mr-'))throw Error('Resume only a selected test-owned replay directory');const db=new DatabaseSync(join(root,'memory.sqlite'),{readOnly:true});try{systemId=db.prepare("SELECT value FROM metadata WHERE key='systemId'").get().value;}finally{db.close();}}
const memory=new SessionMemory(join(root,'memory.sqlite'),systemId),provider=new CodexMemoryProvider(root,{credentialFile,binary,model:'gpt-6-luna'}),results=[];
const started=performance.now();let settled=false;
try {
  for(const entry of cases){
    const session={runtimeId:'moment-owned-replay',sessionId:entry.session??'selected-real-discussion'};
    const admission=entry.rebuildSourceIds?memory.rebuild({session,deliveryId:randomUUID(),sourceIds:entry.rebuildSourceIds,expectedRevision:memory.read({session}).cacheRevision}):memory.observe({session,deliveryId:randomUUID(),message:{text:entry.text,authorship:entry.authorship??'human'},...(entry.exchange?{exchange:entry.exchange}:{})});
    const before=performance.now(),identity=await provider.ready(),dispatch=memory.claim(identity);if(dispatch?.kind!=='dispatch')throw Error('Replay input was not eligible');
    try{const preparation=provider.prepare(dispatch);memory.prepareProfile(dispatch.id,preparation);dispatch.nativePreparation=preparation;}
    catch(error){memory.unknown(dispatch.id,'Owned replay preparation failed before any inference turn was sent');memory.reconcile(dispatch.id,{kind:'not_started',evidence:'The owned helper failed during preparation, before invoke was called.'});await provider.notStarted(dispatch.id);throw error;}
    let maximumObservedNativeRssKiB;
    const sample=()=>{try{const value=Number(execFileSync('/bin/ps',['-o','rss=','-p',String(provider.native.child.pid)],{encoding:'utf8'}).trim());if(Number.isFinite(value)&&value>0)maximumObservedNativeRssKiB=Math.max(maximumObservedNativeRssKiB??0,value);}catch{}};sample();const timer=setInterval(sample,1000);
    try{
      const result=await provider.invoke(dispatch,new AbortController().signal);
      const receipt=result.failure?memory.failObserved(dispatch.id,result.failure,result.usage??{},result.rawOutput):memory.finish(dispatch.id,result.output,result.usage??{},{...(result.rawOutput===undefined?{}:{rawOutput:result.rawOutput})});await provider.settled(receipt);
      const packet=memory.read({session,maximumBytes:262144});results.push({label:entry.label,kind:entry.kind,sourceBasis:entry.sourceBasis??null,admission,receipt,wallMillis:Math.round(performance.now()-before),maximumObservedNativeRssKiB,packet});
      writeCheckpoint(evidenceFile,{formatVersion:1,caseDigest:bytesDigest(bytes),root,systemId,results,complete:false});
      console.log(JSON.stringify({label:entry.label,status:receipt.status,revision:packet.cacheRevision,retained:packet.entries.length,usage:receipt.usage}));
      if(receipt.status!=='succeeded')throw Error('Observed checker failure; inspect the retained case evidence');
    }finally{clearInterval(timer);}
  }
  await provider.close();memory.close();const sizes=[];
  const visit=directory=>{for(const name of readdirSync(directory)){const path=join(directory,name),stat=statSync(path);if(stat.isDirectory())visit(path);else sizes.push({path:path.slice(root.length+1),bytes:stat.size});}};visit(root);
  writeCheckpoint(evidenceFile,{formatVersion:1,caseDigest:bytesDigest(bytes),root,systemId,results,complete:true,wallMillis:Math.round(performance.now()-started),retainedFiles:sizes,scope:'Private selected replay with retained immutable assessment/source evidence; no installation or primary state mutation. Retire the owned directory only after preserving the required proof.'});settled=true;
}finally{
  if(!settled)try{const active=memory.active();if(active?.status==='running')memory.unknown(active.id,'Owned replay ended without establishing the dispatch outcome; preserve exact provider evidence before retrying');}catch{}
  await provider.close();try{memory.close();}catch{}
  if(!settled)console.error('Replay state retained for reconciliation: '+root);
}
