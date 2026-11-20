import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const scannerPin=readFileSync(join(root,'mise.security.toml'),'utf8').match(/^"aqua:aquasecurity\/trivy"\s*=\s*"([\d.]+)"$/m);
if(!scannerPin)throw Error('Security profile must own an exact Trivy pin');
const scannerVersion=scannerPin[1];
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const knownSeverity=new Set(['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL']);

/** Accept only a complete report covering every exact direct dependency. */
export function summarizeSecurity(scan,manifest) {
 if(scan?.SchemaVersion!==2||!Array.isArray(scan.Results))throw Error('Security scan report is missing or has an unsupported format');
 const dependencies=scan.Results.filter(result=>result.Class==='lang-pkgs'),packages=dependencies.flatMap(result=>result.Packages??[]);
 for(const [name,spec] of Object.entries({...manifest.dependencies,...manifest.devDependencies})) {
  const alias=spec.match(/^npm:(.+)@([^@]+)$/),actual=alias?alias[1]:name,version=alias?alias[2]:spec;
  if(!packages.some(pkg=>pkg.Name===actual&&pkg.Version===version))throw Error('Security inventory omitted a declared dependency: '+name+'@'+version);
 }
 const findings=[];
 const add=(kind,result,item,id,line)=>{
  if(typeof id!=='string'||!id||!knownSeverity.has(item.Severity)||typeof result.Target!=='string')throw Error('Security report contains an unsupported finding');
  // Explicit allowlist: never copy secret matches, code, messages or raw evidence.
  findings.push({kind,id,severity:item.Severity,target:result.Target,...(Number.isSafeInteger(line)&&line>0?{line}:{}),
   ...(kind==='vulnerability'?{package:item.PkgName,installed:item.InstalledVersion,fixed:item.FixedVersion||null}:{})});
 };
 for(const result of scan.Results) {
  for(const item of result.Vulnerabilities??[])add('vulnerability',result,item,item.VulnerabilityID);
  for(const item of result.Misconfigurations??[])if(item.Status!=='PASS')add('misconfiguration',result,item,item.ID,item.CauseMetadata?.StartLine);
  for(const item of result.Secrets??[])add('secret',result,item,item.RuleID,item.StartLine);
 }
 return {inventory:{packages:packages.length,dependencyTargets:dependencies.map(r=>({target:r.Target,type:r.Type})),configurationTargets:scan.Results.filter(r=>r.Class==='config').map(r=>({target:r.Target,type:r.Type}))},findings,blocked:findings.filter(f=>['HIGH','CRITICAL'].includes(f.severity)).length};
}

export function securityMarkdown(report) {
 const cell=value=>String(value??'').replace(/[|\r\n<>]/g,' ');
 return ['# Security qualification','',`Trivy ${report.scannerVersion}: ${report.inventory.packages} dependency entries; ${report.findings.length} findings; ${report.blocked} HIGH/CRITICAL.`,
  '','The inventory includes production and development dependencies. Misconfiguration coverage is limited to recognized configuration formats. Credential matches and source excerpts are omitted.',
  '','| Severity | Kind | Rule | File | Package / fix |','| --- | --- | --- | --- | --- |',
  ...report.findings.map(f=>`| ${cell(f.severity)} | ${cell(f.kind)} | ${cell(f.id)} | ${cell(f.target)}${f.line?':'+f.line:''} | ${f.package?cell(f.package+' '+f.installed+' → '+(f.fixed??'no fix published')):''} |`),''].join('\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv.length!==2)throw Error('Use pnpm security:scan with the pinned security mise profile');
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','XDG_CACHE_HOME','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
 const version=spawnSync('trivy',['--version','--format','json'],{env,encoding:'utf8',timeout:15000});
 if(version.error||version.status!==0)throw Error('Pinned Trivy is unavailable; run mise -E security install and mise -E security exec -- pnpm security:scan');
 let identity;try{identity=JSON.parse(version.stdout);}catch{throw Error('Trivy returned an invalid version identity');}
 if(identity.Version!==scannerVersion)throw Error('Trivy version differs from the qualified security profile');
 const scratch=mkdtempSync(join(tmpdir(),'moment-security-')),raw=join(scratch,'scan.json'),manifest=readFileSync(join(root,'package.json')),lock=readFileSync(join(root,'pnpm-lock.yaml'));
 try {
  const config=join(scratch,'config.yaml'),ignore=join(scratch,'empty.ignore');writeFileSync(config,'{}\n',{mode:0o600});writeFileSync(ignore,'',{mode:0o600});
  const args=['fs','--scanners','vuln,misconfig,secret','--include-dev-deps','--include-non-failures','--format','json','--output',raw,'--exit-code','0','--disable-telemetry','--no-progress',
   '--config',config,'--ignorefile',ignore,'--skip-dirs','.git,node_modules,.tools,dist,coverage,artifacts',root];
  const result=spawnSync('trivy',args,{cwd:root,env,stdio:['ignore','ignore','inherit'],timeout:600000});
  if(result.error||result.status!==0)throw Error('Trivy scan failed or was interrupted; no successful scan receipt was produced');
  chmodSync(raw,0o600);let parsed;try{parsed=JSON.parse(readFileSync(raw,'utf8'));}catch{throw Error('Trivy did not produce a complete JSON report');}
  const report={formatVersion:1,scannerVersion,scannedAt:new Date().toISOString(),databases:{vulnerability:identity.VulnerabilityDB??null,checks:identity.CheckBundle??null},
   inputs:{manifestDigest:hash(manifest),lockDigest:hash(lock),arguments:args.map(arg=>arg===root?'.':arg===raw?'<private-output>':arg===config?'<owned-empty-config>':arg===ignore?'<owned-empty-ignore>':arg)},...summarizeSecurity(parsed,JSON.parse(manifest))};
  if(!readFileSync(join(root,'package.json')).equals(manifest)||!readFileSync(join(root,'pnpm-lock.yaml')).equals(lock))throw Error('Dependency inputs changed during the scan');
  const output=join(root,'artifacts/security');mkdirSync(output,{recursive:true});writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');const markdown=securityMarkdown(report);writeFileSync(join(output,'summary.md'),markdown);
  if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,markdown,{flag:'a'});
  console.log(JSON.stringify({scannerVersion,packages:report.inventory.packages,findings:report.findings.length,blocked:report.blocked,report:'artifacts/security/report.json'}));
  if(report.blocked)process.exitCode=1;
 } finally {rmSync(scratch,{recursive:true,force:true});}
}
