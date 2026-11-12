import type { CatalogIdentity, ServicePort } from '../contracts/index.js';
export interface ServiceOptions {
  root?: string;
  credentialFile?: string;
  startupMillis?: number;
  expectedCatalog?: CatalogIdentity;
}
export function createService(options?: ServiceOptions): ServicePort;
