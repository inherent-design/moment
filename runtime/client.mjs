import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readCredential } from './credentials.mjs';
import { parseJson } from './wire.mjs';
import { canonical } from './json.mjs';
import { validateBoundary, catalogIdentity } from './bindings.mjs';

function unknown(original) {
  const error=new Error('RPC outcome unknown; reconcile using the retained exact request before retrying');
  error.code='OUTCOME_UNKNOWN';error.request=original;return error;
}

/** One authenticated RPC per socket; ambiguous failures preserve the original request. */
export function request(root,method,params,{ token,credentialFile=process.env.MOMENT_CREDENTIAL_FILE,timeoutMillis,id=randomUUID() }={}) {
  if (token===undefined) token=readCredential(credentialFile ?? join(root,'runtime','owner.json')).token;
  // Snapshot before yielding: caller mutation must not change dispatched bytes or
  // the request retained for receipt reconciliation. Credentials are separate.
  let original,encoded;
  try {
    original=parseJson(canonical({ jsonrpc:'2.0',id,method,params }));
    encoded=JSON.stringify(original);
    if (typeof id!=='string' || !id.length || Buffer.byteLength(id)>128 || Buffer.byteLength(encoded)>1048576) throw new Error('Request exceeds frame bound');
  } catch { const error=new Error('Invalid or oversized RPC input');error.code='INVALID_ARGUMENT';throw error; }
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(join(root,'runtime','moment.sock'));
    let buffer=Buffer.alloc(0),finished=false;
    const fail=()=>{ if (finished) return;finished=true;socket.destroy();reject(unknown(original)); };
    const timeout=timeoutMillis ?? (method==='events.read' && Number.isInteger(params?.waitMillis)?Math.max(10000,Math.min(31000,params.waitMillis+1000)):10000);
    socket.setTimeout(timeout,fail);socket.on('error',fail);socket.on('end',()=>{ if (!finished) fail(); });
    socket.on('connect',()=>socket.write(`Authorization: Bearer ${token}\n${encoded}\n`));
    socket.on('data',bytes=>{
      buffer=Buffer.concat([buffer,bytes]);if (buffer.length>2097152) { fail();return; }
      const end=buffer.indexOf(10);if (end<0) return;
      try {
        const reply=parseJson(new TextDecoder('utf-8',{ fatal:true }).decode(buffer.subarray(0,end)));
        if (reply?.jsonrpc!=='2.0' || reply.id!==id || Object.hasOwn(reply,'result')===Object.hasOwn(reply,'error')) { fail();return; }
        const validResult=reply.result?.ok===true && Object.hasOwn(reply.result,'value') || reply.result?.ok===false && typeof reply.result.error?.code==='string' && typeof reply.result.error?.message==='string' && ['same_request','refresh','reconcile','never'].includes(reply.result.error?.retry) && Object.hasOwn(reply.result.error,'details');
        // Only these protocol faults establish that dispatch was refused. Server
        // internal faults and malformed results can follow a durable commit.
        if (!validResult && ![-32601,-32602].includes(reply.error?.code) || reply.result?.error?.code==='INTERNAL') { fail();return; }
        if(reply.result) {
          try { validateBoundary(method,'envelope',{operation:method,catalog:catalogIdentity,result:reply.result}); } catch { fail();return; }
        }
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
      return { ok:false,error:{ code:error.code==='OUTCOME_UNKNOWN'?'OUTCOME_UNKNOWN':error.code==='INVALID_ARGUMENT'?'INVALID_ARGUMENT':'UNAUTHENTICATED',message:['OUTCOME_UNKNOWN','INVALID_ARGUMENT'].includes(error.code)?error.message:'Client credentials unavailable',retry:error.code==='OUTCOME_UNKNOWN'?'reconcile':'never',details:error.request ?? null } };
    }
  } };
}
