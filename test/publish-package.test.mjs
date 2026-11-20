import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPackage} from '../scripts/publish-package.mjs';

test('publication binds exact artifact and catalog; stale, substituted and changed inputs refuse',t=>{
 const root=mkdtempSync(join(tmpdir(),'moment-release-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'dist'));mkdirSync(join(root,'runtime/generated'),{recursive:true});
 const pkg={name:'@inherent.design/moment',version:'0.2.0-fixture',license:'Apache-2.0'},catalog={identity:{digest:'fixture-catalog'},sources:[{path:'fixture'}]},bytes=Buffer.from('Qualified fixture archive identity'),archive='dist/inherent.design-moment-0.2.0-fixture.tgz';
 const report={name:pkg.name,version:pkg.version,archive,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),sourceCount:1,catalog:catalog.identity,platform:'fixture',arch:'fixture'};
 const save=(path,value)=>writeFileSync(join(root,path),JSON.stringify(value));save('package.json',pkg);save('runtime/generated/bindings.json',catalog);save('dist/package-verification.json',report);writeFileSync(join(root,archive),bytes);
 assert.equal(verifyPackage(root).sha256,report.sha256);
 writeFileSync(join(root,archive),'Changed bytes');assert.throws(()=>verifyPackage(root),/differs from the qualified bytes/);writeFileSync(join(root,archive),bytes);
 for(const patch of [{archive:'../outside.tgz'},{version:'0.1.0'},{catalog:{digest:'other'}},{sourceCount:2},{bytes:bytes.length+1},{integrity:'sha512-other'}]){save('dist/package-verification.json',{...report,...patch});assert.throws(()=>verifyPackage(root));}
 save('dist/package-verification.json',report);const saved=readFileSync(join(root,archive));unlinkSync(join(root,archive));const other=join(root,'other.tgz');writeFileSync(other,saved);symlinkSync(other,join(root,archive));assert.throws(()=>verifyPackage(root),/regular files/);
});
