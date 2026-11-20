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
defs.Usage=object(Object.fromEntries(['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits'].map(key=>[key,integer])),{unmeasured:{...array(enumeration('cpuMillis','memoryBytes','modelTokens','apiSpendMicrounits')),uniqueItems:true,maxItems:4}});
const isolation=enumeration('none','process','container','vm');
defs.Capability=object({ id,providerId:id,name:string,version:string,inputSchema:reference('SchemaRef'),outputSchema:reference('SchemaRef'),features:array(string),platform:object({ os:string,architecture:string }),isolation,reconciliation:enumeration('lookup','idempotent','manual'),evidence:reference('Evidence'),expiresAt:instant });
defs.Requirement=object({ name:string,versions:array(string),inputSchema:reference('SchemaRef'),outputSchema:reference('SchemaRef'),features:array(string),acceptableIsolation:array(isolation) });
defs.Outcome={ anyOf:[object({ kind:{ const:'succeeded' },output:true,evidence:reference('Evidence') }),object({ kind:{ const:'failed' },code:string,detail:text,evidence:reference('Evidence') }),object({ kind:{ const:'cancelled' },evidence:reference('Evidence') }),object({ kind:{ const:'unknown' },detail:text,evidence:reference('Evidence') })] };
defs.Reconciliation={ anyOf:[object({ kind:{ const:'observed' },outcome:reference('Outcome') }),object({ kind:{ const:'retry' },basis:enumeration('not_started','idempotent'),evidence:reference('Evidence') })] };
defs.Wake={ anyOf:[object({ kind:{ const:'event' },eventTypes:array(string),selector:reference('Selector'),mode:enumeration('edge','each') }),object({ kind:{ const:'at' },instant }),object({ kind:{ const:'after' },eventId:id,durationMillis:integer }),object({ kind:{ const:'capacity' },resource:string,atLeast:{ ...integer,minimum:1 } })] };
defs.Schedule=object({ id,incidentId:id,rule:reference('Ref'),wake:reference('Wake'),recurrence:enumeration('once','rearmAfterCompletion'),coalesce:{ type:'boolean' } });
defs.MemorySession=object({runtimeId:{...string,maxLength:256},sessionId:{...string,maxLength:256}});
defs.AttachmentTarget=object({systemId:id,contextId:id},{projectId:id,incidentId:id});
defs.MemoryGuidanceBinding=object({source:reference('Ref'),capture:reference('Ref'),contentDigest:hash,representation:enumeration('whole','selected'),applicability:{...string,maxLength:2048},materialOmissions:{...array({...string,maxLength:512}),maxItems:8}},{bodyRange:object({offset:integer,byteLength:{...integer,maximum:131072}})});
defs.MemorySelection=object({kind:{const:'codex-rollout'},path:string,offset:integer,byteLength:integer,digest:hash,contentIndex:integer,headerVersion:{...string,maxLength:128}},{nativeTimestamp:{...string,maxLength:128},ordinal:integer,clientAuthored:{type:'boolean'},provenanceType:{...string,maxLength:128},contentKind:{...string,maxLength:128}});
defs.MemoryMessage=object({text,authorship:enumeration('human','assistant','harness','unknown')},{nativeItemId:{...string,maxLength:256},turnId:{...string,maxLength:256},selection:reference('MemorySelection')});
defs.MemoryEntry=object({sourceId:string,weight:{type:'number',minimum:0,maximum:1}},{generality:{type:'number',minimum:0,maximum:1},note:{type:'string',maxLength:2048}});
defs.MemoryCheckResult={anyOf:[object({kind:{const:'unchanged'}}),object({kind:{const:'replace'},entries:{...array(reference('MemoryEntry')),maxItems:32}})]};
defs.MemoryUsage=object({},Object.fromEntries(['latencyMillis','modelTokens','inputTokens','outputTokens','cachedInputTokens'].map(key=>[key,integer])));
defs.MemoryResolution={anyOf:[object({kind:{const:'observed'},output:reference('MemoryCheckResult')},{usage:reference('MemoryUsage'),rawOutput:{type:'string',maxLength:65536}}),object({kind:enumeration('not_started','cancelled'),evidence:{...string,maxLength:2048}}),object({kind:{const:'failed'},code:{...string,maxLength:128},message:{...string,maxLength:2048},evidence:{...string,maxLength:2048}},{usage:reference('MemoryUsage'),rawOutput:{type:'string',maxLength:65536}})]};
defs.Proposal=object({ id,incidentId:id,basisRevision:integer,policy:reference('Ref'),changes:array(reference('Change')),executions:array(reference('ExecutionIntent')),evidence:reference('Evidence') },{ rule:reference('Ref') });
defs.SourceSelection={anyOf:[object({kind:{const:'whole'}}),object({kind:{const:'lines'},first:{...integer,minimum:1},last:{...integer,minimum:1}}),object({kind:{const:'utf8-range'},offset:integer,byteLength:integer}),object({kind:{const:'json-pointer'},pointer:{type:'string',maxLength:4096}})]};
defs.GuidanceSourceDefinition=object({label:{...string,maxLength:512},locator:{anyOf:[object({kind:{const:'file'},path:string}),object({kind:{const:'record'},ref:reference('Ref')})]},selection:reference('SourceSelection'),locations:{...array(string),minItems:1,maxItems:32,uniqueItems:true},classification:enumeration('public','private','sensitive','unknown'),evidence:reference('Evidence')});
defs.GuidanceTask=object({description:{...string,maxLength:16384},location:string,sourceRefs:{...array(reference('Ref')),maxItems:32,uniqueItems:true}});
const read = { contextId: id };
const readOptional = { atRevision: integer };
const mutation = { contextId: id, expectedRevision: integer, idempotencyKey: string };
const page = { type: 'integer', minimum: 1, maximum: 100 };
export const primitives={Id:id,Digest:hash,Revision:integer,Instant:instant,Cursor:string};
export const inputSchemas = {
  'system.describe': object({ protocolVersion: { const: '0.1' } }),
  'service.stop': object({ expectedInstanceId: id }),
  'memory.read':object({session:reference('MemorySession')},{sourceIds:{...array(string),maxItems:100,uniqueItems:true},maximumBytes:{type:'integer',minimum:1,maximum:262144},workingSetId:{...string,maxLength:128},includeWorkingSets:{type:'boolean'}}),
  'memory.assessments.read':object({session:reference('MemorySession')},{assessmentId:{...string,maxLength:128},maximumBytes:{type:'integer',minimum:1,maximum:262144},limit:{type:'integer',minimum:1,maximum:32},cursor:{...string,maxLength:1024},part:enumeration('basis','profile','nativeProfile','preparation','request','renderedInput','nativeSchema','outcome','rawOutput'),bodyRange:object({offset:integer,byteLength:{type:'integer',minimum:1,maximum:131072}})}),
  'memory.configure':object({session:reference('MemorySession'),expectedRevision:integer,idempotencyKey:{...string,maxLength:128},enabled:{type:'boolean'}}),
  'memory.focus':object({session:reference('MemorySession'),expectedFocusRevision:integer,idempotencyKey:{...string,maxLength:128},action:{anyOf:[object({kind:{const:'select'},purposeKey:{...string,maxLength:256}},{label:{...string,maxLength:512},purpose:{type:'string',maxLength:4096},returnPoint:{type:'string',maxLength:2048},basisSourceIds:{...array({...string,maxLength:128}),maxItems:16,uniqueItems:true},seedFrom:{...string,maxLength:128},work:{anyOf:[reference('AttachmentTarget'),{type:'null'}]},guidance:{...array(reference('MemoryGuidanceBinding')),maxItems:8}}),object({kind:{const:'release'},workingSetId:{...string,maxLength:128}},{replacementId:{...string,maxLength:128}})]}}),
  'memory.observe':object({session:reference('MemorySession'),deliveryId:{...string,maxLength:128},message:reference('MemoryMessage')},{exchange:{...array(reference('MemoryMessage')),maxItems:16},automatic:object({subscriptionRevision:{...integer,minimum:1}}),workingSetId:{...string,maxLength:128}}),
  'memory.rebuild':object({session:reference('MemorySession'),deliveryId:{...string,maxLength:128},sourceIds:{...array(string),maxItems:64,uniqueItems:true}},{expectedRevision:integer,workingSetId:{...string,maxLength:128},expectedWorkingSetRevision:integer,captures:{...array(object({session:reference('MemorySession'),message:reference('MemoryMessage')},{exchange:{...array(reference('MemoryMessage')),maxItems:16}})),maxItems:64}}),
  'memory.cancel':object({session:reference('MemorySession'),sequence:{...integer,minimum:1}}),
  'memory.reconcile':object({dispatchId:string,resolution:reference('MemoryResolution')}),
  'context.create': object({ idempotencyKey: string, id, label: string, bootstrapProfile: string, limits: reference('Limits') }),
  'context.get': object(read, readOptional),
  'context.limits': object({ ...mutation,limits:reference('Limits'),evidence:reference('Evidence') }),
  'guidance.register':object({...mutation,id,definition:reference('GuidanceSourceDefinition'),active:{type:'boolean'}}),
  'guidance.refresh':object({...mutation,sourceId:id}),
  'guidance.review':object({...mutation,id,incidentId:id,task:reference('GuidanceTask'),capability:reference('Ref'),grant:reference('Ref'),limits:reference('Limits')},{sourceIds:{...array(id),minItems:1,maxItems:32,uniqueItems:true}}),
  'guidance.read':object({contextId:id},{location:string,sourceIds:{...array(id),maxItems:32,uniqueItems:true},captureIds:{...array(id),maxItems:32,uniqueItems:true},executionId:id,maximumBytes:{type:'integer',minimum:1024,maximum:262144},limit:{type:'integer',minimum:1,maximum:32},cursor:string,representation:enumeration('whole','selected'),bodyRange:object({offset:integer,byteLength:{...integer,maximum:131072}})}),
  'context.close': object({ ...mutation, reason: string }),
  'control.get': object({ ...read, ref: reference('Ref') }, readOptional),
  'schema.publish': object({ ...mutation, schema: reference('SchemaRef'), document: true }),
  'schema.get': object({ ...read, schema: reference('SchemaRef') }, readOptional),
  'incident.create': object({ ...mutation, id, incident: reference('Incident') }, { evidence: reference('Evidence') }),
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
  'captures.read':object({target:object({systemId:id,contextId:id,incidentId:id})},{payloadIds:{...array({...string,maxLength:128}),maxItems:64,uniqueItems:true},maximumBytes:{type:'integer',minimum:1024,maximum:65536}}),
  'workspace.read':object({target:object({systemId:id,contextId:id},{incidentId:id,projectId:id})}, {maximumBytes:{type:'integer',minimum:1,maximum:65536},limit:page,detailRefs:{...array(reference('Ref')),maxItems:100},includeMessages:{type:'boolean'}}),
};
