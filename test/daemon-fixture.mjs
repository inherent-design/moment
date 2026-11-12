import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createService } from '../runtime/service.mjs';
export const cli=new URL('../runtime/cli.mjs',import.meta.url);
export async function start(root,{ entrypoint=cli }={}) {
  const child=spawn(process.execPath,[entrypoint.pathname,'serve'],{ env:{ ...process.env,MOMENT_HOME:root },stdio:['ignore','pipe','pipe'] });
  let output='',errors='';child.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{ child.kill('SIGKILL');reject(new Error('Server startup timeout: '+errors)); },5000);
    child.once('error',error=>{ clearTimeout(timeout);reject(error); });
    child.once('exit',code=>{ clearTimeout(timeout);reject(new Error(`Server exited ${code}: ${errors}`)); });
    child.stdout.on('data',bytes=>{ output+=bytes;if (output.includes('\n')) { clearTimeout(timeout);resolve(); } });
  });
  return child;
}
export async function stop(child,signal='SIGTERM') {
  const exited=once(child,'exit');child.kill(signal);await exited;
}
/** Managed lifecycle acceptance still returns the actual test-owned process handle. */
export async function startManaged(root) {
  let child;
  const service=createService({root,onSpawn:owned=>{child=owned;}}),ready=await service.ensure();
  if(!ready.ok) throw new Error('Managed fixture startup refused: '+ready.error.message);
  if(!child) throw new Error('Managed fixture did not own a new process; preserve the existing service');
  return child;
}
