// Resume only the explicitly selected thread on memory-lifecycle's owned server.
import {readFileSync} from 'node:fs';
import {writeCheckpoint} from '../runtime/home.mjs';
const [contextFile,threadId,evidenceFile,mode]=process.argv.slice(2),context=JSON.parse(readFileSync(contextFile,'utf8'));
const socket=new WebSocket(context.url,{headers:{Authorization:'Bearer '+context.token}}),pending=new Map(),events=[];let id=0;
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned WebSocket open timeout')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Owned WebSocket error'));},{once:true});});
const call=(method,params,timeout=15000)=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(Error('Owned lifecycle timeout: '+method));},timeout);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params}));});
socket.onmessage=event=>{
  const message=JSON.parse(event.data),waiter=pending.get(message.id);
  if(waiter){clearTimeout(waiter.timer);pending.delete(message.id);if(message.error)waiter.reject(Error('Owned method refused: '+JSON.stringify(message.error)));else waiter.resolve(message.result);}
  else if(message.method && Object.hasOwn(message,'id'))socket.send(JSON.stringify({id:message.id,error:{code:-32601,message:'Outside this owned verification'}}));
  else if(['hook/started','hook/completed','turn/completed','item/completed','thread/tokenUsage/updated'].includes(message.method)&&events.length<128)events.push(message);
};
try {
  await call('initialize',{clientInfo:{name:'moment-owned-memory-resume',version:'0.1'},capabilities:{experimentalApi:true}});socket.send(JSON.stringify({method:'initialized',params:{}}));
  await call('thread/resume',{threadId,cwd:context.workspace,model:'gpt-6-luna',permissions:'moment-memory'});
  if(mode==='compact') {
    await call('thread/compact/start',{threadId});
    const compactDeadline=performance.now()+120000;
    while(!events.some(event=>event.method==='item/completed'&&event.params.item.type==='contextCompaction')) {if(performance.now()>compactDeadline)throw Error('Owned compaction outcome unknown');await new Promise(resolve=>setTimeout(resolve,50));}
  }
  const mcp=await call('mcpServerStatus/list',{threadId});
  const turn=await call('turn/start',{threadId,permissions:'moment-memory',effort:'low',input:[{type:'text',text:'Use moment_memory_read for runtimeId "moment-owned-native-lifecycle" and this session. Based on original evidence, did the earlier tentative proposal authorize installation? Answer in one sentence, preserving uncertainty. This is an isolated verification; do not install or modify anything.'}]});
  const deadline=performance.now()+120000;
  while(!events.some(event=>event.method==='turn/completed'&&event.params.turn.id===turn.turn.id)) {if(performance.now()>deadline)throw Error('Owned continuation outcome unknown');await new Promise(resolve=>setTimeout(resolve,50));}
  const thread=await call('thread/read',{threadId,includeTurns:true});writeCheckpoint(evidenceFile,{formatVersion:1,threadId,mcp,events,thread});
  console.log(JSON.stringify({threadId,turnId:turn.turn.id,status:events.find(event=>event.method==='turn/completed'&&event.params.turn.id===turn.turn.id)?.params.turn.status,events:events.map(event=>({method:event.method,...(event.method==='hook/completed'?{event:event.params.run.eventName,status:event.params.run.status,durationMs:event.params.run.durationMs,contextEntries:event.params.run.entries.filter(entry=>entry.kind==='context').length}:event.method==='item/completed'?{type:event.params.item.type,...(event.params.item.type==='agentMessage'?{text:event.params.item.text}:{})}:{})}))}));
}finally{socket.close();for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('Owned client closed'));}}
