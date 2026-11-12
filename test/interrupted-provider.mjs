// Test-owned process interruption boundary; no production flag enables this barrier.
import { openSync,writeFileSync,fsyncSync,closeSync } from 'node:fs';
import { join } from 'node:path';
import { openHome } from '../runtime/home.mjs';
import { Kernel } from '../runtime/kernel.mjs';
import { serve } from '../runtime/server.mjs';
const home=openHome(),original=Kernel.prototype.call;
Kernel.prototype.call=function(method,input,...rest) {
  if (method==='execution.finish') {
    const fd=openSync(join(home.root,'before-finish.json'),'wx',0o600);
    try { writeFileSync(fd,JSON.stringify({ executionId:input.executionId,leaseId:input.leaseId,fencingToken:input.fencingToken }));fsyncSync(fd); } finally { closeSync(fd); }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  }
  return original.call(this,method,input,...rest);
};
const server=await serve(home.root,home.registry.systemId);
console.log(JSON.stringify({ ready:true,socketPath:server.socketPath }));
process.once('SIGTERM',()=>server.close().then(()=>process.exit(0)));
