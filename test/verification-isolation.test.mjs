import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,readlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {stop} from './daemon-fixture.mjs';
import {startNative} from '../verification/native-session.mjs';
import {openCodexTransport} from '../runtime/codex-transport.mjs';

test('verification script mode owns its home and alias without inheriting credentials',t=>{
 const root=mkdtempSync(join(tmpdir(),'moment-isolation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const home=join(root,'parent');mkdirSync(home);const missing=join(root,'missing');symlinkSync(missing,join(home,'.moment'));
 const report=join(root,'report.json'),script=join(root,'probe.mjs');
 writeFileSync(script,"import {writeFileSync,realpathSync,readFileSync} from 'node:fs';const home=process.env.HOME;const selected=realpathSync(home+'/.moment');writeFileSync(process.argv[2],JSON.stringify({home,codexHome:process.env.CODEX_HOME,aliasSelected:selected,registry:JSON.parse(readFileSync(selected+'/registry.json')).formatVersion,apiKey:process.env.OPENAI_API_KEY??null,credential:process.env.MOMENT_CREDENTIAL_FILE??null}));");
 const runner=fileURLToPath(new URL('../scripts/test.mjs',import.meta.url)),result=spawnSync(process.execPath,[runner,'--script',script,report],{env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:join(home,'codex'),OPENAI_API_KEY:'owned-secret-sentinel',MOMENT_CREDENTIAL_FILE:join(home,'credential.json')},encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);const observed=JSON.parse(readFileSync(report,'utf8'));assert.notEqual(observed.home,home);assert.notEqual(observed.codexHome,join(home,'codex'));assert.equal(observed.registry,1);assert.equal(observed.apiKey,null);assert.equal(observed.credential,null);assert.equal(readlinkSync(join(home,'.moment')),missing);assert.equal(existsSync(observed.home),false,'Successful runner removes its owned home');
});

test('owned daemon cleanup returns after an already observed exit',{timeout:5000},async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 try{await stop(child);assert.ok(child.exitCode!==null||child.signalCode!==null);await stop(child);}finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});

for(const [label,start] of [['qualification',startNative],['runtime',openCodexTransport]])test(label+' retirement waits for inherited channel custody after the parent exits',{timeout:5000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'moment-retirement-')),marker=join(root,'settled'),binary=join(root,'owned-codex');let native;
 t.after(async()=>{await native?.close();if(native && (!native.child.stdout.closed || !native.child.stderr.closed))await once(native.child,'close');rmSync(root,{recursive:true,force:true});});
 const writer="import {writeFileSync} from 'node:fs';process.stdout.write('ready');setTimeout(()=>{writeFileSync(process.argv[1],'settled');process.exit(0)},300);";
 const script="import readline from 'node:readline';import {spawn} from 'node:child_process';let stopping=false;process.on('SIGTERM',()=>{if(stopping)return;stopping=true;const writer=spawn(process.execPath,['--input-type=module','-e',"+JSON.stringify(writer)+","+JSON.stringify(marker)+"],{stdio:['ignore','pipe','inherit']});writer.stdout.once('data',()=>process.exit(0));});readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!Object.hasOwn(m,'id'))return;console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='account/read'?{account:null}:{userAgent:'owned-retirement-fixture'}}));});";
 writeFileSync(binary,'#!'+process.execPath+'\n'+script,{mode:0o700});
 native=await start({binary,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},workspace:root});
 await native.close();
 assert.equal(readFileSync(marker,'utf8'),'settled','Parent exit alone does not release inherited output/file custody');
 assert.equal(native.child.stderr.closed,true);await native.close();
});
