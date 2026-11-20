import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

test('documentation checks exclude installed tools and outputs while checking new authored files',t=>{
 const root=mkdtempSync(join(tmpdir(),'moment-doc-scope-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,body)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,body);};
 put('scripts/check-docs.mjs',readFileSync(new URL('../scripts/check-docs.mjs',import.meta.url)));
 put('contracts/index.ts',"export interface Methods {\n  'sample.read': unknown;\n}\n");
 put('contracts/evolution.ts',"export interface EvolutionMethods {\n  'sample.propose': unknown;\n}\n");
 put('docs/reference/protocol.md','# Protocol\n\n| `sample.read` | Read. |\n');
 put('docs/reference/guidance.md','# Guidance\n\n## Public operation contract\n\n| `sample.propose` | Propose. |\n');
 put('README.md','# Owned documentation\n\n[Owned](docs/owned.md#present)\n');put('docs/owned.md','# Owned\n\n## Present\n');
 for(const directory of ['.tools','.lake','artifacts','dist','coverage','node_modules','.git'])put(directory+'/vendor/README.md','[Foreign broken link](missing)\n');
 const check=()=>spawnSync(process.execPath,['scripts/check-docs.mjs'],{cwd:root,encoding:'utf8',timeout:10000});
 const valid=check();assert.equal(valid.status,0,valid.stderr);assert.match(valid.stdout,/Checked 4 Markdown files/);
 put('docs/new.md','# New authored document\n\n[Broken](missing.md)\n');
 const invalid=check();assert.equal(invalid.status,1);assert.match(invalid.stderr,/docs\/new\.md: missing\.md/);
});
