import {join} from 'node:path';
import {readPrivateJson} from './private-files.mjs';
import {resolveMemoryLimits} from './session-memory.mjs';
import {fail} from './json.mjs';

/** Owner-local numeric/presentation preferences, independently of provider credentials. */
export function configuredMemoryLimits(root){
  let config;
  try{config=readPrivateJson(join(root,'runtime/session-memory-limits.json'),16384);}
  catch(error){if(error.code==='ENOENT')return resolveMemoryLimits();throw error;}
  if(!config||config.formatVersion!==1||Object.keys(config).some(key=>!['formatVersion','limits'].includes(key))||!Object.hasOwn(config,'limits'))fail('INVALID_ARGUMENT','Unsupported session memory limits configuration');
  return resolveMemoryLimits(config.limits);
}
