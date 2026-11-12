import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,readdirSync,mkdirSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainRequest } from '../runtime/retry-material.mjs';

test('retry retention has an exact private bounded identity and preserves interrupted publication evidence',t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-retry-files-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const request={id:'retained',method:'graph.transact',params:{expectedRevision:1,idempotencyKey:'keep'},token:'never-copy-this'};
  const first=retainRequest(root,request);assert.deepEqual(retainRequest(root,request),first);
  assert.equal(readFileSync(first.requestFile,'utf8').includes('never-copy-this'),false);
  const directory=join(root,'runtime/retries');
  for(let n=1;n<64;n++) retainRequest(root,{...request,id:String(n)});
  assert.equal(readdirSync(directory).length,64);
  assert.throws(()=>retainRequest(root,{...request,id:'overflow'}),{code:'LIMIT_EXCEEDED'});
  assert.equal(readdirSync(directory).length,64);
  mkdirSync(join(directory,'.publication-lock'),{mode:0o700});
  assert.throws(()=>retainRequest(root,request),{code:'CAPABILITY_UNAVAILABLE'});
  assert.equal(readdirSync(directory).includes('.publication-lock'),true);
});

test('retry material refuses a linked recovery directory without writing through it',t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-retry-link-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const outside=join(root,'outside');mkdirSync(outside);mkdirSync(join(root,'runtime'));symlinkSync(outside,join(root,'runtime/retries'),'dir');
  assert.throws(()=>retainRequest(root,{id:'x',method:'x',params:{}}),{code:'FORBIDDEN'});
  assert.deepEqual(readdirSync(outside),[]);
});
