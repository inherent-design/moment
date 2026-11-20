import {readFileSync,existsSync} from 'node:fs';
import {join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const pins=JSON.parse(readFileSync(join(root,'toolchain.json')));
export function formalTools() {
 const bend=join(process.env.MOMENT_BEND_HOME??join(root,'.tools/bend'),'bin/bend'),leanHome=process.env.MOMENT_LEAN_HOME??join(root,'.tools/lean');
 if(!existsSync(bend)||!existsSync(join(leanHome,'bin/lean')))throw Error('Formal toolchain unavailable; run pnpm setup:formal or select verified local MOMENT_BEND_HOME/MOMENT_LEAN_HOME');
 const env={...process.env,BEND_NO_TELEMETRY:'1',PATH:join(leanHome,'bin')+delimiter+(process.env.PATH??'')};
 const invoke=(command,args,{cwd=root}={})=>{const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw Error('Formal command failed: '+args.join(' ')+'\n'+r.stdout+'\n'+r.stderr,{cause:r.error});return r.stdout+r.stderr;};
 const bendVersion=invoke(bend,['version']),leanVersion=invoke(join(leanHome,'bin/lean'),['--version']);
 if(!bendVersion.includes(pins.bend.version)||!leanVersion.includes(pins.lean.version))throw Error('Formal toolchain version differs from pins');
 return {bend,lean:join(leanHome,'bin/lean'),invoke};
}
