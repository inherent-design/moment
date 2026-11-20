import type {MomentClient,MemoryAssessmentsRead,MemorySession,AttachmentTarget,MemoryGuidanceBinding} from './index.js';

/** Compile-only selectors. Exact originals remain behind the selected session's authority. */
export function assessmentRecovery(client:MomentClient,session:MemorySession,assessmentId:string) {
  void client.call('memory.assessments.read',{session,limit:8});
  void client.call('memory.assessments.read',{session,assessmentId,maximumBytes:262144});
  void client.call('memory.assessments.read',{session,assessmentId,part:'renderedInput',bodyRange:{offset:0,byteLength:4096}});
  // @ts-expect-error A component range needs its assessment and component identity.
  const missingComponent:MemoryAssessmentsRead={session,bodyRange:{offset:0,byteLength:1}};
  // @ts-expect-error A listing cursor does not select an individual assessment.
  const mixedSelection:MemoryAssessmentsRead={session,assessmentId,cursor:'opaque-page'};
  return {missingComponent,mixedSelection};
}

export function reversibleFocus(client:MomentClient,session:MemorySession,workingSetId:string) {
  void client.call('memory.focus',{session,expectedFocusRevision:0,idempotencyKey:'select-current-purpose',action:{kind:'select',purposeKey:'opaque-current-purpose',returnPoint:'Return to the existing incident after this bounded aside.'}});
  void client.call('memory.read',{session,workingSetId,includeWorkingSets:true});
  void client.call('memory.rebuild',{session,deliveryId:'explicit-view-recovery',sourceIds:['an-associated-original'],workingSetId,expectedWorkingSetRevision:3});
  // @ts-expect-error Explicit working-set reconstruction has its own revision, not the active cache's.
  void client.call('memory.rebuild',{session,deliveryId:'mixed-revisions',sourceIds:['original'],workingSetId,expectedRevision:3});
  // @ts-expect-error Focus and enrollment revisions are different boundaries.
  void client.call('memory.focus',{session,expectedRevision:0,idempotencyKey:'wrong-revision',action:{kind:'select',purposeKey:'a'}});
}

/** The native consumer reads the needed source body and records scoped use, independently of validation. */
export function bindInspectedGuidance(client:MomentClient,session:MemorySession,target:AttachmentTarget,binding:MemoryGuidanceBinding) {
  void client.call('memory.focus',{session,expectedFocusRevision:3,idempotencyKey:'bind-scoped-evidence',action:{kind:'select',purposeKey:'existing-purpose',work:target,guidance:[binding]}});
  void client.call('memory.focus',{session,expectedFocusRevision:4,idempotencyKey:'clear-unavailable-bindings',action:{kind:'select',purposeKey:'existing-purpose',work:null,guidance:[]}});
  // @ts-expect-error A binding must retain applicability and material omissions with the exact representation.
  const incomplete:MemoryGuidanceBinding={source:binding.source,capture:binding.capture,contentDigest:binding.contentDigest,representation:'selected'};
  return incomplete;
}
