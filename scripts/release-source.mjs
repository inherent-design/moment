import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,args)=>execFileSync('git',['-c','core.fsmonitor=false',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}).trimEnd();
function sourceFile(root,path) {
 if(typeof path!=='string'||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe release source path');
 let current=root;
 for(const component of path.split('/')){current=join(current,component);if(lstatSync(current).isSymbolicLink())throw Error('Release source must not traverse symbolic links: '+path);}
 const stat=lstatSync(current);if(!stat.isFile())throw Error('Release source must be a regular file: '+path);
 return {bytes:readFileSync(current),mode:(stat.mode&0o111)?'100755':'100644'};
}
const body=s=>({formatVersion:s.formatVersion,revision:s.revision,tree:s.tree,files:s.files});
const identity=s=>'sha256:'+hash(JSON.stringify(body(s)));

// Qualification compares actual files with immutable Git blobs, not just Git's
// cached dirty bit. This also catches assume-unchanged and checkout races.
export function captureSource(directory) {
 const root=realpathSync(directory);
 if(realpathSync(git(root,['rev-parse','--show-toplevel']))!==root)throw Error('Release source must be the repository root');
 const revision=git(root,['rev-parse','--verify','HEAD^{commit}']),tree=git(root,['rev-parse','--verify','HEAD^{tree}']);
 if(git(root,['status','--porcelain=v1','--untracked-files=no']))throw Error('Release source must be committed and clean before qualification');
 const entries=git(root,['ls-tree','-r','-z','--full-tree',revision]).split('\0').filter(Boolean);
 const files=entries.map(entry=>{
  const separator=entry.indexOf('\t'),[mode,type,objectId]=entry.slice(0,separator).split(' '),path=entry.slice(separator+1);
  if(separator<0||type!=='blob'||!['100644','100755'].includes(mode)||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId))throw Error('Unsupported release source entry: '+path);
  const file=sourceFile(root,path),algorithm=objectId.length===40?'sha1':'sha256';
  const actual=createHash(algorithm).update(Buffer.from('blob '+file.bytes.length+'\0')).update(file.bytes).digest('hex');
  if(actual!==objectId||file.mode!==mode)throw Error('Release source disagrees with its committed bytes or mode: '+path);
  return {path,mode,objectId,digest:'sha256:'+hash(file.bytes)};
 });
 if(git(root,['rev-parse','--verify','HEAD^{commit}'])!==revision||git(root,['status','--porcelain=v1','--untracked-files=no']))throw Error('Release source changed during qualification');
 const snapshot={formatVersion:1,revision,tree,files};return {...snapshot,digest:identity(snapshot)};
}

export function verifySource(directory,snapshot) {
 if(!snapshot||snapshot.formatVersion!==1||!Array.isArray(snapshot.files)||snapshot.digest!==identity(snapshot))throw Error('Release source receipt is missing or invalid; requalify the archive');
 const current=captureSource(directory);
 if(current.digest!==snapshot.digest)throw Error('Release source differs from the qualified revision; requalify the archive');
 return current;
}

export function verifyPackedSource(directory,inventory,snapshot) {
 const files=new Map(snapshot.files.map(file=>[file.path,file]));
 for(const entry of inventory) {
  if(!entry.startsWith('package/')||entry.split('/').includes('..'))throw Error('Unsafe packed source path');
  if(entry.endsWith('/'))continue;
  const path=entry.slice('package/'.length),expected=files.get(path),actual=sourceFile(directory,path);
  if(!expected||expected.digest!=='sha256:'+hash(actual.bytes)||expected.mode!==actual.mode)throw Error('Packed source differs from the qualified revision: '+path);
 }
}

export function verifyPublicationTag(directory,report,env=process.env) {
 if(env.GITHUB_REF_TYPE!=='tag'||env.GITHUB_REF_NAME!=='v'+report.version)throw Error('Publication requires the matching immutable version tag');
 const tagged=git(directory,['rev-parse','--verify','refs/tags/'+env.GITHUB_REF_NAME+'^{commit}']);
 if(tagged!==report.sourceRevision||(env.GITHUB_SHA&&env.GITHUB_SHA!==tagged))throw Error('Release tag disagrees with the qualified source revision');
}
