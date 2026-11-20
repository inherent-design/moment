// Test-owned hook observability only; forwards the exact generated command.
import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {bytesDigest} from '../runtime/json.mjs';
const [log,command]=process.argv.slice(2),parts=[];let length=0;
for await(const part of process.stdin){length+=part.length;if(length>1048576)throw Error('Owned hook input exceeds its bound');parts.push(part);}
const input=Buffer.concat(parts),started=performance.now(),child=spawn('/bin/sh',['-c',command],{stdio:['pipe','pipe','pipe']});let output=Buffer.alloc(0),stderrBytes=0;
child.stdout.on('data',part=>{output=Buffer.concat([output,part]);if(output.length>1048576)child.kill();});child.stderr.on('data',part=>stderrBytes+=part.length);
process.once('SIGTERM',()=>child.kill());child.stdin.end(input);
const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
appendFileSync(log,JSON.stringify({event:JSON.parse(input),output:JSON.parse(output),exitCode:code,stderrBytes,durationMillis:Math.round(performance.now()-started),inputDigest:bytesDigest(input),outputDigest:bytesDigest(output)})+'\n',{mode:0o600});
process.stdout.write(output);process.exitCode=code??1;
