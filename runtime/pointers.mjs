import { fail } from './json.mjs';
export function tokens(pointer) {
  if (pointer==='') return [];
  if (!pointer.startsWith('/') || /~(?![01])/.test(pointer)) fail('INVALID_ARGUMENT','Invalid JSON Pointer');
  const path=pointer.slice(1).split('/').map(token=>token.replace(/~1/g,'/').replace(/~0/g,'~'));
  if (path.length>64) fail('LIMIT_EXCEEDED','JSON Pointer exceeds the depth limit');
  return path;
}
export function select(value,pointer) {
  let node=value;
  for (const token of tokens(pointer)) {
    if (node===null || typeof node!=='object' || !Object.hasOwn(node,token)) return { found:false };
    node=node[token];
  }
  return { found:true,value:node };
}
export function bindInput(literal,bindings,environment) {
  const output=structuredClone(literal),keys=Object.keys(bindings);
  for (let i=0;i<keys.length;i++) for (let j=i+1;j<keys.length;j++) {
    const a=tokens(keys[i]),b=tokens(keys[j]);
    if (a.every((token,index)=>b[index]===token) || b.every((token,index)=>a[index]===token)) fail('INVALID_ARGUMENT','Overlapping input binding paths');
  }
  let result=output;
  for (const [pointer,name] of Object.entries(bindings)) {
    if (!Object.hasOwn(environment,name)) fail('INVALID_ARGUMENT','Input binding is unavailable');
    const path=tokens(pointer);
    if (!path.length) { result=structuredClone(environment[name]);continue; }
    const parent=select(result,'/'+path.slice(0,-1).map(token=>token.replace(/~/g,'~0').replace(/\//g,'~1')).join('/'));
    const target=path.length===1?result:parent.value,key=path.at(-1);
    if ((path.length>1 && !parent.found) || target===null || typeof target!=='object' || !Object.hasOwn(target,key)) fail('INVALID_ARGUMENT','Input binding path does not exist');
    Object.defineProperty(target,key,{ value:structuredClone(environment[name]),enumerable:true,writable:true,configurable:true });
  }
  return result;
}
