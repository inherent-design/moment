import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configuredMemoryLimits} from '../runtime/memory-settings.mjs';

test('optional operator limits preserve defaults without initializing a root and keep presentation separate from read ceilings',t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-limits-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const defaults=configuredMemoryLimits(root);assert.equal(defaults.maxAutomaticBytes,4096);assert.equal(defaults.maxWorkingSets,8);assert.equal(existsSync(join(root,'runtime')),false);
  mkdirSync(join(root,'runtime'),{mode:0o700});const path=join(root,'runtime/session-memory-limits.json');
  writeFileSync(path,JSON.stringify({formatVersion:1,limits:{maxAutomaticBytes:2048,maxWorkingSets:3}}),{mode:0o600});
  const result=configuredMemoryLimits(root);assert.equal(result.maxAutomaticBytes,2048);assert.equal(result.maxWorkingSets,3);assert.equal(result.maxSourceBytes,65536);assert.equal(existsSync(join(root,'runtime/session-memory.sqlite')),false);
});

test('unknown settings and invalid capacities refuse without rewriting operator configuration',t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-invalid-limits-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'runtime'),{mode:0o700});const path=join(root,'runtime/session-memory-limits.json');
  for(const config of [{formatVersion:2,limits:{}},{formatVersion:1,limits:{maxAutomaticBytes:1}},{formatVersion:1,limits:{maxWorkingSets:65}},{formatVersion:1,limits:{modelTokens:100}},{formatVersion:1,limits:null}]){
    const bytes=JSON.stringify(config);writeFileSync(path,bytes,{mode:0o600});assert.throws(()=>configuredMemoryLimits(root),{code:'INVALID_ARGUMENT'});assert.equal(readFileSync(path,'utf8'),bytes);
  }
});
