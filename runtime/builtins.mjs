import { digest, fail } from './json.mjs';
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
export const builtinSchemas=Object.entries(definitions).map(([name,properties])=>{
  const temporal=['moment.precedes','moment.during'].includes(name);
  const document={ type:'object',properties:{ ...properties,...(temporal?{ frame:cardinality() }:{}) },required:Object.keys(properties),additionalProperties:false };
  return { schema:{ name,version:'1',digest:digest(document) },document };
});
export function installedSchema(schema) { return builtinSchemas.some(item=>item.schema.name===schema.name && item.schema.version===schema.version && item.schema.digest===schema.digest); }

export function validateTopology(snapshot) {
  const supported=new Set(snapshot.assertions.filter(item=>item.status==='asserted').map(item=>item.assertion.value.record.id));
  const groups=new Map();
  for (const item of snapshot.records) {
    const relation=item.value;
    if (relation.kind!=='relation' || !supported.has(relation.id) || !['moment.within','moment.precedes'].includes(relation.schema.name)) continue;
    const within=relation.schema.name==='moment.within';
    const scope=within?relation.roles.perspective[0].id:relation.roles.frame?.[0].id ?? snapshot.context.id;
    const key=`${relation.schema.name}:${scope}`;
    if (!groups.has(key)) groups.set(key,new Map());
    const graph=groups.get(key),from=relation.roles[within?'child':'earlier'][0].id,to=relation.roles[within?'parent':'later'][0].id;
    if (!graph.has(from)) graph.set(from,new Set());
    graph.get(from).add(to);
    if (within && graph.get(from).size>1) fail('INVALID_ARGUMENT','A structural perspective gives one child multiple immediate parents');
  }
  for (const graph of groups.values()) {
    const done=new Set(),active=new Set();
    for (const start of graph.keys()) {
      const stack=[[start,false]];
      while (stack.length) {
        const [node,exit]=stack.pop();
        if (exit) { active.delete(node);done.add(node);continue; }
        if (done.has(node)) continue;
        if (active.has(node)) fail('INVALID_ARGUMENT','Asserted structural containment or temporal precedence contains a cycle');
        active.add(node);stack.push([node,true]);
        for (const next of graph.get(node) ?? []) stack.push([next,false]);
      }
    }
  }
}
