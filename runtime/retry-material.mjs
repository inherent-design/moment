import { mkdirSync, readdirSync, lstatSync, readFileSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, bytesDigest, fail } from './json.mjs';
import { publishPrivate } from './private-files.mjs';

/** Retained ambiguity is recovery state, never a disposable log or replay queue. */
export function retainRequest(root,request) {
  const original={jsonrpc:'2.0',id:request.id,method:request.method,params:request.params};
  const bytes=canonical(original)+'\n';
  if(Buffer.byteLength(bytes)>1048577) fail('LIMIT_EXCEEDED','Exact retry material exceeds the admitted frame bound; retain the original caller input');
  const requestDigest=bytesDigest(bytes),directory=join(root,'runtime/retries');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=lstatSync(directory);
  if(!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077) fail('FORBIDDEN','Retry storage must be private and owned');
  const requestFile=join(directory,requestDigest.slice(7)+'.json');
  const lock=join(directory,'.publication-lock');
  try {mkdirSync(lock,{mode:0o700});}
  catch {fail('CAPABILITY_UNAVAILABLE','Retry publication is busy or interrupted; retain the original caller request and inspect recovery state');}
  try {
    try {
      const stat=lstatSync(requestFile);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077 || stat.size>1048577 || readFileSync(requestFile,'utf8')!==bytes) fail('IDENTITY_CONFLICT','Existing retry material differs; preserve and inspect it');
    } catch(error) {
      if(error.code!=='ENOENT') throw error;
      if(readdirSync(directory).filter(name=>name!=='.publication-lock').length>=64) fail('LIMIT_EXCEEDED','Retry storage is full; reconcile retained requests before adding more');
      publishPrivate(requestFile,bytes);
    }
  } finally {rmdirSync(lock);}
  return {requestFile,requestDigest,bytes:Buffer.byteLength(bytes),method:original.method};
}
