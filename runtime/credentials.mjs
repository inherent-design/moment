import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function bindings(value) {
  return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length<=100 && Object.entries(value).every(([context,ref])=>uuid(context) && ref && typeof ref==='object' && Object.keys(ref).length===3 && uuid(ref.systemId) && ref.contextId===context && uuid(ref.id));
}
export function readCredential(filename) {
  const stat=lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || (stat.mode & 0o077)!==0 || stat.size>16384) throw new Error('Credential must be a private user-owned regular file');
  const value=JSON.parse(readFileSync(filename,'utf8'));
  if (value.formatVersion!==1 || !uuid(value.principalId) || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error('Invalid credential format');
  return value;
}
/** Local owner operation: binds transport identity, but never creates a grant. */
export function issueCredential(root,principalId,grants) {
  const owner=readCredential(join(root,'runtime','owner.json'));
  if (!uuid(principalId) || principalId===owner.principalId || !bindings(grants)) throw new Error('A separate principal and valid context grant bindings are required');
  const directory=join(root,'runtime','credentials');mkdirSync(directory,{ recursive:true,mode:0o700 });
  if (readdirSync(directory).filter(name=>name.endsWith('.json')).length>=256) throw new Error('Credential registry is full');
  const filename=join(directory,`${randomUUID()}.json`);
  const serialized=JSON.stringify({ formatVersion:1,principalId,grants,token:randomBytes(32).toString('hex') })+'\n';
  if (Buffer.byteLength(serialized)>16384) throw new Error('Credential bindings exceed the size limit');
  writeFileSync(filename,serialized,{ flag:'wx',mode:0o600 });
  return filename;
}
export function authenticate(root,token,owner) {
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  const matches=credential=>timingSafeEqual(Buffer.from(token),Buffer.from(credential.token));
  if (matches(owner)) return owner;
  let names;try { names=readdirSync(join(root,'runtime','credentials')).filter(name=>name.endsWith('.json')); } catch(error) { if (error.code==='ENOENT') return undefined;throw error; }
  if (names.length>256) return undefined;
  for (const name of names) {
    let credential;
    try { credential=readCredential(join(root,'runtime','credentials',name)); } catch { continue; }
    if (credential.principalId!==owner.principalId && bindings(credential.grants) && matches(credential)) return credential;
  }
  return undefined;
}
