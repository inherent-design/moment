import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {root,pins,formalTools} from './core-tools.mjs';
import {installFormal} from './formal-install.mjs';
const platform=process.platform+'-'+process.arch;
if(!pins.bend.sha256[platform]||!pins.lean.sha256[platform])throw Error('Pinned formal tools support macOS/Linux on arm64/x64');
const validate=(command,version,args)=>directory=>{
 const output=execFileSync(join(directory,'bin',command),args,{encoding:'utf8',timeout:15000,env:{...process.env,BEND_NO_TELEMETRY:'1'}});
 if(!output.includes(version))throw Error(command+' extracted version differs from pin');
};
const tools=join(root,'.tools');
console.log(JSON.stringify(await installFormal({tools,name:'bend',version:pins.bend.version,url:`https://github.com/bendlang/bend/releases/download/v${pins.bend.version}/bend-${pins.bend.version}-${platform}.tar.gz`,checksum:pins.bend.sha256[platform],extracted:'bend',validate:validate('bend',pins.bend.version,['version'])})));
const leanName='lean-'+pins.lean.version+'-'+process.platform+(process.arch==='arm64'?'_aarch64':'');
console.log(JSON.stringify(await installFormal({tools,name:'lean',version:pins.lean.version,url:`https://github.com/leanprover/lean4/releases/download/v${pins.lean.version}/${leanName}.tar.zst`,checksum:pins.lean.sha256[platform],extracted:leanName,validate:validate('lean',pins.lean.version,['--version'])})));
formalTools();
