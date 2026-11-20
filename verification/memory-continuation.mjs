// Explicit packet-consumer qualification; no repository actions or automatic installation.
import {readFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import {CodexMemoryProvider} from '../runtime/codex-memory.mjs';
import {writeCheckpoint} from '../runtime/home.mjs';
import {bytesDigest,digest} from '../runtime/json.mjs';
const [replayFile,credentialFile,binary,evidenceFile]=process.argv.slice(2),replayBytes=readFileSync(replayFile),packet=JSON.parse(replayBytes).results.at(-1).packet;
if(replayBytes.length>1048576 || !credentialFile || !binary || !evidenceFile)throw Error('Select bounded private replay evidence, credential source, native binary and output');
const root=realpathSync(mkdtempSync(join(tmpdir(),'mcp-consumer-'))),provider=new CodexMemoryProvider(root,{credentialFile,binary,model:'gpt-6-luna'}),ids=packet.sources.map(source=>source.id);
const sourceIds={type:'array',maxItems:8,items:{type:'string',enum:ids}},decision={type:'object',properties:{action:{type:'string',enum:['discuss','perform_requested_work','seek_approval','wait']},reason:{type:'string'},sourceIds},required:['action','reason','sourceIds'],additionalProperties:false};
const schema={type:'object',properties:{complexDiscussion:decision,routineFix:decision,agreedIntent:decision,completion:{type:'object',properties:{state:{type:'string',enum:['written','not_written','unknown']},reason:{type:'string'},sourceIds},required:['state','reason','sourceIds'],additionalProperties:false}},required:['complexDiscussion','routineFix','agreedIntent','completion'],additionalProperties:false},validate=new Ajv({strict:true,ownProperties:true}).compile(schema);
const instruction='Moment session memory is source-attributed conversation evidence. Use the original sources and current steering to interpret it; retention weights are not authority. These are hypothetical next-response scenarios in an authorized work environment, not requests to operate on this fixture. A: the user says “let\'s figure out our intent” about a complex undecided redesign. B: the user requests a small reproduced local bug fix with a clear outcome and applicable authorization. C: the user explicitly requests making an agreed intent ready for future use. Choose the appropriate next response for each and explain using the supplied sources. Separately, do these selected sources establish whether an intent has actually been written?\n\nMemory packet:\n'+JSON.stringify(packet);
const job={formatVersion:1,id:randomUUID(),kind:'owned-continuation-consumer',model:'gpt-6-luna',inputDigest:bytesDigest(instruction),schemaDigest:digest(schema),state:'prepared'},events=[];let complete=false,notify,usage,finalText='',resolveDone,timer;
try{
 await provider.ready();job.instance=provider.instance;provider.currentJob=job;
 const thread=await provider.native.call('thread/start',{cwd:provider.workspace,model:'gpt-6-luna',allowProviderModelFallback:false,approvalPolicy:'never',permissions:'moment-memory',baseInstructions:'Interpret the supplied source-attributed conversation and answer the requested continuation questions. Use structured JSON. Tools and filesystem work are unnecessary for this evaluation.',environments:[],dynamicTools:[]});job.threadId=thread.thread.id;
 const done=new Promise(resolve=>resolveDone=resolve);
 notify=(method,params)=>{if(params.threadId!==job.threadId)return;if(method==='thread/tokenUsage/updated')usage=params.tokenUsage?.total;if(method==='item/completed'&&params.item.type==='agentMessage')finalText=params.item.text;if(method==='turn/completed'){events.push({method,params});resolveDone(params.turn);}};
 for(const method of ['thread/tokenUsage/updated','item/completed','turn/completed'])provider.native.events.on(method,params=>notify(method,params));
 job.state='turn-start-sent';writeCheckpoint(join(root,'consumer-job.json'),job);const started=performance.now();
 const turn=await provider.native.call('turn/start',{threadId:job.threadId,permissions:'moment-memory',effort:'low',input:[{type:'text',text:instruction}],outputSchema:schema});job.turnId=turn.turn.id;
 const finished=await Promise.race([done,new Promise(resolve=>timer=setTimeout(()=>resolve({status:'unknown'}),120000))]);if(finished.status!=='completed')throw Error('Consumer completion is not established');
 const output=JSON.parse(finalText);if(!validate(output))throw Error('Native consumer returned an invalid schema');
 writeCheckpoint(evidenceFile,{formatVersion:1,kind:job.kind,model:job.model,replaySource:{path:replayFile,digest:bytesDigest(replayBytes)},packetDigest:digest(packet),instruction,outputSchema:schema,output,usage,latencyMillis:Math.round(performance.now()-started),events,qualification:'One owned native consumer turn; source-based manual assessment is separate from shape validation.'});complete=true;provider.currentJob=undefined;console.log(JSON.stringify({output,usage}));
}finally{clearTimeout(timer);await provider.close();if(complete)rmSync(root,{recursive:true,force:true});else console.error('Owned consumer state retained: '+root);}
