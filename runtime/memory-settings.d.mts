import type {MemoryLimits} from './session-memory.mjs';
export interface MemoryLimitsConfiguration {formatVersion:1;limits:Partial<MemoryLimits>}
export function configuredMemoryLimits(root:string):MemoryLimits;
