import {join} from 'node:path';
import {replacePrivate,readPrivateJson} from './private-files.mjs';
import {canonical,fail} from './json.mjs';

const filename=root=>join(root,'runtime/session-memory-enrollment.json');
const validSession=session=>session && typeof session==='object' && Object.keys(session).length===2 && ['runtimeId','sessionId'].every(key=>typeof session[key]==='string' && session[key].length>0 && Buffer.byteLength(session[key])<=256);
/** Hint only: the service rechecks subscription identity/revision during admission. */
export function publishEnrollment(root,systemId,subscriptions) {
  const enabled=subscriptions.filter(item=>item.enabled).map(({session,revision})=>({session,revision}));
  if(enabled.length>128)fail('LIMIT_EXCEEDED','Native enrollment projection exceeds its session bound');
  replacePrivate(filename(root),canonical({formatVersion:1,systemId,enabled})+'\n');
}
export function enrollmentHint(root,systemId,session) {
  let value;
  try{value=readPrivateJson(filename(root),131072);}
  catch(error){if(error.code==='ENOENT')return undefined;throw error;}
  if(value?.formatVersion!==1 || value.systemId!==systemId || !Array.isArray(value.enabled) || value.enabled.length>128 || Object.keys(value).some(key=>!['formatVersion','systemId','enabled'].includes(key)))fail('UNSUPPORTED_VERSION','Session enrollment projection needs inspection');
  const seen=new Set();
  for(const item of value.enabled) {
    if(!validSession(item?.session) || Object.keys(item).some(key=>!['session','revision'].includes(key)) || !Number.isSafeInteger(item.revision) || item.revision<1)fail('INVALID_ARGUMENT','Invalid session enrollment hint');
    const key=canonical(item.session);if(seen.has(key))fail('IDENTITY_CONFLICT','Duplicate session enrollment hint');seen.add(key);
  }
  return value.enabled.find(item=>item.session.runtimeId===session.runtimeId && item.session.sessionId===session.sessionId);
}
