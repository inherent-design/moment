import { openHome } from './home.mjs';
import { serve } from './server.mjs';
import { request } from './client.mjs';
import { parseJson } from './wire.mjs';

try {
  const [command,method,raw,...extra]=process.argv.slice(2);
  if (command==='--help' || command==='help' || !command) {
    console.log('moment serve | moment call <method> <params-json> | moment describe');
  } else {
    if (extra.length || !['serve','call','describe'].includes(command) || (command==='call' ? !method || raw===undefined : method!==undefined)) throw new Error('Invalid arguments; use moment --help');
    const home=openHome();
    if (command==='serve') {
      const server=await serve(home.root,home.registry.systemId);
      console.log(JSON.stringify({ ready:true,socketPath:server.socketPath }));
      const stop=()=>server.close().then(()=>process.exit(0)).catch(()=>process.exit(1));
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
    } else {
      const reply=await request(home.root,command==='describe'?'system.describe':method,command==='describe'?{ protocolVersion:'0.1' }:parseJson(raw));
      console.log(JSON.stringify(reply,null,2));
      if (reply.error || reply.result?.ok===false) process.exitCode=1;
    }
  }
} catch(error) { console.error(error instanceof SyntaxError?'Moment command failed: invalid JSON':error.code==='OUTCOME_UNKNOWN'?error.message:'Moment command failed: '+error.message);process.exitCode=1; }
