import {createWriteStream,mkdirSync,mkdtempSync,lstatSync,readlinkSync,symlinkSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {join,relative} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

/** Private build setup: publish a complete verified bundle with exclusive symlink creation. */
export async function installFormal({tools,name,version,url,checksum,extracted,validate}) {
 if(!/^[a-z][a-z0-9-]*$/.test(name)||!/^\d[\da-z.-]*$/i.test(version)||!/^\w[\w.-]*$/.test(extracted)||!/^[a-f\d]{64}$/.test(checksum))throw Error('Invalid formal archive identity');
 const destination=join(tools,name),lock=destination+'.install-lock';mkdirSync(tools,{recursive:true});
 const exists=()=>lstatSync(destination,{throwIfNoEntry:false});
 if(exists())return {state:'existing',path:destination};
 try{mkdirSync(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('Formal setup is active or interrupted; inspect '+lock+' before recovery');throw error;}
 let bundle,selected=false;
 try {
  if(exists())return {state:'existing',path:destination};
  bundle=mkdtempSync(join(tools,name+'-'+version+'-'));
  writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid,name,version,url,checksum,bundle})+'\n',{mode:0o600,flag:'wx'});
  const response=await fetch(url,{signal:AbortSignal.timeout(600000)});if(!response.ok||!response.body)throw Error(name+' release HTTP '+response.status);
  const input=Readable.fromWeb(response.body),hash=createHash('sha256'),archive=join(bundle,'download.archive');let bytes=0;
  input.on('data',chunk=>{bytes+=chunk.length;hash.update(chunk);if(bytes>2**31)input.destroy(Error('Formal archive exceeds the 2 GiB setup bound'));});
  await pipeline(input,createWriteStream(archive,{flags:'wx',mode:0o600}));
  if(hash.digest('hex')!==checksum)throw Error(name+' archive SHA-256 differs from pin');
  const entries=execFileSync('tar',['-tf',archive],{encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024}).trim().split('\n');
  if(!entries.length||entries.some(entry=>{const path=entry.replace(/^\.\//,'');return path.split('/').includes('..')||!(path===extracted||path.startsWith(extracted+'/'));}))throw Error('Formal archive escapes its expected bundle root');
  execFileSync('tar',['-xf',archive,'-C',bundle],{timeout:600000,stdio:'pipe'});
  const target=join(bundle,extracted),stat=lstatSync(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Formal bundle root must be a regular directory');await validate(target);unlinkSync(archive);
  const pointer=relative(tools,target);
  // Exclusive creation never replaces another install, empty directory or link.
  symlinkSync(pointer,destination);selected=true;
  return {state:'installed',path:destination,sha256:checksum,bytes};
 } finally {
  // A killed process retains its lock/bundle. Never silently reclaim uncertain setup.
  if(bundle&&!selected) {
   const entry=lstatSync(destination,{throwIfNoEntry:false});
   if(entry?.isSymbolicLink()&&readlinkSync(destination)===relative(tools,join(bundle,extracted)))selected=true;
   if(!selected)rmSync(bundle,{recursive:true,force:true});
  }
  rmSync(lock,{recursive:true,force:true});
 }
}
