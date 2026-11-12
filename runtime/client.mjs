import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readCredential } from './credentials.mjs';
import { parseJson } from './wire.mjs';

/** One authenticated RPC per socket; ambiguous failures preserve the original request. */
export function request(root,method,params,{ token,credentialFile=process.env.MOMENT_CREDENTIAL_FILE,timeoutMillis,id=randomUUID() }={}) {
  if (token===undefined) token=readCredential(credentialFile ?? join(root,'runtime','owner.json')).token;
  const original={ jsonrpc:'2.0',id,method,params };
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(join(root,'runtime','moment.sock'));
    let buffer=Buffer.alloc(0),finished=false;
    const fail=()=>{ if (finished) return;finished=true;socket.destroy();const error=new Error('RPC outcome unknown; retain exact request for retry');error.code='OUTCOME_UNKNOWN';error.request=original;reject(error); };
    const timeout=timeoutMillis ?? (method==='events.read' && Number.isInteger(params?.waitMillis)?Math.max(10000,Math.min(31000,params.waitMillis+1000)):10000);
    socket.setTimeout(timeout,fail);socket.on('error',fail);socket.on('end',()=>{ if (!finished) fail(); });
    socket.on('connect',()=>socket.write(`Authorization: Bearer ${token}\n${JSON.stringify(original)}\n`));
    socket.on('data',bytes=>{
      buffer=Buffer.concat([buffer,bytes]);if (buffer.length>2097152) { fail();return; }
      const end=buffer.indexOf(10);if (end<0) return;
      try {
        const reply=parseJson(new TextDecoder('utf-8',{ fatal:true }).decode(buffer.subarray(0,end)));
        if (reply.jsonrpc!=='2.0' || (reply.id!==id && reply.id!==null)) { fail();return; }
        finished=true;socket.destroy();resolve(reply);
      } catch { fail(); }
    });
  });
}

/** Programmatic Result-based client matching the declared MomentClient interface. */
export function createClient(root,options={}) {
  return { async call(method,input) {
    try {
      const reply=await request(root,method,input,options);
      if (reply.result?.ok===true && Object.hasOwn(reply.result,'value')) return reply.result;
      if (reply.result?.ok===false && typeof reply.result.error?.code==='string' && typeof reply.result.error?.message==='string' && ['same_request','refresh','reconcile','never'].includes(reply.result.error?.retry) && Object.hasOwn(reply.result.error,'details')) return reply.result;
      const code=reply.error?.code===-32602 || reply.error?.code===-32601 ? 'INVALID_ARGUMENT' : 'INTERNAL';
      return { ok:false,error:{ code,message:reply.error?.message ?? 'Invalid RPC response',retry:'never',details:null } };
    } catch(error) {
      return { ok:false,error:{ code:error.code==='OUTCOME_UNKNOWN'?'OUTCOME_UNKNOWN':'UNAUTHENTICATED',message:error.code==='OUTCOME_UNKNOWN'?error.message:'Client credentials unavailable',retry:error.code==='OUTCOME_UNKNOWN'?'reconcile':'never',details:error.request ?? null } };
    }
  } };
}
