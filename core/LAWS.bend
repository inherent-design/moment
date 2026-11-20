import Base
import ./semantics.bend as Core
import ./execution.bend as Run
import ./topology.bend as Top
import ./accounting.bend as Budget
import ./scheduler.bend as Sched
import ./capability.bend as Cap
import ./policy-query.bend as PQ
import ./control.bend as Control
import ./awareness.bend as Aware
import ./guidance.bend as Guide

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

law exhausted_query_budget_is_final:
  for cost: U32
  {PQ.charge(PQ.PQExhausted{}, cost) == PQ.PQExhausted{} : PQ.Budget}

law empty_query_budget_refuses_an_observation:
  {PQ.charge(PQ.PQBudget{0}, 1) == PQ.PQExhausted{} : PQ.Budget}

law exact_last_observation_is_usable:
  {PQ.charge(PQ.PQBudget{1}, 1) == PQ.PQBudget{0} : PQ.Budget}

law oversized_query_snapshot_is_unknown:
  {Core.policy_query_initial(4097, 0) == PQ.PQExhausted{} : PQ.Budget}

law bounded_query_snapshot_is_usable:
  {Core.policy_query_initial(4096, 16384) == PQ.PQBudget{12288} : PQ.Budget}

law withdrawn_authorization_support_is_inactive:
  for visible: +List<Bool>
  {Core.policy_query_supported("withdrawn", visible) == False{} : Bool}

law restricted_missing_proof_is_unknown:
  {Core.policy_query_observed(False{}, False{}) == PQ.PQUnknown{} : PQ.Verdict}

law visible_positive_proof_is_usable:
  for operator: Bool
  {Core.policy_query_observed(True{}, operator) == PQ.PQYes{} : PQ.Verdict}

law exhausted_relationship_query_is_unknown:
  for edges: +List<PQ.Edge>
  for source: String
  for destination: String
  for hops: Nat
  for operator: Bool
  {Core.policy_query_related(edges, source, destination, hops, operator, PQ.PQExhausted{}) == PQ.PQDone{PQ.PQUnknown{}, PQ.PQExhausted{}} : PQ.Search}

law endpoint_identity_is_not_a_path:
  for source: String
  {Core.policy_query_related(Nil{}, source, source, 1n, True{}, PQ.PQBudget{1}) == PQ.PQDone{PQ.PQNo{}, PQ.PQBudget{1}} : PQ.Search}

law observed_relationship_is_usable:
  {Core.policy_query_related(Con{PQ.PQEdge{Budget.one(), Budget.one(), Con{"from", Nil{}}, Con{PQ.PQTarget{"to", True{}}, Nil{}}}, Nil{}}, "from", "to", 1n, False{}, PQ.PQBudget{3}) == PQ.PQDone{PQ.PQYes{}, PQ.PQBudget{0}} : PQ.Search}

law oversized_role_count_is_above_bound:
  {Budget.le(Budget.BudgetCount{1, 0}, Budget.BudgetCount{0, 32768}) == False{} : Bool}

law oversized_role_count_cannot_wrap:
  {PQ.role_budget(Budget.BudgetCount{1, 0}, Budget.zero(), PQ.PQBudget{32768}) == PQ.PQExhausted{} : PQ.Budget}

law root_projection_is_usable:
  {Core.control_projection(1, Con{Control.ProjectionPath{Nil{}}, Nil{}}, True{}) == Control.ProjectionAllowed{} : Control.Projection}

law schema_grouping_needs_visible_schema:
  {Core.control_projection(1, Con{Control.ProjectionPath{Con{"digest", Nil{}}}, Nil{}}, True{}) == Control.ProjectionSchemaHidden{} : Control.Projection}

law support_children_are_not_projection_fields:
  {Core.control_projection(1, Con{Control.ProjectionPath{Con{"support", Con{"value", Nil{}}}}, Nil{}}, False{}) == Control.ProjectionUnknown{} : Control.Projection}

law projection_limit_cannot_expand:
  for paths: +List<Control.Path>
  for grouped: Bool
  {Core.control_projection(65, paths, grouped) == Control.ProjectionTooMany{} : Control.Projection}

law empty_proposal_is_not_work:
  {Core.control_proposal("p", "1", "1", "policy", "policy", Nil{}, 0) == Control.ProposalEmpty{} : Control.Proposal}

law stale_proposal_cannot_admit:
  for changes: +List<Control.Change>
  for executions: U32
  {Core.control_proposal("p", "1", "2", "policy", "policy", changes, executions) == Control.ProposalStale{} : Control.Proposal}

law fresh_proposal_is_usable:
  {Core.control_proposal("p", "1", "1", "policy", "policy", Con{Control.DeclaredChange{"a"}, Nil{}}, 0) == Control.ProposalAllowed{} : Control.Proposal}

law proposal_cannot_alias_its_change:
  {Core.control_proposal("p", "1", "1", "policy", "policy", Con{Control.DeclaredChange{"p"}, Nil{}}, 0) == Control.ProposalAlias{} : Control.Proposal}

law terminal_proposal_cannot_commit:
  for revision: String
  for policy: String
  {Core.control_commit("committed", revision, revision, policy, policy) == Control.CommitTerminal{} : Control.Commit}

law stale_commit_cannot_rebase:
  {Core.control_commit("proposed", "1", "2", "policy", "policy") == Control.CommitStale{} : Control.Commit}

law current_proposal_can_commit:
  {Core.control_commit("proposed", "1", "1", "policy", "policy") == Control.CommitAllowed{} : Control.Commit}

law repeated_plan_identity_is_refused:
  {Core.control_plan("p", "i", Nil{}, Con{Control.PlanExecution{"a", "i"}, Con{Control.PlanExecution{"a", "i"}, Nil{}}}) == Control.PlanAlias{} : Control.Plan}

law plan_cannot_cross_incidents:
  {Core.control_plan("p", "i", Nil{}, Con{Control.PlanExecution{"a", "other"}, Nil{}}) == Control.PlanIncident{} : Control.Plan}

law missing_bound_grant_is_not_selection:
  for submitted: String
  for bound: String
  {Core.control_bound(False{}, True{}, False{}, submitted, bound) == False{} : Bool}

law matching_bound_grant_is_usable:
  {Core.control_bound(False{}, True{}, True{}, "g", "g") == True{} : Bool}

law unsupported_transition_branch_is_hidden:
  {Core.control_visible(True{}, True{}, False{}, "author", "reader", "g", Con{"g", Nil{}}, False{}) == False{} : Bool}

law reserved_schema_needs_installed_definition:
  for submitted: String
  for actual: String
  {Core.control_schema("moment.test", False{}, submitted, actual, False{}, "") == Control.SchemaReserved{} : Control.SchemaAdmission}

law matching_user_schema_is_usable:
  {Core.control_schema("user.test", False{}, "digest", "digest", False{}, "") == Control.SchemaAllowed{} : Control.SchemaAdmission}

law unknown_rule_binding_is_refused:
  {Core.control_bindings(Con{"arbitrary", Nil{}}) == False{} : Bool}

law future_reaction_source_is_unavailable:
  {Core.reaction_source(True{}, Budget.BudgetCount{0, 2}, Budget.BudgetCount{0, 1}) == Core.ReactionSourceMissing{} : Core.ReactionSource}

law invisible_reaction_event_is_not_a_trigger:
  for kind: String
  for types: +List<String>
  {Core.reaction_event(False{}, kind, types) == Core.ReactionEventHidden{} : Core.ReactionEvent}

law eventless_reaction_is_usable:
  {Core.reaction_mode(0, 0, 0) == Core.ReactionOnce{} : Core.ReactionMode}

law missing_named_event_is_not_eventless:
  {Core.reaction_mode(0, 1, 0) == Core.ReactionNone{} : Core.ReactionMode}

law matched_reaction_preserves_its_result:
  for value: Core.Truth
  {Core.reaction_observe(Core.ReactionMatched{}, value) == Core.ReactionMatched{} : Core.ReactionProgress}

law false_does_not_resolve_unknown_reaction:
  {Core.reaction_observe(Core.ReactionPending{True{}}, Core.No{}) == Core.ReactionPending{True{}} : Core.ReactionProgress}

law positive_reaction_can_resolve_unknown:
  {Core.reaction_observe(Core.ReactionPending{True{}}, Core.Yes{}) == Core.ReactionMatched{} : Core.ReactionProgress}

law empty_reaction_has_no_candidate:
  {Core.reaction_finish(Core.reaction_begin()) == Core.ReactionIneligible{} : Core.ReactionEnd}

law high_sequence_order_stays_exact:
  {Core.resource_compare(Budget.BudgetCount{1, 0}, Budget.BudgetCount{0, 4294967295}) == GT{} : Cmp}

law mailbox_body_is_not_generic_detail:
  for kind: String
  for roles: +List<Bool>
  for incident: Bool
  for scope: Bool
  for dependencies: +List<Bool>
  {Core.awareness_detail(True{}, kind, roles, incident, scope, dependencies) == Aware.DetailMailbox{} : Aware.Detail}

law absent_incident_hides_message:
  for recipient: String
  for principal: String
  {Core.awareness_message_visible(True{}, recipient, principal, False{}) == False{} : Bool}

law summary_last_byte_is_usable:
  {Core.awareness_message(0, Budget.BudgetCount{0, 8192}, True{}, True{}, True{}) == Aware.MessageAllowed{} : Aware.MessageAdmission}

law full_mailbox_refuses_new_message:
  for bytes: Budget.Count
  for incident: Bool
  for scope: Bool
  for live: Bool
  {Core.awareness_message(4096, bytes, incident, scope, live) == Aware.MessageRetention{} : Aware.MessageAdmission}

law response_requires_named_request:
  for incident: String
  for principal: String
  for recipient: String
  {Core.awareness_reply("response", incident, principal, recipient, Aware.NoParent{}) == Aware.ReplyRequired{} : Aware.Reply}

law matching_reply_still_needs_visibility:
  {Core.awareness_reply("response", "i", "b", "a", Aware.ReplyParent{"request", "i", "b", "a"}) == Aware.ReplyNeedsVisibility{} : Aware.Reply}

law acknowledged_mail_is_not_implicitly_selected:
  {Core.awareness_selected(False{}, True{}) == False{} : Bool}

law unacknowledged_mail_is_selected:
  for include_acknowledged: Bool
  {Core.awareness_selected(include_acknowledged, False{}) == True{} : Bool}

law empty_template_support_is_not_authority:
  for record: String
  for issuers: +List<String>
  {Core.awareness_supported(Nil{}, record, issuers) == False{} : Bool}

law withdrawn_template_is_not_instruction:
  for visible: +List<Bool>
  {Core.awareness_supported(Con{Aware.TemplateSupport{"t", "owner", "withdrawn", visible}, Nil{}}, "t", Con{"owner", Nil{}}) == False{} : Bool}

law current_template_support_is_usable:
  {Core.awareness_supported(Con{Aware.TemplateSupport{"t", "owner", "asserted", Nil{}}, Nil{}}, "t", Con{"owner", Nil{}}) == True{} : Bool}

law malformed_template_slots_refuse:
  for count: U32
  for expected: U32
  for declared: +List<String>
  for optional: +List<String>
  for markers: +List<String>
  {Core.awareness_slots(count, expected, declared, optional, markers, True{}) == False{} : Bool}

law fitting_prompt_keeps_required_evidence:
  for candidates: +List<String>
  {Core.awareness_prompt_step(candidates, Budget.BudgetCount{0, 0}, Budget.BudgetCount{0, 0}) == Aware.PromptFits{} : Aware.PromptStep}

law prompt_omits_last_declared_optional_first:
  {Core.awareness_prompt_candidates(Con{"a", Con{"b", Con{"c", Nil{}}}}, Con{"a", Con{"c", Nil{}}}) == Con{"c", Con{"a", Nil{}}} : +List<String>}

law mailbox_reference_keeps_recipient_boundary:
  for readable: Bool
  {Core.awareness_ref_route(True{}, True{}, readable, False{}, False{}, False{}) == Aware.RefMailbox{} : Aware.RefRoute}

law event_scan_stops_at_its_budget:
  for items: U32
  for ceiling: U32
  {Core.awareness_scan_request(items, ceiling, 4096) == 0 : U32}

law empty_visibility_group_is_not_authority:
  for next: Aware.Walk
  {Aware.groups(Con{Aware.VisibilityGroup{Nil{}}, Nil{}}, next) == Aware.VisibilityDenied{} : Aware.Visibility}

law exhausted_visibility_pop_refuses:
  for seen: +List<String>
  {Core.visibility_demand(Aware.VisibilityWalking{Aware.VisibilityWalk{Con{"root", Nil{}}, seen, 0}}) == Aware.VisibilityComplete{False{}} : Aware.Demand}

law complete_visibility_walk_is_useful:
  for seen: +List<String>
  {Core.visibility_demand(Aware.VisibilityWalking{Aware.VisibilityWalk{Nil{}, seen, 0}}) == Aware.VisibilityComplete{True{}} : Aware.Demand}

law missing_visibility_event_refuses:
  for context: String
  {Core.visibility_event(Aware.VisibilityWalking{Aware.VisibilityWalk{Con{"root", Nil{}}, Nil{}, 64}}, Aware.VisibilityMissingEvent{}, context) == Aware.VisibilityDenied{} : Aware.Visibility}

law refused_reference_does_not_complete_group:
  for next: Aware.Walk
  {Core.visibility_ref(Aware.VisibilityChecking{Con{"ref", Nil{}}, Nil{}, next}, False{}) == Aware.VisibilityDenied{} : Aware.Visibility}

law accepted_reference_keeps_causal_continuation:
  for next: Aware.Walk
  {Core.visibility_ref(Aware.VisibilityChecking{Con{"ref", Nil{}}, Nil{}, next}, True{}) == Aware.VisibilityChecking{Nil{}, Nil{}, next} : Aware.Visibility}

law recipient_capacity_does_not_expand:
  for indices: +List<U32>
  {Aware.recipient_step("actor", Aware.RecipientGrant{0, "actor"}, Aware.RecipientCollect{4096, indices}) == Aware.RecipientExhausted{} : Aware.RecipientBag}


law guidance_root_matches_descendants:
  for selected: +List<String>
  {Core.guidance_path("/", Nil{}, "/", selected) == True{} : Bool}


law guidance_component_is_not_text_prefix:
  {Core.guidance_path("/", Con{"a", Nil{}}, "/", Con{"ab", Nil{}}) == False{} : Bool}


law guidance_invalid_registration_refuses:
  for present: Bool
  for count: U32
  for same: Bool
  {Core.guidance_registration(False{}, present, count, same) == Guide.GuidanceInvalidPaths{} : Guide.Registration}


law guidance_existing_registration_survives_capacity:
  for count: U32
  {Core.guidance_registration(True{}, True{}, count, True{}) == Guide.GuidanceSameSource{} : Guide.Registration}


law guidance_full_new_registry_refuses:
  {Core.guidance_registration(True{}, False{}, 256, False{}) == Guide.GuidanceRegistryFull{} : Guide.Registration}


law guidance_withdrawn_source_cannot_refresh:
  for storage: Bool
  {Core.guidance_refresh(False{}, storage) == Guide.GuidanceWithdrawn{} : Guide.Refresh}


law guidance_ready_source_can_refresh:
  {Core.guidance_refresh(True{}, True{}) == Guide.GuidanceObserve{} : Guide.Refresh}


law guidance_retention_accepts_last_available_slot:
  {Core.guidance_retained(Budget.BudgetCount{0, 1}, Budget.BudgetCount{0, 2}, Budget.BudgetCount{0, 2}, Budget.BudgetCount{0, 3}, Budget.BudgetCount{0, 5}) == True{} : Bool}


law guidance_full_capture_registry_refuses:
  {Core.guidance_capture_room(2048) == False{} : Bool}


law guidance_unknown_domain_error_is_not_missing:
  {Core.guidance_observation_error("NOT_FOUND", True{}) == Guide.GuidanceRethrow{} : Guide.ObservationError}


law guidance_implicit_withdrawn_source_is_absent:
  for located: Bool
  for matches: +List<Bool>
  {Core.guidance_selected(False{}, False{}, located, matches) == False{} : Bool}


law guidance_explicit_history_remains_selectable:
  {Core.guidance_selected(True{}, False{}, False{}, Nil{}) == True{} : Bool}


law guidance_empty_assessment_refuses:
  {Core.guidance_review_size(0) == Guide.GuidanceNoSources{} : Guide.ReviewSize}


law guidance_32_source_assessment_is_useful:
  {Core.guidance_review_size(32) == Guide.GuidanceSourcesReady{} : Guide.ReviewSize}


law guidance_evidence_byte_boundary_is_useful:
  {Core.guidance_review_bytes(Con{Budget.BudgetCount{0, 131072}, Nil{}}) == True{} : Bool}


law guidance_evidence_word_overflow_refuses:
  {Core.guidance_review_bytes(Con{Budget.BudgetCount{1, 0}, Nil{}}) == False{} : Bool}


law guidance_withdrawn_capture_is_historical:
  for definition: String
  for captured: String
  for observation: String
  for latest: String
  for capture: String
  {Core.guidance_current(True{}, False{}, definition, captured, observation, latest, capture) == False{} : Bool}


law guidance_exact_capture_is_current:
  {Core.guidance_current(True{}, True{}, "d", "d", "ready", "r", "r") == True{} : Bool}


law guidance_missing_basis_is_not_current:
  for actual: String
  for expected: String
  {Core.guidance_basis(False{}, actual, expected) == Guide.GuidanceBasisUnavailable{} : Guide.Basis}


law guidance_changed_policy_refuses_current:
  {Core.guidance_policy("new", "old", "d", "d") == False{} : Bool}


law guidance_wrong_principal_cannot_supply_profile:
  for actions: +List<String>
  for resources: +List<String>
  for operator: Bool
  for candidate: String
  for bound: String
  {Core.guidance_grant("owner", "other", actions, resources, "cap", operator, candidate, bound) == False{} : Bool}


law guidance_valid_profile_grant_is_useful:
  {Core.guidance_grant("owner", "owner", Con{"local.moment.guidance", Con{"guidance.review", Nil{}}}, Con{"cap", Nil{}}, "cap", True{}, "g", "") == True{} : Bool}


law guidance_blocked_candidate_rests:
  for settlement: Bool
  {Core.guidance_candidate(Run.RunQueued{}, True{}, settlement) == False{} : Bool}


law guidance_uncertain_receipt_keeps_priority:
  for a: String
  for b: String
  {Core.guidance_candidate_compare(Run.RunUncertain{}, a, Run.RunQueued{}, b) == LT{} : Cmp}


law guidance_actual_failure_is_not_projection:
  for raw: Bool
  {Core.guidance_result("observed", True{}, raw) == Guide.GuidanceFailed{} : Guide.ReportDecision}


law guidance_missing_output_is_uncertain:
  {Core.guidance_result("observed", False{}, False{}) == Guide.GuidanceUnknownOutput{} : Guide.ReportDecision}


law guidance_ambiguous_quotation_stays_ambiguous:
  for editorial: Bool
  {Core.guidance_quote(2, editorial) == Guide.GuidanceQuoteAmbiguous{} : Guide.Quote}


law guidance_editorial_quotation_is_explicit:
  {Core.guidance_quote(1, True{}) == Guide.GuidanceQuoteEditorial{} : Guide.Quote}
