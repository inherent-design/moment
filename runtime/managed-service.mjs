// A detached service writes only bounded diagnostics to its private inherited log.
let remaining=65536;
for (const stream of [process.stdout,process.stderr]) {
  const write=stream.write.bind(stream);
  stream.write=(chunk,encoding,callback)=>{
    if(typeof encoding==='function') { callback=encoding;encoding=undefined; }
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding);
    const selected=bytes.subarray(0,remaining);remaining-=selected.length;
    if(selected.length) return write(selected,callback);
    if(callback) queueMicrotask(callback);return true;
  };
}
process.argv=[process.execPath,new URL('./cli.mjs',import.meta.url).pathname,'serve'];
await import('./cli.mjs');
