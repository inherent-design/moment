import net from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, lstatSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Kernel } from './kernel.mjs';
import { authenticate } from './credentials.mjs';
import { parseJson } from './wire.mjs';
import { runtimeSocket } from './home.mjs';
import { publishPrivate } from './private-files.mjs';
import { catalogIdentity, validateBoundary } from './bindings.mjs';
import { serviceMethods } from './operations.mjs';
import { validateInput } from './validation.mjs';
import { VerifierRuntime } from './providers/bytes-runtime.mjs';
import { SessionMemory } from './session-memory.mjs';
import {createMemoryBindings} from './memory-bindings.mjs';
import {configuredMemoryLimits} from './memory-settings.mjs';
import { MemoryWorker } from './memory-worker.mjs';
import { configuredMemoryProvider } from './codex-memory.mjs';
import {configureGuidance,GuidanceRuntime} from './guidance-runtime.mjs';
import {NativeLabor} from './native-labor.mjs';
import {publishEnrollment} from './memory-enrollment.mjs';
import {assertMigrationReady} from './migration-state.mjs';
import { DomainError, resultError } from './json.mjs';

export function credentials(root) {
  const filename=join(root,'runtime','owner.json');
  mkdirSync(join(root,'runtime'),{ recursive:true,mode:0o700 });
  try {lstatSync(filename);} catch(error) {
    if(error.code!=='ENOENT') throw error;
    try {
      if(lstatSync(join(root,'runtime/store.sqlite')).size>0) {
        try {lstatSync(filename);} catch(error) {if(error.code==='ENOENT') throw new Error('Owner credential is missing for retained state; restore its original custody without resetting identity');throw error;}
      }
    }
    catch(error) {if(error.code!=='ENOENT') throw error;}
  }
  try { publishPrivate(filename,JSON.stringify({ formatVersion:1,principalId:randomUUID(),token:randomBytes(32).toString('hex'),cursorKey:randomBytes(32).toString('hex') })+'\n'); }
  catch(error) { if (error.code!=='EEXIST') throw error; }
  const stat=lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0 || stat.uid!==process.getuid()) throw new Error('Owner credential file must be a user-owned private regular file');
  const value=JSON.parse(readFileSync(filename,'utf8'));
  if (value.formatVersion!==1 || !/^[a-f0-9]{64}$/.test(value.token) || !/^[a-f0-9]{64}$/.test(value.cursorKey) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.principalId)) throw new Error('Invalid owner credential file');
  return value;
}

export async function serve(root,systemId,{memoryProvider,memoryLimits,guidanceProvider,guidanceOptions}={}) {
  assertMigrationReady(root);
  const socketPath=runtimeSocket(root),auth=credentials(root),directory=join(root,'runtime');
  const store=new Store(join(directory,'store.sqlite'),systemId);
  let claim,memory,memoryWorker,guidanceWorker,nativeLabor,enrollmentIssue;
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
    let selectedGuidance;
    try{selectedGuidance={...configureGuidance(root),...guidanceOptions};}
    catch{selectedGuidance={fileRoots:[],provider:{unavailableReason:'Guidance component custody is unavailable; other store operations remain usable'}};}
    const kernel=new Kernel(store,{ ownerId:auth.principalId,cursorKey:auth.cursorKey,catalog:catalogIdentity,instanceId:claim.nonce,guidance:selectedGuidance });
    let selectedMemoryProvider=memoryProvider??configuredMemoryProvider(root);
    try {memory=new SessionMemory(join(directory,'session-memory.sqlite'),systemId,{...configuredMemoryLimits(root),...memoryLimits},{bindings:createMemoryBindings({root,kernel,principalId:auth.principalId})});}
    catch {
      const unavailable=()=>{throw new DomainError('CAPABILITY_UNAVAILABLE','Session memory store is unavailable; preserve its original files and inspect the component without resetting it');};
      memory={read:unavailable,readAssessments:unavailable,focus:unavailable,configure:unavailable,observe:unavailable,rebuild:unavailable,cancel:unavailable,reconcile:unavailable,active:()=>undefined,hasPending:()=>false,close:()=>{}};
      selectedMemoryProvider={unavailableReason:'Session memory storage is unavailable; other Moment operations remain available',ready:async()=>unavailable()};
    }
    const updateEnrollment=()=>{
      try{publishEnrollment(root,systemId,memory.subscriptions());enrollmentIssue=undefined;}
      catch{enrollmentIssue='The automatic capture projection is unavailable; inspect local enrollment custody. Configuration/history remain retained.';}
    };
    if(memory.subscriptions)updateEnrollment();
    try {
      nativeLabor=new NativeLabor(root,{onChange:()=>{memoryWorker?.wake();guidanceWorker?.wake();}});
      if(memory.active())nativeLabor.retain('memory',memory.active());
    }catch{
      const unavailable={unavailableReason:'Native labor reservation needs inspection; preserve its recovery state'};
      nativeLabor={provider:(_kind,provider)=>provider?unavailable:undefined,close:()=>{}};
    }
    memoryWorker=new MemoryWorker(memory,{provider:nativeLabor.provider('memory',selectedMemoryProvider),recover:true});
    guidanceWorker=new GuidanceRuntime(kernel,root,{provider:nativeLabor.provider('guidance',guidanceProvider??selectedGuidance.provider),onChange:contextId=>queuePump(contextId)});
    kernel.guidance.workerStatus=()=>guidanceWorker.status();
    let maintenanceTimer,closed=false,closeService,maintenanceDiagnostics=0;
    let pumpHandle,pumping=false;const dirty=new Set();
    const queuePump=contextId=>{
      if (closed) return;
      if (contextId) dirty.add(contextId);
      if (!pumpHandle && !pumping && dirty.size) pumpHandle=setImmediate(pump);
    };
    const pump=()=>{
      pumpHandle=undefined;if (closed) return;pumping=true;
      const batch=[...dirty];dirty.clear();let failed=false;
      for (const id of batch) try { if (kernel.scheduler.advance(id)) dirty.add(id);verifier.pump(id);guidanceWorker.wake(); }
      catch { dirty.add(id);failed=true; }
      pumping=false;if (failed) { maintenanceFailure();return; }armMaintenance();queuePump();
    };
    const verifier=new VerifierRuntime(kernel,root,{ onChange:queuePump });
    const onCommit=({contextId,method})=>{ if (!method.startsWith('$runtime.schedule.') && !method.startsWith('$runtime.provider.')) queuePump(contextId); };
    store.notifications.on('commit',onCommit);
    const maintenanceFailure=()=>{
      clearTimeout(maintenanceTimer);
      if (closed) return;
      if (maintenanceDiagnostics++<128) process.stderr.write('Moment runtime maintenance failed; retrying retained work.\n');
      else if (maintenanceDiagnostics===129) process.stderr.write('Further repeated maintenance diagnostics suppressed; inspect retained state.\n');
      maintenanceTimer=setTimeout(runMaintenance,1000);
    };
    const armMaintenance=()=>{
      clearTimeout(maintenanceTimer);
      if (closed) return;
      try {
        const delays=[kernel.executions.nextDelay(),kernel.scheduler.nextDelay()].filter(value=>value!==null);
        if (delays.length) maintenanceTimer=setTimeout(runMaintenance,Math.min(...delays,2147483647));
      } catch { maintenanceFailure(); }
    };
    const runMaintenance=()=>{ if (closed) return;try { kernel.executions.maintainAll();for (const id of store.contextIds()) queuePump(id);armMaintenance(); } catch { maintenanceFailure(); } };
    kernel.executions.maintainAll();
    const sockets=new Set();
    const server=net.createServer(socket=>{
      if (sockets.size>=256) { socket.destroy();return; }
      const abort=new AbortController();socket.once('close',()=>abort.abort());
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
      socket.setTimeout(10000,()=>socket.destroy());
      let buffer=Buffer.alloc(0),authenticated=false,handled=false,session;
      const error=(id,code,message)=>{ handled=true;socket.end(JSON.stringify({ jsonrpc:'2.0',id,error:{ code,message } })+'\n'); };
      socket.on('data',async bytes=>{
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
        if (![...description.methods,...serviceMethods].includes(request.method)) { error(request.id,-32601,'Method not found');return; }
        handled=true;
        try {
          if(request.method.startsWith('memory.')) {
            validateInput(request.method,request.params);
            let result;
            if(session.principalId!==auth.principalId || session.grants) result={ok:false,error:{code:'FORBIDDEN',message:'Session memory requires the local owner credential; delegated access is not implemented',retry:'never',details:null}};
            else try {
              let value;
              if(request.method==='memory.read') value=memory.read(request.params,memoryWorker.status(),enrollmentIssue);
              else if(request.method==='memory.assessments.read') value=memory.readAssessments(request.params);
              else if(request.method==='memory.focus') value=memory.focus(request.params,session.principalId);
              else if(request.method==='memory.configure') {
                value=memory.configure(request.params,session.principalId);updateEnrollment();
                if(enrollmentIssue)throw new DomainError('OUTCOME_UNKNOWN',enrollmentIssue+' Retry the exact configuration request to reconcile publication.','reconcile');
              }
              else if(request.method==='memory.observe') value=memory.observe(request.params);
              else if(request.method==='memory.rebuild') value=memory.rebuild(request.params);
              else if(request.method==='memory.cancel') value=memoryWorker.cancel(request.params.session,request.params.sequence);
              else if(request.method==='memory.reconcile') value=memoryWorker.reconcile(request.params.dispatchId,request.params.resolution);
              try {validateBoundary(request.method,'output',value);} catch {throw Error('Memory output does not match the installed contract; reconcile possible admitted changes');}
              result={ok:true,value};
              if(!['memory.read','memory.assessments.read','memory.focus','memory.configure'].includes(request.method)) memoryWorker.wake();
            } catch(error) {if(!(error instanceof DomainError)) throw error;result=resultError(error);}
            const frame=JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n';
            if(Buffer.byteLength(frame)>1048576) {error(request.id,-32603,'Response exceeds frame limit; use a smaller selection');return;}
            socket.end(frame);return;
          }
          if (request.method==='service.stop') {
            validateInput(request.method,request.params);
            const result=session.principalId!==auth.principalId || session.grants
              ? { ok:false,error:{ code:'FORBIDDEN',message:'Service stop requires the local owner credential',retry:'never',details:null } }
              : request.params.expectedInstanceId!==claim.nonce
                ? { ok:false,error:{ code:'IDENTITY_CONFLICT',message:'Service instance changed; inspect its current identity before stopping',retry:'refresh',details:null } }
                : { ok:true,value:{ accepted:true,instanceId:claim.nonce } };
            socket.end(JSON.stringify({ jsonrpc:'2.0',id:request.id,result })+'\n',()=>{ if(result.ok) setImmediate(()=>closeService().catch(()=>{ process.exitCode=1; })); });
            return;
          }
          const grant=session.grants?.[request.params?.contextId];
          let result=kernel.call(request.method,request.params,session.principalId,grant);
          if(request.method==='system.describe' && result.ok) {
            result.value.methods.push(...serviceMethods);result.value.principalId=session.principalId;
            if(session.grants) result.value.grants=session.grants;
          }
          if (request.method==='events.read' && result.ok && request.params.waitMillis>0 && !result.value.items.length) {
            socket.setTimeout(request.params.waitMillis+1000,()=>socket.destroy());
            result=await kernel.events.wait(request.params,session.principalId,grant,abort.signal);
          }
          armMaintenance();
          if (!result.ok && result.error.code==='INVALID_ARGUMENT') { error(request.id,-32602,'Invalid params');return; }
          if (result.ok) {
            try { validateBoundary(request.method,'output',result.value); }
            catch { throw new Error('Implementation output does not match the installed contract'); }
          }
          const frame=JSON.stringify({ jsonrpc:'2.0',id:request.id,result })+'\n';
          if (Buffer.byteLength(frame)>1048576) { error(request.id,-32603,'Response exceeds frame limit; use a smaller page');return; }
          handled=true;socket.end(frame);
        } catch(fault) { error(request.id,fault.code==='INVALID_ARGUMENT'?-32602:-32603,fault.code==='INVALID_ARGUMENT'?'Invalid params':'Internal error'); }
      });
    });
    const previousMask=process.umask(0o177);
    try { await new Promise((resolve,reject)=>{ server.once('error',reject);server.listen(socketPath,resolve); }); }
    finally { process.umask(previousMask); }
    chmodSync(socketPath,0o600);
    armMaintenance();
    memoryWorker.wake();
    for (const id of store.contextIds()) queuePump(id);
    closeService=async()=>{
      if (closed) return;closed=true;clearTimeout(maintenanceTimer);clearImmediate(pumpHandle);store.notifications.off('commit',onCommit);
      for (const socket of sockets) socket.destroy();
      nativeLabor.close();await verifier.close();await guidanceWorker.close();await memoryWorker.close();memory.close();
      await new Promise(resolve=>server.close(resolve));store.releaseWriter(claim);store.close();
    };
    return { socketPath,close:closeService };
  } catch(error) {
    nativeLabor?.close();if(guidanceWorker)await guidanceWorker.close();if(memoryWorker) await memoryWorker.close();if(memory) memory.close();
    if (claim) store.releaseWriter(claim);
    store.close();
    throw error;
  }
}
