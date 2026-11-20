import type {MemoryConfigure,MemoryConfigureResult,MemorySubscription,MemoryAdmission,MemoryCheckResult,MemoryEntry,MemoryObservation,MemoryPacket,MemoryRead,MemoryRebuild,MemoryReceipt,MemoryResolution,MemorySession,MemorySource,MemoryUsage,MemoryWorkerStatus,MemoryAssessmentsRead,MemoryAssessmentPacket,MemoryNativePreparation,MemoryAssessmentInput,MemoryFocus,MemoryFocusResult} from '../contracts/index.js';
import type {AttachmentTarget,MemoryGuidanceBinding,MemoryBindingsRead} from '../contracts/index.js';
export interface MemoryBindingPort {
  validate(value:{work?:AttachmentTarget;guidance?:MemoryGuidanceBinding[]}):void;
  read(value:{work?:AttachmentTarget;guidance?:MemoryGuidanceBinding[]}):MemoryBindingsRead;
}
export interface MemoryLimits {capacity:number;maxSessions:number;maxInputs:number;maxPending:number;maxSourceBytes:number;maxStoredBytes:number;maxPromptBytes:number;maxOutputBytes:number;maxConfigurationReceipts:number;maxWorkingSets:number;maxWorkingSetBytes:number;maxAssessmentBytes:number;maxProfileBytes:number;retainedAssessments:number;maxAutomaticBytes:number}
export interface MemoryProviderIdentity {id:string;model:string}
export type MemoryCheckInput = MemoryAssessmentInput;
export interface MemoryDispatch {
  kind?:'dispatch';id:string;key:string;sequence:number;cacheRevision:number;processedThrough:number;provider:MemoryProviderIdentity;
  promptVersion:string;promptDigest:string;outputSchemaDigest:string;inputDigest:string;request:MemoryCheckInput;status:'running'|'unknown';startedAt:string;detail?:string;
  nativePreparation?:MemoryNativePreparation;
  workingSetId?:string;workingSetRevision?:number;focusRevision?:number;admittedFocusRevision?:number;
}
export const memoryDefaults:Readonly<MemoryLimits>;
export function resolveMemoryLimits(options?:Partial<MemoryLimits>):MemoryLimits;
export const memoryStorageVersion:number;
export const memoryPromptVersion:string;
export const memoryPrompt:string;
export function renderMemoryPrompt(request:MemoryCheckInput):string;
export const memoryInputRenderer:string;
export function renderMemoryInput(request:MemoryCheckInput,prompt?:string,renderer?:string):string;
export function memorySelection(request:MemoryCheckInput):{selectableSourceIds:string[];contextOnlySourceIds:string[];maximumEntries:number};
export const memoryOutputSchema:Readonly<import('../contracts/index.js').Json>;
export function memorySessionKey(session:MemorySession):string;
/** Trusted storage interface; callers provide actual authenticated service access separately. */
export class SessionMemory {
  constructor(filename:string,systemId:string,options?:Partial<MemoryLimits>,ports?:{bindings?:MemoryBindingPort});
  readonly limits:MemoryLimits;
  close():void;
  subscription(session:MemorySession):MemorySubscription;
  subscriptions():MemorySubscription[];
  configure(input:MemoryConfigure,principalId:string):MemoryConfigureResult;
  focus(input:MemoryFocus,principalId:string):MemoryFocusResult;
  observe(input:MemoryObservation):MemoryAdmission;
  rebuild(input:MemoryRebuild):MemoryAdmission;
  read(input:MemoryRead,worker?:MemoryWorkerStatus,automationIssue?:string):MemoryPacket;
  readAssessments(input:MemoryAssessmentsRead):MemoryAssessmentPacket;
  prepareProfile(id:string,preparation:MemoryNativePreparation):{assessmentId:string;prepared:true};
  source(id:string):MemorySource;
  hasPending():boolean;
  active():MemoryDispatch|undefined;
  claim(provider:MemoryProviderIdentity):({kind:'dispatch'}&MemoryDispatch)|{kind:'refused';session:MemorySession;sequence:number;error:{code:string;message:string}}|null;
  finish(id:string,output:MemoryCheckResult|import('../contracts/index.js').Json,usage?:MemoryUsage,observation?:{rawOutput?:string}):MemoryReceipt;
  failObserved(id:string,failure:{code:string;message:string},usage?:MemoryUsage,rawOutput?:string):MemoryReceipt;
  unknown(id:string,detail:string):{dispatchId:string;status:'unknown'};
  reconcile(id:string,resolution:MemoryResolution):MemoryReceipt|{dispatchId:string;status:'pending'|'cancelled'};
  recoveryDispatch(dispatch:MemoryDispatch):MemoryDispatch;
  cancel(session:MemorySession,sequence:number):{session:MemorySession;sequence:number;status:import('../contracts/index.js').MemoryInputStatus};
}
