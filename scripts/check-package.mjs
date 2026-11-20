import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {exposedOperations} from '../runtime/bindings.mjs';
import {openHome} from '../runtime/home.mjs';
import {captureSource,verifySource,verifyPackedSource} from './release-source.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(readFileSync(join(root,'package.json'))),dist=join(root,'dist');
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
const scratch=mkdtempSync(join(tmpdir(),'moment-pkg-')),home=join(scratch,'s'),recipient=join(scratch,'recipient');
const recipientHome=join(scratch,'home');mkdirSync(recipientHome,{mode:0o700});openHome({home:recipientHome,override:join(scratch,'primary')});
const env=Object.fromEntries(Object.entries({PATH:process.env.PATH,HOME:recipientHome,CODEX_HOME:join(scratch,'codex'),USER:process.env.USER,LOGNAME:process.env.LOGNAME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,MOMENT_HOME:home}).filter(([,v])=>v!==undefined));
function run(command,args,cwd=root){return execFileSync(command,args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:8*1024*1024});}
mkdirSync(dist,{recursive:true});
const archive=join(dist,pkg.name.replace('@','').replace('/','-')+'-'+pkg.version+'.tgz');
const checks=[];let client,transport,installed;
try {
 const sourceSnapshot=captureSource(root);
 run('pnpm',['pack','--skip-manifest-obfuscation','--out',archive]);
 const inventory=run('tar',['-tzf',archive]).trim().split('\n');
 assert.ok(inventory.every(p=>p.startsWith('package/')&&!p.split('/').includes('..')),'Non-package archive path');
 assert.ok(inventory.every(p=>!/(^|\/)(node_modules|\.git|\.moment|\.codex|captures|secrets)(\/|$)/.test(p)),'Private/generated archive payload');
 const extracted=join(scratch,'extracted');mkdirSync(extracted);run('tar',['-xzf',archive,'-C',extracted]);
 const packed=join(extracted,'package');
 verifyPackedSource(packed,inventory,sourceSnapshot);
 assert.deepEqual(readFileSync(join(packed,'package.json')),readFileSync(join(root,'package.json')),'Packing changed integrity-checked manifest');
 const catalog=JSON.parse(readFileSync(join(packed,'runtime/generated/bindings.json')));
 for(const source of catalog.sources){let path=resolve(packed,source.path);if(source.path==='pnpm-lock.yaml'&&!lstatSync(path,{throwIfNoEntry:false}))path=join(packed,'runtime/generated/source-lock.yaml');assert.ok(path.startsWith(packed+'/'));assert.ok(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink());assert.equal('sha256:'+hash(readFileSync(path)),source.digest,'Missing or changed packaged source: '+source.path);}
 checks.push('Archive manifest and complete catalog-source closure');
 mkdirSync(recipient);writeFileSync(join(recipient,'package.json'),JSON.stringify({name:'moment-package-recipient',private:true,type:'module',packageManager:pkg.packageManager}));
 writeFileSync(join(recipient,'pnpm-workspace.yaml'),'packages:\n  - .\nignoreScripts: true\n');
 run('pnpm',['add',archive,'--prod','--ignore-scripts'],recipient);
 installed=realpathSync(join(recipient,'node_modules',...pkg.name.split('/')));
 const bin=join(recipient,'node_modules/.bin/moment');
 assert.match(run(bin,['--help'],recipient),/moment agents/);
 assert.match(run(bin,['agents','workspace.read'],recipient),/workspace.read/);
 assert.equal(existsSync(home),false,'Offline installed discovery created personal state');
 checks.push('Production-only installation, executable CLI and offline discovery');
 transport=new StdioClientTransport({command:process.execPath,args:[join(installed,'runtime/cli.mjs'),'mcp'],env,stderr:'pipe'});
 let stderr='';transport.stderr?.on('data',b=>{stderr+=b;});
 client=new Client({name:'moment-package-check',version:pkg.version});
 await client.connect(transport);
 const tools=await client.listTools();
 assert.deepEqual(tools.tools.map(t=>t.name).sort(),exposedOperations().map(id=>'moment_'+id.replaceAll('.','_')).sort());
 assert.ok(tools.tools.some(t=>t.name==='moment_context_create'));
 assert.equal(existsSync(home),false,'MCP discovery initialized service state');
 const contextId=randomUUID();
 const created=await client.callTool({name:'moment_context_create',arguments:{id:contextId,label:'Installed package qualification',bootstrapProfile:'owner-local',idempotencyKey:randomUUID(),limits:{concurrentExecutions:1,cpuMillis:10000,memoryBytes:10000,outputBytes:10000,modelTokens:0,apiSpendMicrounits:0,currency:'USD'}}});
 assert.equal(created.structuredContent?.result?.ok,true,JSON.stringify(created));
 const module=await import(pathToFileURL(join(recipient,'node_modules',...pkg.name.split('/'),'runtime/client.mjs')));
 const domain=module.createClient(home);
 const described=await domain.call('system.describe',{protocolVersion:'0.1'});
 assert.equal(described.ok,true,JSON.stringify(described));assert.equal(described.value.catalog.digest,catalog.identity.digest);assert.equal(described.value.implementationVersion,pkg.version,'Installed domain reports the actual qualified package version');
 const read=await domain.call('context.get',{contextId});assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.value.id,contextId);
 await client.close();client=null;
 assert.equal((await domain.call('context.get',{contextId})).ok,true,'Closing bridge stopped shared service');
 const stop=JSON.parse(run(bin,['stop','--json'],recipient));assert.equal(stop.ok,true,JSON.stringify(stop));assert.equal(stop.value.retired,true);
 checks.push('Installed MCP discovery/domain call, authenticated typed client and service retirement');
 const consumer=join(recipient,'consumer.mts');
 writeFileSync(consumer,`import {createClient} from '${pkg.name}/client';\nimport type {Input} from '${pkg.name}/contracts';\nconst input:Input<'system.describe'>={protocolVersion:'0.1'};\nconst result=await createClient('/test-owned/example').call('system.describe',input);\nif(result.ok) result.value.systemId satisfies string;\n`);
 run('pnpm',['exec','tsc','--ignoreConfig','--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',consumer]);
 checks.push('Independent TypeScript client/contract exports');
 verifySource(root,sourceSnapshot);
 checks.push('Clean immutable source revision and every packed file match');
 const bytes=readFileSync(archive),report={name:pkg.name,version:pkg.version,archive:archive.slice(root.length),sha256:hash(bytes),integrity:'sha512-'+hash(bytes,'sha512'),bytes:bytes.length,catalog:catalog.identity,sourceCount:catalog.sources.length,qualifierDigest:'sha256:'+hash(readFileSync(fileURLToPath(import.meta.url))),platform:process.platform,arch:process.arch,node:process.version,pnpm:run('pnpm',['--version']).trim(),checks,inventory,limitations:['No inference, primary Codex or real personal store exercised','Optional Darwin COW helper not exercised','Qualification applies to this source/catalog, artifact and platform']};
 report.sourceSnapshot=sourceSnapshot;
 writeFileSync(join(dist,'package-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({name:report.name,version:report.version,archive:report.archive,sha256:report.sha256,integrity:report.integrity,bytes:report.bytes,sourceCount:report.sourceCount,checks}));
} finally {
 await client?.close().catch(()=>{});
 await transport?.close().catch(()=>{});
 if(installed&&existsSync(home)) {
  try {const stopped=JSON.parse(run(join(recipient,'node_modules/.bin/moment'),['stop','--json'],recipient));assert.equal(stopped.ok,true);assert.equal(stopped.value.retired,true);}
  catch(error) {throw new Error('Test-owned service retirement is unconfirmed; retained recovery at '+scratch,{cause:error});}
 }
 rmSync(scratch,{recursive:true,force:true});
}
