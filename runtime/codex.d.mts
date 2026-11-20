import type { Json } from '../contracts/index.js';
export interface NativeFunctionTool { type:'function';name:string;description:string;inputSchema:Json }
export interface NativeResult { output:Json;version:string;apiContractDigest:string;model?:string;threadId:string;turnId:string;toolCalls:number }
export interface NativeConnection {
  version:string;apiContractDigest:string;root:string;workspace:string;
  account():Promise<{ authenticated:boolean;accountKind:string|null;persistedAuth:boolean }>;
  invoke(input:{ instruction:string;outputSchema:Json;timeoutMillis?:number }):Promise<NativeResult>;
  close():Promise<void>;
}
export function isolatedCodex(input?:{ credentials?:{ accessToken:string;chatgptAccountId:string;chatgptPlanType?:string };tools?:NativeFunctionTool[];onTool?:(name:string,args:Json)=>Promise<Json> }):Promise<NativeConnection>;
