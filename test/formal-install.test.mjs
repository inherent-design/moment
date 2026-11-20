import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {installFormal} from '../scripts/formal-install.mjs';

async function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'moment-formal-install-')),payload=join(root,'payload');mkdirSync(join(payload,'bundle/bin'),{recursive:true});writeFileSync(join(payload,'bundle/bin/tool'),'verified native fixture\n');
 const bytes=execFileSync('tar',['-czf','-','-C',payload,'bundle']),checksum=createHash('sha256').update(bytes).digest('hex');let requests=0;
 const server=createServer((_request,response)=>{requests++;response.end(bytes);});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});});
 const tools=join(root,'tools'),input={tools,name:'fixture',version:'1',url:'http://127.0.0.1:'+server.address().port,checksum,extracted:'bundle',validate:path=>assert.equal(readFileSync(join(path,'bin/tool'),'utf8'),'verified native fixture\n')};
 return {root,tools,input,requests:()=>requests};
}
test('formal setup streams a pinned archive, publishes complete bytes and leaves existing installs untouched',async t=>{
 const f=await fixture(t),result=await installFormal(f.input);assert.equal(result.state,'installed');assert.equal(result.sha256,f.input.checksum);assert.ok(lstatSync(result.path).isSymbolicLink());f.input.validate(result.path);
 assert.equal((await installFormal(f.input)).state,'existing');assert.equal(f.requests(),1);assert.ok(!existsSync(result.path+'.install-lock'));
 const other=join(f.tools,'existing');mkdirSync(other);assert.equal((await installFormal({...f.input,name:'existing'})).state,'existing');assert.ok(!lstatSync(other).isSymbolicLink());assert.equal(f.requests(),1);
});
test('wrong digests, failed validation and a competing publication never replace a destination',async t=>{
 const f=await fixture(t);
 await assert.rejects(installFormal({...f.input,checksum:'0'.repeat(64)}),/SHA-256 differs/);assert.deepEqual(readdirSync(f.tools),[]);
 await assert.rejects(installFormal({...f.input,validate:()=>{throw Error('invalid native version');}}),/invalid native version/);assert.deepEqual(readdirSync(f.tools),[]);
 const destination=join(f.tools,'fixture');
 await assert.rejects(installFormal({...f.input,validate:path=>{f.input.validate(path);writeFileSync(destination,'another writer');}}),{code:'EEXIST'});
 assert.equal(readFileSync(destination,'utf8'),'another writer');assert.deepEqual(readdirSync(f.tools),['fixture']);
});
test('actual setup interruption retains its unpublished bundle and refuses uncertain recovery',async t=>{
 const f=await fixture(t),module=new URL('../scripts/formal-install.mjs',import.meta.url).href;
 const source=`import {installFormal} from ${JSON.stringify(module)};await installFormal({...JSON.parse(process.argv[1]),validate:async()=>{process.stdout.write('ready\\n');await new Promise(resolve=>setTimeout(resolve,60000));}});`;
 const {validate:_validate,...input}=f.input,child=spawn(process.execPath,['--input-type=module','-e',source,JSON.stringify(input)],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned setup did not reach publication boundary')),10000);child.stdout.once('data',data=>{clearTimeout(timer);assert.match(String(data),/ready/);resolve();});child.once('error',reject);});
 const exit=once(child,'exit');child.kill('SIGKILL');const [_code,signal]=await exit;assert.equal(signal,'SIGKILL');assert.equal(existsSync(join(f.tools,'fixture')),false);assert.ok(existsSync(join(f.tools,'fixture.install-lock/owner.json')));
 await assert.rejects(installFormal(f.input),/active or interrupted/);assert.equal(f.requests(),1);assert.equal(readdirSync(f.tools).length,2);
});
