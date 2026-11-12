import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const executable=(process.env.PATH ?? '').split(delimiter).map(directory=>join(directory,'codex')).find(path=>{
  try { accessSync(path,constants.X_OK);return true; } catch { return false; }
});
if (!executable) throw new Error('Codex executable is unavailable; install selection is an operator action');
const binary=realpathSync(executable);
const directory=realpathSync(mkdtempSync(join(tmpdir(),'moment-codex-')));
const state=join(directory,'codex-state'), workspace=join(directory,'workspace');
mkdirSync(state,{ mode:0o700 });mkdirSync(workspace,{ mode:0o700 });
writeFileSync(join(state,'config.toml'),'cli_auth_credentials_store = "file"\n',{ mode:0o600 });
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('CODEX_') && !key.startsWith('OPENAI_') && !key.startsWith('CHATGPT_')));
// This override belongs only to the test child and uses Codex's supported state-root setting.
env.CODEX_HOME=state;
for (const [key,suffix] of [['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data'],['XDG_CACHE_HOME','cache'],['XDG_RUNTIME_DIR','run']]) {
  env[key]=join(directory,suffix);mkdirSync(env[key],{ mode:0o700 });
}
let child;
const pending=new Map();let nextId=0;
try {
  const version=execFileSync(binary,['--version'],{ cwd:workspace,env,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'] }).trim();
  child=spawn(binary,['app-server','--listen','stdio://'],{ cwd:workspace,env,stdio:['pipe','pipe','pipe'] });
  // Never forward account/config output or raw diagnostics into captures.
  child.stderr.on('data',()=>{});
  const lines=createInterface({ input:child.stdout });
  lines.on('line',line=>{
    let message;try { message=JSON.parse(line); } catch { return; }
    if (Object.hasOwn(message,'id') && pending.has(message.id)) {
      const waiter=pending.get(message.id);pending.delete(message.id);clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`Isolated Codex RPC failed (${message.error.code ?? 'unknown'})`));else waiter.resolve(message.result);
    }
  });
  const call=(method,params)=>new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{ pending.delete(id);reject(new Error(`Isolated Codex RPC timed out: ${method}`)); },15000);
    pending.set(id,{ resolve,reject,timer });
    child.stdin.write(JSON.stringify({ id,method,params })+'\n');
  });
  child.on('error',()=>{ for (const waiter of pending.values()) { clearTimeout(waiter.timer);waiter.reject(new Error('Isolated Codex process failed')); }pending.clear(); });
  child.on('exit',()=>{ for (const waiter of pending.values()) { clearTimeout(waiter.timer);waiter.reject(new Error('Isolated Codex exited')); }pending.clear(); });
  const initialized=await call('initialize',{ clientInfo:{ name:'moment-isolated-probe',title:'Moment isolated protocol probe',version:'0.1.0' },capabilities:{ experimentalApi:false } });
  if (!initialized || typeof initialized!=='object') throw new Error('Invalid initialization response');
  child.stdin.write(JSON.stringify({ method:'initialized',params:{} })+'\n');
  const account=await call('account/read',{ refreshToken:false });
  if (account?.account!==null) throw new Error('Test instance unexpectedly inherited an account; isolation is unproven');
  console.log(JSON.stringify({ version,transport:'dedicated-stdio-process',isolatedState:true,isolatedWorkspace:true,inheritedAccount:false,inferenceInvoked:false,primaryDaemonContacted:false,operations:['initialize','initialized','account/read with refreshToken=false'] },null,2));
  lines.close();
} finally {
  if (child && child.exitCode===null && child.signalCode===null) {
    const exited=once(child,'exit');child.kill('SIGTERM');
    const killer=setTimeout(()=>child.kill('SIGKILL'),5000);
    await exited;clearTimeout(killer);
  }
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
  rmSync(directory,{ recursive:true,force:true });
}
