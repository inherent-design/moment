import type { ManagedClient, ServicePort } from '../contracts/index.js';
export interface ManagedOptions {
  root?: string;
  credentialFile?: string;
  profile?: 'continuity' | 'operator';
  service?: ServicePort;
}
export function createManaged(options?: ManagedOptions): ManagedClient & { service: ServicePort };
