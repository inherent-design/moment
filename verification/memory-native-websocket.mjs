// Explicit lifecycle qualification only. Production memory workers use stdio.
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

export async function ownedMemoryWebSocket({root,binary,env,workspace}) {
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const token=randomBytes(32).toString('hex'),tokenFile=join(root,'websocket-token');writeFileSync(tokenFile,token,{mode:0o600});
  const url='ws://127.0.0.1:'+port,child=spawn(binary,['app-server','--listen',url,'--ws-auth','capability-token','--ws-token-file',tokenFile],{env,cwd:workspace,stdio:['ignore','pipe','pipe']});
  let socket,closed=false,sequence=0,stderrBytes=0;const pending=new Map(),events=new EventEmitter();events.setMaxListeners(0);
  child.stdout.on('data',()=>{});child.stderr.on('data',bytes=>stderrBytes+=bytes.length);
  const rejectAll=()=>{for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('Owned WebSocket closed'));}pending.clear();};
  const close=async()=>{
    if(closed)return;closed=true;rejectAll();socket?.close();
    if(child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await exited;}finally{clearTimeout(timer);}}
  };
  child.on('error',rejectAll);child.on('exit',rejectAll);
  const call=(method,params,timeout=15000)=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Owned WebSocket request timed out: '+method));},timeout);
    pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params}));
  });
  try {
    const deadline=performance.now()+5000;
    for(;;) {
      if(child.exitCode!==null || child.signalCode!==null)throw Error('Owned app-server exited before readiness');
      try {await new Promise((resolve,reject)=>{const probe=net.createConnection({host:'127.0.0.1',port});probe.once('connect',()=>{probe.destroy();resolve();});probe.once('error',error=>{probe.destroy();reject(error);});});break;}
      catch {if(performance.now()>deadline)throw Error('Owned app-server did not listen');await new Promise(resolve=>setTimeout(resolve,20));}
    }
    socket=new WebSocket(url,{headers:{Authorization:'Bearer '+token}});
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Owned authenticated WebSocket failed')),{once:true});});
    socket.addEventListener('close',rejectAll);socket.addEventListener('error',rejectAll);
    socket.addEventListener('message',event=>{
      try {
        if(typeof event.data!=='string' || Buffer.byteLength(event.data)>16777216)throw Error('Native frame bound');
        const message=JSON.parse(event.data);
        if(message.method && Object.hasOwn(message,'id')) socket.send(JSON.stringify({id:message.id,error:{code:-32601,message:'Outside this owned lifecycle qualification'}}));
        else if(Object.hasOwn(message,'id')) {const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);clearTimeout(waiter.timer);if(message.error)waiter.reject(Error('Owned native method rejected: '+waiter.method+' ('+message.error.code+')'));else waiter.resolve(message.result);}
        else if(message.method) events.emit(message.method,message.params);
      }catch {rejectAll();socket.close();}
    });
    await call('initialize',{clientInfo:{name:'moment-owned-lifecycle',version:'0.1.0'},capabilities:{experimentalApi:true}});socket.send(JSON.stringify({method:'initialized',params:{}}));
    if((await call('account/read',{refreshToken:false})).account!==null)throw Error('Owned lifecycle instance inherited an account');
    return {call,events,close,child,url,token,diagnostics:()=>({stderrBytes})};
  }catch(error){await close();throw error;}
}
