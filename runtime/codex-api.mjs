import {execFileSync} from 'node:child_process';
import {compileDocument} from './validation.mjs';
import {digest,DomainError} from './json.mjs';

/** Evidence baseline only. Admission depends on the used API, never this label. */
export const codexVerifiedBaseline='codex-cli 0.169.0';
export function observeCodexVersion(binary,{cwd,env}={}) {
  try {
    const version=execFileSync(binary,['--version'],{cwd,env,encoding:'utf8',timeout:10000,maxBuffer:4096,stdio:['ignore','pipe','ignore']}).trim();
    return /^codex-cli [A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(version)?version:'unknown';
  } catch {return 'unknown';}
}
const text={type:'string',minLength:1};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required});
const identified=object({id:text});
// Validate only consumed fields. Additive fields and unrelated notifications pass.
export const codexResponseSchemas={
  initialize:object({userAgent:text}),
  'account/read':object({account:{anyOf:[{type:'null'},object({type:text})]}}),
  'account/login/start':object({type:text}),
  'model/list':object({data:{type:'array'}}),
  'thread/start':object({thread:identified,model:text}),
  'turn/start':object({turn:identified}),
};
const notificationSchemas={
  'thread/started':object({thread:identified}),
  'turn/started':object({threadId:text,turn:identified}),
  'turn/completed':object({threadId:text,turn:object({id:text,status:text})}),
  'item/completed':object({threadId:text,turnId:text,item:object({type:text})}),
};
const responses=new Map(Object.entries(codexResponseSchemas).map(([method,schema])=>[method,compileDocument(schema)]));
const notifications=new Map(Object.entries(notificationSchemas).map(([method,schema])=>[method,compileDocument(schema)]));
export const codexApiContractDigest=digest({responses:codexResponseSchemas,notifications:notificationSchemas,permissionAgreement:'selected profile or resolved read-only without network',revision:1});

export function codexApiError(boundary,expected,version='unknown',rpcCode) {
  const observed=/^codex-cli [A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(version)?version.slice('codex-cli '.length):'unknown version';
  const message=`Codex ${observed}: ${boundary} requires ${expected}${Number.isInteger(rpcCode)?` (RPC ${rpcCode})`:''}`;
  const error=new DomainError('CAPABILITY_UNAVAILABLE',message);
  // This diagnostic contains local descriptors and a version/code, no raw RPC payload.
  error.codexDiagnostic=message;error.boundary=boundary;
  if(Number.isInteger(rpcCode))error.rpcCode=rpcCode;
  return error;
}
export function validateCodexResponse(method,value,version) {
  const validate=responses.get(method);
  if(validate && !validate(value))throw codexApiError(method,'the consumed response fields in the app-server v2 contract',version);
  return value;
}
export function validateCodexNotification(method,value,version) {
  const validate=notifications.get(method);
  if(validate && !validate(value) || method==='item/completed' && value?.item?.type==='agentMessage' && typeof value.item.text!=='string')throw codexApiError(method,'the consumed notification fields in the app-server v2 contract',version);
}
/** Check the selected model and effective permissions before submitting a turn. */
export function assertCodexThread(value,{model,permissionProfileId,version}={}) {
  validateCodexResponse('thread/start',value,version);
  if(value.model!==model)throw codexApiError('thread/start','the requested model without fallback',version);
  const profile=value.activePermissionProfile;
  const legacyReadOnly=value.sandbox?.type==='readOnly' && value.sandbox.networkAccess===false;
  const selectedProfile=permissionProfileId && profile?.id===permissionProfileId;
  const profileDisagrees=profile && permissionProfileId && !selectedProfile;
  if(value.approvalPolicy!=='never' || profileDisagrees || !legacyReadOnly && !selectedProfile || value.sandbox && !legacyReadOnly)throw codexApiError('thread/start','the requested read-only profile, disabled tool network and never-approve policy',version);
  return value;
}
