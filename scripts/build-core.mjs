import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {root,pins,formalTools} from './core-tools.mjs';
import {semanticSources,verifySemanticBuild} from '../runtime/semantic-manifest.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const output='runtime/generated/semantics.mjs',manifestName='runtime/generated/semantics.json';
const current=()=>semanticSources(root);
const unchanged=sources=>{if(JSON.stringify(current())!==JSON.stringify(sources))throw Error('Semantic inputs changed during qualification; previous executable and manifest were not updated');};
function put(directory,path,bytes) {mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),bytes);}
function snapshot(sources) {
 const directory=mkdtempSync(join(tmpdir(),'moment-semantics-'));
 try {
  for(const source of sources){const bytes=readFileSync(join(root,source.path));if(hash(bytes)!==source.digest)throw Error('Semantic inputs changed during qualification: '+source.path);put(directory,source.path,bytes);}
  unchanged(sources);return directory;
 }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
const command=process.argv[2]??'check';
if(command==='build') {
 const tools=formalTools(),sources=current(),directory=snapshot(sources);
 try {
  const generated=join(directory,'emitted.mjs');
  tools.invoke(tools.bend,[join(directory,'core/semantics.bend'),'-o',generated],{cwd:directory});
  const bytes=readFileSync(generated),manifest={formatVersion:1,abiVersion:pins.abiVersion,compiler:{name:'Bend',version:pins.bend.version},sources,output:{path:output,digest:hash(bytes)},claim:'Compiled executable core; proof verdict and native correspondence are separately qualified evidence'};
  // Compile copied, digest-checked inputs: pre/post hashing alone misses ABA.
  // Readers independently verify both files, so interrupted publication refuses.
  unchanged(sources);writeFileSync(join(root,output),bytes);writeFileSync(join(root,manifestName),JSON.stringify(manifest,null,2)+'\n');
  console.log('Built the source-bound Bend executable core from frozen inputs');
 }finally{rmSync(directory,{recursive:true,force:true});}
} else if(command==='check') {
 verifySemanticBuild(root);console.log('Checked exact core/model/toolchain inputs and emitted executable identity');
} else if(command==='prove') {
 const manifest=verifySemanticBuild(root),tools=formalTools(),directory=snapshot(manifest.sources);
 try {
  for(const path of [output,manifestName])put(directory,path,readFileSync(join(root,path)));
  if(JSON.stringify(verifySemanticBuild(directory))!==JSON.stringify(manifest))throw Error('Executable identity changed before proof qualification');
  const bend=tools.invoke(tools.bend,['core/PROOF.bend','--verdict'],{cwd:directory});
  if(!bend.includes('ALL PROOFS CHECK')||bend.includes('SOME PROOFS FAIL'))throw Error('Bend kernel verdict did not accept every law\n'+bend);
  const lean=tools.invoke(tools.lean,['--run','proof/Moment.lean'],{cwd:directory});
  const {checkCorrespondence,checkAxioms,checkModelDiagnostics}=await import(pathToFileURL(join(directory,'scripts/core-correspondence.mjs')).href);
  checkModelDiagnostics(lean);
  const declarations=[...readFileSync(join(directory,'proof/Moment.lean'),'utf8').matchAll(/^#print axioms ([\w.]+)$/gm)].map(m=>m[1].startsWith('Moment.')?m[1]:'Moment.'+m[1]);
  if(!declarations.length)throw Error('No declared Lean claims to audit');
  const audits=checkAxioms(lean,declarations),correspondence=checkCorrespondence(lean);
  unchanged(manifest.sources);if(JSON.stringify(verifySemanticBuild(root))!==JSON.stringify(manifest))throw Error('Executable identity changed during proof qualification');
  console.log(bend.trim());console.log('Declared Lean dependency audit: '+JSON.stringify(audits));console.log('Native/Lean correspondence: '+JSON.stringify(correspondence));
  console.log('Qualified frozen semantic snapshot: '+hash(JSON.stringify({sources:manifest.sources,output:manifest.output})));
 }finally{rmSync(directory,{recursive:true,force:true});}
} else throw Error('Use build, check or prove');
