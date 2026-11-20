import { writeFileSync,openSync,closeSync,fsyncSync,linkSync,unlinkSync,renameSync,fstatSync,readSync,constants } from 'node:fs';
import { dirname,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './json.mjs';
import { parseJson } from './wire.mjs';

/** Bounded private JSON custody without following a file symlink. */
export function readPrivateBytes(filename,maximumBytes=65536) {
  if(!isAbsolute(filename)) fail('INVALID_ARGUMENT','Private input paths must be absolute');
  const fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.uid!==process.getuid() || stat.mode&0o077 || stat.size>maximumBytes) fail('UNAUTHENTICATED','Private input must be an owned regular file within its bound');
    const bytes=Buffer.alloc(maximumBytes+1);let length=0,count;
    while(length<bytes.length && (count=readSync(fd,bytes,length,bytes.length-length,null)))length+=count;
    if(length>maximumBytes)fail('LIMIT_EXCEEDED','Private input grew beyond its bound');
    return bytes.subarray(0,length);
  } finally {closeSync(fd);}
}

export function readPrivateJson(filename,maximumBytes=65536) {
  const bytes=readPrivateBytes(filename,maximumBytes);
  try{return parseJson(new TextDecoder('utf8',{fatal:true}).decode(bytes));}
  catch{fail('INVALID_ARGUMENT','Private input is not valid JSON');}
}

/** Publish a complete private file exclusively; never expose a partial identity. */
export function publishPrivate(filename,bytes) {
  const temporary=filename+'.'+randomUUID()+'.publishing';
  try {
    writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});
    const fd=openSync(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {fsyncSync(fd);} finally {closeSync(fd);}
    linkSync(temporary,filename);
    const directory=openSync(dirname(filename),constants.O_RDONLY);
    try {fsyncSync(directory);} finally {closeSync(directory);}
  } finally {try {unlinkSync(temporary);} catch(error) {if(error.code!=='ENOENT') throw error;}}
}

/** Replace caller-owned private recovery state after syncing bytes and directory. */
export function replacePrivate(filename,bytes) {
  const temporary=filename+'.'+randomUUID()+'.publishing';
  try {
    writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});
    const fd=openSync(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {fsyncSync(fd);} finally {closeSync(fd);}
    renameSync(temporary,filename);
    const directory=openSync(dirname(filename),constants.O_RDONLY);
    try {fsyncSync(directory);} finally {closeSync(directory);}
  } finally {try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
