import {readFileSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifySource,verifyPublicationTag} from './release-source.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
const regular=path=>{const st=lstatSync(path);if(st.isSymbolicLink()||!st.isFile())throw Error('Release inputs must be regular files');return readFileSync(path);};
export function verifyPackage(directory) {
 const pkg=JSON.parse(regular(join(directory,'package.json'))),report=JSON.parse(regular(join(directory,'dist/package-verification.json'))),catalog=JSON.parse(regular(join(directory,'runtime/generated/bindings.json')));
 if(pkg.name!=='@inherent.design/moment'||pkg.license!=='Apache-2.0'||pkg.private||!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/.test(pkg.version))throw Error('Release identity or version is not qualified');
 const archive='dist/inherent.design-moment-'+pkg.version+'.tgz';
 if(report.name!==pkg.name||report.version!==pkg.version||report.archive!==archive||JSON.stringify(report.catalog)!==JSON.stringify(catalog.identity)||report.sourceCount!==catalog.sources.length)throw Error('Release receipt disagrees with the source/catalog');
 if(report.qualifierDigest!=='sha256:'+hash(regular(join(directory,'scripts/check-package.mjs'))))throw Error('Package qualification changed; requalify the exact archive before publishing');
 const bytes=regular(join(directory,archive));
 if(report.sha256!==hash(bytes)||report.integrity!=='sha512-'+hash(bytes,'sha512')||report.bytes!==bytes.length)throw Error('Release archive differs from the qualified bytes');
 const source=verifySource(directory,report.sourceSnapshot);
 return {name:pkg.name,version:pkg.version,archive,sha256:report.sha256,integrity:report.integrity,sourceRevision:source.revision,platform:report.platform,arch:report.arch};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const mode=process.argv[2];if(!['--check','--publish'].includes(mode)||process.argv.length!==3)throw Error('Use --check, or --publish inside the authorized tag workflow');
 const report=verifyPackage(root);console.log(JSON.stringify(report));
 if(mode==='--publish') {
  verifyPublicationTag(root,report);
  const result=spawnSync('pnpm',['publish',report.archive,'--access','public','--tag','preview','--provenance','--no-git-checks','--ignore-scripts','--skip-manifest-obfuscation','--publish-wait-timeout','900000','--json'],{cwd:root,stdio:'inherit'});
  if(result.error||result.status!==0)throw Error('Publication was refused or uncertain; reconcile the exact version/integrity before retrying');
 }
}
