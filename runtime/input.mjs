import { createReadStream } from 'node:fs';
import { parseJson } from './wire.mjs';
import { fail } from './json.mjs';

/** Explicit command input; bounded before decoding or creating any store state. */
export async function readJsonInput(source) {
  const stream=source==='-'?process.stdin:createReadStream(source),chunks=[];let size=0;
  for await (const chunk of stream) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;
    if (size>1048576) fail('LIMIT_EXCEEDED','JSON input exceeds the 1 MiB byte limit');
    chunks.push(bytes);
  }
  let text;
  try { text=new TextDecoder('utf-8',{ fatal:true,ignoreBOM:true }).decode(Buffer.concat(chunks)); }
  catch { throw new SyntaxError('JSON input must be valid UTF-8'); }
  return parseJson(text);
}
