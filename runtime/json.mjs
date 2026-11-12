import { createHash } from 'node:crypto';

export function canonical(value) {
  const seen = new Set();
  function encode(item) {
    if (typeof item === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)) throw new TypeError('Unpaired Unicode surrogate');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || seen.has(item)) throw new TypeError('Expected finite, acyclic JSON');
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) if (!Object.hasOwn(item, index)) throw new TypeError('Sparse JSON array');
      result = `[${item.map(encode).join(',')}]`;
    }
    else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new TypeError('Expected plain JSON object');
      result = `{${Object.keys(item).sort().map(key => `${encode(key)}:${encode(item[key])}`).join(',')}}`;
    }
    seen.delete(item);
    return result;
  }
  return encode(value);
}

export const digest = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
export const bytesDigest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export class DomainError extends Error {
  constructor(code, message, retry = 'never') {
    super(message);
    this.code = code;
    this.retry = retry;
  }
}
export const fail = (code, message, retry) => { throw new DomainError(code, message, retry); };
export function resultError(error) {
  if (!(error instanceof DomainError)) throw error;
  return { ok: false, error: { code: error.code, message: error.message, retry: error.retry, details: null } };
}
