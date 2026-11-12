// Test-only delivery delay: the real worker completes before its report is released.
import { watch,existsSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openHome } from '../runtime/home.mjs';
import { serve } from '../runtime/server.mjs';
import { BytesVerifier } from '../runtime/providers/bytes-host.mjs';
const home=openHome(),original=BytesVerifier.prototype.execute;
BytesVerifier.prototype.execute=async function(input) {
  const report=await original.call(this,input),release=join(home.root,'release-finish');
  writeFileSync(join(home.root,'before-finish.json'),JSON.stringify({ executionId:input.execution.intent.id }),{ flag:'wx',mode:0o600 });
  await new Promise(resolve=>{ const watcher=watch(home.root,()=>{ if (existsSync(release)) { watcher.close();resolve(); } });if (existsSync(release)) { watcher.close();resolve(); } });
  return report;
};
const server=await serve(home.root,home.registry.systemId);
console.log(JSON.stringify({ ready:true,socketPath:server.socketPath }));
process.once('SIGTERM',()=>server.close().then(()=>process.exit(0)));
