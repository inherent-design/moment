// Explicit, interactive qualification. Never loaded by ordinary checks or services.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createInterface} from 'node:readline';
import {nativeEnvironment} from './native-session.mjs';
import {ownedMemoryWebSocket} from './memory-native-websocket.mjs';
import {readMemoryAccessSession} from '../runtime/codex-memory.mjs';
import {observeCodexVersion} from '../runtime/codex-api.mjs';
import {openHome,writeCheckpoint} from '../runtime/home.mjs';
import {serve} from '../runtime/server.mjs';
import {createClient} from '../runtime/client.mjs';
import {memoryHookDefinitions} from '../runtime/memory-commands.mjs';
import {bytesDigest} from '../runtime/json.mjs';

const [credentialFile,binaryArg,evidenceFile,captureHooks]=process.argv.slice(2);
if(!credentialFile || !binaryArg || !evidenceFile)throw Error('Use memory-lifecycle.mjs ABSOLUTE_CREDENTIAL_FILE ABSOLUTE_CODEX_BINARY ABSOLUTE_EVIDENCE_FILE; real subscription inference is opt-in.');
const root=realpathSync(mkdtempSync(join(tmpdir(),'ml-'))),workspace=join(root,'workspace');mkdirSync(workspace,{mode:0o700});
const env=nativeEnvironment(root),binary=realpathSync(binaryArg),moment=openHome({home:env.HOME,override:join(root,'moment')}),runtimeId='moment-owned-native-lifecycle';env.MOMENT_HOME=moment.root;
const nativeVersion=observeCodexVersion(binary,{env,cwd:workspace});
mkdirSync(join(moment.root,'runtime'),{mode:0o700});
writeCheckpoint(join(moment.root,'runtime/session-memory.json'),{formatVersion:1,enabled:true,provider:{kind:'codex',credentialFile:resolve(credentialFile),binary,model:'gpt-6-luna'}});
const cli=realpathSync(new URL('../runtime/cli.mjs',import.meta.url).pathname),definitions=memoryHookDefinitions(runtimeId,env.CODEX_HOME,moment.root);
const hookLog=join(root,'hook-events.jsonl');
if(captureHooks==='capture-hooks'){
  const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'",wrapper=realpathSync(new URL('./memory-hook-capture.mjs',import.meta.url).pathname);
  for(const groups of Object.values(definitions.hooks))for(const group of groups)for(const hook of group.hooks)hook.command=[process.execPath,wrapper,hookLog,hook.command].map(quote).join(' ');
}
writeCheckpoint(join(env.CODEX_HOME,'hooks.json'),definitions);
writeFileSync(join(env.CODEX_HOME,'config.toml'),[
  'cli_auth_credentials_store = "ephemeral"','model = "gpt-6-luna"','model_reasoning_effort = "low"','web_search = "disabled"','default_permissions = "moment-memory"',
  '[features]','hooks = true','shell_tool = false','apps = false','plugins = false','[agents]','enabled = false',
  '[permissions.moment-memory.filesystem]','":minimal" = "read"','[permissions.moment-memory.filesystem.":workspace_roots"]','"." = "read"','[permissions.moment-memory.network]','enabled = false',
  '[mcp_servers.moment]','command = '+JSON.stringify(process.execPath),'args = '+JSON.stringify([cli,'mcp']),'[mcp_servers.moment.env]','MOMENT_HOME = '+JSON.stringify(moment.root),'',
].join('\n'),{mode:0o600});
let server,native;const sessions=new Set(),events=[];let finished=false;
const save=async()=>{
  const packets=[];for(const sessionId of sessions)packets.push(await createClient(moment.root).call('memory.read',{session:{runtimeId,sessionId},maximumBytes:65536}));
  const hooks=native?await native.call('hooks/list',{cwds:[workspace]}).catch(()=>({unavailable:true})):undefined;
  const capturedHooks=existsSync(hookLog)?readFileSync(hookLog,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  const evidence={formatVersion:1,kind:'owned-native-memory-lifecycle',version:nativeVersion,runtimeId,root,workspace,hooksDigest:bytesDigest(JSON.stringify(definitions)),authPersisted:existsSync(join(env.CODEX_HOME,'auth.json')),events,hooks,packets,capturedHooks,diagnostics:native?.diagnostics()};
  writeCheckpoint(evidenceFile,evidence);return evidence;
};
const close=async(remove=false)=>{
  if(finished)return;finished=true;let evidence;
  try{evidence=await save();}finally{try{await native?.close();}finally{await server?.close();}}
  if(remove && evidence.packets.every(packet=>packet.ok && packet.value.pending.length===0))rmSync(root,{recursive:true,force:true});
  else console.error('Owned lifecycle state retained for inspection: '+root);
};
try {
  server=await serve(moment.root,moment.registry.systemId);
  native=await ownedMemoryWebSocket({root,binary,env,workspace});
  const auth=await native.call('account/login/start',{type:'chatgptAuthTokens',...readMemoryAccessSession(credentialFile)});
  if(auth.type!=='chatgptAuthTokens' || !(await native.call('account/read',{refreshToken:false})).account || existsSync(join(env.CODEX_HOME,'auth.json')))throw Error('Owned ephemeral authentication failed');
  for(const method of ['thread/started','hook/started','hook/completed','turn/completed','thread/tokenUsage/updated'])native.events.on(method,params=>{
    if(method==='thread/started')sessions.add(params.thread.id);
    if(events.length<128)events.push({method,params:method==='thread/started'?{threadId:params.thread.id}:params});
  });
  const context=join(root,'tui.json');writeCheckpoint(context,{formatVersion:1,binary,env,workspace,url:native.url,token:native.token});
  console.log(JSON.stringify({ready:true,context,evidenceFile,commands:['status','close']}));
  const lines=createInterface({input:process.stdin});
  const timer=setTimeout(()=>void close().finally(()=>{process.exitCode=1;lines.close();}),900000);let remove=false;
  try{for await(const line of lines){if(line==='close'){remove=true;break;}if(line==='status'){const value=await save();console.log(JSON.stringify({sessions:[...sessions],events:events.length,packets:value.packets.map(packet=>packet.ok?{revision:packet.value.cacheRevision,observed:packet.value.observedThrough,processed:packet.value.processedThrough,worker:packet.value.worker}:packet),hookEntries:value.hooks?.data?.length}));}}}finally{clearTimeout(timer);lines.close();await close(remove);}
}finally{await close();}
