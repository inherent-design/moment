import type {MemoryProvider} from './memory-worker.mjs';
import type {MemoryDispatch,MemoryProviderIdentity} from './session-memory.mjs';
import type {Json,MemoryUsage,MemoryReceipt,MemoryResolution,MemoryNativePreparation} from '../contracts/index.js';
export const memoryNativeSchema:Json;
export function readMemoryAccessSession(filename:string):{accessToken:string;chatgptAccountId:string};
export interface CodexMemoryProfile {credentialFile:string;model?:string;binary?:string;timeoutMillis?:number;maximumJournals?:number;maximumJournalBytes?:number}
export class CodexMemoryProvider implements MemoryProvider {
  constructor(root:string,profile:CodexMemoryProfile);
  ready():Promise<MemoryProviderIdentity>;
  prepare(dispatch:MemoryDispatch):MemoryNativePreparation;
  invoke(dispatch:MemoryDispatch,signal:AbortSignal):Promise<{output:Json;usage?:MemoryUsage;rawOutput?:string}|{failure:{code:string;message:string};usage?:MemoryUsage;rawOutput?:string}>;
  recover(dispatch:MemoryDispatch):MemoryResolution|undefined;
  settled(receipt:MemoryReceipt):Promise<void>;
  notStarted(dispatchId:string):Promise<void>;
  cancelled(dispatch:MemoryDispatch):Promise<void>;
  idle():Promise<void>;
  close():Promise<void>;
}
export function configuredMemoryProvider(root:string):MemoryProvider|undefined;
