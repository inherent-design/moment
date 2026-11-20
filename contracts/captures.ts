import type {Id,Revision,Digest,Instant,Ref,Evidence,Json} from './index.js';

/** Legacy capture custody; a manifest is evidence and never grants host authority. */
export interface CaptureTarget { systemId:Id; contextId:Id; incidentId:Id; }
export type CaptureAvailability =
  | {kind:'present'}
  | {kind:'exact-shared'; operationDigest:Digest}
  | {kind:'packed'; path:string; digest:Digest; restoration:string[]; verifiedEvidence:Ref[]}
  | {kind:'rebuild-only'; recipe:string[]; limitations:string[]}
  | {kind:'intentionally-retired'; reason:string; dispositionEvidence:Ref[]};
export interface CapturePayload {
  id:string; path:string; bytes:number; digest:Digest;
  kind:'binary'|'archive'|'cache'|'observation'|'authored'|'world'|'state'|'recovery'|'private';
  availability:CaptureAvailability; pins:string[];
  dependencies:string[]; requiredBy:string[];
}
export interface CaptureClaim {id:string; summary:string; outcome:'observed'|'unverified'|'superseded'; sources:Ref[]; payloadIds:string[]; limitations:string[];}
export interface CaptureManifest {
  formatVersion:1; id:Id; target:CaptureTarget; generation:Revision; previousDigest?:Digest;
  run:{id:string; category:string; projectId?:Id; worktree?:string; state:'active'|'completed'|'cancelled'; current:boolean; order:Revision; pins:string[]; dependencies:string[]};
  provenance:{revision?:string; dirtyInputDigests:Digest[]; tools:string[]; commands:string[]; environment:string[]; outcomes:string[]; limitations:string[]};
  claims:CaptureClaim[]; payloads:CapturePayload[];
  continuation:{summary:string; nextAction?:string; unresolved:string[]};
  evidence:Evidence;
}
export interface CapturePublication {
  contextId:Id; expectedRevision:Revision; idempotencyKey:string; manifest:CaptureManifest;
}
export interface CapturePublicationResult {target:CaptureTarget; generation:Revision; digest:Digest; record:Ref; replayed:boolean;}
export interface CaptureReadInput { target:CaptureTarget; payloadIds?:string[]; maximumBytes?:number; }
export interface CapturePacket {
  target:CaptureTarget; availability:'unregistered'|'registered';
  generation?:Revision; manifestDigest?:Digest; record?:Ref; manifest?:CaptureManifest;
  payloads:{id:string; path:string; declared:CaptureAvailability; observation:'present-unverified'|'absent'|'unexpectedly-present'|'materialization-required';}[];
  omittedPayloadIds:string[]; omittedFields:string[];
}

/** Owner-local configuration, not supplied by an MCP model call. No retirement permission. */
export interface CaptureMaintenancePolicy {
  formatVersion:1; id:Id; revision:Revision; enabled:boolean;
  scope:CaptureTarget[]; kinds:('binary'|'archive'|'cache')[]; maximumFiles:number; maximumBytes:number;
  authority:Evidence;
}
export interface CaptureCustody {
  formatVersion:1; id:Id; revision:Revision; policyDigest:Digest; scope:CaptureTarget[];
  ownerPid:number; participants:string[]; confirmed:boolean; unknownWriters:string[];
  exclusions:string[]; evidence:Evidence;
}
export interface CaptureMaintenanceRequest {
  formatVersion:1; id:Id; policyFile:string; custodyFile:string;
  target:CaptureTarget; manifestDigest:Digest;
  pairs:{sourceId:string; targetId:string}[];
}
export interface CaptureFileIdentity {
  dev:string; ino:string; size:number; sha256:string; mode:number; uid:number; gid:number; flags:number;
  attrs:{[name:string]:string}; birth:number[]; mtime_ns:string; atime_ns:string; ctime_ns:string; allocated:number;
}
export interface CaptureMaintenancePlan {
  formatVersion:1; id:Id; operation:'exact-share'; target:CaptureTarget; contextRevision:Revision;
  manifestDigest:Digest; policyFile:string; policyDigest:Digest; custodyFile:string; custodyDigest:Digest;
  roots:string[]; items:{source:string; target:string; sourceId:string; targetId:string; source_before:CaptureFileIdentity; before:CaptureFileIdentity}[];
  protectedPaths:string[]; deferred:{id:string; reason:string}[]; retainedRunIds:string[];
  duplicateAllocatedUpperBound:number; limitations:string[];
}
export interface CaptureMaintenanceReceipt {
  formatVersion:1; planDigest:Digest; target:CaptureTarget; state:'complete'|'incomplete'|'refused';
  completedItems:number; files:number; logicalPathsRemoved:0; logicalBytesRemoved:0;
  observedFreeBytesBefore:number; observedFreeBytesAfter:number; finishedAt:Instant; limitations:string[];
  journalPath:string; details?:Json;
}
