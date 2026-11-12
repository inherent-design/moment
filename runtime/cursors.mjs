import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canonical, fail } from './json.mjs';
const key=value=>createHash('sha256').update(value).digest();
export function sealCursor(value,secret) {
  const encoded=Buffer.from(canonical(value));
  if (encoded.length>1024) fail('LIMIT_EXCEEDED','Cursor metadata exceeds its envelope');
  const plain=Buffer.alloc(1024,32);encoded.copy(plain);
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),nonce);
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  return 'v1.'+Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function openCursor(value,secret) {
  if (!value.startsWith('v1.')) fail('CURSOR_EXPIRED','Cursor format changed; start a fresh query','refresh');
  try {
    const text=value.slice(3);if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error();
    const bytes=Buffer.from(text,'base64url');if (bytes.length!==1052) throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',key(secret),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
  } catch { fail('INVALID_ARGUMENT','Invalid cursor'); }
}
