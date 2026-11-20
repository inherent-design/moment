#!/usr/bin/env node
import { openHome } from './home.mjs';
import { serve } from './server.mjs';
import { request } from './client.mjs';
import { issueCredential } from './credentials.mjs';
import { parseJson } from './wire.mjs';
import { installVerifier } from './providers/bytes-runtime.mjs';
import { readJsonInput } from './input.mjs';
import { runManagedCommand } from './commands.mjs';

try {
  const [command,method,raw,...extra]=process.argv.slice(2);
  if (command==='--help' || command==='help' || !command) {
    console.log('moment captures read|record|plan|apply|reconcile (use moment captures --help)\nmoment agents [operation-id] [--limit N] [--cursor CURSOR]\nmoment mcp [--profile continuity|operator]\nmoment guidance setup --context ID [--actions-only|--read-only] [--refs FILE] [--json]\nmoment guidance read --context ID [--location PATH] [--execution ID] [--maximum-bytes N] [--json]\nmoment guidance register|refresh|review --file PATH|- [--json]\nmoment memory on|off [--runtime ID] [--session ID] [--json]\nmoment memory configure --file PATH|- [--json]\nmoment memory focus --file PATH|- [--json]\nmoment memory assessments [--runtime ID] [--session ID] [--maximum-bytes N] [--json]\nmoment memory assessments --file PATH|- [--json]\nmoment memory read|status [--runtime ID] [--session ID] [--maximum-bytes N] [--sources JSON] [--working-set ID] [--sets] [--json]\nmoment memory hooks [--runtime ID] [--session ID] [--codex-home PATH] [--moment-home PATH]\nmoment memory hook [--runtime ID] [--session ID] [--codex-home PATH]\nmoment memory select --file PATH|- [--codex-home PATH] [--runtime ID] [--json]\nmoment memory observe|rebuild|cancel|reconcile --file PATH|- [--json]\nmoment storage plan [--enroll FILE] [--out FILE] [--json]\nmoment storage migrate --file PLAN [--json]\nmoment storage resume [--json]\nmoment status [--context ID] [--details] [--json]\nmoment show INCIDENT --context ID [--details] [--json]\nmoment stop [--json]\nmoment connect|disconnect --codex-home PATH --moment-home PATH [--apply] [--json]\nmoment serve | moment call <method> <params-json> | moment call <method> --file <path|-> | moment describe | moment credential <principal-id> <grant-bindings-json> | moment verifier <context-id>');
  } else if(await runManagedCommand(process.argv.slice(2))) {
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
