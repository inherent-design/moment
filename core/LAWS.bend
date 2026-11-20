import Base
import ./semantics.bend as Core
import ./execution.bend as Run
import ./topology.bend as Top
import ./accounting.bend as Budget

law deny_precedence:
  for permits: Core.Truth
  {Core.policy.combine(Core.Yes{}, permits) == Core.Deny{} : Core.Decision}

law unknown_deny_blocks_permit:
  {Core.policy.combine(Core.Unknown{}, Core.Yes{}) == Core.Indeterminate{} : Core.Decision}

law positive_permit:
  {Core.policy.combine(Core.No{}, Core.Yes{}) == Core.Permit{} : Core.Decision}

law withdrawn_final:
  for same_digest: Bool
  {Core.assertion_edit(True{}, same_digest, Core.Withdrawn{}) == Core.Conflict{} : Core.Edit}

law missing_support_refused:
  for same_digest: Bool
  for support: Core.Support
  {Core.assertion_edit(False{}, same_digest, support) == Core.Missing{} : Core.Edit}

law supported_withdrawal:
  {Core.assertion_withdraw(Core.Asserted{}) == Core.Withdraw{} : Core.Edit}

law withdrawal_idempotent:
  {Core.assertion_withdraw(Core.Withdrawn{}) == Core.Keep{} : Core.Edit}

law revoked_grant_unavailable:
  for expiry_present: Bool
  for expiry: Core.Rank
  for now: Core.Rank
  {Core.grant_available(True{}, True{}, expiry_present, expiry, now) == False{} : Bool}

law unexpired_grant_available:
  for expiry: Core.Rank
  for now: Core.Rank
  {Core.grant_available(True{}, False{}, False{}, expiry, now) == True{} : Bool}

law uncertain_claim_refused:
  {Run.step(Run.RunUncertain{}, Run.RunClaim{}) == Run.RunNotClaimable{} : Run.Step}

law claim_requires_current_authority:
  {Run.step(Run.RunQueued{}, Run.RunClaim{}) == Run.RunNext{Run.RunLeased{}, False{}, True{}, False{}} : Run.Step}

law retry_requires_current_authority:
  {Run.step(Run.RunUncertain{}, Run.RunRetry{}) == Run.RunNext{Run.RunQueued{}, False{}, True{}, False{}} : Run.Step}

law leased_effect_needs_dispatch:
  {Run.step(Run.RunLeased{}, Run.RunFinish{Run.RunSuccess{}}) == Run.RunDispatchRequired{} : Run.Step}

law cancelling_accepts_real_success:
  {Run.step(Run.RunCancelling{}, Run.RunFinish{Run.RunSuccess{}}) == Run.RunNext{Run.RunSucceeded{}, False{}, False{}, False{}} : Run.Step}

law queued_cancel_needs_no_effect:
  {Run.step(Run.RunQueued{}, Run.RunCancel{}) == Run.RunNext{Run.RunCancelled{}, True{}, False{}, True{}} : Run.Step}

law unsupported_relation_is_absent:
  for context: String
  {Core.topology_record("relation", "moment.within", Nil{}, context, "perspective", False{}, "frame", "child", "parent", "earlier", "later") == Top.TopSkip{} : Top.Projection}

law missing_temporal_frame_is_context:
  for context: String
  {Core.topology_record("relation", "moment.precedes", Con{"asserted", Nil{}}, context, "perspective", False{}, "frame", "child", "parent", "earlier", "later") == Top.TopBefore{context, "earlier", "later"} : Top.Projection}

law single_edge_is_usable:
  {Core.topology_check(True{}, 2, Con{Top.TopEdge{0, 1}, Nil{}}, [0:U32 * 2n], [Nil{}:List<&2, U32> * 2n], [0:U32 * 2n], [0:U32 * 2n]) == Top.TopGood{} : Top.Verdict}

law bound_identity_not_operator:
  {Core.access_operator("owner", "owner", "owner", True{}) == False{} : Bool}

law delegated_schema_remains_operator_only:
  {Core.access_method(False{}, Con{Core.AccessScope{Con{"schema.publish", Nil{}}, True{}, Nil{}, Con{"context", Nil{}}}, Nil{}}, "schema.publish", "context") == Core.MethodSchemaOperator{} : Core.MethodAdmission}

law open_without_evidence_is_usable:
  {Core.incident_evidence(Core.IncidentOpen{}, False{}, Nil{}) == Core.IncidentEvidenceAllowed{} : Core.IncidentEvidence}

law terminal_incident_cannot_reopen:
  {Core.incident_revisable(Core.IncidentCompleted{}, Core.IncidentOpen{}) == False{} : Bool}

law closed_context_can_reconcile:
  {Core.mutation_basis("1", "1", "closed", "execution.reconcile") == Core.MutationAllowed{} : Core.MutationAdmission}

law word_carry_is_exact:
  {Budget.add(Budget.BudgetCount{0, 4294967295}, Budget.one()) == Budget.BudgetFinite{Budget.BudgetCount{1, 0}} : Budget.Amount}

law unsafe_sum_is_overflow:
  {Budget.add(Budget.BudgetCount{2097151, 4294967295}, Budget.one()) == Budget.BudgetOverflow{} : Budget.Amount}

law overflow_never_fits:
  {Budget.fits(Budget.BudgetOverflow{}, Budget.BudgetCount{2097151, 4294967295}) == False{} : Bool}

law empty_balance_is_usable:
  {Budget.within(Budget.empty(), Budget.BudgetQuantities{Budget.zero(), Budget.zero(), Budget.zero(), Budget.zero(), Budget.zero(), Budget.zero()}) == True{} : Bool}

law word_borrow_is_exact:
  {Budget.subtract(Budget.BudgetCount{1, 0}, Budget.one()) == Budget.BudgetFinite{Budget.BudgetCount{0, 4294967295}} : Budget.Amount}

law negative_difference_refused:
  {Budget.subtract(Budget.zero(), Budget.one()) == Budget.BudgetOverflow{} : Budget.Amount}

law live_lease_is_usable:
  {Core.lease_window(Budget.BudgetCount{0, 100}, Budget.one(), Con{Budget.BudgetCount{0, 200}, Nil{}}) == Core.ClockWindow{Budget.BudgetCount{0, 101}, Budget.one()} : Core.LeaseWindow}

law missing_clock_frame_expires:
  for wall: Core.Rank
  for wall_end: Core.Rank
  for mono: Core.Rank
  for mono_end: Core.Rank
  {Core.lease_expired(True{}, False{}, "", "boot", wall, wall_end, mono, mono_end) == True{} : Bool}

law terminal_clock_is_inert:
  {Core.execution_maintenance(Run.RunSucceeded{}, True{}, False{}, Core.Rank{0, 0}, Core.Rank{0, 0}, Core.Rank{0, 0}, Nil{}) == Core.ClockKeep{} : Core.Maintenance}

law exhausted_fence_refused:
  {Core.fence_next(Budget.BudgetCount{2097151, 4294967295}) == Budget.BudgetOverflow{} : Budget.Amount}

law cancellation_blocks_retry:
  {Core.retry_admission(True{}, "idempotent", "idempotent") == Core.RetryCancelled{} : Core.RetryAdmission}
