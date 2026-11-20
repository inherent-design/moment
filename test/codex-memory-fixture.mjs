// Scripted child only: ordinary tests never invoke real Codex or OpenAI.
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
if(process.argv.includes('--version')) {console.log('codex-cli 0.169.0');process.exit(0);}
let logged=false,scenario='normal',threadId='owned-thread',turnId='owned-turn',threadRequest;
const send=message=>process.stdout.write(JSON.stringify({...message,additiveFixtureField:true})+'\n');
const notify=(method,params)=>send({method,params});
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line),{id,method,params}=request;if(id===undefined)return;
  let result;
  if(method==='initialize') result={userAgent:'memory-fixture'};
  else if(method==='account/read') result={account:logged?{type:'chatgpt'}:null};
  else if(method==='account/login/start') {
    if(params.chatgptAccountId==='missing-login'){send({id,error:{code:-32601,message:'PRIVATE_UPSTREAM_SENTINEL'}});return;}
    if(params.chatgptAccountId==='malformed-login'){send({id,result:{unexpected:'PRIVATE_UPSTREAM_SENTINEL'}});return;}
    if(Object.keys(params).some(key=>!['type','accessToken','chatgptAccountId'].includes(key))) {send({id,error:{code:-32602,message:'Refresh material is forbidden'}});return;}
    logged=true;scenario=params.chatgptAccountId;result={type:'chatgptAuthTokens'};
  } else if(method==='model/list') result={data:[{id:'gpt-6-luna',model:'gpt-6-luna'}],nextCursor:null};
  else if(method==='thread/start') {
    if(scenario==='refuse-thread') {send({id,error:{code:-32602,message:'Thread refused before inference'}});return;}
    if(params.model!=='gpt-6-luna' || params.permissions!=='moment-memory' || params.sandbox!==undefined) {send({id,error:{code:-32602,message:'Unqualified profile'}});return;}
    if(scenario==='missing-thread-id'){send({id,result:{thread:{},model:params.model}});return;}
    threadRequest=params;notify('thread/started',{thread:{id:threadId}});result={thread:{id:threadId},model:params.model,approvalPolicy:'never',activePermissionProfile:{id:scenario==='wrong-permissions'?':danger-full-access':'moment-memory'},sandbox:{type:'readOnly',networkAccess:false}};
  } else if(method==='turn/start') {
    if(scenario==='malformed-turn'){send({id,result:{turn:{}}});return;}
    if(scenario==='lose-turn') process.exit(9);
    if(params.permissions!=='moment-memory' || params.sandboxPolicy!==undefined || params.effort!=='low') {send({id,error:{code:-32602,message:'Unqualified turn'}});return;}
    notify('turn/started',{threadId,turn:{id:turnId}});
    const text=params.input[0].text,markers=['\n\nSession and capacity:\n','\n\nOriginal source messages:\n','\n\nPrevious cache assessments (reconsider against the original sources):\n','\n\nIncoming source IDs:\n'];
    const positions=markers.map(marker=>text.indexOf(marker));
    if(positions.some((position,index)=>position<0||index>0&&position<=positions[index-1])){send({id,error:{code:-32602,message:'Missing source-first prompt evidence'}});return;}
    const sections=markers.map((marker,index)=>JSON.parse(text.slice(positions[index]+marker.length,positions[index+1]??text.length)));
    const input={...sections[0],sources:sections[1],cache:sections[2],incomingSourceIds:sections[3]};
    writeFileSync(join(process.env.CODEX_HOME,'observed-request.json'),JSON.stringify({threadStart:threadRequest,turnStart:params}),{mode:0o600});
    const expectedIds=[...new Set([...input.cache.map(entry=>entry.sourceId),...input.incomingSourceIds,...input.focusSourceIds??[]])];
    if(params.outputSchema.properties.entries.maxItems!==Math.min(input.capacity,expectedIds.length) || JSON.stringify(params.outputSchema.properties.entries.items.properties.sourceId.enum)!==JSON.stringify(expectedIds)) {send({id,error:{code:-32602,message:'Native output schema is not bound to the actual cache basis'}});return;}
    const entry={sourceId:input.incomingSourceIds.at(-1),weight:0.8,generality:null,note:scenario==='invalid-unicode-output'?String.fromCharCode(0xd800):'Scripted provider fixture.'};
    let output=scenario==='invalid-output'?'not json':JSON.stringify({kind:'replace',explanation:'Scripted fixture assessment.',entries:scenario==='rejected-output'?Array(input.capacity+1).fill(entry):[entry]});
    if(scenario==='unchanged-output')output=JSON.stringify({kind:'unchanged',entries:[],explanation:'The incoming routine question does not change the retained steering.'});
    if(scenario==='encoded-control-output')output='\0'.repeat(65536);
    if(scenario==='duplicate-output')output=output.replace('{"kind":"replace"','{"kind":"unchanged","kind":"replace"');
    notify('thread/tokenUsage/updated',{threadId,tokenUsage:{total:{totalTokens:30,inputTokens:20,outputTokens:10,cachedInputTokens:0}}});
    if(!['failed-turn','interrupted-turn'].includes(scenario)) notify('item/completed',{threadId,turnId,item:{type:'agentMessage',id:'owned-final',text:output}});
    // Intentionally complete before acknowledging turn/start.
    notify('turn/completed',{threadId,turn:{id:turnId,status:scenario==='failed-turn'?'failed':scenario==='interrupted-turn'?'interrupted':'completed'}});
    if(scenario==='lose-ack-completed'){process.stdout.write('',()=>process.exit(9));return;}
    result={turn:{id:turnId}};
  } else if(method==='turn/interrupt') result={};
  else {send({id,error:{code:-32601,message:'Unsupported fixture method'}});return;}
  send({id,result});
});
