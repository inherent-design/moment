import {readFileSync,mkdirSync,existsSync,mkdtempSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root,pins,formalTools} from './core-tools.mjs';
const platform=process.platform+'-'+process.arch;
if(!pins.bend.sha256[platform]||!pins.lean.sha256[platform])throw Error('Pinned formal tools support macOS/Linux on arm64/x64');
const scratch=mkdtempSync(join(tmpdir(),'moment-toolchain-'));mkdirSync(join(root,'.tools'),{recursive:true});
async function install(tool,destination,url,checksum,extracted,entries) {
 if(existsSync(destination)){console.log(tool+' already present; existing installation preserved');return;}
 const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(tool+' release HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==checksum)throw Error(tool+' archive SHA-256 differs from pin');
 const archive=join(scratch,tool+'.archive');writeFileSync(archive,bytes,{flag:'wx'});execFileSync('tar',['-xf',archive,'-C',scratch]);
 mkdirSync(destination,{recursive:true});for(const entry of entries)cpSync(join(scratch,extracted,entry),join(destination,entry),{recursive:true});console.log(tool+' installed from pinned SHA-256 archive');
}
try {
 await install('Bend',join(root,'.tools/bend'),`https://github.com/bendlang/bend/releases/download/v${pins.bend.version}/bend-${pins.bend.version}-${platform}.tar.gz`,pins.bend.sha256[platform],'bend',['bin','bend2','guide']);
 const leanName='lean-'+pins.lean.version+'-'+process.platform+(process.arch==='arm64'?'_aarch64':'');
 await install('Lean',join(root,'.tools/lean'),`https://github.com/leanprover/lean4/releases/download/v${pins.lean.version}/${leanName}.tar.zst`,pins.lean.sha256[platform],leanName,['bin','lib','include','share','src']);
 formalTools();
}finally{rmSync(scratch,{recursive:true,force:true});}
