import Base
import ./semantics.bend as Core
import ./execution.bend as Run
import ./topology.bend as Top
import ./accounting.bend as Budget
import ./scheduler.bend as Sched
import ./capability.bend as Cap

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

law zero_calendar_gap_is_usable:
  {Core.calendar_after(Budget.zero(), Budget.zero(), Budget.one()) == Budget.BudgetFinite{Budget.zero()} : Budget.Amount}

law calendar_overflow_refused:
  {Core.calendar_after(Budget.one(), Budget.one(), Budget.one()) == Budget.BudgetOverflow{} : Budget.Amount}

law unknown_usage_advertises_no_capacity:
  {Budget.available(Con{Budget.CapacityEnvelope{Budget.BudgetOverflow{}, Budget.one()}, Nil{}}) == Budget.zero() : Budget.Count}

law completed_schedule_cannot_cancel:
  {Core.schedule_cancellable(Sched.SchCompleted{}) == False{} : Bool}

law word_self_compare:
  for n: Nat
  for value: Word(n)
  {Word.cmp(n, value, value) == EQ{} : Cmp}

law count_self_equal:
  for value: Budget.Count
  {Budget.equal(value, value) == True{} : Bool}

law cancelled_schedule_never_ready:
  for activity: Budget.Count
  {Core.schedule_ready(Sched.SchFacts{Sched.SchCancelled{}, Budget.zero(), Sched.SchNoBlock{}, 1, 0, False{}, False{}, Sched.SchNoBlock{}}, activity, False{}, 0) == False{} : Bool}

law blocked_schedule_rests:
  for activity: Budget.Count
  {Core.schedule_ready(Sched.SchFacts{Sched.SchActive{}, Budget.zero(), Sched.SchBlocked{activity}, 1, 0, False{}, False{}, Sched.SchNoBlock{}}, activity, False{}, 0) == False{} : Bool}

law full_queue_keeps_cursor:
  for previous: Budget.Count
  for sequence: Budget.Count
  for activity: Budget.Count
  for old_edge: Bool
  {Core.schedule_advance(previous, sequence, activity, old_edge, False{}, True{}, False{}, True{}, False{}) == Sched.SchAdvance{previous, old_edge, True{}, True{}} : Sched.Advance}

law repeated_edge_does_not_fire:
  {Core.schedule_observation(False{}, True{}, True{}) == Sched.SchObservation{False{}, True{}} : Sched.Observation}

law failed_capacity_retains_rise:
  {Core.schedule_capacity_edge(False{}, True{}, False{}) == False{} : Bool}

law missing_ancestry_is_unknown:
  for id: String
  for context: String
  for schedule: String
  {Core.schedule_causal_step(Core.schedule_causality(id), Sched.SchMissingCause{}, context, schedule) == Sched.SchUnknownCause{} : Sched.CausalStep}

law empty_ancestry_is_independent:
  {Core.schedule_causal_demand(Sched.SchCausality{Nil{}, Nil{}, 0}) == Sched.SchIndependent{} : Sched.Demand}

law observed_policy_permits_compatible_match:
  {Core.capability_finish(Cap.CapNeedsPolicy{}, Cap.CapPolicyAllowed{}) == Cap.CapAssessment{Nil{}, Cap.CapEligible{}} : Cap.Assessment}

law missing_policy_remains_unknown:
  {Core.capability_finish(Cap.CapNeedsPolicy{}, Cap.CapPolicyMissing{}) == Cap.CapAssessment{Con{"policy_unknown", Nil{}}, Cap.CapUnknown{}} : Cap.Assessment}

law unresolved_policy_remains_unknown:
  {Core.capability_finish(Cap.CapNeedsPolicy{}, Cap.CapPolicyUnknown{}) == Cap.CapAssessment{Con{"policy_unknown", Nil{}}, Cap.CapUnknown{}} : Cap.Assessment}

law denied_policy_is_ineligible:
  {Core.capability_finish(Cap.CapNeedsPolicy{}, Cap.CapPolicyDenied{}) == Cap.CapAssessment{Con{"policy", Nil{}}, Cap.CapIneligible{}} : Cap.Assessment}

law policy_cannot_erase_incompatibility:
  for unmet: +List<String>
  for policy: Cap.PolicyObservation
  {Core.capability_finish(Cap.CapAssessment{unmet, Cap.CapIneligible{}}, policy) == Cap.CapAssessment{unmet, Cap.CapIneligible{}} : Cap.Assessment}

law required_evidence_needs_source:
  {Core.execution_evidence(True{}, Nil{}) == False{} : Bool}

law optional_evidence_is_usable:
  {Core.execution_evidence(False{}, Nil{}) == True{} : Bool}

law unreadable_advertisement_is_absent:
  for advertised: String
  for requested: String
  {Core.capability_selected(advertised, requested, False{}) == False{} : Bool}

law capability_retention_is_bounded:
  {Core.execution_room(4096) == False{} : Bool}

law live_provider_can_publish:
  for input: Cap.Schema
  for output: Cap.Schema
  for features: +List<String>
  {Cap.publish(Cap.CapAdvertisement{"cap", "provider", "verify", "1", input, output, features, "process"}, "provider", Nil{}, 0, False{}) == Cap.CapPublishAllowed{} : Cap.Publication}

law missing_origin_hides_execution:
  for principal: String
  for chain: +List<String>
  {Core.execution_visible(True{}, False{}, True{}, True{}, principal, "", "", "", chain, True{}, True{}) == False{} : Bool}

law absent_deadline_is_usable:
  for expiry: Core.Rank
  for now: Core.Rank
  {Core.execution_deadline(False{}, expiry, now) == True{} : Bool}
