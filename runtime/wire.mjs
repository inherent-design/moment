import { canonical } from './json.mjs';

/** JSON parser with duplicate-key rejection before ordinary JSON decoding. */
export function parseJson(text) {
  let index=0;
  const whitespace=()=>{ while (/[\t\r\n ]/.test(text[index] ?? 'x')) index++; };
  const string=()=>{
    const start=index++;
    while (index<text.length) {
      if (text[index]==='\\') { index+=2; continue; }
      if (text[index++]==='"') return JSON.parse(text.slice(start,index));
    }
    throw new SyntaxError('Unterminated string');
  };
  function value(depth) {
    if (depth>64) throw new SyntaxError('JSON nesting limit');
    whitespace();
    if (text[index]==='"') { string(); return; }
    if (text[index]==='{') {
      index++; whitespace();const keys=new Set();
      if (text[index]==='}') { index++;return; }
      for (;;) {
        whitespace();if (text[index]!=='"') throw new SyntaxError('Expected object key');
        const key=string();if (keys.has(key)) throw new SyntaxError('Duplicate object key');keys.add(key);
        whitespace();if (text[index++]!==':') throw new SyntaxError('Expected colon');value(depth+1);whitespace();
        const token=text[index++];if (token==='}') return;if (token!==',') throw new SyntaxError('Expected separator');
      }
    }
    if (text[index]==='[') {
      index++;whitespace();if (text[index]===']') { index++;return; }
      for (;;) { value(depth+1);whitespace();const token=text[index++];if (token===']') return;if (token!==',') throw new SyntaxError('Expected array separator'); }
    }
    const match=text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match) throw new SyntaxError('Expected JSON value'); index+=match[0].length;
  }
  value(0);whitespace();if (index!==text.length) throw new SyntaxError('Unexpected JSON suffix');
  const decoded=JSON.parse(text);
  try { canonical(decoded); } catch { throw new SyntaxError('Unsupported JSON data'); }
  return decoded;
}
