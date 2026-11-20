import type {Json,MemoryUsage,MemoryWorkerStatus,MemoryReceipt,MemoryResolution,MemorySession,MemoryInputStatus,MemoryNativePreparation} from '../contracts/index.js';
import type {MemoryDispatch,MemoryProviderIdentity,SessionMemory} from './session-memory.mjs';
export interface MemoryProvider {
  unavailableReason?:string;
  ready():Promise<MemoryProviderIdentity>;
  prepare?(dispatch:MemoryDispatch):MemoryNativePreparation|Promise<MemoryNativePreparation>;
  invoke(dispatch:MemoryDispatch,signal:AbortSignal):Promise<{output:Json;usage?:MemoryUsage;rawOutput?:string}|{failure:{code:string;message:string};usage?:MemoryUsage;rawOutput?:string}>;
  recover?(dispatch:MemoryDispatch):MemoryResolution|undefined|Promise<MemoryResolution|undefined>;
  settled?(receipt:MemoryReceipt):Promise<void>;
  notStarted?(dispatchId:string):Promise<void>;
  cancelled?(dispatch:MemoryDispatch):Promise<void>;
  idle?():Promise<void>;
  close?():Promise<void>;
}
export class MemoryWorker {
  constructor(memory:SessionMemory,options?:{provider?:MemoryProvider;onChange?:()=>void;recover?:boolean});
  status():MemoryWorkerStatus;
  wake():void;
  cancel(session:MemorySession,sequence:number):{session:MemorySession;sequence:number;status:MemoryInputStatus};
  reconcile(id:string,resolution:MemoryResolution):ReturnType<SessionMemory['reconcile']>;
  close():Promise<void>;
}
