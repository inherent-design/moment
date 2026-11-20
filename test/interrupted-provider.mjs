// Test-owned process interruption boundary; no production flag enables this barrier.
import { join } from 'node:path';
import { openHome } from '../runtime/home.mjs';
import { Kernel } from '../runtime/kernel.mjs';
import { serve } from '../runtime/server.mjs';
import { publishPrivate } from '../runtime/private-files.mjs';
const home=openHome(),original=Kernel.prototype.call;
Kernel.prototype.call=function(method,input,...rest) {
  if (method==='execution.finish') {
    publishPrivate(join(home.root,'before-finish.json'),JSON.stringify({ executionId:input.executionId,leaseId:input.leaseId,fencingToken:input.fencingToken }));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  }
  return original.call(this,method,input,...rest);
};
const server=await serve(home.root,home.registry.systemId);
console.log(JSON.stringify({ ready:true,socketPath:server.socketPath }));
process.once('SIGTERM',()=>server.close().then(()=>process.exit(0)));
