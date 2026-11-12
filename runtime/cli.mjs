import { openHome } from './home.mjs';
import { serve } from './server.mjs';
import { request } from './client.mjs';
import { issueCredential } from './credentials.mjs';
import { parseJson } from './wire.mjs';
import { installVerifier } from './providers/bytes-runtime.mjs';
import { readJsonInput } from './input.mjs';

try {
  const [command,method,raw,...extra]=process.argv.slice(2);
  if (command==='--help' || command==='help' || !command) {
    console.log('moment serve | moment call <method> <params-json> | moment call <method> --file <path|-> | moment describe | moment credential <principal-id> <grant-bindings-json> | moment verifier <context-id>');
  } else {
    const fileMode=command==='call' && raw==='--file';
    if (!['serve','call','describe','credential','verifier'].includes(command) || (fileMode ? !method || extra.length!==1 : extra.length || (['call','credential'].includes(command) ? !method || raw===undefined : command==='verifier'?!method || raw!==undefined:method!==undefined))) throw new Error('Invalid arguments; use moment --help');
    const params=['call','credential'].includes(command)?fileMode?await readJsonInput(extra[0]):parseJson(raw):undefined;
    const home=openHome();
    if (command==='verifier') {
      console.log(JSON.stringify(await installVerifier(home.root,method),null,2));
    } else if (command==='credential') {
      console.log(JSON.stringify({ credentialFile:issueCredential(home.root,method,params) }));
    } else if (command==='serve') {
      const server=await serve(home.root,home.registry.systemId);
      console.log(JSON.stringify({ ready:true,socketPath:server.socketPath }));
      const stop=()=>server.close().then(()=>process.exit(0)).catch(()=>process.exit(1));
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
    } else {
      const reply=await request(home.root,command==='describe'?'system.describe':method,command==='describe'?{ protocolVersion:'0.1' }:params);
      console.log(JSON.stringify(reply,null,2));
      if (reply.error || reply.result?.ok===false) process.exitCode=1;
    }
  }
} catch(error) { console.error(error instanceof SyntaxError?'Moment command failed: invalid JSON':error.code==='OUTCOME_UNKNOWN'?error.message:'Moment command failed: '+error.message);process.exitCode=1; }
