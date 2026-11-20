// Owned scripted protocol child. No network, real credentials or inference.
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
if(process.argv.includes('--version')){console.log('codex-cli 0.169.0');process.exit(0);}
let logged=false,scenario='normal',threadRequest,waiting;
const threadId='guidance-owned-thread',turnId='guidance-owned-turn',send=x=>process.stdout.write(JSON.stringify(x)+'\n'),notify=(method,params)=>send({method,params});
createInterface({input:process.stdin}).on('line',line=>{
 const {id,method,params}=JSON.parse(line);if(id===undefined)return;let result;
 if(method==='initialize')result={userAgent:'guidance-fixture'};
 else if(method==='account/read')result={account:logged?{type:'chatgpt'}:null};
 else if(method==='account/login/start'){logged=true;scenario=params.chatgptAccountId;result={type:'chatgptAuthTokens'};}
 else if(method==='model/list')result={data:[{id:'gpt-6-luna',model:'gpt-6-luna'}],nextCursor:null};
 else if(method==='thread/start'){
  threadRequest=params;notify('thread/started',{thread:{id:threadId}});result={thread:{id:threadId},model:params.model,approvalPolicy:'never',activePermissionProfile:{id:'moment-memory'},sandbox:{type:'readOnly',networkAccess:false}};
 }else if(method==='turn/start'){
  if(scenario==='lose-turn')process.exit(9);
  notify('turn/started',{threadId,turn:{id:turnId}});
  const input=JSON.parse(params.input[0].text.split('\n').slice(1).join('\n'));
  writeFileSync(join(process.env.CODEX_HOME,'observed-request.json'),JSON.stringify({threadStart:threadRequest,turnStart:params}),{mode:0o600});
  const source=input.sources[0],output={candidates:[{captureId:source.capture.id,interpretation:'Use the local package manager within this project.',scope:'Current task at its stated project location.',reason:'Relevant project-specific guide.',quotes:['Use pnpm.']}],exclusions:input.sources.slice(1).map(s=>({captureId:s.capture.id,reason:'Unrelated to this task.'})),premises:[input.task.description],uncertainties:['Implementation correctness requires separate verification.'],evidenceCoverage:'Guidance-only evidence; missing reproduction data does not contradict a user-stated confirmed defect.'};
  const finish=()=>{
   if(scenario!=='no-usage')notify('thread/tokenUsage/updated',{threadId,tokenUsage:{total:{totalTokens:30,inputTokens:20,outputTokens:10,cachedInputTokens:0}}});
   notify('item/completed',{threadId,turnId,item:{type:'agentMessage',id:'guidance-final',text:scenario==='invalid-output'?'not-json':JSON.stringify(output)}});
   notify('turn/completed',{threadId,turn:{id:turnId,status:'completed'}});
   if(scenario==='lose-ack-completed'){process.stdout.write('',()=>process.exit(9));return;}
   send({id,result:{turn:{id:turnId}}});
  };
  if(scenario==='delay')waiting=setTimeout(finish,150);else if(scenario==='wait-interrupt') {send({id,result:{turn:{id:turnId}}});}else finish();return;
 }else if(method==='turn/interrupt'){clearTimeout(waiting);notify('turn/completed',{threadId,turn:{id:turnId,status:'interrupted'}});result={};}
 else {send({id,error:{code:-32601,message:'Unsupported owned fixture method'}});return;}
 send({id,result});
});
