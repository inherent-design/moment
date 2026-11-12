import type { HostPort, Id } from '../../contracts/index.js';
/** Fixed-code local provider. See the integration contract for enforcement limits. */
export class BytesVerifier implements HostPort {
  constructor(root: string, options: { providerId: Id; onChange?: (contextId: Id) => void });
  inspect: HostPort['inspect'];
  execute: HostPort['execute'];
  reconcile: HostPort['reconcile'];
  cancel: HostPort['cancel'];
  close(): Promise<void>;
}
