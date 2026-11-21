import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createService } from '../runtime/service.mjs';
export const cli=new URL('../runtime/cli.mjs',import.meta.url);
export async function start(root,{ entrypoint=cli }={}) {
  const child=spawn(process.execPath,[entrypoint.pathname,'serve'],{ env:{ ...process.env,MOMENT_HOME:root },stdio:['ignore','pipe','pipe'] });
  let output='',errors='';child.stderr.on('data',bytes=>{errors=(errors+bytes).slice(-16384);});
  try{await new Promise((resolve,reject)=>{
    // Match the product's default readiness allowance; this is no cold-start benchmark.
    const timeout=setTimeout(()=>reject(new Error('Server startup timeout: '+errors)),10000);
    child.once('error',error=>{ clearTimeout(timeout);reject(error); });
    child.once('exit',code=>{ clearTimeout(timeout);reject(new Error(`Server exited ${code}: ${errors}`)); });
    child.stdout.on('data',bytes=>{ output+=bytes;if (output.includes('\n')) { clearTimeout(timeout);resolve(); } });
  });}catch(error){await stop(child,'SIGKILL');throw error;}
  return child;
}
export async function stop(child,signal='SIGTERM') {
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.ref();const exited=once(child,'exit');
  let escalation,deadline;
  try{
    child.kill(signal);escalation=setTimeout(()=>child.kill('SIGKILL'),3000);
    await Promise.race([exited,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Owned daemon retirement was not observed; retain its state')),6000);})]);
  }finally{clearTimeout(escalation);clearTimeout(deadline);}
}
/** Managed lifecycle acceptance still returns the actual test-owned process handle. */
export async function startManaged(root) {
  let child;
  const service=createService({root,onSpawn:owned=>{child=owned;}}),ready=await service.ensure();
  if(!ready.ok){if(child)await stop(child);throw Object.assign(new Error('Managed fixture startup refused ('+ready.error.code+(ready.error.details?.reasonCode?'/'+ready.error.details.reasonCode:'')+'): '+ready.error.message),{code:ready.error.code});}
  if(!child) throw new Error('Managed fixture did not own a new process; preserve the existing service');
  return child;
}
