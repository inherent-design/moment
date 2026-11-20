import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const regular=path=>{const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw Error('Semantic inputs must be regular files');return readFileSync(path);};
export function semanticSources(root) {
 const paths=['toolchain.json','runtime/semantic-manifest.mjs','runtime/semantic-core.mjs','runtime/json.mjs','scripts/core-tools.mjs','scripts/build-core.mjs','scripts/core-correspondence.mjs','scripts/setup-formal.mjs','scripts/formal-install.mjs'];
 const walk=directory=>{for(const entry of readdirSync(join(root,directory),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const path=directory+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Semantic sources cannot be symlinks');if(entry.isDirectory())walk(path);else if(/\.(bend|lean)$/.test(entry.name))paths.push(path);}};
 for(const directory of ['core','proof'])walk(directory);
 return paths.sort().map(path=>({path,digest:hash(regular(join(root,path)))}));
}
export function verifySemanticBuild(root) {
 const pins=JSON.parse(regular(join(root,'toolchain.json'))),manifest=JSON.parse(regular(join(root,'runtime/generated/semantics.json')));
 if(pins.abiVersion!==1||manifest.abiVersion!==1)throw Error('Unsupported semantic core ABI');
 if(manifest.formatVersion!==1||manifest.compiler?.version!==pins.bend.version||JSON.stringify(manifest.sources)!==JSON.stringify(semanticSources(root))||manifest.output?.path!=='runtime/generated/semantics.mjs'||manifest.output.digest!==hash(regular(join(root,manifest.output.path))))throw Error('Executable core is stale; run pnpm build:core');
 return manifest;
}
