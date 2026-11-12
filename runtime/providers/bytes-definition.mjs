import { readFileSync,realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { bytesDigest,digest,fail } from '../json.mjs';
export const workerPath=realpathSync(fileURLToPath(new URL('./bytes-worker.mjs',import.meta.url)));
export const workerDigest=bytesDigest(readFileSync(workerPath));
export const profileName='local.verify-bytes';
export const inputDocument={ type:'object',properties:{ contentBase64:{ type:'string',maxLength:349528 },expectedDigest:{ type:'string',pattern:'^sha256:[0-9a-f]{64}$' } },required:['contentBase64','expectedDigest'],additionalProperties:false };
export const outputDocument={ type:'object',properties:{ observedDigest:{ type:'string',pattern:'^sha256:[0-9a-f]{64}$' },byteLength:{ type:'integer',minimum:0,maximum:262144 },matches:{ type:'boolean' } },required:['observedDigest','byteLength','matches'],additionalProperties:false };
const object=(properties,optional={})=>({ type:'object',properties:{ ...properties,...optional },required:Object.keys(properties),additionalProperties:false });
const integer={ type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER },text={ type:'string',maxLength:4096 },hash={ type:'string',pattern:'^sha256:[0-9a-f]{64}$' },uuid={ type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const usage=object(Object.fromEntries(['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits'].map(key=>[key,integer])));
const status=object({ exitCode:{ anyOf:[integer,{ type:'null' }] },signal:{ anyOf:[text,{ type:'null' }] },outputBytes:integer,recordedAt:text },{ stopReason:text,spawnError:text });
export const receiptDocument={ anyOf:[object({ formatVersion:{ const:1 },executionId:uuid,contextId:uuid,attempt:{ ...integer,minimum:1 },fencingToken:{ ...integer,minimum:1 },intentDigest:hash,descriptorDigest:hash,expectedDigest:hash,baselineUsage:usage,result:outputDocument,outcome:{ anyOf:[object({ kind:{ const:'succeeded' },output:outputDocument }),object({ kind:{ const:'failed' },code:{ const:'DIGEST_MISMATCH' },detail:text })] },usage,guards:object({ enforce:{ const:true },inputRead:{ const:true },...Object.fromEntries(['inputWrite','parentRead','finalReceiptWrite','child','worker','net','inspector','wasi','addon','ffi','openssl.store'].map(key=>[key,{ const:false }])) }),measurement:object({ source:{ const:'node:process.resourceUsage' },scope:text,nodeVersion:text }),recordedAt:text }),object({ formatVersion:{ const:1 },kind:{ const:'verifier-lookup' },executionId:uuid,contextId:uuid,attempt:{ ...integer,minimum:1 },intentDigest:hash,descriptorDigest:hash,observation:{ enum:['not_started','unknown'] } },{ status })] };
const ref=(name,document)=>({ name,version:'1',digest:digest(document) });
export const inputSchema=ref('local.verifier.bytes.input',inputDocument),outputSchema=ref('local.verifier.bytes.output',outputDocument),receiptSchema=ref('local.verifier.bytes.receipt',receiptDocument);
export const descriptor={ kind:'fixed-node-process',version:1,workerDigest,receiptSchema,nodeVersion:process.version,platform:{ os:process.platform,architecture:process.arch },inputMaximumBytes:262144,wallTimeoutMillis:5000,heapMaximumMiB:32,read:['job-directory'],write:['receipt.tmp','receipt.ready'],durability:'host validation, fsync, exclusive publication and directory fsync',environment:['LANG','TZ'],network:false,childProcesses:false,workerThreads:false,addons:false,arbitraryCode:false,arbitraryPaths:false,resourceEnforcement:'input/output/wall/Node-API guards; CPU and RSS metered, not hard OS ceilings' };
export const descriptorDigest=digest(descriptor);
export const verifierFeatures=['sha256','bounded-input','durable-receipt','metered-cpu-rss','node-permission-guards',descriptorDigest];
export const recommendedLimits=currency=>({ concurrentExecutions:1,cpuMillis:5000,memoryBytes:268435456,outputBytes:4096,modelTokens:0,apiSpendMicrounits:0,currency });
export function assertVerifierLocation(path) { if (/[*,\r\n\0]/.test(path) || /[*,\r\n\0]/.test(workerPath)) fail('INVALID_ARGUMENT','Verifier paths must not contain permission-glob or list syntax'); }
export function workerArguments(path) { assertVerifierLocation(path);return ['--permission','--max-old-space-size=32','--allow-fs-read='+path,'--allow-fs-write='+join(path,'receipt.tmp'),'--allow-fs-write='+join(path,'receipt.ready'),workerPath]; }
export function matchesVerifier(capability,ownerId) {
  return capability.providerId===ownerId && capability.name===profileName && capability.version==='1' && digest(capability.inputSchema)===digest(inputSchema) && digest(capability.outputSchema)===digest(outputSchema) && capability.isolation==='process' && capability.reconciliation==='lookup' && digest(capability.platform)===digest(descriptor.platform) && digest(capability.features)===digest(verifierFeatures) && capability.evidence.artifactDigests.includes(workerDigest) && capability.evidence.artifactDigests.includes(descriptorDigest);
}
export function verifierBytes(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==2 || typeof input.contentBase64!=='string' || typeof input.expectedDigest!=='string' || !/^sha256:[0-9a-f]{64}$/.test(input.expectedDigest) || input.contentBase64.length>349528) fail('INVALID_ARGUMENT','Invalid byte verifier input');
  const bytes=Buffer.from(input.contentBase64,'base64');
  if (bytes.length>262144 || bytes.toString('base64')!==input.contentBase64) fail('INVALID_ARGUMENT','Verifier requires canonical base64 within its byte bound');
  return bytes;
}
export function validateVerifier(capability,ownerId,intent) {
  if (capability.providerId!==ownerId || capability.name!==profileName) return;
  if (!matchesVerifier(capability,ownerId)) fail('CAPABILITY_UNAVAILABLE','Installed verifier descriptor does not match this advertisement');
  verifierReservation(intent);
}
export function verifierReservation(intent) {
  verifierBytes(intent.input);
  for (const [key,minimum] of Object.entries(recommendedLimits(intent.limits.currency))) if (typeof minimum==='number' && !['modelTokens','apiSpendMicrounits'].includes(key) && intent.limits[key]<minimum) fail('LIMIT_EXCEEDED','Verifier reservation is below its installed profile minimum');
  if (intent.limits.modelTokens!==0 || intent.limits.apiSpendMicrounits!==0) fail('INVALID_ARGUMENT','The local verifier uses no inference or billed API allowance');
}
