import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createManaged } from './managed.mjs';
import { catalog, catalogIdentity, exposedOperations, bindingMap, validateBoundary } from './bindings.mjs';
import { parseJson } from './wire.mjs';
import { inspectHome } from './home.mjs';
import { retainRequest } from './retry-material.mjs';

/** Framing only. The SDK owns negotiation, protocol validation and dispatch. */
function strictFrames() {
  let buffer=Buffer.alloc(0);
  return new Transform({transform(chunk,encoding,callback) {
    try {
      buffer=Buffer.concat([buffer,chunk]);
      let end;
      while((end=buffer.indexOf(10))>=0) {
        if(end>1048576) throw new Error();
        const frame=buffer.subarray(0,end);
        parseJson(new TextDecoder('utf8',{fatal:true}).decode(frame));
        this.push(buffer.subarray(0,end+1));buffer=buffer.subarray(end+1);
      }
      if(buffer.length>1048576) throw new Error();callback();
    } catch {callback(new Error('Invalid MCP frame: strict JSON, UTF-8 and 1 MiB bounds are required'));}
  },flush(callback) {callback(buffer.length?new Error('Incomplete MCP frame'):undefined);} });
}

function buildMcpServer({root,credentialFile,profile='continuity'}={}) {
  const managed=createManaged({root,credentialFile,profile});
  const server=new McpServer({name:'moment',version:catalogIdentity.implementationVersion},{instructions:catalog.instructions,capabilities:{tools:{}}});
  let active=0;
  for(const operation of exposedOperations(profile)) {
    const binding=bindingMap.get(operation);
    const inputSchema=fromJsonSchema(binding.inputSchema.document);
    // Keep exact advertised JSON Schema. Moment's shared validator performs
    // admission inside the callback so its typed domain fault survives SDK
    // presentation; the SDK continues to own protocol-envelope validation.
    const domainInput={...inputSchema,'~standard':{...inputSchema['~standard'],validate:value=>({value})}};
    server.registerTool(binding.mcpName,{
      description:[binding.summary,...binding.preconditions].join(' '),
      inputSchema:domainInput,outputSchema:fromJsonSchema(binding.envelopeSchema),
      annotations:{readOnlyHint:binding.mode==='read',destructiveHint:binding.mode!=='read',idempotentHint:binding.retryIdentity!=='none',openWorldHint:false},
      _meta:{'moment/catalog':catalogIdentity.digest,'moment/operation':operation,'moment/input':binding.inputSchema.ref.digest,'moment/output':binding.outputSchema.ref.digest},
    },async input=>{
      let result;
      if(active>=32) result={ok:false,error:{code:'LIMIT_EXCEEDED',message:'Bridge already has 32 active calls; wait for their outcomes before sending more',retry:'never',details:null}};
      else {active++;try {result=await managed.call(operation,input);} finally {active--;}}
      const envelope=()=>({operation,catalog:catalogIdentity,result});
      if(result.error?.code==='OUTCOME_UNKNOWN' && Buffer.byteLength(JSON.stringify(result.error.details))>16384) {
        try { result={...result,error:{...result.error,details:retainRequest(inspectHome(root===undefined?{}:{override:root}).root,result.error.details)}}; }
        catch { result={...result,error:{...result.error,message:'Outcome unknown; retain the original caller request. Private retry storage could not retain another request.',details:{method:operation,idempotencyKey:input.idempotencyKey??null}}}; }
      }
      if(Buffer.byteLength(JSON.stringify(envelope()))>480000) {
        const mutation=binding.mode==='write'||binding.mode==='bootstrap';
        let details=null;
        if(mutation) try {details=retainRequest(inspectHome(root===undefined?{}:{override:root}).root,{id:randomUUID(),method:operation,params:input});} catch {details={method:operation,idempotencyKey:input.idempotencyKey??null};}
        result={ok:false,error:{code:mutation?'OUTCOME_UNKNOWN':'LIMIT_EXCEEDED',message:mutation?'Admitted response cannot fit; reconcile the exact request before retrying':'Response exceeds the bridge bound; request a smaller page or selected detail',retry:mutation?'reconcile':'never',details}};
      }
      const value=envelope();validateBoundary(operation,'envelope',value);
      return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:!result.ok,
        _meta:{'moment/protocolVersion':server.server.getNegotiatedProtocolVersion()}};
    });
  }
  return server;
}

export function runMcp(options={}) {
  const input=strictFrames();let diagnostics=0,handle;
  const diagnostic=()=>{if(diagnostics++<8) process.stderr.write('Moment MCP connection failed; inspect the selected service and framing.\n');};
  const transport=new StdioServerTransport(input,process.stdout,{maxBufferSize:1048577});
  handle=serveStdio(()=>buildMcpServer(options),{legacy:'serve',transport,onerror:diagnostic});
  input.on('error',()=>{diagnostic();process.exitCode=1;process.stdin.unpipe(input);process.stdin.pause();handle.close().catch(()=>{});});
  process.stdin.pipe(input);
  return handle;
}
