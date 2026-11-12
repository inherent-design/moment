import { writeFileSync,openSync,closeSync,fsyncSync,linkSync,unlinkSync,constants } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

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
