import net from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, lstatSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Kernel } from './kernel.mjs';
import { authenticate } from './credentials.mjs';
import { parseJson } from './wire.mjs';

export function credentials(root) {
  const filename=join(root,'runtime','owner.json');
  mkdirSync(join(root,'runtime'),{ recursive:true,mode:0o700 });
  try { writeFileSync(filename,JSON.stringify({ formatVersion:1,principalId:randomUUID(),token:randomBytes(32).toString('hex'),cursorKey:randomBytes(32).toString('hex') })+'\n',{ flag:'wx',mode:0o600 }); }
  catch(error) { if (error.code!=='EEXIST') throw error; }
  const stat=lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0 || stat.uid!==process.getuid()) throw new Error('Owner credential file must be a user-owned private regular file');
  const value=JSON.parse(readFileSync(filename,'utf8'));
  if (value.formatVersion!==1 || !/^[a-f0-9]{64}$/.test(value.token) || !/^[a-f0-9]{64}$/.test(value.cursorKey) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.principalId)) throw new Error('Invalid owner credential file');
  return value;
}

export async function serve(root,systemId) {
  const auth=credentials(root), directory=join(root,'runtime'), socketPath=join(directory,'moment.sock');
  const store=new Store(join(directory,'store.sqlite'),systemId);
  let claim;
  try {
    claim=store.claimWriter();
    try {
      const stat=lstatSync(socketPath);
      if (!stat.isSocket() || stat.uid!==process.getuid()) throw new Error('Existing socket path is not an owned socket');
      await new Promise((resolve,reject)=>{
        const probe=net.createConnection(socketPath);
        probe.setTimeout(1000,()=>{ probe.destroy();reject(new Error('Existing socket liveness is uncertain')); });
        probe.once('connect',()=>{ probe.destroy();reject(new Error('A live server already owns the socket')); });
        probe.once('error',error=>{ probe.destroy();if (['ECONNREFUSED','ENOENT'].includes(error.code)) resolve();else reject(new Error('Cannot establish existing socket ownership')); });
      });
      unlinkSync(socketPath);
    } catch(error) { if (error.code!=='ENOENT') throw error; }
    const kernel=new Kernel(store,{ ownerId:auth.principalId,cursorKey:auth.cursorKey });
    let maintenanceTimer,closed=false;
    const maintenanceFailure=()=>{
      clearTimeout(maintenanceTimer);
      if (closed) return;
      process.stderr.write('Moment execution maintenance failed; retrying retained deadlines.\n');
      maintenanceTimer=setTimeout(runMaintenance,1000);
    };
    const armMaintenance=()=>{
      clearTimeout(maintenanceTimer);
      if (closed) return;
      try {
        const delay=kernel.executions.nextDelay();
        if (delay!==null) maintenanceTimer=setTimeout(runMaintenance,Math.min(delay,2147483647));
      } catch { maintenanceFailure(); }
    };
    const runMaintenance=()=>{ if (closed) return;try { kernel.executions.maintainAll();armMaintenance(); } catch { maintenanceFailure(); } };
    kernel.executions.maintainAll();
    const sockets=new Set();
    const server=net.createServer(socket=>{
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
      socket.setTimeout(10000,()=>socket.destroy());
      let buffer=Buffer.alloc(0),authenticated=false,handled=false,session;
      const error=(id,code,message)=>{ handled=true;socket.end(JSON.stringify({ jsonrpc:'2.0',id,error:{ code,message } })+'\n'); };
      socket.on('data',bytes=>{
        if (handled) return;
        buffer=Buffer.concat([buffer,bytes]);
        if (buffer.length>1048576+4096) { socket.destroy();return; }
        if (!authenticated) {
          const end=buffer.indexOf(10);
          if (end<0) { if (buffer.length>4096) socket.destroy();return; }
          const header=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);
          const token=header.startsWith('Authorization: Bearer ')?header.slice(22):'';
          try { session=authenticate(root,token,auth); } catch { socket.destroy();return; }
          if (!session) { socket.destroy();return; }
          authenticated=true;
        }
        const end=buffer.indexOf(10);
        if (end<0) { if (buffer.length>1048576) socket.destroy();return; }
        if (end>1048576) { socket.destroy();return; }
        let request;
        try { request=parseJson(new TextDecoder('utf-8',{ fatal:true }).decode(buffer.subarray(0,end))); }
        catch { error(null,-32700,'Parse error');return; }
        if (!request || typeof request!=='object' || Array.isArray(request) || request.jsonrpc!=='2.0' || typeof request.id!=='string' || !request.id.length || Buffer.byteLength(request.id)>128 || typeof request.method!=='string' || !Object.hasOwn(request,'params') || Object.keys(request).some(key=>!['jsonrpc','id','method','params'].includes(key))) { error(null,-32600,'Invalid request');return; }
        const description=kernel.call('system.describe',{ protocolVersion:'0.1' },auth.principalId).value;
        if (!description.methods.includes(request.method)) { error(request.id,-32601,'Method not found');return; }
        try {
          const result=kernel.call(request.method,request.params,session.principalId,session.grants?.[request.params?.contextId]);
          armMaintenance();
          if (!result.ok && result.error.code==='INVALID_ARGUMENT') { error(request.id,-32602,'Invalid params');return; }
          const frame=JSON.stringify({ jsonrpc:'2.0',id:request.id,result })+'\n';
          if (Buffer.byteLength(frame)>1048576) { error(request.id,-32603,'Response exceeds frame limit; use a smaller page');return; }
          handled=true;socket.end(frame);
        } catch { error(request.id,-32603,'Internal error'); }
      });
    });
    await new Promise((resolve,reject)=>{ server.once('error',reject);server.listen(socketPath,resolve); });
    chmodSync(socketPath,0o600);
    armMaintenance();
    return { socketPath, close:async()=>{
      if (closed) return;closed=true;clearTimeout(maintenanceTimer);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve=>server.close(resolve));store.releaseWriter(claim);store.close();
    } };
  } catch(error) {
    if (claim) store.releaseWriter(claim);
    store.close();
    throw error;
  }
}
