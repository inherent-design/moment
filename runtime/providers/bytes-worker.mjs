// Fixed entrypoint. This process receives no caller-selected code, paths or environment.
import { openSync,readFileSync,writeFileSync,closeSync,renameSync,constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resourceUsage } from 'node:process';
import { resolve } from 'node:path';
const denied=['child','worker','net','inspector','wasi','addon','ffi','openssl.store'];
const guards={ enforce:process.execArgv.includes('--permission') && !process.execArgv.includes('--permission-audit'),inputRead:process.permission?.has('fs.read',resolve('input.bin'))===true,inputWrite:process.permission?.has('fs.write',resolve('input.bin'))===true,parentRead:process.permission?.has('fs.read',resolve('..'))===true,finalReceiptWrite:process.permission?.has('fs.write',resolve('receipt.json'))===true,...Object.fromEntries(denied.map(name=>[name,process.permission?.has(name)===true])) };
if (!guards.enforce || !guards.inputRead || guards.inputWrite || guards.parentRead || guards.finalReceiptWrite || denied.some(name=>guards[name])) throw new Error('Verifier process guards do not match the installed descriptor');
const read=name=>{
  const fd=openSync(name,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { return readFileSync(fd); } finally { closeSync(fd); }
};
const request=JSON.parse(read('request.json').toString('utf8')),bytes=read('input.bin');
if (bytes.length>262144) throw new Error('Input exceeds verifier bound');
const observedDigest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const result={ observedDigest,byteLength:bytes.length,matches:observedDigest===request.expectedDigest };
const outcome=result.matches?{ kind:'succeeded',output:result }:{ kind:'failed',code:'DIGEST_MISMATCH',detail:'Expected digest does not match observed bytes' };
const measured=resourceUsage();
const usage={ cpuMillis:Math.ceil((measured.userCPUTime+measured.systemCPUTime)/1000),memoryBytes:measured.maxRSS*1024,outputBytes:Buffer.byteLength(outcome.kind==='succeeded'?JSON.stringify(result):outcome.detail),modelTokens:0,apiSpendMicrounits:0 };
const receipt={ formatVersion:1,...request,result,outcome,usage,guards,measurement:{ source:'node:process.resourceUsage',scope:'child startup and verification, sampled before receipt persistence',nodeVersion:process.version },recordedAt:new Date().toISOString() };
const fd=openSync('receipt.tmp',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
try { writeFileSync(fd,JSON.stringify(receipt)+'\n'); } finally { closeSync(fd); }
renameSync('receipt.tmp','receipt.ready');
