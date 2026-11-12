import type { Input, Method, MomentClient, Output, Result } from '../contracts/index.js';

export interface ClientOptions {
  token?: string;
  timeoutMillis?: number;
  id?: string;
}
export type RpcReply<T> =
  | { jsonrpc: '2.0'; id: string; result: Result<T> }
  | { jsonrpc: '2.0'; id: string | null; error: { code: number; message: string } };

export function request<M extends Method>(root: string, method: M, input: Input<M>, options?: ClientOptions): Promise<RpcReply<Output<M>>>;
export function createClient(root: string, options?: ClientOptions): MomentClient;
