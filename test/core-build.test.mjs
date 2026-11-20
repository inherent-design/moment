import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {semanticSources} from '../runtime/semantic-manifest.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const output='runtime/generated/semantics.mjs',manifest='runtime/generated/semantics.json';
async function reached(path,child) {
 const deadline=Date.now()+10000;
 while(!existsSync(path)){if(child.exitCode!==null||Date.now()>deadline)throw Error('Owned compiler did not reach barrier: '+path);await delay(10);}
}
function fixture(t) {
 const directory=mkdtempSync(join(tmpdir(),'moment-core-build-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const path of [...semanticSources(root).map(s=>s.path),output,manifest]){mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),readFileSync(join(root,path)));}
 const pins=JSON.parse(readFileSync(join(directory,'toolchain.json'))),bend=join(directory,'tools/bend/bin'),lean=join(directory,'tools/lean/bin');mkdirSync(bend,{recursive:true});mkdirSync(lean,{recursive:true});
 // Deliberate test double for compiler input custody, never proof qualification.
 writeFileSync(join(bend,'bend'),'#!'+process.execPath+'\n'+`
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),home=process.env.MOMENT_BUILD_BARRIER;
if(args[0]==='version'){console.log(${JSON.stringify(pins.bend.version)});process.exit(0);}
const wait=name=>{const until=Date.now()+10000;while(!existsSync(join(home,name))){if(Date.now()>until)throw Error('Test barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}};
writeFileSync(join(home,'ready'),'');wait('read');
const source=readFileSync(args[0]),digest=createHash('sha256').update(source).digest('hex');
writeFileSync(args[args.indexOf('-o')+1],'// test compiler input '+digest+'\\n');
writeFileSync(join(home,'observed'),digest);wait('finish');
`,{mode:0o755});
 writeFileSync(join(lean,'lean'),'#!'+process.execPath+'\nconsole.log('+JSON.stringify(pins.lean.version)+');\n',{mode:0o755});
 return {directory,bend:dirname(bend),lean:dirname(lean)};
}

for(const restore of [true,false])test(restore?'compilation reads a frozen snapshot despite a working-source ABA edit':'a changed source refuses publication and preserves the previous executable/manifest',async t=>{
 const f=fixture(t),source=join(f.directory,'core/semantics.bend'),original=readFileSync(source),beforeOutput=readFileSync(join(f.directory,output)),beforeManifest=readFileSync(join(f.directory,manifest));
 const child=spawn(process.execPath,['scripts/build-core.mjs','build'],{cwd:f.directory,env:{...process.env,MOMENT_BEND_HOME:f.bend,MOMENT_LEAN_HOME:f.lean,MOMENT_BUILD_BARRIER:f.directory},stdio:['ignore','pipe','pipe']});
 let transcript='';child.stdout.on('data',b=>transcript+=b);child.stderr.on('data',b=>transcript+=b);
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 try{
  await reached(join(f.directory,'ready'),child);writeFileSync(source,Buffer.concat([original,Buffer.from('\n# concurrent source edit\n')]));writeFileSync(join(f.directory,'read'),'');
  await reached(join(f.directory,'observed'),child);if(restore)writeFileSync(source,original);writeFileSync(join(f.directory,'finish'),'');
  const result=await done;
  if(restore){assert.equal(result.code,0,transcript);assert.equal(readFileSync(join(f.directory,'observed'),'utf8'),digest(original),'The compiler must see the exact captured input, even after working bytes change and return');}
  else {assert.notEqual(result.code,0,'A successful build cannot bless changed working inputs');assert.match(transcript,/Semantic inputs changed during qualification/);assert.deepEqual(readFileSync(join(f.directory,output)),beforeOutput);assert.deepEqual(readFileSync(join(f.directory,manifest)),beforeManifest);}
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await done;}
});
