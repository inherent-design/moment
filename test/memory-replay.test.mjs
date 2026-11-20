import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {bytesDigest} from '../runtime/json.mjs';

test('owned replay retains reconstructable native preparation and exact raw evidence before settling',t=>{
  const directory=mkdtempSync(join(tmpdir(),'mrt-'));let retained;
  t.after(()=>{if(retained){assert.ok(retained.startsWith(realpathSync(tmpdir())+'/mr-'));rmSync(retained,{recursive:true,force:true});}rmSync(directory,{recursive:true,force:true});});
  const binary=join(directory,'fixture.mjs'),credentialFile=join(directory,'access.json'),cases=join(directory,'cases.json'),evidenceFile=join(directory,'evidence.json');
  writeFileSync(binary,'#!'+process.execPath+'\n'+readFileSync(new URL('./codex-memory-fixture.mjs',import.meta.url)),{mode:0o700});
  const claims=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  writeFileSync(credentialFile,JSON.stringify({tokens:{access_token:'fixture.'+claims+'.signature',account_id:'normal',refresh_token:'UNSELECTED_REFRESH_SENTINEL'}}),{mode:0o600});const before=readFileSync(credentialFile);
  writeFileSync(cases,JSON.stringify([{label:'owned-fixture',text:'Maybe keep this conditional proposal; installation stays deferred.',authorship:'unknown'}]),{mode:0o600});
  execFileSync(process.execPath,[new URL('../verification/memory-replay.mjs',import.meta.url).pathname,cases,credentialFile,binary,evidenceFile],{stdio:'pipe',timeout:15000});
  const result=JSON.parse(readFileSync(evidenceFile,'utf8'));retained=result.root;
  assert.equal(result.complete,true);assert.ok(retained,'A completed comparison must retain its source/assessment evidence, not only selected cache bodies');
  const memory=new SessionMemory(join(retained,'memory.sqlite'),result.systemId);
  try{
    const receipt=result.results[0].receipt,packet=memory.readAssessments({session:receipt.session,assessmentId:receipt.dispatchId,maximumBytes:262144});
    assert.deepEqual(packet.omittedParts,[]);assert.equal(packet.assessment.nativeProfile.version,6);assert.equal(bytesDigest(packet.assessment.rawOutput),receipt.nativeOutputDigest);assert.ok(packet.assessment.preparation.cwd);
    const native=JSON.parse(readFileSync(join(retained,'runtime/session-memory-native/jobs',receipt.dispatchId+'.json'),'utf8'));assert.equal(native.state,'committed');assert.equal(native.rawOutput,undefined);assert.equal(native.assessmentId,receipt.dispatchId);
    assert.deepEqual(readdirSync(join(retained,'runtime/session-memory-native')).filter(x=>x.startsWith('instance-')),[]);
  }finally{memory.close();}
  assert.deepEqual(readFileSync(credentialFile),before);
});
