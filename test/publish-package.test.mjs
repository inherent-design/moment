import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,unlinkSync,chmodSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyPackage} from '../scripts/publish-package.mjs';
import {captureSource,verifySource,verifyPackedSource,verifyPublicationTag} from '../scripts/release-source.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'moment-release-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const path of ['dist','scripts','runtime/generated','docs'])mkdirSync(join(root,path),{recursive:true});
 const save=(path,value)=>writeFileSync(join(root,path),JSON.stringify(value));
 const pkg={name:'@inherent.design/moment',version:'0.2.0-fixture',license:'Apache-2.0'},source=Buffer.from('Qualified implementation'),qualifier='Owned qualification fixture',bytes=Buffer.from('Qualified fixture archive identity'),archive='dist/inherent.design-moment-'+pkg.version+'.tgz';
 const catalog={identity:{digest:'fixture-catalog'},sources:[{path:'runtime/implementation.mjs',digest:'sha256:'+hash(source)}]};
 save('package.json',pkg);save('runtime/generated/bindings.json',catalog);writeFileSync(join(root,'runtime/implementation.mjs'),source);writeFileSync(join(root,'scripts/check-package.mjs'),qualifier);writeFileSync(join(root,'docs/guide.md'),'Qualified documentation');writeFileSync(join(root,'.gitignore'),'dist/\n');
 const git=args=>execFileSync('git',['-c','user.name=Moment fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath='+join(root,'no-hooks'),...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
 git(['init']);git(['add','.']);git(['commit','-m','Owned release fixture']);
 const sourceSnapshot=captureSource(root),report={name:pkg.name,version:pkg.version,archive,bytes:bytes.length,sha256:hash(bytes),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),sourceCount:1,catalog:catalog.identity,qualifierDigest:'sha256:'+hash(qualifier),sourceSnapshot,platform:'fixture',arch:'fixture'};
 save('dist/package-verification.json',report);writeFileSync(join(root,archive),bytes);
 return {root,save,pkg,source,qualifier,bytes,archive,report,git};
}

test('publication binds exact artifact and catalog; stale, substituted and changed inputs refuse',t=>{
 const {root,save,bytes,archive,report,qualifier}=fixture(t);
 assert.equal(verifyPackage(root).sha256,report.sha256);
 writeFileSync(join(root,'scripts/check-package.mjs'),'Different qualification');assert.throws(()=>verifyPackage(root),/qualification changed/);writeFileSync(join(root,'scripts/check-package.mjs'),qualifier);
 writeFileSync(join(root,archive),'Changed bytes');assert.throws(()=>verifyPackage(root),/differs from the qualified bytes/);writeFileSync(join(root,archive),bytes);
 for(const patch of [{archive:'../outside.tgz'},{version:'0.1.0'},{catalog:{digest:'other'}},{sourceCount:2},{bytes:bytes.length+1},{integrity:'sha512-other'},{sourceSnapshot:null}]){save('dist/package-verification.json',{...report,...patch});assert.throws(()=>verifyPackage(root));}
 save('dist/package-verification.json',report);const saved=readFileSync(join(root,archive));unlinkSync(join(root,archive));const other=join(root,'other.tgz');writeFileSync(other,saved);symlinkSync(other,join(root,archive));assert.throws(()=>verifyPackage(root),/regular files/);
});

test('publication refuses changed qualified source even when its catalog file and archive are untouched',t=>{
 const {root,source,report,git}=fixture(t);
 assert.equal(verifyPackage(root).sha256,report.sha256);writeFileSync(join(root,'runtime/implementation.mjs'),'Changed after qualification');
 assert.throws(()=>verifyPackage(root),/source|stale/i);
 // Git can deliberately hide a working change from its status cache. The
 // immutable blob comparison must still reject it.
 git(['update-index','--assume-unchanged','runtime/implementation.mjs']);
 assert.throws(()=>verifyPackage(root),/committed bytes/);
 writeFileSync(join(root,'runtime/implementation.mjs'),source);assert.equal(verifyPackage(root).sha256,report.sha256);
 writeFileSync(join(root,'docs/guide.md'),'Changed outside the runtime catalog');assert.throws(()=>verifyPackage(root),/source/);
});

test('qualification refuses a staged change, a new revision, changed modes and symbolic source ancestors',t=>{
 const {root,git,report}=fixture(t);
 writeFileSync(join(root,'docs/guide.md'),'Staged documentation');git(['add','docs/guide.md']);assert.throws(()=>captureSource(root),/committed and clean/);
 git(['commit','-m','New documentation']);assert.throws(()=>verifySource(root,report.sourceSnapshot),/qualified revision/);
 const current=captureSource(root);chmodSync(join(root,'runtime/implementation.mjs'),0o755);assert.throws(()=>verifySource(root,current),/source/);chmodSync(join(root,'runtime/implementation.mjs'),0o644);
 const original=readFileSync(join(root,'runtime/implementation.mjs'));rmSync(join(root,'runtime'),{recursive:true});const elsewhere=mkdtempSync(join(tmpdir(),'moment-release-linked-'));t.after(()=>rmSync(elsewhere,{recursive:true,force:true}));mkdirSync(join(elsewhere,'generated'));writeFileSync(join(elsewhere,'implementation.mjs'),original);symlinkSync(elsewhere,join(root,'runtime'));assert.throws(()=>captureSource(root));
});

test('every packed file must match frozen tracked bytes, including docs and executable mode',t=>{
 const {root,report}=fixture(t),packed=mkdtempSync(join(tmpdir(),'moment-packed-'));t.after(()=>rmSync(packed,{recursive:true,force:true}));mkdirSync(join(packed,'docs'));
 copyFileSync(join(root,'docs/guide.md'),join(packed,'docs/guide.md'));
 verifyPackedSource(packed,['package/docs/','package/docs/guide.md'],report.sourceSnapshot);
 writeFileSync(join(packed,'docs/guide.md'),'Mixed snapshot');assert.throws(()=>verifyPackedSource(packed,['package/docs/guide.md'],report.sourceSnapshot),/Packed source/);
 copyFileSync(join(root,'docs/guide.md'),join(packed,'docs/guide.md'));chmodSync(join(packed,'docs/guide.md'),0o755);assert.throws(()=>verifyPackedSource(packed,['package/docs/guide.md'],report.sourceSnapshot),/Packed source/);
 writeFileSync(join(packed,'unexpected.md'),'Untracked public payload');assert.throws(()=>verifyPackedSource(packed,['package/unexpected.md'],report.sourceSnapshot),/Packed source/);
 assert.throws(()=>verifyPackedSource(packed,['package/../outside'],report.sourceSnapshot),/Unsafe/);
});

test('publication tag and workflow commit must identify the qualified revision',t=>{
 const {root,pkg,git}=fixture(t),report=verifyPackage(root),env={GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v'+pkg.version,GITHUB_SHA:report.sourceRevision};
 git(['tag','v'+pkg.version]);verifyPublicationTag(root,report,env);
 assert.throws(()=>verifyPublicationTag(root,report,{...env,GITHUB_REF_TYPE:'branch'}),/matching/);
 assert.throws(()=>verifyPublicationTag(root,report,{...env,GITHUB_SHA:'0'.repeat(40)}),/qualified source/);
 git(['commit','--allow-empty','-m','Moved source']);git(['tag','-f','v'+pkg.version]);assert.throws(()=>verifyPublicationTag(root,report,env),/qualified source/);
});
