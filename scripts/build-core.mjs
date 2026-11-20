import {readFileSync,writeFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {root,pins,formalTools} from './core-tools.mjs';
import {semanticSources,verifySemanticBuild} from '../runtime/semantic-manifest.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex'),out=join(root,'runtime/generated/semantics.mjs'),manifestPath=join(root,'runtime/generated/semantics.json');
export const coreSources=()=>semanticSources(root);
const checkCurrent=()=>verifySemanticBuild(root);
const command=process.argv[2]??'check';
if(command==='build') {
 const tools=formalTools(),scratch=mkdtempSync(join(tmpdir(),'moment-bend-'));
 try{const generated=join(scratch,'semantics.mjs');tools.invoke(tools.bend,['core/semantics.bend','-o',generated]);const bytes=readFileSync(generated);writeFileSync(out,bytes);writeFileSync(manifestPath,JSON.stringify({formatVersion:1,abiVersion:pins.abiVersion,compiler:{name:'Bend',version:pins.bend.version},sources:coreSources(),output:{path:'runtime/generated/semantics.mjs',digest:hash(bytes)},claim:'Compiled executable core; proof verdict and native correspondence are separately qualified evidence'},null,2)+'\n');console.log('Built the source-bound Bend executable core');}finally{rmSync(scratch,{recursive:true,force:true});}
} else if(command==='check') {
 checkCurrent();console.log('Checked exact core/model/toolchain inputs and emitted executable identity');
} else if(command==='prove') {
 const manifest=checkCurrent(),tools=formalTools(),bend=tools.invoke(tools.bend,['core/PROOF.bend','--verdict']);if(!bend.includes('ALL PROOFS CHECK')||bend.includes('SOME PROOFS FAIL'))throw Error('Bend kernel verdict did not accept every law\n'+bend);
 const lean=tools.invoke(tools.lean,['--run','proof/Moment.lean']);if(/sorryAx|warning:|error:/.test(lean))throw Error('Lean rejected a proof or its axiom audit\n'+lean);
 const {checkCorrespondence,checkAxioms}=await import('./core-correspondence.mjs');
 const declarations=[...readFileSync(join(root,'proof/Moment.lean'),'utf8').matchAll(/^#print axioms ([\w.]+)$/gm)].map(m=>m[1].startsWith('Moment.')?m[1]:'Moment.'+m[1]);
 if(!declarations.length)throw Error('No declared Lean claims to audit');const audits=checkAxioms(lean,declarations),correspondence=checkCorrespondence(lean);console.log(bend.trim());console.log('Declared Lean dependency audit: '+JSON.stringify(audits));console.log('Native/Lean correspondence: '+JSON.stringify(correspondence));
} else throw Error('Use build, check or prove');
