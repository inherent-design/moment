// Explicit opt-in only. Never imported by ordinary checks or the product runtime.
import { accessSync,constants,realpathSync,mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { join,delimiter } from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { digest } from '../runtime/json.mjs';
import { compileDocument } from '../runtime/validation.mjs';

export function nativeEnvironment(root) {
  const env={PATH:process.env.PATH??'',HOME:join(root,'home'),CODEX_HOME:join(root,'state'),TMPDIR:join(root,'tmp')};
  for(const [name,suffix] of [['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data'],['XDG_CACHE_HOME','cache'],['XDG_RUNTIME_DIR','run']]) env[name]=join(root,suffix);
  for(const path of Object.values(env).slice(1)) mkdirSync(path,{recursive:true,mode:0o700});
  return env;
}

export function qualifyNative(root,env,workspace) {
  const executable=(env.PATH??'').split(delimiter).map(path=>join(path,'codex')).find(path=>{try{accessSync(path,constants.X_OK);return true;}catch{return false;}});
  if(!executable) throw Error('Installed Codex is unavailable');
  const binary=realpathSync(executable),run=args=>execFileSync(binary,args,{cwd:workspace,env,encoding:'utf8',timeout:15000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});
  const version=run(['--version']).trim();
  if(version!=='codex-cli 0.167.2') throw Error('Requalify installed Codex before inference: '+version);
  run(['app-server','generate-json-schema','--experimental','--out',join(root,'schema')]);
  const names=['LoginAccountParams','ThreadStartParams','ThreadResumeParams','TurnStartParams','ThreadReadResponse','ListMcpServerStatusParams','ListMcpServerStatusResponse','McpServerToolCallParams'];
  const schemas=Object.fromEntries(names.map(name=>[name,JSON.parse(readFileSync(join(root,'schema/v2',name+'.json')))]));
  if(!schemas.LoginAccountParams.oneOf.some(item=>item.properties?.type?.enum?.includes('chatgptAuthTokens'))) throw Error('External-token login is unavailable');
  for(const [name,fields] of [['ThreadStartParams',['ephemeral','historyMode']],['ThreadResumeParams',['threadId']],['TurnStartParams',['threadId','input']],['ListMcpServerStatusParams',['threadId']]]) {
    if(fields.some(field=>!Object.hasOwn(schemas[name].properties,field))) throw Error('Installed protocol changed: '+name);
  }
  if(!schemas.ThreadReadResponse.definitions.ThreadItem.oneOf.some(item=>item.properties?.type?.enum?.includes('subAgentActivity')))throw Error('Installed protocol no longer describes native child activity');
  return {binary,version,schemaDigests:Object.fromEntries(Object.entries(schemas).map(([name,value])=>[name,digest(value)]))};
}

export function configureNative(env) {
  writeFileSync(join(env.CODEX_HOME,'config.toml'),[
    'cli_auth_credentials_store = "ephemeral"','web_search = "disabled"',
    '[features]','shell_tool = false','apps = false',
    '[agents]','enabled = true','max_concurrent_threads_per_session = 1','',
  ].join('\n'),{mode:0o600});
}

export async function startNative({binary,env,workspace,onItem=()=>{}}) {
  // The goal authorizes this exact fixture mutation. Approval remains separate
  // from Moment's restricted credential; never weaken the advertised annotation.
  const child=spawn(binary,['-c','mcp_servers.moment.tools.moment_graph_transact.approval_mode="approve"','app-server','--listen','stdio://'],{cwd:workspace,env,stdio:['pipe','pipe','pipe']});
  const pending=new Map(),events=[];let sequence=0,buffer=Buffer.alloc(0),closed=false,failure,stderrBytes=0,eventBytes=0;
  const rejectAll=reason=>{failure??=reason;for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(reason);}pending.clear();};
  child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;}); // Never retain raw authenticated diagnostics.
  child.on('error',()=>rejectAll(Error('Owned app-server failed to start')));
  child.on('exit',()=>rejectAll(Error('Owned app-server exited')));
  child.stdin.on('error',()=>rejectAll(Error('Owned app-server transport closed')));
  const send=message=>{if(!closed && !failure)child.stdin.write(JSON.stringify(message)+'\n');};
  const close=async()=>{
    if(closed)return;closed=true;rejectAll(Error('Owned app-server closed'));
    if(child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await exited;}finally{clearTimeout(timer);}}
  };
  child.stdout.on('data',bytes=>{
    try {
      buffer=Buffer.concat([buffer,bytes]);let end;
      while((end=buffer.indexOf(10))>=0){
        if(end>16777216)throw Error('Owned app-server frame exceeds 16 MiB');
        const message=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,end)));buffer=buffer.subarray(end+1);
        if(message.method && Object.hasOwn(message,'id')){
          // Includes refresh and approvals: this fixture cannot refresh or approve new powers.
          send({id:message.id,error:{code:-32601,message:'Outside the bounded isolated qualification'}});
          if(events.length<512)events.push({method:'refused-server-request',params:{method:message.method}});
        } else if(Object.hasOwn(message,'id')){
          const waiter=pending.get(message.id);if(!waiter)continue;pending.delete(message.id);clearTimeout(waiter.timer);
          if(message.error)waiter.reject(Error('Owned app-server rejected '+waiter.method+' ('+message.error.code+')'));else waiter.resolve(message.result);
        } else if(['item/completed','turn/completed','thread/started'].includes(message.method)){
          eventBytes+=Buffer.byteLength(JSON.stringify(message));
          if(events.length>=512 || eventBytes>8388608)throw Error('Owned native event bound exceeded');events.push(message);
          if(message.method==='item/completed')onItem(message.params.item);
        }
      }
      if(buffer.length>16777216)throw Error('Owned app-server unterminated frame exceeds 16 MiB');
    }catch(error){rejectAll(error);void close();}
  });
  const call=(method,params,timeout=15000)=>new Promise((resolve,reject)=>{
    if(closed || failure){reject(failure??Error('Owned app-server closed'));return;}
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Owned app-server timed out: '+method));},timeout);
    pending.set(id,{resolve,reject,timer,method});send({id,method,params});
  });
  try {
    await call('initialize',{clientInfo:{name:'moment-mcp-qualification',version:'0.1.0'},capabilities:{experimentalApi:true}});
    send({method:'initialized',params:{}});
    if((await call('account/read',{refreshToken:false})).account!==null)throw Error('Owned app-server unexpectedly inherited an account');
    return {
      call,events,child,close,
      async login(credentials){
        const result=await call('account/login/start',{type:'chatgptAuthTokens',...credentials});
        if(result.type!=='chatgptAuthTokens' || !(await call('account/read',{refreshToken:false})).account || existsSync(join(env.CODEX_HOME,'auth.json')))throw Error('External authentication qualification failed');
        return {authenticated:true,persistedAuth:false,refreshTokenSupplied:false};
      },
      async turn(threadId,instruction,outputSchema,{timeout=120000}={}){
        if(Buffer.byteLength(instruction)>16384 || timeout>120000)throw Error('Native turn exceeds its bound');
        const started=await call('turn/start',{threadId,input:[{type:'text',text:instruction}],outputSchema,effort:'low'});
        const deadline=Date.now()+timeout;
        while(Date.now()<deadline){
          if(failure)throw failure;
          const done=events.find(event=>event.method==='turn/completed' && event.params.threadId===threadId && event.params.turn.id===started.turn.id);
          if(done){
            if(done.params.turn.status!=='completed')throw Error('Native turn ended '+done.params.turn.status);
            const items=events.filter(event=>event.method==='item/completed' && event.params.threadId===threadId && event.params.turnId===started.turn.id).map(event=>event.params.item);
            let output;try{output=JSON.parse(items.filter(item=>item.type==='agentMessage').at(-1)?.text);}catch{throw Error('Native final output is not JSON');}
            if(!compileDocument(outputSchema)(output))throw Error('Native final output violates its schema');
            return {turnId:started.turn.id,items,output};
          }
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        await call('turn/interrupt',{threadId,turnId:started.turn.id}).catch(()=>{});
        throw Error('Native turn deadline; reconcile retained Moment state before another attempt');
      },
      diagnostics(){return {stderrBytes,events:events.length,refusedRequests:events.filter(event=>event.method==='refused-server-request').map(event=>event.params.method)};},
    };
  }catch(error){await close();throw error;}
}
