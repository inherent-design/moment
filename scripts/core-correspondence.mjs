import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';

/** Model rows may describe refusals; compiler diagnostics are separate output. */
export function checkModelDiagnostics(output) {
 const diagnostic=output.split('\n').find(line=>!line.startsWith('case|')&&/sorryAx|warning:|error:/.test(line));
 if(diagnostic)throw Error('Lean rejected a proof or its axiom audit: '+diagnostic);
}

/** Audit the explicitly claimed Lean declarations and their transitive axioms. */
export function checkAxioms(output,claims) {
 const allowed=new Set(['propext','Classical.choice','Quot.sound']),audits=new Map();
 for(const line of output.split('\n')){const match=line.match(/^'([^']+)' (does not depend on any axioms|depends on axioms: \[([^\]]*)\])$/);if(!match)continue;const deps=match[3]?match[3].split(',').map(x=>x.trim()):[];if(deps.some(x=>!allowed.has(x)))throw Error('Unapproved proof axiom for '+match[1]+': '+deps.join(', '));if(audits.has(match[1]))throw Error('Duplicate axiom audit');audits.set(match[1],deps);}
 for(const claim of claims)if(!audits.has(claim))throw Error('Missing transitive axiom audit: '+claim);
 return claims.map(name=>({name,axioms:audits.get(name)}));
}

/** Compare the actual Lean evaluator and generated Bend/native consumer. */
export function checkCorrespondence(output) {
 const truth=value=>value==='true'?true:value==='false'?false:value==='unknown'?'unknown':(()=>{throw Error('Unknown model truth');})();
 const rows=output.split('\n').filter(line=>line.startsWith('case|'));
 assert.equal(rows.length,159629,'The complete declared finite correspondence set must be present');
 const counts={},seen=new Set(),choose=(values,mask)=>values.filter((_value,i)=>Number(mask)&2**i);
 const when={kind:'equal',left:{kind:'literal',value:true},right:{kind:'literal',value:true}},rules=[
  {id:'read',effect:'permit',when,actions:['read']},{id:'write',effect:'permit',when,actions:['write']},
  {id:'deny',effect:'deny',when,actions:['read']},{id:'both',effect:'permit',when,actions:['read','write']}
 ];
 const run=(state,label)=>{const [action,outcome]=label.split('.');return core.executionStep(state,action,outcome);};
 const runLabel=step=>step.kind==='next'?['next',step.state,step.cancellation,step.authority,step.immediate].join(':'):step.kind;
 const topEdges=(size,mask)=>choose(Array.from({length:size*size},(_,i)=>({source:Math.floor(i/size),target:i%size})),mask);
 const edgeList=values=>values.map(([source,target])=>({source,target}));
 const topExtra=[[3,[[3,0]]],[3,[[0,3]]],[3,[[4,0]]],[3,[[0,0xffffffff]]],[0,[[0,0]]],
  [3,[[0,1],[0,2],[3,1]]],[2,[[0,1],[0,1]]],[2,[[0,1],[1,0],[0,1]]],[3,[[0,1],[0,1],[0,2]]]];
 const ref=id=>({systemId:'system',contextId:'context',id}),accessMethods=['graph.query','graph.transact','schema.publish','context.limits','context.close','policy.activate'];
 const accessSamples=[{actions:accessMethods,incidentIds:'all',resourceRefs:['one','ctx'].map(ref)},
  {actions:accessMethods,incidentIds:['incident'],resourceRefs:['one','ctx'].map(ref)},
  {actions:['graph.query','graph.transact'],incidentIds:'all',resourceRefs:[ref('two')]},{actions:[],incidentIds:[],resourceRefs:[]}],accessCache=new Map();
 const access=(depth,code,operator)=>{const key=[depth,code,operator].join('|');if(!accessCache.has(key))accessCache.set(key,core.accessScopes(truth(operator),Array.from({length:Number(depth)},(_,i)=>accessSamples[Math.floor(Number(code)/4**i)%4])));return accessCache.get(key);};
 const filters=(index,name)=>[undefined,[],[name],['other']][Number(index)],supports=[[],['withdrawn'],['asserted'],['withdrawn','asserted']];
 const queryRoles=[{}, {subject:[ref('one')]},{object:[ref('two')]},{subject:[ref('one')],object:[ref('two')]}];
 const budgetZero=()=>Object.fromEntries(['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits','concurrentExecutions'].map(key=>[key,0]));
 const amountLabel=n=>n===Infinity?'overflow':String(n);
 const budgetEntry=(state,key,ceiling,usage,unknown,grantIds=[])=>({value:{state,intent:{limits:{...budgetZero(),concurrentExecutions:1,[key]:Number(ceiling)}},usage:{...budgetZero(),[key]:Number(usage),...(unknown?{unmeasured:[key]}:{})}},origin:{grantIds}});
 const sequence=(values,size,code)=>Array.from({length:Number(size)},(_,i)=>values[Math.floor(Number(code)/values.length**i)%values.length]);
 const date=value=>new Date(value).toISOString(),calendarStart=-62167219200000;
 const schState=(overrides={})=>({state:'active',lastSeq:100,pending:[],activeExecutionIds:[],edge:false,timerFired:false,blockedActivity:-1,...overrides});
 const schSources=[[],['a'],['a','b'],['b','a'],Array.from({length:32},(_,i)=>String(i)),Array.from({length:33},(_,i)=>String(i))],schIncoming=[[],['a'],['b','a'],['new'],['31','0']];
 const schFilters=[undefined,[],['a','b'],['c','a']];
 const capSchema=name=>({name,version:'1',digest:'digest'}),capItem=expired=>({ref:ref('cap'),value:{providerId:'provider',name:'verify',version:'1',inputSchema:capSchema('input'),outputSchema:capSchema('output'),features:['bytes'],isolation:'process',expiresAt:date(expired?99:101)}});
 const capRequirement=mask=>({name:'verify',versions:mask&1?[]:['1'],inputSchema:{...capSchema('input'),version:mask&2?'other':'1'},outputSchema:{...capSchema('output'),digest:mask&4?'other':'digest'},features:mask&8?['missing']:['bytes'],acceptableIsolation:mask&16?[]:['process']});
 const capChain=(mask,restricted)=>[{actions:mask&64?[]:['verify'],resourceRefs:[ref('cap')],incidentIds:restricted?[]:'all'}];
 const capResult=value=>value.eligibility+':'+value.unmet.join(',');
 const pqBase=core.policyQueryInitial(0,0),pqBudgets=new Map(),pqBudget=value=>{if(!pqBudgets.has(value))pqBudgets.set(value,core.policyQueryCharge(pqBase,[value===undefined?32769:32768-value]));return pqBudgets.get(value);};
 const pqBudgetLabel=value=>core.policyQueryAvailable(value)?String(value.remaining):'unknown';
 const pqAccess=operator=>({operator,canRead:()=>true}),pqEndpoint=id=>core.policyQueryEndpoint({systemId:'system',id:'context'},id,pqAccess(true));
 const ctlPaths=['','/value','/value/schema','/value/schema/name','/value/schema/name/x','/value/value/a~1b','/ref','/ref/id','/support','/support/x','/digest','/revision','/recordedAt','/recordedBy','/other','/digest/x'];
 const ctlChanges=[[],[{kind:'record.put',record:{id:'p'}}],[{kind:'record.put',record:{id:'a'}}],[{kind:'assertion.withdraw'}],[{kind:'assertion.put',assertion:{id:'a'}},{kind:'assertion.withdraw'}]];
 const ctlItems=[{id:'a',incidentId:'i'},{id:'b',incidentId:'i'},{id:'p',incidentId:'i'},{id:'a',incidentId:'other'}],ctlChains=[[],['g'],['other']],ctlNames=['policies','transitions','executions','schemas','guidanceSources','unknown'],ctlBindings=[[],['now'],['arbitrary'],['now','event.id'],['now','arbitrary']];
 const otherRevision=revision=>Number(revision)===0?1:0;
 const awBools=[[],[true],[false],[true,false]],awGroups=[[],[[]],[['r0']],[['r1']],[['r0','r1']],[['r0'],['r1']],[['r0','r0'],['r1']]];
 const awSupports=[['t','owner','asserted',[]],['t','other','asserted',[]],['t','owner','withdrawn',[]],['other','owner','asserted',[]],['t','owner','asserted',[false]],['t','owner','asserted',[true]]];
 const capDigest=letter=>'sha256:'+letter.repeat(64),capPayload=id=>({id,kind:'archive',availability:{kind:'present'},digest:capDigest('a'),bytes:1,pins:[],path:'payload'});
 const capFlag=(mask,index)=>!!(Number(mask)&2**index);
 const capCandidateInputs=(mask,profile)=>{
  const flag=index=>capFlag(mask,index),kinds=Number(profile)===0?['archive','observation']:Number(profile)===1?['world','archive']:['private','cache'];
  return [{...capPayload('s'),kind:kinds[flag(1)?0:1],availability:{kind:flag(7)?'present':'packed'},pins:flag(3)?['pin']:[],path:flag(5)?'state/payload':'payload'},
   {...capPayload(flag(0)?'s':'t'),kind:kinds[flag(2)?0:1],availability:{kind:flag(8)?'present':'packed'},pins:flag(4)?['pin']:[],path:flag(6)?'recipient-state/payload':'payload',digest:capDigest(flag(9)?'a':'b'),bytes:flag(10)?1:2},Number(profile)===0?['archive']:kinds];
 };
 const capPairInputs=(mask,mode)=>{
  const flag=index=>capFlag(mask,index),value=Number(mode);
  return [{sha256:(flag(0)?'a':'b').repeat(64),size:flag(2)?1:2,mode:value,uid:1,gid:1,flags:0,attrs:{}},
   {sha256:(flag(1)?'a':'b').repeat(64),size:flag(3)?1:2,mode:flag(4)?value:(value^1)>>>0,uid:flag(5)?1:2,gid:flag(6)?1:2,flags:flag(7)?0:1,attrs:flag(8)?{}:{'com.apple.provenance':'b'.repeat(64)}}];
 };
 const capScopeSample=mask=>{
  const flag=index=>capFlag(mask,index);
  return {target:{systemId:flag(0)?'s':'foreign',contextId:flag(1)?'c':'other'},run:{id:'sample',order:0,category:flag(5)?'archive':'cache',...(flag(2)?{projectId:flag(3)?'p':'c'}:{}),...(flag(4)?{worktree:'tree'}:{})}};
 };
 const capRunVariant=(variant,index,profile)=>{
  const state=['completed','completed','active','cancelled','cancelled','cancelled','completed','completed'][variant],order=[0,1,1,0,2,3,0,Number.MAX_SAFE_INTEGER][variant];
  return {target:{systemId:profile===1?'s'+index:'s',contextId:profile===3?'c'+index:'c'},run:{id:'r'+index,state,current:variant===3,order,pins:variant===4||variant===6?['pin']:[],dependencies:[],category:profile===4&&index%3===0?'cache':'archive',...(profile===3?{projectId:'shared'}:profile===2&&index%2===0?{projectId:'c'}:{}),...(profile===4&&index%2===0?{worktree:'tree'}:{})}};
 };
 const capGraphRuns=(size,mask,profile,missing)=>Array.from({length:Number(size)},(_,index)=>({target:{systemId:Number(profile)===3?'s'+index:'s',contextId:'c'},run:{id:'r'+index,order:index,state:Number(profile)===2?'cancelled':'completed',current:Number(profile)===1&&index===0,pins:Number(profile)===2&&index===0?['pin']:[],category:'archive',dependencies:[...Array.from({length:Number(size)},(_,target)=>target).filter(target=>capFlag(mask,index*Number(size)+target)).map(target=>'r'+target),...(truth(missing)&&index===0?['outside']:[])]}}));
 const capRunResult=values=>{try{return 'ok:'+core.captureRuns(values).join(',');}catch(error){if(!['INVALID_ARGUMENT','UNSUPPORTED_VERSION','NOT_FOUND'].includes(error.code))throw error;return 'error:'+error.code;}};
 const capIds=[[],['a'],['a','a'],['a','b']],capAmounts=[Infinity,0,1,Number.MAX_SAFE_INTEGER],capBudgetValues=[0,1,2,4294967295,4294967296,4294967297,281474976710655,281474976710656,281474976710657,9007199254740990,9007199254740991];
 const stVersions=[null,0,1,2,3,Number.MAX_SAFE_INTEGER],stMemoryVersions=[null,0,1,2,3,4,Number.MAX_SAFE_INTEGER];
 for(const row of rows){const [,kind,...parts]=row.split('|'),expected=parts.pop(),key=[kind,...parts].join('|');let actual;
  assert.ok(!seen.has(key),'Duplicate model input: '+key);seen.add(key);counts[kind]=(counts[kind]??0)+1;
  const a=['not','all','any','policy','record','assertion'].includes(kind)?truth(parts[0]):undefined;
  if(kind==='not')actual=String(core.not(a));
  else if(kind==='all'||kind==='any')actual=String(core[kind]([a,truth(parts[1])]));
  else if(kind==='policy')actual=core.policyDecision([{effect:'deny',result:a},{effect:'permit',result:truth(parts[1])}]);
  else if(kind==='record')actual=core.recordEdit(a,truth(parts[1]));
  else if(kind==='assertion')actual=core.assertionEdit(a,truth(parts[1]),parts[2]);
  else if(kind==='withdraw')actual=core.withdrawEdit(parts[0]);
  else if(kind==='graph'){
   const changes=(parts[0]==='-'?[]:[...parts[0]]).map((flag,i)=>({kind:flag==='1'?'record.put':'assertion.withdraw',index:i}));actual=core.graphOrder(changes).map(change=>change.index).join(',');
  }
  else if(kind==='grant'){
   const [depth,repeated,scope,present,revoked,expiry,principal]=parts,seen=Array.from({length:Number(depth)},(_,i)=>i===0&&truth(repeated)?'leaf':'seen-'+i);
   const ref={systemId:truth(scope)?'system':'foreign',contextId:'context',id:'leaf'},value={principalId:truth(principal)?'caller':'other',...(Number(expiry)?{expiresAt:new Date(Number(expiry)).toISOString()}:{})};
   actual=core.grantLink({systemId:'system',id:'context'},ref,seen,truth(present)?{value}:undefined,truth(revoked),'caller',200);
  }
  else if(kind==='grantEnd')actual=core.grantEnd(Number(parts[0])?['leaf']:[]);
  else if(kind==='policyRules')actual=core.policyRules(choose(rules,parts[0]),choose(rules,parts[1]),choose(['read','write'],parts[2]));
  else if(kind==='issuers')actual=core.policyIssuers(choose(['a','b'],parts[0]),choose(['a','b'],parts[1]));
  else if(kind==='runTerminal')actual=String(core.executionTerminal(parts[0]));
  else if(kind==='runStep')actual=runLabel(run(parts[0],parts[1]));
  else if(kind==='runTrace'){
   const first=run(parts[0],parts[1]),middle=first.kind==='next'?first.state:parts[0],second=run(middle,parts[2]);actual=second.kind==='next'?second.state:middle;
  }
  else if(kind==='topology'||kind==='topologyExtra'){
   const [size,edges,exclusive]=kind==='topology'?[Number(parts[0]),topEdges(Number(parts[0]),parts[1]),truth(parts[2])]:[topExtra[Number(parts[0])][0],edgeList(topExtra[Number(parts[0])][1]),truth(parts[1])];
   actual=core.topologyCheck(size,edges,exclusive);
   assert.equal(core.topologyCheck(size,edges.toReversed(),exclusive),expected,'Topology must not depend on edge input order: '+row);
  }
  else if(kind==='topologyProjection'){
   const [recordKind,schema,supports,framed]=parts,roles=Object.fromEntries(['perspective','frame','child','parent','earlier','later'].filter(k=>k!=='frame'||truth(framed)).map(k=>[k,[{id:k}]]));
   const result=core.topologyRecord({kind:recordKind,schema:{name:schema},roles},[[],['withdrawn'],['asserted'],['withdrawn','asserted']][Number(supports)],'context');
   actual=result.kind==='skip'?'skip':[result.kind,result.scope,result.source,result.target].join(':');
  }
  else if(kind==='topologyCombine')actual=core.topologyCombine(parts[0]==='-'?[]:parts);
  else if(kind==='topologyCertificate'){
   const [mask,rankMask]=parts;actual=core.topologyCertify(3,topEdges(3,mask),Array.from({length:3},(_,i)=>Math.floor(Number(rankMask)/3**i)%3));
  }
  else if(kind==='accessOperator')actual=String(core.isOperator('caller',truth(parts[0])?'caller':'owner',truth(parts[1])?'caller':'other',truth(parts[2])));
  else if(kind==='accessResource')actual=String(access(...parts.slice(0,3)).canRead(ref(parts[3])));
  else if(kind==='accessIncident')actual=String(access(...parts.slice(0,3)).canIncident(parts[3]));
  else if(kind==='accessMethod')actual=access(...parts.slice(0,3)).method(parts[3],ref('ctx'));
  else if(kind==='incidentTerminal')actual=String(core.incidentTerminal(parts[0]));
  else if(kind==='incidentEdit')actual=String(core.incidentRevisable(parts[0],parts[1]));
  else if(kind==='incidentEvidence')actual=core.incidentEvidence(parts[0],[undefined,{sources:[]},{sources:[ref('one')]}][Number(parts[1])]);
  else if(kind==='mutationBasis'){
   const revision=Number(parts[0]),expected=truth(parts[1])?revision:revision===0?1:0;actual=core.mutationBasis(revision,expected,parts[2],parts[3]);
  }
  else if(kind==='querySelection'){
   const [ids,schemas,status,support,related]=parts;
   actual=String(core.querySelection({ids:filters(ids,'id'),schemaNames:filters(schemas,'schema'),assertionStatus:status},filters(related,'id'))({id:'id',schema:{name:'schema'}},supports[Number(support)]));
  }
  else if(kind==='queryRelated')actual=String(core.queryRelated({kind:parts[0],roles:queryRoles[Number(parts[3])]},[undefined,'subject','object','missing'][Number(parts[1])],ref(parts[2])));
  else if(kind==='budgetAdd')actual=amountLabel(core.resourceAdd(Number(parts[0]),Number(parts[1])));
  else if(kind==='budgetLe')actual=String(core.resourceLessOrEqual(Number(parts[0]),Number(parts[1])));
  else if(kind==='budgetCapacity'){
   const [key,total,requested,ceiling]=parts;
   actual=String(core.resourceCapacity({...budgetZero(),[key]:Number(total)},{...budgetZero(),[key]:Number(requested)},{...budgetZero(),[key]:Number(ceiling)}));
  }
  else if(kind==='budgetCharge'){
   const [state,key,ceiling,usage,unknown]=parts,total=core.resourceTotals([budgetEntry(state,key,ceiling,usage,truth(unknown))]);actual=amountLabel(total[key])+':'+total.concurrentExecutions;
  }
  else if(kind==='budgetUsage'){
   const [key,previous,usage,ceiling,observed]=parts;
   actual=String(core.resourceUsage({...budgetZero(),[key]:Number(previous)},{...budgetZero(),[key]:Number(usage)},{...budgetZero(),[key]:Number(ceiling)},truth(observed)));
  }
  else if(kind==='budgetTrace'){
   const [stateMask,unknownMask,code,scope]=parts,values=[1,2,Number.MAX_SAFE_INTEGER];
   const entries=Array.from({length:2},(_,i)=>budgetEntry(Number(stateMask)&2**i?'running':'succeeded','cpuMillis',values[Math.floor(Number(code)/3**i)%3],1,!!(Number(unknownMask)&2**i),[i===0?'a':'b','shared']));
   const total=core.resourceTotals(entries,scope==='all'?undefined:scope);actual=amountLabel(total.cpuMillis)+':'+total.concurrentExecutions;
  }
  else if(kind==='budgetSubtract')actual=amountLabel(core.resourceSubtract(Number(parts[0]),Number(parts[1])));
  else if(kind==='fenceEqual')actual=String(core.fenceEqual(Number(parts[0]),Number(parts[1])));
  else if(kind==='fenceNext'){
   try{actual=String(core.fenceNext(Number(parts[0])));}catch(error){if(error.code!=='LIMIT_EXCEEDED')throw error;actual='overflow';}
  }
  else if(kind==='singleSlot')actual=String(core.resourceSingleSlot(Number(parts[0])));
  else if(kind==='leaseWindow'){
   const [millis,size,code]=parts,bounds=sequence([50,100,101,1100,30100],size,code);
   try{const result=core.leaseWindow({bootId:'boot',wall:calendarStart+100,monotonic:0.25},Number(millis),bounds.map(value=>calendarStart+value));actual=[Date.parse(result.expiresAt)-calendarStart,Date.parse(result.expiresAt)-(calendarStart+100)].join(':');}
   catch(error){if(error.code!=='LEASE_STALE')throw error;actual='expired';}
  }
  else if(kind==='leaseExpiry'){
   const [present,meta,boot,wall,mono]=parts;
   actual=String(core.leaseExpired(truth(present)?{expiresAt:date(100)}:undefined,truth(meta)?{bootId:truth(boot)?'boot':'other',monotonicDeadline:100}:undefined,{bootId:'boot',wall:Number(wall),monotonic:Number(mono)/4}));
  }
  else if(kind==='leaseValid'){
   const [present,meta,boot,holder,identity,fence,live,token]=parts;
   const lease=truth(present)?{expiresAt:date(100),holderId:truth(holder)?'holder':'other',id:'lease',fencingToken:Number(token)}:undefined;
   actual=String(core.leaseValid(lease,truth(meta)?{bootId:truth(boot)?'boot':'other',monotonicDeadline:100.25}:undefined,{bootId:'boot',wall:truth(live)?99:100,monotonic:0.25},'holder',{leaseId:truth(identity)?'lease':'different',fencingToken:truth(fence)?Number(token):0}));
  }
  else if(kind==='retryAdmission')actual=core.retryAdmission(truth(parts[0]),parts[1],parts[2]);
  else if(kind==='executionQueued')actual=String(core.executionQueued(parts[0]));
  else if(kind==='executionDeadline')actual=String(core.executionWaitsDeadline(parts[0],truth(parts[1])));
  else if(kind==='executionMaintenance'){
   const [state,expired,deadline,cap,grants]=parts,at=[undefined,99,100,101][Number(deadline)];
   const value={state,intent:{limits:at===undefined?{}:{deadline:date(at)}},...(truth(expired)?{lease:{expiresAt:date(1000)}}:{})};
   actual=core.executionMaintenance(value,truth(expired)?{bootId:'other',monotonicDeadline:1000}:undefined,{bootId:'boot',wall:100,monotonic:0.25},Number(cap),[[],[99],[101]][Number(grants)]);
  }
  else if(kind==='clockDelay'){
   const values=sequence([-4,-1,0,1,4],parts[0],parts[1]),result=core.timeDelay(values.map(v=>v/4));actual=result===null?'idle':String(result*4);
  }
  else if(kind==='resourceBlocked')actual=String(core.resourceBlocked(sequence([[],['cpuMillis'],['memoryBytes'],['cpuMillis','memoryBytes']],parts[0],parts[1]).map(limitViolations=>({limitViolations}))));
  else if(kind==='capacityAvailable')actual=String(core.resourceAvailable(sequence([{used:0,ceiling:0},{used:0,ceiling:1},{used:1,ceiling:1},{used:1,ceiling:Number.MAX_SAFE_INTEGER},{used:Number.MAX_SAFE_INTEGER,ceiling:Number.MAX_SAFE_INTEGER},{used:Infinity,ceiling:Number.MAX_SAFE_INTEGER}],parts[0],parts[1])));
  else if(kind==='resourceEnvelope'){
   const [key,size,code,ceiling]=parts;
   actual=String(core.resourceEnvelope(sequence([0,1,Number.MAX_SAFE_INTEGER],size,code).map(value=>({...budgetZero(),[key]:value})),{...budgetZero(),[key]:Number(ceiling)}));
  }
  else if(kind==='calendarAfter'){
   try{actual=String(core.calendarAfter(calendarStart+Number(parts[0]),Number(parts[1]))-calendarStart);}
   catch(error){if(error.code!=='INVALID_ARGUMENT'||error.message!=='Temporal anchor exceeds the supported calendar')throw error;actual='overflow';}
  }
  else if(kind==='scheduleReady'){
   const [state,blocked,pressure,pending,busy,coalesce,sources,sequence]=parts;
   const f=schState({state,lastSeq:Number(sequence),blockedActivity:truth(blocked)?100:-1,backpressureActivity:truth(pressure)?100:-1,pending:Array.from({length:Number(pending)},()=>({eventIds:Array.from({length:Number(sources)},(_,i)=>String(i))})),activeExecutionIds:Array(Number(busy)).fill('busy')});
   actual=String(core.scheduleReady(f,100,truth(coalesce)));
  }
  else if(kind==='scheduleScan'){
   const [state,blocked,context,ended]=parts;actual=core.scheduleScan(schState({state,blockedActivity:truth(blocked)?100:-1}),context,truth(ended),100);
  }
  else if(kind==='scheduleWatch'){
   const [state,blocked,fired,present]=parts;actual=String(core.scheduleWatch(schState({state,blockedActivity:truth(blocked)?100:-1,timerFired:truth(fired),...(truth(present)?{due:100}:{})}),100));
  }
  else if(kind==='scheduleNeedsEvents')actual=String(core.scheduleNeedsEvents(parts[0]));
  else if(kind==='scheduleBaseline')actual=String(core.scheduleBaseline({kind:parts[0],mode:truth(parts[1])?'edge':'each'}));
  else if(kind==='scheduleWake')actual=core.scheduleWakeAdmission({wake:{kind:parts[0],resource:parts[2]},recurrence:truth(parts[1])?'once':'rearmAfterCompletion'});
  else if(kind==='scheduleMode'){
   const [wake,fired,index,sequence]=parts,due=[undefined,99,101][Number(index)];actual=core.scheduleMode({kind:wake},schState({timerFired:truth(fired),lastSeq:Number(sequence),...(due===undefined?{}:{due})}),100,100).$;
  }
  else if(kind==='scheduleEventGate')actual=core.scheduleEventGate(schState({lastSeq:Number(parts[0])}),{sequence:Number(parts[1]),type:parts[2]},100,['graph.transact.committed','runtime.schedule.triggered']);
  else if(kind==='scheduleObservation'){
   const result=core.scheduleObservation(truth(parts[0])?'each':'edge',truth(parts[1]),truth(parts[2]));actual=[result.fire,result.edge].join(':');
  }
  else if(kind==='scheduleQueue'){
   const [pending,coalesce,previous,incoming]=parts,state=schState({pending:Array.from({length:Number(pending)},()=>({eventIds:schSources[Number(previous)]}))}),result=core.scheduleQueue(state,truth(coalesce),schIncoming[Number(incoming)]);
   actual=result.kind+(result.kind==='SchQueueFull'?'':':'+result.sources.join(','));
  }
  else if(kind==='scheduleAdvance'){
   const [oldEdge,nextEdge,fire,enqueued,pending,once]=parts,result=core.scheduleAdvance(schState({lastSeq:99,edge:truth(oldEdge),pending:truth(pending)?[{}]:[]}),100,101,truth(nextEdge),truth(fire),truth(enqueued),truth(once)?'once':'rearmAfterCompletion');
   actual=[result.cursor,result.edge,result.stop,result.full].join(':');
  }
  else if(kind==='scheduleCapacityEdge')actual=String(core.scheduleCapacityEdge(...parts.map(truth)));
  else if(kind==='scheduleMatches')actual=String(core.scheduleMatches(schState({state:parts[0],pending:truth(parts[1])?[{id:truth(parts[2])?'expected':'other'}]:[]}), 'expected'));
  else if(kind==='scheduleVisible'){
   const [present,incident,operator,readable,creator,bound]=parts.map(truth),stored=present?{ref:ref('schedule'),value:{incidentId:'incident'}}:undefined;
   actual=String(core.scheduleVisible(stored,{principalId:creator?'caller':'other',grant:{id:'grant'}},'caller',{canIncident:()=>incident,operator,canRead:()=>readable,chain:bound?[{id:'grant'}]:[]}));
  }
  else if(kind==='scheduleSelection'){
   const result=core.scheduleSelection(schFilters[Number(parts[0])],schFilters[Number(parts[1])]);actual=result===undefined?'unrestricted':'selected:'+result.join(',');
  }
  else if(kind==='scheduleChoose'){
   const entries=[['b',9],['a',5],['a',3],['c',7]].map(([incidentId,order],i)=>['s'+i,{value:{incidentId,order}}]),states=Object.fromEntries(entries.map(([id,stored],i)=>[id,schState({pending:Number(parts[0])&2**i?[{id:'occ'+i,eventIds:[],order:stored.value.order}]:[]})]));
   const result=core.scheduleChoose(entries,states,100,[undefined,'a','b','c','z'][Number(parts[1])]);actual=result?String(entries.indexOf(result)):'none';
  }
  else if(kind==='scheduleCausality'){
   const [mask,dependent,broken]=parts.map(Number),events=[0,1].filter(i=>!(broken===1&&i===1)).map(i=>({id:'n'+i,contextId:broken===2&&i===1?'foreign':'context',type:dependent&2**i?'runtime.schedule.triggered':'graph.transact.committed',subjectRefs:[ref('target')],causeIds:[0,1].filter(j=>mask&2**(i*2+j)).map(j=>'n'+j)}));
   const result=core.scheduleDepends(events[0],id=>events.find(e=>e.id===id),'context',ref('target'));actual=result==='unknown'?'unknown':result?'dependent':'independent';
  }
  else if(kind==='scheduleRoom')actual=String(core.scheduleRoom(Number(parts[0])));
  else if(kind==='scheduleOrder'){
   try{actual=String(core.scheduleOrder(Number(parts[0]),Number(parts[1])));}catch(error){if(error.code!=='LIMIT_EXCEEDED')throw error;actual='overflow';}
  }
  else if(kind==='scheduleCancel')actual=String(core.scheduleCancellable(parts[0]));
  else if(kind==='scheduleCompleted')actual=core.scheduleCompleted(truth(parts[0])?'once':'rearmAfterCompletion');
  else if(kind==='scheduleRetryFault')actual=String(core.scheduleRetryFault(parts[0]));
  else if(kind==='capabilityBasis'){
   const [mask,restricted,incident,policy]=parts,m=Number(mask),basis=core.capabilityBasis(capItem(!!(m&32)),capRequirement(m),capChain(m,truth(restricted)),truth(incident)?'incident':undefined,100);
   actual=capResult(core.capabilityFinish(basis,policy));
  }
  else if(kind==='capabilityCompare'){
   const match=(eligibility,count,id)=>({eligibility,unmet:Array(Number(count)).fill('unmet'),capability:{ref:ref(id)}}),value=core.capabilityCompare(match(...parts.slice(0,3)),match(...parts.slice(3)));
   actual=value===-1?'LT':value===1?'GT':'EQ';
  }
  else if(kind==='capabilityPublish'){
   const [count,provider,reserved,expired]=parts,item=capItem(truth(expired));actual=core.capabilityPublish(item.value,item.ref,truth(provider)?'provider':'other',truth(reserved)?['verify']:[],Number(count),100);
  }
  else if(kind==='executionRoom')actual=String(core.executionRoom(Number(parts[0])));
  else if(kind==='executionAdmission')actual=core.executionAdmission(capItem(truth(parts[0])).value,100,parts[1],truth(parts[2])?{status:parts[3]}:undefined);
  else if(kind==='executionDeadlineAdmission')actual=String(core.executionDeadline(truth(parts[0])?date(Number(parts[1])):undefined,100));
  else if(kind==='executionPrepare'){
   const [incident,capability,operator,self,bound,readable]=parts.map(truth),intent={incidentId:'incident',capability:ref('cap'),grant:ref('grant')};
   actual=core.executionPrepare(intent,'actor',self?'actor':'requester',{operator,canIncident:()=>incident,canRead:r=>r.id==='cap'?capability:readable},ref(bound?'grant':'other'));
  }
  else if(kind==='executionVisible'){
   const [present,origin,incident,operator,requester,provider,bound,capability,readable]=parts.map(truth),stored=present?{ref:ref('execution'),value:{intent:{incidentId:'incident',capability:ref('cap')}}}:undefined;
   actual=String(core.executionVisible(stored,origin?{principalId:requester?'caller':'requester',providerId:provider?'caller':'provider',grantIds:['grant']}:undefined,'caller',{operator,chain:bound?[{id:'grant'}]:[],canIncident:()=>incident,canRead:r=>r.id==='cap'?capability:readable}));
  }
  else if(kind==='executionReconcile')actual=String(core.executionReconcile('caller',truth(parts[0])?'caller':'provider',truth(parts[1]),truth(parts[2])));
  else if(kind==='executionEvidence')actual=String(core.executionEvidence(truth(parts[0]),truth(parts[1])?[ref('evidence')]:[]));
  else if(kind==='capabilityBoundGrant')actual=String(core.boundGrantSelected(truth(parts[0]),ref('grant'),ref(truth(parts[1])?'grant':'other')));
  else if(kind==='capabilitySelected')actual=String(core.capabilitySelected(capItem(false),truth(parts[0])?'verify':'other',truth(parts[1])));
  else if(kind==='capabilityEmptyChain')actual=capResult(core.capabilityFinish(core.capabilityBasis(capItem(false),capRequirement(0),[],'incident',100),parts[0]));
  else if(kind==='capabilitySchema'){
   const variant=(name,code)=>({...capSchema(name),...(code===1?{name:'other'}:code===2?{version:'other'}:code===3?{digest:'other'}:{})}),req={...capRequirement(0),inputSchema:variant('input',Number(parts[0])),outputSchema:variant('output',Number(parts[1]))};
   actual=capResult(core.capabilityFinish(core.capabilityBasis(capItem(false),req,capChain(0,false),'incident',100),'allowed'));
  }
  else if(kind==='policyQueryInitial')actual=pqBudgetLabel(core.policyQueryInitial(Number(parts[0]),Number(parts[1])));
  else if(kind==='policyQueryCharge')actual=pqBudgetLabel(core.policyQueryCharge(pqBudget([undefined,0,1,32768][Number(parts[0])]),sequence([0,1,32768,2147483647],parts[1],parts[2])));
  else if(kind==='policyQueryProjection'){
   const [records,size,code,mask]=parts.map(Number),assertions=Array.from({length:size},(_,index)=>{
    const kind=Math.floor(code/4**index)%4,record=kind===1?'two':'one',sources=kind===0?0:kind===1?1000:32768;
    return {assertion:{ref:{systemId:kind===3&&index%2===0?'foreign':'system',contextId:kind===3&&index%2===1?'foreign':'context'},recordedBy:kind===2?'delegate':'owner',value:{record:{id:record},evidence:{sources:Array(sources)}}}};
   });
   const result=core.policyQueryProjection({context:{systemId:'system',id:'context'},records:Array(records),assertions},choose(['owner','delegate'],mask));
   actual=result?'ready:'+pqBudgetLabel(result.budget)+':'+result.provenance+':'+result.indices.join(',')+':'+result.records.join(','):'unknown';
  }
  else if(kind==='policyQuerySupported')actual=String(core.policyQuerySupported(parts[0],sequence([false,true],parts[1],parts[2]).map(visible=>({visible})),{canRead:ref=>ref.visible}));
  else if(kind==='policyQuerySelected')actual=String(core.policyQuerySelected({kind:parts[0],schema:{name:parts[1]}},['edge'],truth(parts[2]),truth(parts[3])));
  else if(kind==='policyQueryObserved')actual=String(core.policyQueryObserved(truth(parts[0]),truth(parts[1])));
  else if(kind==='policyQueryExistsBudget'){
   const [records,assertions,provenance,budget,size,code]=parts.map(Number),roles=Object.fromEntries(sequence([0,1,1000],size,code).map((cost,i)=>['r'+i,Array(cost)])),trusted={records:Array.from({length:records},(_,i)=>({value:i===0?{kind:'relation',roles}:{kind:'atom'}})),assertions:Array(assertions)};
   actual=pqBudgetLabel(core.policyQueryExistsBudget(pqBudget(budget),trusted,provenance,true));
  }
  else if(kind==='policyQueryRelated'){
   const [size,mask,budget,hops,operator]=parts,edges=topEdges(Number(size),mask),records=edges.map(({source,target},index)=>({ref:ref('edge'+index),value:{kind:'relation',schema:{name:'edge'},roles:{subject:[ref('n'+source)],object:[ref('n'+target)]}}}));
   const result=core.policyQueryRelated(pqBudget([undefined,0,2,3,6,9,15][Number(budget)]),records,new Set(records.map(item=>item.ref.id)),['edge'],pqEndpoint('n0'),pqEndpoint('n'+Math.max(0,Number(size)-1)),Number(hops),pqAccess(truth(operator)));
   actual=String(result.value)+':'+pqBudgetLabel(result.budget);
  }
  else if(kind==='controlProjection')actual=core.projectionPlan(sequence(ctlPaths,parts[0],parts[1]),truth(parts[2])?'schema':'record');
  else if(kind==='controlProjectionCount')actual=core.projectionPlan(Array(Number(parts[0])).fill('/value'),truth(parts[1])?'schema':undefined);
  else if(kind==='controlProposal'){
   const [revision,basis,policy,changes,executions]=parts;
   actual=core.proposalAdmission({id:'p',basisRevision:Number(revision),policy:ref('policy'),changes:ctlChanges[Number(changes)],executions:Array(Number(executions))},truth(basis)?Number(revision):otherRevision(revision),ref(truth(policy)?'policy':'other'));
  }
  else if(kind==='controlCommit'){
   const [state,revision,basis,policy]=parts;
   actual=core.commitAdmission({revision:Number(revision),value:{state,proposal:{policy:ref('policy')}}},{context:{revision:truth(basis)?Number(revision):otherRevision(revision),policy:ref(truth(policy)?'policy':'other')}});
  }
  else if(kind==='controlPlan')actual=core.proposalPlan({id:'p',incidentId:'i',changes:ctlChanges[Number(parts[0])],executions:sequence(ctlItems,parts[1],parts[2])});
  else if(kind==='controlVisible'){
   const [present,incident,operator,own,chain,readable]=parts;
   actual=String(core.transitionVisible(truth(present)?{ref:ref('p'),value:{proposal:{incidentId:'i'}}}:undefined,{principalId:truth(own)?'caller':'other',grantId:'g'},'caller',{operator:truth(operator),chain:ctlChains[Number(chain)].map(id=>({id})),canIncident:()=>truth(incident),canRead:()=>truth(readable)}));
  }
  else if(kind==='controlNamespace')actual=String(core.controlNamespace(sequence(ctlNames,parts[0],parts[1])));
  else if(kind==='controlRevoke')actual=String(core.grantRevocable(truth(parts[0]),ref(truth(parts[1])?'g':'target'),ref('g'),truth(parts[2])?'caller':'other','caller',ctlChains[Number(parts[3])].map(id=>({id}))));
  else if(kind==='controlActions')actual=String(core.grantActions(choose(['read','write'],parts[0]),choose(['read','write'],parts[1]),choose(['read','write'],parts[2])));
  else if(kind==='controlSchema')actual=core.schemaAdmission({name:parts[0],digest:'digest'},truth(parts[1]),truth(parts[2])?'digest':'other',truth(parts[3])?{value:{schema:{digest:truth(parts[4])?'digest':'other'}}}:undefined);
  else if(kind==='controlBindings')actual=String(core.ruleBindings(ctlBindings[Number(parts[0])]));
  else if(kind==='controlBound')actual=String(core.boundGrantSelected(truth(parts[0]),truth(parts[1])?ref('g'):undefined,truth(parts[2])?ref(truth(parts[3])?'g':'other'):undefined));
  else if(kind==='reactionSource')actual=core.reactionSource(truth(parts[0])?{revision:Number(parts[1])}:undefined,Number(parts[2]));
  else if(kind==='reactionEvent')actual=core.reactionEvent(truth(parts[0]),parts[1],[[],['wanted'],['other']][Number(parts[2])]);
  else if(kind==='reactionMode')actual=core.reactionMode(...parts.map(Number));
  else if(kind==='reactionTrace')actual=core.reactionFinish(sequence([true,false,'unknown'],parts[0],parts[1]).reduce((state,value)=>core.reactionObserve(state,value),core.reactionBegin()));
  else if(kind==='resourceCompare')actual=String(core.resourceCompare(Number(parts[0]),Number(parts[1])));
  else if(kind==='counterNext'){
   try{actual=String(core.counterNext(Number(parts[0])));}catch(error){if(error.code!=='LIMIT_EXCEEDED')throw error;actual='overflow';}
  }
  else if(kind==='awDetail'){
   const [message,kind,roles,incident,scope,dependencies]=parts,toRefs=values=>values.map((visible,i)=>({...ref('s'+i),visible}));
   actual=core.awarenessDetail({value:{kind,roles:{r:toRefs(awBools[Number(roles)])},evidence:{sources:toRefs(awBools[Number(dependencies)])}}},truth(message),truth(incident),truth(scope),{canRead:r=>r.visible});
  }
  else if(kind==='awMessageVisible')actual=String(core.messageVisible(truth(parts[0])?{value:{recipientId:truth(parts[1])?'actor':'other'}}:undefined,'actor',truth(parts[2])));
  else if(kind==='awMessage')actual=core.messageAdmission(Number(parts[0]),Number(parts[1]),truth(parts[2]),truth(parts[3]),truth(parts[4]));
  else if(kind==='awReply'){
   const [kind,code]=parts,n=Number(code),mask=n-2,message={kind,incidentId:'i',recipientId:'recipient',...(n?{inReplyTo:'parent'}:{})};
   const parent=n<2?undefined:{recordedBy:mask&8?'recipient':'other',value:{kind:mask&1?'request':'notice',incidentId:mask&2?'i':'other',recipientId:mask&4?'actor':'other'}};
   actual=core.messageReply(message,'actor',parent);
  }
  else if(kind==='awRecipients'){
   const grants=Object.fromEntries(sequence(['actor','other'],parts[1],parts[2]).map((principalId,i)=>['g'+i,{value:{principalId},ref:ref(String(i))}])),result=core.recipientCandidates({controlState:{grants}},'actor',truth(parts[0])?'actor':'owner');
   actual=result.length&&result[0]===undefined?'owner':result.map(r=>r.id).join(',');
  }
  else if(kind==='awSelected')actual=String(core.messageSelected(truth(parts[0]),truth(parts[1])));
  else if(kind==='awMessageCompare')actual=String(core.messageCompare({revision:Number(parts[0]),ref:ref('a')},{revision:Number(parts[1]),ref:ref(parts[2])}));
  else if(kind==='awTemplate'){
   const expected={name:'prompt',version:'1',digest:'digest'},template={ref:ref('t'),value:{kind:truth(parts[0])?'atom':'relation',schema:{...expected,digest:truth(parts[1])?'digest':'other'}}};
   actual=String(core.promptTemplate(template,{ref:ref(truth(parts[2])?'t':'other')},expected));
  }
  else if(kind==='awSupported'){
   const assertions=sequence(awSupports,parts[0],parts[1]).map(([target,issuer,status,sources])=>({status,assertion:{recordedBy:issuer,value:{record:ref(target),evidence:{sources:sources.map(visible=>({...ref('evidence'),visible}))}}}}));
   actual=String(core.templateSupported(assertions,ref('t'),truth(parts[2])?['owner']:[],{canRead:r=>r.visible}));
  }
  else if(kind==='awSlots')actual=String(core.promptSlots(Number(parts[0]),choose(['a','b'],parts[1]),choose(['a','b','x'],parts[2]),choose(['a','b','x'],parts[3]),truth(parts[4])));
  else if(kind==='awPromptCandidates'){
   const declared=choose(['a','b','c'],parts[1]);actual=core.promptCandidates(truth(parts[0])?declared.toReversed():declared,choose(['a','b','c'],parts[2])).join(',');
  }
  else if(kind==='awPromptStep'){
   const result=core.promptStep([[],['a'],['a','b'],['b','a']][Number(parts[0])],Number(parts[1]),Number(parts[2]));actual=result.kind==='PromptOmit'?result.kind+':'+result.slot+':'+result.remaining.join(','):result.kind;
  }
  else if(kind==='awRoute')actual=core.eventRefRoute(...parts.map(truth));
  else if(kind==='awScan')actual=String(core.eventScanRequest(...parts.map(Number)));
  else if(kind==='awVisibility'){
   const [size,mask,missing,foreign,readable,group,operator]=parts.map((part,i)=>i===6?truth(part):Number(part)),events=new Map();
   for(let i=0;i<size;i++)if(!(missing&2**i))events.set('e'+i,{id:'e'+i,contextId:foreign&2**i?'foreign':'context',visibilityAlternatives:awGroups[group].map(group=>group.map(ref)),causeIds:Array.from({length:size},(_,j)=>j).filter(j=>mask&2**(i*size+j)).map(j=>'e'+j)});
   actual=String(core.eventVisible(operator,events.get('e0'),'context',id=>events.get(id),r=>!!(readable&2**Number(r.id.slice(1)))));
  }
  else if(kind==='guiPath') {const paths=[[],['a'],['b'],['a','b'],['ab'],['a','b','c'],['é']];actual=String(core.guidancePath('/',paths[Number(parts[0])],truth(parts[2])?'/':'other',paths[Number(parts[1])]));}
  else if(kind==='guiRegistration')actual=core.guidanceRegistration(truth(parts[0]),truth(parts[1])?{value:{definitionDigest:'d'}}:undefined,Number(parts[2]),truth(parts[3])?'d':'other');
  else if(kind==='guiRefresh')actual=core.guidanceRefresh(...parts.map(truth));
  else if(kind==='guiRetained')actual=String(core.guidanceRetained(...parts.map(Number)));
  else if(kind==='guiError')actual=core.guidanceObservationError(parts[0],truth(parts[1]));
  else if(kind==='guiSelected')actual=String(core.guidanceSelected(...parts.slice(0,3).map(truth),awBools[Number(parts[3])]));
  else if(kind==='guiReviewSize')actual=core.guidanceReviewSize(Number(parts[0]));
  else if(kind==='guiReviewSource')actual=String(core.guidanceReviewSource(truth(parts[0]),parts[1]));
  else if(kind==='guiReviewBytes')actual=String(core.guidanceReviewBytes(sequence([0,1,131072,131073,2**32,Number.MAX_SAFE_INTEGER],...parts)));
  else if(kind==='guiCurrent') {
   const [present,active,sameDefinition,observation,code]=parts,capture={ref:ref('capture'),value:{definitionDigest:truth(sameDefinition)?'d':'other'}},latest={...ref('capture'),...(Number(code)===1?{id:'other'}:Number(code)===2?{systemId:'foreign'}:Number(code)===3?{contextId:'foreign'}:{})};
   actual=String(core.guidanceCurrent(truth(present)?{value:{active:truth(active),definitionDigest:'d',latest:{state:observation,capture:latest}}}:undefined,capture));
  }
  else if(kind==='guiBasis')actual=core.guidanceBasis(truth(parts[0])?{digest:'d'}:undefined,truth(parts[1])?'d':'other');
  else if(kind==='guiPolicy') {
   const code=Number(parts[0]),actualRef={...ref('policy'),...(code===1?{id:'other'}:code===2?{systemId:'foreign'}:code===3?{contextId:'foreign'}:{})};actual=String(core.guidancePolicy(actualRef,ref('policy'),'d',truth(parts[1])?'d':'other'));
  }
  else if(kind==='guiProfile') {
   const expected={providerId:'provider',name:'profile',version:'1',inputSchema:{name:'input',version:'1',digest:'d'},outputSchema:{name:'output',version:'1',digest:'d'},isolation:'process',reconciliation:'lookup',features:['a','b']},actualProfile={...expected};
   for(const [index,key] of Object.keys(expected).entries())if(Number(parts[0])&2**index)actualProfile[key]=['inputSchema','outputSchema'].includes(key)?{...expected[key],name:'other'}:key==='features'?['b','a']:'other';
   actual=String(core.guidanceProfileMatches(actualProfile,expected));
  }
  else if(kind==='guiAvailable')actual=String(core.guidanceProfileAvailable(truth(parts[0]),truth(parts[1]),date(Number(parts[2])),100));
  else if(kind==='guiGrant') {
   const [same,actions,code,operator,bound]=parts,resource={...ref('cap'),...(Number(code)===1?{id:'other'}:Number(code)===2?{systemId:'foreign'}:Number(code)===3?{contextId:'foreign'}:{})};
   actual=String(core.guidanceGrant({ref:ref('g'),value:{principalId:truth(same)?'actor':'other',actions:choose(['local.moment.guidance','guidance.review'],actions),resourceRefs:Number(code)===4?[]:[resource]}},'actor',ref('cap'),{operator:truth(operator),chain:[{id:truth(bound)?'g':'other'}]}));
  }
  else if(kind==='guiCandidate')actual=String(core.guidanceCandidate(parts[0],truth(parts[1]),truth(parts[2])));
  else if(kind==='guiSettlement')actual=String(core.guidanceSettlement(parts[0],truth(parts[1])));
  else if(kind==='guiCompare')actual=String(core.guidanceCandidateCompare(...parts));
  else if(kind==='guiResult')actual=core.guidanceResult(parts[0],truth(parts[1]),truth(parts[2]));
  else if(kind==='guiQuote')actual=core.guidanceQuote(Number(parts[0]),truth(parts[1]));
  else if(kind==='guiEditorial')actual=String(core.guidanceEditorial(truth(parts[0]),Number(parts[1]),truth(parts[2])));
  else if(kind==='guiCaptureRoom')actual=String(core.guidanceCaptureRoom(Number(parts[0])));
  else if(kind==='memStatus')actual=[core.memoryTerminal(parts[0]),core.memoryPending(parts[0]),core.memoryGap(parts[0])].join(':');
  else if(kind==='memUser')actual=[core.memoryUser(parts[0]),core.memoryFocusSource({authorship:parts[0],origin:parts[1]})].join(':');
  else if(kind==='memObservation')actual=core.memoryObservation(parts[0]);
  else if(kind==='memSelection') {
   const lists=[[],['a'],['b','a'],['a','a']],sources=[[],['a'],['b'],['a','b'],['b','a'],['context'],['a','context','context']],selected=core.memorySelection(lists[Number(parts[0])],lists[Number(parts[1])],lists[Number(parts[2])],sources[Number(parts[3])],Number(parts[4]));
   actual=selected.selectableSourceIds.join(',')+':'+selected.contextOnlySourceIds.join(',')+':'+selected.maximumEntries;
  }
  else if(kind==='memFocusHeader')actual=core.memoryFocusHeader(...parts.map(Number));
  else if(kind==='memFocusProjection')actual=core.memoryFocusProjection(truth(parts[0]));
  else if(kind==='memFocusSelect')actual=core.memoryFocusSelect(truth(parts[0]),truth(parts[1]),Number(parts[2]),Number(parts[3]));
  else if(kind==='memFocusRelease') {
   const replacements=[undefined,'','released','current','other'],value=core.memoryFocusRelease(truth(parts[0]),truth(parts[1]),'released',truth(parts[2])?'released':'current',replacements[Number(parts[3])]);actual=value.kind+(value.id===undefined?'':':'+value.id);
  }
  else if(kind==='memFocusChanged')actual=String(core.memoryFocusChanged(truth(parts[0]),truth(parts[1]),'target',truth(parts[2])?'target':'other'));
  else if(kind==='memConfigure')actual=core.memoryConfigure({revision:Number(parts[0]),enabled:truth(parts[4])},Number(parts[1]),Number(parts[2]),Number(parts[3]),truth(parts[5]));
  else if(kind==='memDisable')actual=String(core.memoryDisableInput(truth(parts[0]),{automatic:truth(parts[1]),status:parts[2]}));
  else if(kind==='memEnrollment')actual=core.memoryEnrollment({enabled:truth(parts[0]),revision:Number(parts[1])},Number(parts[2]));
  else if(kind==='memAdmission')actual=core.memoryAdmission(...parts.slice(0,3).map(truth),...parts.slice(3).map(Number));
  else if(kind==='memClaim')actual=core.memoryClaim(...parts.map(truth));
  else if(kind==='memBasis') {
   const [basis,mask]=parts.map(Number),flag=index=>!!(mask&2**index),different=basis===0?1:0;
   const state={revision:flag(7)?basis:different,processedThrough:flag(4)?basis:different},binding={focusRevision:basis},target=flag(0)?{id:'set',revision:flag(3)?basis:different}:undefined,focus={revision:flag(5)?basis:different,workingSetId:flag(6)?'set':'other'},dispatch={cacheRevision:basis,processedThrough:basis,...(flag(1)?{workingSetId:flag(2)?'set':'other',workingSetRevision:basis,focusRevision:basis}:{})};
   actual=core.memoryCompletionBasis(state,binding,target,focus,dispatch);
  }
  else if(kind==='memOutput')actual=core.memoryOutput(...parts.map(truth));
  else if(kind==='memEntry')actual=core.memoryEntrySelection([[],['a'],['a','a'],['a','b'],['context'],['a','context']][Number(parts[0])],choose(['a','b'],parts[1]),Number(parts[2]));
  else if(kind==='memReconcile')actual=core.memoryReconcile(truth(parts[0])?{id:'d',status:parts[2]}:undefined,truth(parts[1])?'d':'other',parts[3]);
  else if(kind==='memCancel') {
   const [present,sameKey,sameSequence,sequence]=parts,seq=Number(sequence);actual=String(core.memoryCancelUncertain(truth(present)?{key:'key',sequence:seq}:undefined,truth(sameKey)?'key':'other',truth(sameSequence)?seq:seq===0?1:0));
  }
  else if(kind==='memCancelStatus')actual=core.memoryCancelStatus(parts[0]);
  else if(kind==='memAutomation')actual=core.memoryAutomation({enabled:truth(parts[0]),revision:Number(parts[4]),...(truth(parts[2])?{lastIntake:{subscriptionRevision:truth(parts[3])?Number(parts[4]):0}}:{})},truth(parts[1]));
  else if(kind==='memHeadDue')actual=String(core.memoryHeadDue(parts[0],Number(parts[1]),Number(parts[2])));
  else if(kind==='memNextHead') {
   const heads=sequence(Array.from({length:16},(_,index)=>index),...parts).map((value,index)=>({order:['-9223372036854775808','-1','1','9223372036854775807'][Math.floor(value/4)],input:{status:value%2?'pending':'unknown',sequence:Math.floor(value/2)%2?1:2},processedThrough:0}));actual=String(core.memoryNextHead(heads)??'none');
  }
  else if(kind==='memRebuild') {
   const revision=Number(parts[3]),different=revision===0?1:0;actual=String(core.memoryRebuildBasis(truth(parts[0]),revision,truth(parts[1])?revision:different,revision,truth(parts[2])?revision:different));
  }
  else if(kind==='memDispatch')actual=String(core.memoryDispatch(truth(parts[0])?{id:'d',status:parts[2]}:undefined,truth(parts[1])?'d':'other',truth(parts[3])));
  else if(kind==='maFrame') {
   const phase=[undefined,'','commentary','final','analysis','final_answer'][Number(parts[1])],item={role:parts[0],...(phase===undefined?{}:{phase})};actual=core.memoryVisibleAssistant(item)+':'+core.memoryFrame(item);
  }
  else if(kind==='maExchange') {
   const variants=[['assistant','final',1],['assistant','analysis',1],['assistant',undefined,1],['user',undefined,1],['assistant','final',0],['assistant','commentary',1],['system',undefined,0],['assistant','',1]];
   actual=String(core.memoryLatestExchange(sequence(variants,...parts).map(([role,phase,outputParts])=>({item:{role,...(phase===undefined?{}:{phase})},outputParts})))??'none');
  }
  else if(kind==='maParts')actual=String(core.memoryPartsFit(Array(Number(parts[0])).fill(Number(parts[1])),Number(parts[2])));
  else if(kind==='maHistory')actual=core.memoryHistoryPart(parts[0],Number(parts[1]),Number(parts[2]));
  else if(kind==='maFull')actual=String(core.memoryHistoryFull(...parts.map(Number)));
  else if(kind==='maProject') {
   const mask=Number(parts[0]),flag=index=>!!(mask&2**index),registry={systemId:flag(0)?'system':'foreign',projects:[{id:flag(1)?'p':'other',contextIds:flag(2)?['c']:[]}]};actual=String(core.memoryProject(registry,{systemId:'system',projectId:'p',contextId:'c'},flag(3)?['p']:[]));
  }
  else if(kind==='maError')actual=core.memoryBindingError(parts[0]);
  else if(kind==='maBootstrap') {
   const value=core.memoryWorkerBootstrap(truth(parts[0]),truth(parts[1]),truth(parts[2])?{status:parts[4]}:undefined,truth(parts[3]));actual=value.state+':'+value.markUnknown;
   assert.equal(core.memoryWorkerMode(truth(parts[0]),truth(parts[1]),truth(parts[2])),value.state,'Bootstrap mode and continuing worker selection agree');
  }
  else if(kind==='maEnabled')actual=String(core.memoryWorkerEnabled(...parts.map(truth)));
  else if(kind==='maQueue')actual=String(core.memoryWorkerQueueNeeded(parts[0],truth(parts[1])));
  else if(kind==='maWake') {const value=core.memoryWorkerWake(parts[0],...parts.slice(1).map(truth));actual=value.queued+':'+value.action;}
  else if(kind==='maDemand')actual=core.memoryWorkerDemand(...parts.map(truth));
  else if(kind==='maFault')actual=core.memoryWorkerFault(...parts.map(truth));
  else if(kind==='maAgain')actual=String(core.memoryWorkerAgain(truth(parts[0]),truth(parts[1]),parts[2],truth(parts[3]),truth(parts[4])));
  else if(kind==='maCancel') {
   const session={runtimeId:'runtime',sessionId:'one'},sessionCode=Number(parts[1]),actualSequence=Number(parts[3]),requestedSequence=truth(parts[2])?actualSequence:actualSequence===0?1:0;
   actual=String(core.memoryWorkerCancel(truth(parts[0])?{request:{session},sequence:actualSequence}:undefined,{...session,...(sessionCode===1?{runtimeId:'other'}:sessionCode===2?{sessionId:'other'}:{})},requestedSequence,parts[4]));
  }
  else if(kind==='retCategory') {try{actual=core.memoryValueCategory(parts[0]);}catch(error){if(error.code!=='UNSUPPORTED_VERSION')throw error;actual='unknown';}}
  else if(kind==='retUsage') {
   const pools=[[],['profile'],['entries'],['basis','raw'],['profile','entries','outcome'],['future']],metadata=[{assessments:[],working:[],receipts:[],focus:0,bindings:0},{assessments:[1],working:[2],receipts:[3],focus:1,bindings:2},{assessments:[Number.MAX_SAFE_INTEGER],working:[Number.MAX_SAFE_INTEGER],receipts:[],focus:0,bindings:0},{assessments:[],working:[],receipts:[],focus:Number.MAX_SAFE_INTEGER,bindings:Number.MAX_SAFE_INTEGER}];
   try{actual=amountLabel(core.memoryRetentionUsage(parts[0],{values:pools[Number(parts[1])].map(kind=>({kind,bytes:Number(parts[2])})),...metadata[Number(parts[3])]}));}catch(error){if(error.code!=='UNSUPPORTED_VERSION')throw error;actual='unknown-kind';}
  }
  else if(kind==='retPressure') {
   const ceiling=Number(parts[3]);actual=core.memoryRetentionPressure(parts[0],[Infinity,0,1,Number.MAX_SAFE_INTEGER][Number(parts[1])],Number(parts[2]),{maxProfileBytes:ceiling,maxWorkingSetBytes:ceiling,maxAssessmentBytes:ceiling});
  }
  else if(kind==='retCollect') {
   const values=sequence(['profile','entries','raw','future'],...parts.slice(0,2)).map((kind,index)=>({kind,digest:'v'+index})),live=values.filter((_value,index)=>Number(parts[2])&2**index).map(value=>value.kind+'\0'+value.digest),states=[[],['succeeded'],['unknown'],['future']][Number(parts[3])];
   try{actual='ok:'+core.memoryCollectValues(values,live,states).join(',');}catch(error){if(error.code!=='UNSUPPORTED_VERSION')throw error;if(error.message==='Unrecognized assessment state; collection preserves its evidence')actual='state';else if(error.message==='Unrecognized pooled memory value kind; collection preserves its bytes')actual='kind';else throw error;}
  }
  else if(kind==='retRetire') {
   const variants=[['succeeded',true,'9223372036854775807'],['failed',true,'-9223372036854775808'],['unknown',true,'-1'],['running',true,'1'],['future',true,'0'],['succeeded',false,'0'],['succeeded',true,'9223372036854775807'],['succeeded',true,'-9223372036854775808']],rows=sequence(variants,...parts.slice(0,2)).map(([status,basis,ordinal],index)=>({ordinal,value:{id:'r'+index,status,...(basis?{basis:{}}:{})}})),protectedIds=rows.filter((_value,index)=>Number(parts[2])&2**index).map(row=>row.value.id);
   try{actual=String(core.memoryRetireAssessment(rows,protectedIds)??'none');}catch(error){if(error.code!=='UNSUPPORTED_VERSION')throw error;actual='state';}
  }
  else if(kind==='retAvailability') {
   const reason=[undefined,'not-supplied','oversize'][Number(parts[2])];try{actual=core.memoryNativeAvailability({raw:truth(parts[0]),basisAvailability:parts[1],...(reason===undefined?{}:{rawUnavailable:{reason}}),status:parts[3]});}catch(error){if(error.code!=='UNSUPPORTED_VERSION')throw error;actual='unsupported';}
  }
  else if(kind==='retExcess')actual=String(core.memoryRetentionExcess(...parts.map(Number)));
  else if(kind==='capCandidate') {
   const [source,target,allowed]=capCandidateInputs(parts[0],parts[1]),[used,maximum]=[[Infinity,1],[0,0],[0,1],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]][Number(parts[2])];actual=core.captureCandidate(source,target,allowed,used,maximum);
  }
  else if(kind==='capPair') {const [a,b]=capPairInputs(...parts);actual=core.captureObservedPair(capPayload('s'),capPayload('t'),a,b);}
  else if(kind==='capObservation')actual=core.captureObservation(parts[0],truth(parts[1]),truth(parts[2]));
  else if(kind==='capDeclaration')actual=String(core.captureDeclaration({path:'payload',availability:{kind:parts[0],restoration:Array(Number(parts[1])).fill('r'),verifiedEvidence:Array(Number(parts[2])).fill('e'),dispositionEvidence:Array(Number(parts[3])).fill('d'),path:truth(parts[4])?'payload':'other'}}));
  else if(kind==='capProtection')actual=String(core.captureProtection({kind:parts[0],pins:Array(Number(parts[1])).fill('pin')}));
  else if(kind==='capTargets')actual=String(core.captureTargets(capIds[Number(parts[0])],Number(parts[1])));
  else if(kind==='capSurvivors')actual=String(core.captureSurvivors(capIds[Number(parts[0])],capIds[Number(parts[1])]));
  else if(kind==='capCapacity')actual=String(core.captureCapacity(Number(parts[0]),Number(parts[1]),capAmounts[Number(parts[2])],Number(parts[3])));
  else if(kind==='capSum')actual=amountLabel(core.captureSum(sequence(capBudgetValues,...parts)));
  else if(kind==='capCustody')actual=String(core.captureCustody({enabled:truth(parts[0])},{confirmed:truth(parts[1]),participants:Array(Number(parts[3])).fill('p'),unknownWriters:Array(Number(parts[4])).fill('w')},truth(parts[2])));
  else if(kind==='capGroup')actual=String(core.captureRunGroup(capScopeSample(parts[0]))===core.captureRunGroup(capScopeSample(parts[1])));
  else if(kind==='capCompare')actual=String(core.captureRunCompare({id:parts[0],order:Number(parts[2])},{id:parts[1],order:Number(parts[3])}));
  else if(kind==='capRuns')actual=capRunResult(sequence([0,1,2,3,4,5,6,7],...parts.slice(0,2)).map((variant,index)=>capRunVariant(variant,index,Number(parts[2]))));
  else if(kind==='capDependencies')actual=capRunResult(capGraphRuns(...parts));
  else if(kind==='capRunInvalid') {
   const run=capRunVariant(0,0,0),future={...run,run:{...run.run,state:'future'}},other={...future,run:{...future.run,id:'other'}};actual=capRunResult([[],[run,run],[future],[run,future],[run,other]][Number(parts[0])]);
  }
  else if(kind==='capHeader')actual=String(core.captureManifestHeader({generation:Number(parts[0]),...(truth(parts[1])?{previousDigest:'d'}:{})}));
  else if(kind==='capGeneration') {
   const previous=[undefined,'d','other'][Number(parts[1])],head=[undefined,{generation:1,digest:'d'},{generation:2,digest:'d'},{generation:Number.MAX_SAFE_INTEGER-1,digest:'d'},{generation:Number.MAX_SAFE_INTEGER,digest:'d'}][Number(parts[2])];actual=core.captureGeneration({generation:Number(parts[0]),...(previous===undefined?{}:{previousDigest:previous})},head);
  }
  else if(kind==='capReceipt')actual=core.captureReceipt({state:parts[0],completedItems:Number(parts[1]),files:Number(parts[2])},Number(parts[3]));
  else if(kind==='capLock') {
   const expected=truth(parts[2])?'':'operation';actual=String(core.captureLockReclaim({operationDigest:truth(parts[0])?expected:'other',target:'scope'},truth(parts[1])?'scope':'other',expected,truth(parts[3])));
  }
  else if(kind==='capPointer') {const current={digest:truth(parts[1])?'published':'current'};actual=String(core.capturePointer(current,truth(parts[0])?current:{digest:'before'},'published'));}
  else if(kind==='stFormat')actual=core.storageFormat(parts[0],Number(parts[1]));
  else if(kind==='stReady')actual=String(core.storageReady(truth(parts[0])?{formatVersion:Number(parts[1]),stage:parts[2]}:undefined));
  else if(kind==='stPlan') {const [kernel,memory]=[[2,3],[2,2],[1,3],[3,3],[2,4]][Number(parts[2])];actual=core.storagePlanFormats({from:{kernel:Number(parts[0]),memory:stMemoryVersions[Number(parts[1])]},to:{kernel,memory}});}
  else if(kind==='stSource')actual=String(core.storageSourceFormat(stVersions[Number(parts[0])],stVersions[Number(parts[1])],Number(parts[2]),truth(parts[3])));
  else if(kind==='stPreserve')actual=String(core.storagePreserveMemory(Number(parts[0])));
  else if(kind==='stHold')actual=String(core.storageExecutionHold(parts[0]));
  else if(kind==='stMemory')actual=core.storageMemoryReceipt(parts[0])+':'+core.storageMemoryDispatch(parts[0]);
  else if(kind==='stLabor') {const holder=[undefined,'memory','guidance','other',''][Number(parts[2])];actual=String(core.storageLabor(truth(parts[0])?{formatVersion:Number(parts[1]),...(holder===undefined?{}:{holder:{component:holder}})}:undefined,truth(parts[3])));}
  else if(kind==='stJournal')actual=core.storageJournal(truth(parts[0])?{formatVersion:Number(parts[1]),planDigest:truth(parts[2])?'plan':'other',stage:parts[3]}:undefined,'plan');
  else if(kind==='stConversion')actual=String(core.storageConversionNeeded(parts[0]));
  else if(kind==='stEnrollment')actual=String(core.storageEnrollment({session:truth(parts[0])?'session':'other',idempotencyKey:truth(parts[1])?'key':'other',enabled:truth(parts[2])},'session','key'));
  else if(kind==='stInitialization') {const flag=index=>capFlag(parts[0],index);actual=String(core.storageInitialization(flag(0)?null:1,parts[2],flag(1)?{formatVersion:Number(parts[1]),component:flag(2)?'memory':'other',systemId:flag(3)?'system':'other',planDigest:flag(4)?'plan':'other'}:undefined,'system','plan'));}
  else throw Error('Unknown model case');
  assert.equal(actual,expected,'Native/model correspondence mismatch: '+row);
 }
 assert.deepEqual(counts,{not:3,all:9,any:9,policy:9,record:4,assertion:12,withdraw:3,graph:63,grant:576,grantEnd:2,policyRules:1024,issuers:16,runTerminal:8,runStep:104,runTrace:1352,topology:1062,topologyExtra:18,topologyProjection:48,topologyCombine:17,topologyCertificate:13824,accessOperator:8,accessResource:680,accessIncident:510,accessMethod:1020,incidentTerminal:4,incidentEdit:16,incidentEvidence:12,mutationBasis:96,querySelection:768,queryRelated:96,budgetAdd:121,budgetLe:121,budgetCapacity:1296,budgetCharge:648,budgetUsage:270,budgetTrace:576,fenceNext:11,singleSlot:11,budgetSubtract:121,fenceEqual:121,leaseWindow:93,leaseExpiry:72,leaseValid:384,retryAdmission:12,executionQueued:8,executionDeadline:16,executionMaintenance:384,clockDelay:156,resourceBlocked:85,capacityAvailable:259,resourceEnvelope:234,calendarAfter:16,scheduleCancel:3,scheduleMatches:12,scheduleReady:576,scheduleScan:24,scheduleWatch:24,scheduleNeedsEvents:4,scheduleBaseline:8,scheduleWake:16,scheduleMode:48,scheduleEventGate:36,scheduleObservation:8,scheduleQueue:180,scheduleAdvance:64,scheduleCapacityEdge:8,scheduleVisible:64,scheduleSelection:16,scheduleChoose:80,scheduleCausality:192,scheduleRoom:4,scheduleOrder:33,scheduleCompleted:2,scheduleRetryFault:3,capabilityBasis:2048,capabilityCompare:324,capabilityPublish:24,executionRoom:4,executionAdmission:32,executionDeadlineAdmission:6,executionPrepare:64,executionVisible:512,executionReconcile:8,executionEvidence:4,capabilityBoundGrant:4,capabilitySelected:4,capabilityEmptyChain:4,capabilitySchema:16,policyQueryInitial:16,policyQueryCharge:340,policyQueryProjection:680,policyQuerySupported:30,policyQuerySelected:16,policyQueryObserved:4,policyQueryExistsBudget:2160,policyQueryRelated:22302,controlProjection:546,controlProjectionCount:10,controlProposal:180,controlCommit:36,controlPlan:105,controlVisible:96,controlNamespace:43,controlRevoke:24,controlActions:64,controlSchema:32,controlBindings:5,controlBound:16,reactionSource:242,reactionEvent:12,reactionMode:27,reactionTrace:121,resourceCompare:121,counterNext:11,awDetail:384,awMessageVisible:8,awMessage:96,awReply:54,awRecipients:62,awSelected:4,awMessageCompare:363,awTemplate:8,awSupported:518,awSlots:2048,awPromptCandidates:128,awPromptStep:120,awRoute:64,awScan:36,awVisibility:14840,guiPath:98,guiRegistration:40,guiRefresh:4,guiRetained:768,guiError:22,guiSelected:32,guiReviewSize:6,guiReviewSource:8,guiReviewBytes:259,guiCurrent:160,guiBasis:4,guiPolicy:8,guiProfile:256,guiAvailable:12,guiGrant:160,guiCandidate:32,guiSettlement:16,guiCompare:256,guiResult:20,guiQuote:10,guiEditorial:12,guiCaptureRoom:4,memStatus:9,memCancelStatus:9,memObservation:5,memUser:15,memSelection:1344,memFocusHeader:121,memFocusProjection:2,memFocusSelect:60,memFocusRelease:40,memFocusChanged:8,memConfigure:216,memDisable:36,memEnrollment:18,memAdmission:864,memClaim:4,memBasis:768,memOutput:16,memEntry:96,memReconcile:216,memCancel:24,memAutomation:32,memHeadDue:1089,memNextHead:4369,memRebuild:24,memDispatch:72,maFrame:30,maExchange:585,maParts:48,maHistory:45,maFull:9,retExcess:9,maProject:16,maError:8,maBootstrap:64,maEnabled:8,maQueue:8,maWake:64,maAgain:64,maDemand:4,maFault:8,maCancel:72,retCategory:7,retUsage:288,retPressure:144,retCollect:2720,retRetire:4680,retAvailability:192,capCandidate:24576,capPair:3584,capObservation:20,capDeclaration:80,capProtection:27,capTargets:20,capSurvivors:16,capCapacity:192,capSum:133,capCustody:72,capGroup:4096,capCompare:324,capRuns:23405,capDependencies:4248,capRunInvalid:5,capHeader:10,capGeneration:75,capReceipt:135,capLock:16,capPointer:4,stFormat:18,stReady:25,stPlan:175,stSource:144,stPreserve:6,stHold:8,stMemory:9,stLabor:31,stJournal:49,stConversion:6,stEnrollment:8,stInitialization:576});
 return {cases:rows.length,counts,coverage:'Finite truth/support and execution tables and two-step traces; record/support orderings through length five; grant boundaries and four-rule/two-action policies; every directed graph through three nodes and named rank certificates; bounded scope chains, incident/evidence/revision and query products; exact resource/count boundaries and scoped reservation traces; bounded lease windows and wall/quarter-millisecond expiry observations, credentials/fences, retries, maintenance and timer/overrun selections; relative calendar bounds, compound envelopes and capacity intersections; bounded scheduler lifecycle/readiness/visibility/queue/edge/cursor and incident-choice products, plus all two-node causal edge masks with selected dependence and missing/foreign observations; structured capability compatibility/policy-phase/schema/grant/ranking/publication and execution-admission/visibility/evidence products; relationship-policy budget/projection/support and complete directed graphs through three nodes under named hop/budget/view products; projection/root/grouping/path/count, exact proposal/commit bases, identity plans, transition branches, grant/schema and binding products; reaction source/filter/mode products, every three-valued observation trace through length four and exact count ordering and journal increment boundaries; mailbox/detail/recipient/reply/template/provenance/slot/omission products and all directed visibility graphs through two nodes under named missing/foreign/readability/alternative/operator products; normalized-root/component, source admission/withdrawal/observation/freshness, exact evidence/retention bounds, task/policy/profile identities, grant selection, recovery candidates and quotation-status products; memory source/selection/focus/enrollment/admission and late-result basis products, explicit reconciliation/cancellation/automation stages, exact counter boundaries and all input-head combinations through three sessions with signed SQLite ordinal extremes; adapter role/phase/exchange/history/association and worker recovery/wake/fault/cancellation products; exact pooled-value and metadata accounting, overflow/capacity, root-preserving collection and protected retirement through three rows with signed ordinal extremes and explicit unknown formats; capture eligibility and exact metadata/executable products, structured system/project/context/worktree grouping, active/latest-two/pin roots through four runs and every directed dependency graph through three runs, generation/custody/receipt/pointer products; storage formats, private-record presence, execution settlement and forward-recovery/enrollment admission',limitations:['Capture/storage models assume authenticated complete manifests, filesystem observations, private records and settled custody. They establish value decisions, not filesystem durability, signatures, process retirement or atomic cross-database effects; native recovery and effect tests remain necessary','Memory adapter/retention models assume authentic complete roots, native format/integrity and source byte observations. Logical accounting is not a physical disk quota; collector effects and transaction rollback require actual native tests. Historical source meaning, host custody and provider outcome are not manufactured by selection','Memory models assume authentic session/source/binding/row observations and the stated independent revisions. Schema validation, source text, model meaning, SQLite snapshot/atomicity, hash integrity, current external authority and provider termination evidence remain native obligations. Signed row-order codecs are independently exercised through the actual SQLite adapter','Guidance models assume actual normalized path components, current authorized source/task/policy objects and immutable capture identities; filesystem custody, UTF-8/text matching, byte measurement, schema compilation, model interpretation and effects remain independently checked native ports','Finite exhaustive correspondence only within the named input sets, not every possible policy or graph','Topology certificate theorem excludes cycles under its complete rank-check premise; native input assembly and compiler translation remain trust boundaries','Lease comparison tables assume authenticated clock observations in their stated frames; native fractional interpolation is separately exercised and is not a physical-clock theorem','Execution signals require native lease/provider/evidence/current-authority validation; state selection grants none of those','Grant scope tables assume independently validated current grant chains and authenticated principal observations','Theorems concern their stated models; compiler/translation and native adapters remain explicit trust boundaries','Resource counting is accounting, not host-enforced isolation or currency conversion; numeric codecs and native effects require independent execution checks','Scheduler selection remains conditional on current admission, delivered observations, worker fairness and available resources; the finite cases are not an unconditional liveness theorem','Capability matching uses upstream-validated current grant chains and observed policy results; advertised compatibility and isolation labels do not establish dispatch permission or physical isolation','Awareness graphs use fixed per-run readability for model comparison; actual reference observations remain fresh and short-circuit in the native demand port. Authenticated principals, immutable event/source assembly, UTF-8 byte measurement, regex/JSON encoding and current policy reads remain native obligations','Control decisions assume actual current authorization and complete native observations; JSON Pointer parsing/content selection, schema compilation, atomic store effects and receipt recovery remain native obligations','Relationship tables compare the independently modeled complete graph with the actual budget-selected prefix/codec; native record authenticity and current scope observations remain separate obligations']};
}
