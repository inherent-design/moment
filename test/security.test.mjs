import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSecurity,securityMarkdown} from '../scripts/check-security.mjs';

const manifest={dependencies:{prod:'1.0.0'},devDependencies:{dev:'2.0.0',compiler:'npm:typescript@6.0.2'}};
const inventory={Target:'pnpm-lock.yaml',Class:'lang-pkgs',Type:'pnpm',Packages:[{Name:'prod',Version:'1.0.0'},{Name:'dev',Version:'2.0.0'},{Name:'typescript',Version:'6.0.2'}]};
test('security qualification refuses incomplete production, development or alias inventories',()=>{
 assert.equal(summarizeSecurity({SchemaVersion:2,Results:[inventory]},manifest).inventory.packages,3);
 for(const missing of [undefined,{}, {SchemaVersion:2}, {SchemaVersion:2,Results:[]}])assert.throws(()=>summarizeSecurity(missing,manifest));
 for(let i=0;i<3;i++)assert.throws(()=>summarizeSecurity({SchemaVersion:2,Results:[{...inventory,Packages:inventory.Packages.filter((_p,n)=>n!==i)}]},manifest),/omitted a declared dependency/);
});
test('public security output omits raw secret text and keeps real high severity findings',()=>{
 const secret='sensitive-fixture-sentinel',scan={SchemaVersion:2,Results:[inventory,{Target:'settings.json',Secrets:[{RuleID:'fixture-key',Severity:'HIGH',StartLine:7,Match:secret,Title:secret,Code:{Lines:[{Content:secret}]}}]},{Target:'config.yml',Class:'config',Misconfigurations:[{ID:'config-check',Severity:'MEDIUM',Status:'PASS'},{ID:'missing-bound',Severity:'HIGH',Status:'FAIL',CauseMetadata:{StartLine:2}},{ID:'unadmitted-suppression',Severity:'HIGH',Status:'EXCEPTION'}]}]};
 const report={scannerVersion:'fixture',...summarizeSecurity(scan,manifest)};
 assert.equal(report.blocked,3);assert.equal(report.findings.length,3);assert.ok(!JSON.stringify(report).includes(secret));assert.ok(!securityMarkdown(report).includes(secret));assert.match(securityMarkdown(report),/fixture-key/);assert.ok(report.findings.some(f=>f.id==='unadmitted-suppression'));
 assert.throws(()=>summarizeSecurity({...scan,Results:[inventory,{Target:'x',Secrets:[{RuleID:'x',Severity:'UNRECOGNIZED'}]}]},manifest),/unsupported finding/);
});
