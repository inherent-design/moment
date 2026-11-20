import { canonical, digest, fail } from './json.mjs';
import * as core from './semantic-core.mjs';
const ref={ type:'object',properties:Object.fromEntries(['systemId','contextId','id'].map(name=>[name,{ type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }])),required:['systemId','contextId','id'],additionalProperties:false };
const cardinality=(minimum=1,maximum=1)=>({ type:'array',items:ref,minItems:minimum,...(maximum===undefined?{}:{ maxItems:maximum }) });
const definitions={
  'moment.within':{ child:cardinality(),parent:cardinality(),perspective:cardinality() },
  'moment.partOf':{ part:cardinality(),whole:cardinality(),perspective:cardinality() },
  'moment.viewOf':{ view:cardinality(),subject:cardinality() },
  'moment.supports':{ evidence:cardinality(1,1000),claim:cardinality() },
  'moment.contradicts':{ left:cardinality(),right:cardinality() },
  'moment.equivalent':{ left:cardinality(),right:cardinality(),criterion:cardinality() },
  'moment.precedes':{ earlier:cardinality(),later:cardinality() },
  'moment.during':{ inner:cardinality(),outer:cardinality() },
  'moment.derivedFrom':{ result:cardinality(),source:cardinality(1,1000) },
};
const promptDocument={ type:'object',properties:{ text:{ type:'string',maxLength:65536 },sourceSlots:{ type:'array',items:{ type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,63}$' },uniqueItems:true,maxItems:32 },optionalSlots:{ type:'array',items:{ type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,63}$' },uniqueItems:true,maxItems:32 } },required:['text','sourceSlots'],additionalProperties:false };
export const promptSchema={ name:'moment.prompt-template',version:'1',digest:digest(promptDocument) };
export const builtinSchemas=Object.entries(definitions).map(([name,properties])=>{
  const temporal=['moment.precedes','moment.during'].includes(name);
  const document={ type:'object',properties:{ ...properties,...(temporal?{ frame:cardinality() }:{}) },required:Object.keys(properties),additionalProperties:false };
  return { schema:{ name,version:'1',digest:digest(document) },document };
}).concat([{ schema:promptSchema,document:promptDocument }]);
export function installedSchema(schema) { return builtinSchemas.some(item=>item.schema.name===schema.name && item.schema.version===schema.version && item.schema.digest===schema.digest); }

export function validateTopology(snapshot) {
  const supports=new Map();
  for(const item of snapshot.assertions){const id=item.assertion.value.record.id;if(!supports.has(id))supports.set(id,[]);supports.get(id).push(item.status);}
  const groups=new Map();
  for (const item of snapshot.records) {
    const edge=core.topologyRecord(item.value,supports.get(item.value.id)??[],snapshot.context.id);if(edge.kind==='skip')continue;
    const key=canonical([edge.kind,edge.scope]);
    if(!groups.has(key))groups.set(key,{exclusive:edge.kind==='within',indices:new Map(),edges:[]});
    const group=groups.get(key),index=id=>{if(!group.indices.has(id))group.indices.set(id,group.indices.size);return group.indices.get(id);};
    group.edges.push({source:index(edge.source),target:index(edge.target)});
  }
  const verdict=core.topologyCombine([...groups.values()].map(group=>core.topologyCheck(group.indices.size,group.edges,group.exclusive)));
  if(verdict==='TopParents')fail('INVALID_ARGUMENT','A structural perspective gives one child multiple immediate parents');
  if(verdict==='TopCycle')fail('INVALID_ARGUMENT','Asserted structural containment or temporal precedence contains a cycle');
  if(verdict==='TopInvalid')fail('INTERNAL','Topology representation or complete certificate is invalid');
}
