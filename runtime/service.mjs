import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, openSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { inspectHome, openHome } from './home.mjs';
import { credentials } from './server.mjs';
import { request, createClient } from './client.mjs';
import { catalogIdentity } from './bindings.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const optionalStat = path => { try { return lstatSync(path); } catch (error) { if (error.code==='ENOENT') return;throw error; } };
function claimAt(root) {
  const path=join(root,'runtime/store.sqlite'),stat=optionalStat(path);
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077) throw new Error('Database is not a private owned regular file');
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    db.exec('PRAGMA busy_timeout=1000');
    const version=db.prepare('PRAGMA user_version').get().user_version;
    if(version===0) return; // Empty owned file; Store initializes under BEGIN IMMEDIATE.
    if(version!==1) throw new Error('Unsupported database version');
    const row=db.prepare("SELECT value FROM metadata WHERE key='daemonClaim'").get();
    if (!row) return;
    const claim=JSON.parse(row.value);
    if (!Number.isSafeInteger(claim.pid) || claim.pid<1 || typeof claim.nonce!=='string') throw new Error('Invalid daemon ownership');
    try { process.kill(claim.pid,0);return {...claim,live:true}; } catch(error) { if(error.code==='ESRCH') return {...claim,live:false};throw error; }
  } finally { db.close(); }
}
const minimumEnvironment = root => Object.fromEntries(Object.entries({ PATH:process.env.PATH,HOME:process.env.HOME,USER:process.env.USER,LOGNAME:process.env.LOGNAME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,LC_ALL:process.env.LC_ALL,MOMENT_HOME:root }).filter(([,v])=>v!==undefined));

/** Shared service custody. Process liveness is observation, never authority to kill. */
export function createService({ root, credentialFile=process.env.MOMENT_CREDENTIAL_FILE, startupMillis=10000, expectedCatalog=catalogIdentity, onSpawn=()=>{} }={}) {
  if (!Number.isInteger(startupMillis) || startupMillis<100 || startupMillis>120000) throw new Error('Startup deadline must be 100–120000 ms');
  const homeOptions=root===undefined?{}:{override:root};
  async function inspect() {
    let home;
    try { home=inspectHome(homeOptions); }
    catch { return {state:'incompatible',reason:'Moment home is invalid; inspect the selected registry without resetting it',home:root??''}; }
    const health=(state,reason,extra={})=>({state,reason,home:home.root,...extra});
    if (!home.registry) return health('stopped','Moment is not initialized; a domain operation can initialize and start it');
    try {
      const socket=optionalStat(join(home.root,'runtime/moment.sock'));
      if (socket && (!socket.isSocket() || socket.uid!==process.getuid() || socket.mode&0o077)) return health('incompatible','Socket path is not a private owned socket; inspect it explicitly');
      const claim=claimAt(home.root);
      if (socket) {
        try {
          const reply=await request(home.root,'system.describe',{protocolVersion:'0.1'},{credentialFile,timeoutMillis:500});
          const value=reply.result?.ok?reply.result.value:undefined;
          if (!value || value.protocolVersion!=='0.1' || value.systemId!==home.registry.systemId || !value.instanceId || value.catalog?.digest!==expectedCatalog.digest || !claim?.live || claim.nonce!==value.instanceId) return health('incompatible','Service identity, protocol or catalog differs; inspect it with the raw operator interface',{...(value?.instanceId?{instanceId:value.instanceId}:{}),...(value?.catalog?{catalog:value.catalog}:{})});
          return health('ready','Authenticated service is ready',{instanceId:value.instanceId,catalog:value.catalog});
        } catch(error) {
          if (!['OUTCOME_UNKNOWN','ENOENT'].includes(error.code)) return health('unavailable','Selected credentials are unavailable; repair that credential without falling back to the owner');
          if (claim?.live) return health('starting','A live owner holds the store; wait for authenticated readiness');
          // A refused stale socket is safe for serve() to recheck. A live socket
          // without a claim cannot be adopted based on failed authentication.
          const { default:net }=await import('node:net');
          const listening=await new Promise(resolve=>{const probe=net.createConnection(join(home.root,'runtime/moment.sock'));probe.once('connect',()=>{probe.destroy();resolve(true);});probe.once('error',e=>{probe.destroy();resolve(!['ENOENT','ECONNREFUSED'].includes(e.code));});probe.setTimeout(500,()=>{probe.destroy();resolve(true);});});
          if(listening) return health('uncertain','Socket is listening without authenticated ownership; inspect before starting');
        }
      }
      return claim?.live?health('starting','A live process holds the store; wait without replacing it'):health('stopped','No live service owns this store; retained work can resume on startup');
    } catch(error) {
      if([5,6].includes(error.errcode&255)) return health('starting','The store is busy establishing ownership; wait for authenticated readiness');
      return health('incompatible',`Cannot establish database ownership or compatibility (${error.code??'invalid state'}); preserve state and inspect it`);
    }
  }
  async function ensure() {
    // Qualify an explicitly selected delegate before provisioning anything.
    if(credentialFile) {
      try { const {readCredential}=await import('./credentials.mjs');readCredential(credentialFile); }
      catch { return {ok:false,error:{code:'UNAUTHENTICATED',message:'Selected credential is unavailable; no owner fallback',retry:'never',details:null}}; }
    }
    let state=await inspect();
    if(state.state==='stopped') {
      try {
        const home=openHome(homeOptions);credentials(home.root);
        // Recheck after provisioning: a concurrent starter may already own it.
        state=await inspect();
        if(state.state==='stopped') {
          const logPath=join(home.root,'runtime/service.log');
          const logStat=optionalStat(logPath);
          if(logStat && (!logStat.isFile() || logStat.isSymbolicLink() || logStat.uid!==process.getuid() || logStat.mode&0o077)) throw new Error('Service log is not private');
          // Each start gets a bounded diagnostic file. The daemon itself limits
          // repeated maintenance diagnostics; no prompts or credentials enter it.
          const fd=openSync(logPath,constants.O_CREAT|constants.O_WRONLY|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
          let child;
          try { child=spawn(process.execPath,[new URL('./managed-service.mjs',import.meta.url).pathname],{detached:true,env:minimumEnvironment(home.root),stdio:['ignore',fd,fd]});child.on('error',()=>{});onSpawn(child);child.unref(); }
          finally { closeSync(fd); }
        }
      } catch { return {ok:false,error:{code:'CAPABILITY_UNAVAILABLE',message:'Service startup could not be admitted; inspect status and its private log',retry:'never',details:null}}; }
    }
    const until=Date.now()+startupMillis;
    do {
      state=await inspect();
      if(state.state==='ready') return {ok:true,value:state};
      if(['incompatible','unavailable','uncertain'].includes(state.state)) break;
      await delay(Math.min(50,Math.max(1,until-Date.now())));
    } while(Date.now()<until);
    return {ok:false,error:{code:state.state==='incompatible'?'UNSUPPORTED_VERSION':'CAPABILITY_UNAVAILABLE',message:state.reason+(state.state==='starting'||state.state==='stopped'?'; readiness deadline expired without proof of retirement':''),retry:'reconcile',details:state}};
  }
  async function stop(expectedInstanceId) {
    const state=await inspect();
    if(state.state!=='ready') return {ok:false,error:{code:'CAPABILITY_UNAVAILABLE',message:state.reason,retry:'reconcile',details:state}};
    return createClient(state.home,{credentialFile}).call('service.stop',{expectedInstanceId});
  }
  return {inspect,ensure,stop};
}
