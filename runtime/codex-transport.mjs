import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {EventEmitter} from 'node:events';
import {parseJson} from './wire.mjs';
import {codexApiError,validateCodexResponse,validateCodexNotification} from './codex-api.mjs';

/** Dedicated child transport. Callers supply only test/provider-owned cwd and state. */
export async function openCodexTransport({binary,env,workspace,version='unknown',onNotification=()=>{}}) {
  const child=spawn(binary,['app-server','--listen','stdio://'],{cwd:workspace,env,stdio:['pipe','pipe','pipe']});
  const pending=new Map(),events=new EventEmitter();let sequence=0,buffer=Buffer.alloc(0),closed=false,failure,stderrBytes=0,refusedRequests=0;
  events.setMaxListeners(0);
  const rejectAll=error=>{failure??=error;for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}pending.clear();events.emit('failure',error);};
  child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;});
  child.once('error',()=>rejectAll(Error('Owned Codex process could not start')));
  child.once('exit',()=>rejectAll(Error('Owned Codex process exited')));
  child.stdin.on('error',()=>rejectAll(Error('Owned Codex pipe closed')));
  function send(message) {
    if(closed || failure) throw failure??Error('Owned Codex connection is closed');
    const frame=JSON.stringify(message)+'\n';if(Buffer.byteLength(frame)>2097152)throw Error('Owned Codex request exceeds 2 MiB');
    child.stdin.write(frame);
  }
  const close=async()=>{
    if(closed)return;closed=true;rejectAll(Error('Owned Codex connection closed'));
    if(child.exitCode===null && child.signalCode===null) {
      const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
      try {await exited;} finally {clearTimeout(timer);}
    }
  };
  child.stdout.on('data',bytes=>{
    try {
      buffer=Buffer.concat([buffer,bytes]);let end;
      while((end=buffer.indexOf(10))>=0) {
        if(end>16777216)throw Error('Owned Codex response exceeds 16 MiB');
        const message=parseJson(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,end)));buffer=buffer.subarray(end+1);
        if(message.method && Object.hasOwn(message,'id')) {
          // No approval, dynamic tool, authentication refresh or other reverse RPC is delegated.
          refusedRequests++;send({id:message.id,error:{code:-32601,message:'Outside this bounded owned connection'}});
        } else if(Object.hasOwn(message,'id')) {
          const waiter=pending.get(message.id);if(!waiter)continue;pending.delete(message.id);clearTimeout(waiter.timer);
          if(message.error)waiter.reject(codexApiError(waiter.method,'a supported request and parameters',version,message.error.code));
          else {try{waiter.resolve(validateCodexResponse(waiter.method,message.result,version))}catch(error){waiter.reject(error)}}
        } else if(typeof message.method==='string') {validateCodexNotification(message.method,message.params,version);events.emit(message.method,message.params);onNotification(message.method,message.params);}
      }
      if(buffer.length>16777216)throw Error('Owned Codex unterminated response exceeds 16 MiB');
    } catch(error) {rejectAll(error.codexDiagnostic?error:codexApiError('transport','bounded valid JSON-RPC messages',version));void close();}
  });
  function call(method,params,timeoutMillis=15000) {
    return new Promise((resolve,reject)=>{
      if(closed || failure) {reject(failure??Error('Owned Codex connection is closed'));return;}
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(codexApiError(method,'a response before the request deadline',version));},timeoutMillis);
      // Retain only method identity; login input must never enter error/diagnostic receipts.
      pending.set(id,{resolve,reject,timer,method});
      try {send({id,method,params});} catch(error) {clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  try {
    await call('initialize',{clientInfo:{name:'moment-session-memory',version:'0.1.0'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
    if((await call('account/read',{refreshToken:false})).account!==null)throw Error('Owned Codex unexpectedly inherited an account');
    return {call,events,child,close,diagnostics:()=>({stderrBytes,refusedRequests}),failure:()=>failure};
  } catch(error) {await close();throw error;}
}
