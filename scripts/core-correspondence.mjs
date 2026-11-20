import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';

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
 assert.equal(rows.length,24405,'The complete declared finite correspondence set must be present');
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
  else throw Error('Unknown model case');
  assert.equal(actual,expected,'Native/model correspondence mismatch: '+row);
 }
 assert.deepEqual(counts,{not:3,all:9,any:9,policy:9,record:4,assertion:12,withdraw:3,graph:63,grant:576,grantEnd:2,policyRules:1024,issuers:16,runTerminal:8,runStep:104,runTrace:1352,topology:1062,topologyExtra:18,topologyProjection:48,topologyCombine:17,topologyCertificate:13824,accessOperator:8,accessResource:680,accessIncident:510,accessMethod:1020,incidentTerminal:4,incidentEdit:16,incidentEvidence:12,mutationBasis:96,querySelection:768,queryRelated:96,budgetAdd:121,budgetLe:121,budgetCapacity:1296,budgetCharge:648,budgetUsage:270,budgetTrace:576});
 return {cases:rows.length,counts,coverage:'Finite truth/support and execution tables and two-step traces; record/support orderings through length five; grant boundaries and four-rule/two-action policies; every directed graph through three nodes, both parent modes, invalid/duplicate inputs and three-valued rank certificates; chains through length three over four scope samples and six method gates; incident/evidence and revision boundaries; named query-filter/support/role product; exact resource count boundaries, per-field capacity/charge/usage products and scoped two-reservation traces',limitations:['Finite exhaustive correspondence only within the named input sets, not every possible policy or graph','Topology certificate theorem excludes cycles for every finite checked edge set, conditional on its stated rank check; native input assembly and compiler translation remain trust boundaries','Execution signals require native lease/provider/evidence/current-authority validation; state selection grants none of those','Grant scope tables assume independently validated current grant chains and authenticated principal observations','Theorems concern their stated models; compiler/translation and native adapters remain explicit trust boundaries','Resource counting is accounting, not host-enforced isolation or currency conversion; numeric codecs and native effects require independent execution checks']};
}
