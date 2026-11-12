const object = (required, optional = {}) => ({ type: 'object', properties: { ...required, ...optional }, required: Object.keys(required), additionalProperties: false });
const array = items => ({ type: 'array', items, maxItems: 1000 });
const text = { type: 'string', maxLength: 65536 };
const string = { type: 'string', minLength: 1, maxLength: 4096 };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const hash = { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' };
const instant = { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d{1,3})?Z$' };
const enumeration = (...values) => ({ enum: values });
const reference = name => ({ $ref: `#/$defs/${name}` });
export const defs = {
  Ref: object({ systemId: id, contextId: id, id }),
  SchemaRef: object({ name: string, version: string, digest: hash }),
  Evidence: object({ sources: array(reference('Ref')), method: string, artifactDigests: array(hash) }),
  Limits: object({ concurrentExecutions: integer, cpuMillis: integer, memoryBytes: integer, outputBytes: integer, modelTokens: integer, apiSpendMicrounits: integer, currency: string }, { deadline: instant }),
  Incident: object({ purpose: text, completionCriteria: array(string), status: enumeration('open', 'resting', 'completed', 'cancelled'), continuation: array(reference('Ref')) }),
  Selector: object({ assertionStatus: enumeration('asserted', 'withdrawn', 'any') }, { ids: array(id), schemaNames: array(string), relatedTo: reference('Ref'), relationRole: string }),
  Operand: { anyOf: [object({ kind: { const: 'literal' }, value: true }), object({ kind: { const: 'binding' }, name: string })] },
};
defs.Condition = { anyOf: [
  ...['all', 'any'].map(kind => object({ kind: { const: kind }, terms: { ...array(reference('Condition')), minItems: 1 } })),
  object({ kind: { const: 'not' }, term: reference('Condition') }),
  ...['equal', 'lessOrEqual'].map(kind => object({ kind: { const: kind }, left: reference('Operand'), right: reference('Operand') })),
  object({ kind: { const: 'exists' }, selector: reference('Selector') }),
  object({ kind: { const: 'related' }, from: reference('Operand'), to: reference('Operand'), schemaNames: array(string), maxHops: { type: 'integer', minimum: 1, maximum: 8 } }),
] };
defs.Policy = object({ id, rules: array(object({ id: string, effect: enumeration('permit', 'deny'), actions: array(string), when: reference('Condition') })), limits: reference('Limits'), evidence: reference('Evidence') }, { parent: reference('Ref'), authorityIssuers: array(id) });
defs.Grant = object({ id, principalId: id, actions: array(string), incidentIds: { anyOf: [{ const: 'all' }, array(id)] }, resourceRefs: array(reference('Ref')), delegable: { type: 'boolean' }, limits: reference('Limits') }, { parentGrant: reference('Ref'), expiresAt: instant });
defs.Record = { anyOf: [
  object({ kind: { const: 'atom' }, id, schema: reference('SchemaRef'), value: true }),
  object({ kind: { const: 'relation' }, id, schema: reference('SchemaRef'), roles: { type: 'object', additionalProperties: array(reference('Ref')), maxProperties: 32 } }),
] };
defs.Assertion = object({ id, record: reference('Ref'), evidence: reference('Evidence') }, { validDuring: reference('Ref') });
defs.Change = { anyOf: [
  object({ kind: { const: 'record.put' }, record: reference('Record') }),
  object({ kind: { const: 'assertion.put' }, assertion: reference('Assertion') }),
  object({ kind: { const: 'assertion.withdraw' }, assertionId: id, reason: string }),
] };
defs.View = object({ id, selector: reference('Selector'), fields: array(string) }, { groupBy: enumeration('record', 'schema') });
defs.Rule = object({ id, triggerEventTypes: array(string), condition: reference('Condition'), operation: string, literalInput: true, inputBindings: { type: 'object', additionalProperties: string, maxProperties:64 }, limits: reference('Limits') });
defs.ExecutionIntent=object({ id,incidentId:id,capability:reference('Ref'),grant:reference('Ref'),input:true,limits:reference('Limits') });
defs.Usage=object(Object.fromEntries(['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits'].map(key=>[key,integer])));
const isolation=enumeration('none','process','container','vm');
defs.Capability=object({ id,providerId:id,name:string,version:string,inputSchema:reference('SchemaRef'),outputSchema:reference('SchemaRef'),features:array(string),platform:object({ os:string,architecture:string }),isolation,reconciliation:enumeration('lookup','idempotent','manual'),evidence:reference('Evidence'),expiresAt:instant });
defs.Requirement=object({ name:string,versions:array(string),inputSchema:reference('SchemaRef'),outputSchema:reference('SchemaRef'),features:array(string),acceptableIsolation:array(isolation) });
defs.Outcome={ anyOf:[object({ kind:{ const:'succeeded' },output:true,evidence:reference('Evidence') }),object({ kind:{ const:'failed' },code:string,detail:text,evidence:reference('Evidence') }),object({ kind:{ const:'cancelled' },evidence:reference('Evidence') }),object({ kind:{ const:'unknown' },detail:text,evidence:reference('Evidence') })] };
defs.Reconciliation={ anyOf:[object({ kind:{ const:'observed' },outcome:reference('Outcome') }),object({ kind:{ const:'retry' },basis:enumeration('not_started','idempotent'),evidence:reference('Evidence') })] };
defs.Wake={ anyOf:[object({ kind:{ const:'event' },eventTypes:array(string),selector:reference('Selector'),mode:enumeration('edge','each') }),object({ kind:{ const:'at' },instant }),object({ kind:{ const:'after' },eventId:id,durationMillis:integer }),object({ kind:{ const:'capacity' },resource:string,atLeast:{ ...integer,minimum:1 } })] };
defs.Schedule=object({ id,incidentId:id,rule:reference('Ref'),wake:reference('Wake'),recurrence:enumeration('once','rearmAfterCompletion'),coalesce:{ type:'boolean' } });
defs.Proposal=object({ id,incidentId:id,basisRevision:integer,policy:reference('Ref'),changes:array(reference('Change')),executions:array(reference('ExecutionIntent')),evidence:reference('Evidence') },{ rule:reference('Ref') });
const read = { contextId: id };
const readOptional = { atRevision: integer };
const mutation = { contextId: id, expectedRevision: integer, idempotencyKey: string };
const page = { type: 'integer', minimum: 1, maximum: 100 };
export const primitives={Id:id,Digest:hash,Revision:integer,Instant:instant,Cursor:string};
export const inputSchemas = {
  'system.describe': object({ protocolVersion: { const: '0.1' } }),
  'service.stop': object({ expectedInstanceId: id }),
  'context.create': object({ idempotencyKey: string, id, label: string, bootstrapProfile: string, limits: reference('Limits') }),
  'context.get': object(read, readOptional),
  'context.close': object({ ...mutation, reason: string }),
  'control.get': object({ ...read, ref: reference('Ref') }, readOptional),
  'schema.publish': object({ ...mutation, schema: reference('SchemaRef'), document: true }),
  'schema.get': object({ ...read, schema: reference('SchemaRef') }, readOptional),
  'incident.create': object({ ...mutation, id, incident: reference('Incident') }),
  'incident.get': object({ ...read, incidentId: id }, readOptional),
  'incident.list': object({ ...read,limit:page },{ ...readOptional,statuses:{...array(enumeration('open','resting','completed','cancelled')),maxItems:4,uniqueItems:true},cursor:string }),
  'incident.update': object({ ...mutation, incidentId: id, incident: reference('Incident'), evidence: reference('Evidence') }),
  'graph.transact': object({ ...mutation, changes: array(reference('Change')) }),
  'graph.query': object({ ...read, selector: reference('Selector'), limit: page }, { ...readOptional, cursor: string }),
  'policy.publish': object({ ...mutation, policy: reference('Policy') }),
  'policy.activate': object({ ...mutation, policy: reference('Ref'), evidence: reference('Evidence') }),
  'policy.evaluate': object({ ...read, action: string, incidentId: id, resourceRefs: array(reference('Ref')), grant: reference('Ref') }, readOptional),
  'grant.issue': object({ ...mutation, grant: reference('Grant') }),
  'grant.revoke': object({ ...mutation, grant: reference('Ref'), reason: string }),
  'view.publish': object({ ...mutation, view: reference('View') }),
  'view.read': object({ ...read, view: reference('Ref'), limit: page }, { ...readOptional, cursor: string }),
  'rule.publish': object({ ...mutation, rule: reference('Rule') }),
  'transition.propose': object({ ...mutation,proposal:reference('Proposal') }),
  'transition.commit': object({ ...mutation,proposalId:id }),
  'transition.get': object({ ...read,proposalId:id },readOptional),
  'reaction.evaluate': object({ ...read, rule: reference('Ref'), eventIds: array(id), incidentId: id }, readOptional),
  'capability.advertise':object({ ...mutation,capability:reference('Capability') }),
  'capability.match':object({ ...read,requirement:reference('Requirement'),grant:reference('Ref'),limit:page },{ ...readOptional,incidentId:id }),
  'execution.request':object({ ...mutation,execution:reference('ExecutionIntent') }),
  'execution.get':object({ ...read,executionId:id },readOptional),
  'execution.claim':object({ ...mutation,executionId:id,leaseMillis:{ type:'integer',minimum:1,maximum:30000 } }),
  'execution.heartbeat':object({ ...mutation,executionId:id,leaseId:id,fencingToken:{ ...integer,minimum:1 },leaseMillis:{ type:'integer',minimum:1,maximum:30000 } }),
  'execution.finish':object({ ...mutation,executionId:id,leaseId:id,fencingToken:{ ...integer,minimum:1 },outcome:reference('Outcome'),usage:reference('Usage') }),
  'execution.reconcile':object({ ...mutation,executionId:id,attempt:{ ...integer,minimum:1 },resolution:reference('Reconciliation'),usage:reference('Usage') }),
  'execution.cancel':object({ ...mutation,executionId:id,reason:string }),
  'events.read':object({ ...read,limit:page,waitMillis:{ type:'integer',minimum:0,maximum:30000 } },{ ...readOptional,after:string }),
  'schedule.put':object({ ...mutation,schedule:reference('Schedule') }),
  'schedule.cancel':object({ ...mutation,scheduleId:id }),
  'schedule.get':object({ ...read,scheduleId:id },readOptional),
  'messages.send':object({ ...mutation,message:object({ id,incidentId:id,recipientId:id,kind:enumeration('notice','request','response'),summary:text,detailRefs:{ ...array(reference('Ref')),maxItems:32 } },{ inReplyTo:id,expiresAt:instant }) }),
  'messages.read':object({ ...read,limit:page,includeAcknowledged:{ type:'boolean' } },{ ...readOptional,cursor:string }),
  'messages.ack':object({ ...mutation,messageIds:{ ...array(id),minItems:1,maxItems:100,uniqueItems:true } }),
  'prompt.compose':object({ ...read,incidentId:id,template:reference('Ref'),sourceRefs:{ ...array(reference('Ref')),maxItems:32 },outputSchema:reference('SchemaRef'),maximumInputBytes:{ type:'integer',minimum:1,maximum:262144 } },readOptional),
  'bindings.discover':object({}, {operationId:string,cursor:string,limit:page}),
  'workspace.attach':object({}, {projectId:id,location:string,contextId:id,incidentId:id}),
  'workspace.read':object({target:object({systemId:id,contextId:id},{incidentId:id,projectId:id})}, {maximumBytes:{type:'integer',minimum:1,maximum:65536},limit:page,detailRefs:{...array(reference('Ref')),maxItems:100},includeMessages:{type:'boolean'}}),
};
