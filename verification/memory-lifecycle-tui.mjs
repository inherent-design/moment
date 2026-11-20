// Uses only the private context created by memory-lifecycle.mjs.
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const context=JSON.parse(readFileSync(process.argv[2],'utf8'));
const child=spawn(context.binary,['--remote',context.url,'--remote-auth-token-env','MOMENT_NATIVE_TOKEN','-C',context.workspace,'--model','gpt-6-luna','--no-alt-screen'],{env:{...context.env,MOMENT_NATIVE_TOKEN:context.token},stdio:'inherit'});
child.once('exit',code=>process.exitCode=code??1);
