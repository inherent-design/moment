import type { Ref, Limits, SchemaRef, Digest } from '../../contracts/index.js';
export interface VerifierRegistration {
  capability: Ref;
  grant: Ref;
  limits: Limits;
  inputSchema: SchemaRef;
  outputSchema: SchemaRef;
  descriptorDigest: Digest;
}
/** Explicit owner bootstrap through the existing authenticated local service. */
export function installVerifier(root: string, contextId: string): Promise<VerifierRegistration>;
