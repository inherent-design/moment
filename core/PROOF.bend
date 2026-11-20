import Base
import ./semantics.bend as Core
import ./accounting.bend as Budget
import ./LAWS.bend as Laws

def Laws.deny_precedence(permits):
  {==}

def Laws.unknown_deny_blocks_permit():
  {==}

def Laws.positive_permit():
  {==}

def Laws.withdrawn_final(same_digest):
  {==}

def Laws.missing_support_refused(same_digest, support):
  {==}

def Laws.supported_withdrawal():
  {==}

def Laws.withdrawal_idempotent():
  {==}

def Laws.revoked_grant_unavailable(expiry_present, expiry, now):
  {==}

def Laws.unexpired_grant_available(expiry, now):
  {==}

def Laws.uncertain_claim_refused():
  {==}

def Laws.claim_requires_current_authority():
  {==}

def Laws.retry_requires_current_authority():
  {==}

def Laws.leased_effect_needs_dispatch():
  {==}

def Laws.cancelling_accepts_real_success():
  {==}

def Laws.queued_cancel_needs_no_effect():
  {==}

def Laws.unsupported_relation_is_absent(context):
  {==}

def Laws.missing_temporal_frame_is_context(context):
  {==}

def Laws.single_edge_is_usable():
  {==}

def Laws.bound_identity_not_operator():
  {==}

def Laws.delegated_schema_remains_operator_only():
  {==}

def Laws.open_without_evidence_is_usable():
  {==}

def Laws.terminal_incident_cannot_reopen():
  {==}

def Laws.closed_context_can_reconcile():
  {==}

def Laws.word_carry_is_exact():
  {==}

def Laws.unsafe_sum_is_overflow():
  {==}

def Laws.overflow_never_fits():
  {==}

def Laws.empty_balance_is_usable():
  {==}

def Laws.word_borrow_is_exact():
  {==}

def Laws.negative_difference_refused():
  {==}

def Laws.live_lease_is_usable():
  {==}

def Laws.missing_clock_frame_expires(wall, wall_end, mono, mono_end):
  {==}

def Laws.terminal_clock_is_inert():
  {==}

def Laws.exhausted_fence_refused():
  {==}

def Laws.cancellation_blocks_retry():
  {==}

def Laws.zero_calendar_gap_is_usable():
  {==}

def Laws.calendar_overflow_refused():
  {==}

def Laws.unknown_usage_advertises_no_capacity():
  {==}

def Laws.completed_schedule_cannot_cancel():
  {==}

def Laws.word_self_compare(n, value):
  match n:
    case 0n:
      {==}
    case 1n+p:
      match value:
        case WCon{False{}, tail}:
          Equal.cong(Cmp, Cmp, value => Word.cmp.fin(False{}, False{}, value), Word.cmp(p, tail, tail), EQ{}, Laws.word_self_compare(p, tail))
        case WCon{True{}, tail}:
          Equal.cong(Cmp, Cmp, value => Word.cmp.fin(True{}, True{}, value), Word.cmp(p, tail, tail), EQ{}, Laws.word_self_compare(p, tail))

def Laws.count_self_equal(value):
  match value:
    case Budget.BudgetCount{U32{high}, U32{low}}:
      Equal.trans(Bool,
        Bool.and(Cmp.is_eq(Word.cmp(32n, high, high)), Cmp.is_eq(Word.cmp(32n, low, low))),
        Cmp.is_eq(Word.cmp(32n, low, low)), True{},
        Equal.cong(Cmp, Bool, value => Bool.and(Cmp.is_eq(value), Cmp.is_eq(Word.cmp(32n, low, low))), Word.cmp(32n, high, high), EQ{}, Laws.word_self_compare(32n, high)),
        Equal.cong(Cmp, Bool, Cmp.is_eq, Word.cmp(32n, low, low), EQ{}, Laws.word_self_compare(32n, low)))

def Laws.cancelled_schedule_never_ready(activity):
  {==}

def Laws.blocked_schedule_rests(activity):
  Equal.cong(Bool, Bool, value => Bool.and(Bool.not(value), Bool.or(Bool.and(Bool.not(Budget.le(activity, Budget.zero())), True{}), True{})), Budget.equal(activity, activity), True{}, Laws.count_self_equal(activity))

def Laws.full_queue_keeps_cursor(previous, sequence, activity, old_edge):
  {==}

def Laws.repeated_edge_does_not_fire():
  {==}

def Laws.failed_capacity_retains_rise():
  {==}

def Laws.missing_ancestry_is_unknown(id, context, schedule):
  {==}

def Laws.empty_ancestry_is_independent():
  {==}

def Laws.observed_policy_permits_compatible_match():
  {==}

def Laws.missing_policy_remains_unknown():
  {==}

def Laws.unresolved_policy_remains_unknown():
  {==}

def Laws.denied_policy_is_ineligible():
  {==}

def Laws.policy_cannot_erase_incompatibility(unmet, policy):
  {==}

def Laws.required_evidence_needs_source():
  {==}

def Laws.optional_evidence_is_usable():
  {==}

def Laws.unreadable_advertisement_is_absent(advertised, requested):
  {==}

def Laws.capability_retention_is_bounded():
  {==}

def Laws.live_provider_can_publish(input, output, features):
  {==}

def Laws.missing_origin_hides_execution(principal, chain):
  {==}

def Laws.absent_deadline_is_usable(expiry, now):
  {==}

def Laws.exhausted_query_budget_is_final(cost):
  {==}

def Laws.empty_query_budget_refuses_an_observation():
  {==}

def Laws.exact_last_observation_is_usable():
  {==}

def Laws.oversized_query_snapshot_is_unknown():
  {==}

def Laws.bounded_query_snapshot_is_usable():
  {==}

def Laws.withdrawn_authorization_support_is_inactive(visible):
  {==}

def Laws.restricted_missing_proof_is_unknown():
  {==}

def Laws.visible_positive_proof_is_usable(operator):
  {==}

def Laws.exhausted_relationship_query_is_unknown(edges, source, destination, hops, operator):
  {==}

def Laws.endpoint_identity_is_not_a_path(source):
  {==}

def Laws.observed_relationship_is_usable():
  {==}

def Laws.oversized_role_count_is_above_bound():
  {==}

def Laws.oversized_role_count_cannot_wrap():
  {==}

def Laws.root_projection_is_usable():
  {==}

def Laws.schema_grouping_needs_visible_schema():
  {==}

def Laws.support_children_are_not_projection_fields():
  {==}

def Laws.projection_limit_cannot_expand(paths, grouped):
  {==}

def Laws.empty_proposal_is_not_work():
  {==}

def Laws.stale_proposal_cannot_admit(changes, executions):
  {==}

def Laws.fresh_proposal_is_usable():
  {==}

def Laws.proposal_cannot_alias_its_change():
  {==}

def Laws.terminal_proposal_cannot_commit(revision, policy):
  {==}

def Laws.stale_commit_cannot_rebase():
  {==}

def Laws.current_proposal_can_commit():
  {==}

def Laws.repeated_plan_identity_is_refused():
  {==}

def Laws.plan_cannot_cross_incidents():
  {==}

def Laws.missing_bound_grant_is_not_selection(submitted, bound):
  {==}

def Laws.matching_bound_grant_is_usable():
  {==}

def Laws.unsupported_transition_branch_is_hidden():
  {==}

def Laws.reserved_schema_needs_installed_definition(submitted, actual):
  {==}

def Laws.matching_user_schema_is_usable():
  {==}

def Laws.unknown_rule_binding_is_refused():
  {==}

def Laws.future_reaction_source_is_unavailable():
  {==}

def Laws.invisible_reaction_event_is_not_a_trigger(kind, types):
  {==}

def Laws.eventless_reaction_is_usable():
  {==}

def Laws.missing_named_event_is_not_eventless():
  {==}

def Laws.matched_reaction_preserves_its_result(value):
  {==}

def Laws.false_does_not_resolve_unknown_reaction():
  {==}

def Laws.positive_reaction_can_resolve_unknown():
  {==}

def Laws.empty_reaction_has_no_candidate():
  {==}

def Laws.high_sequence_order_stays_exact():
  {==}

def Laws.mailbox_body_is_not_generic_detail(kind, roles, incident, scope, dependencies):
  {==}

def Laws.absent_incident_hides_message(recipient, principal):
  {==}

def Laws.summary_last_byte_is_usable():
  {==}

def Laws.full_mailbox_refuses_new_message(bytes, incident, scope, live):
  {==}

def Laws.response_requires_named_request(incident, principal, recipient):
  {==}

def Laws.matching_reply_still_needs_visibility():
  {==}

def Laws.acknowledged_mail_is_not_implicitly_selected():
  {==}

def Laws.unacknowledged_mail_is_selected(include_acknowledged):
  match include_acknowledged:
    case False{}:
      {==}
    case True{}:
      {==}

def Laws.empty_template_support_is_not_authority(record, issuers):
  {==}

def Laws.withdrawn_template_is_not_instruction(visible):
  {==}

def Laws.current_template_support_is_usable():
  {==}

def Laws.malformed_template_slots_refuse(count, expected, declared, optional, markers):
  {==}

def Laws.fitting_prompt_keeps_required_evidence(candidates):
  {==}

def Laws.prompt_omits_last_declared_optional_first():
  {==}

def Laws.mailbox_reference_keeps_recipient_boundary(readable):
  {==}

def Laws.event_scan_stops_at_its_budget(items, ceiling):
  {==}

def Laws.empty_visibility_group_is_not_authority(next):
  {==}

def Laws.exhausted_visibility_pop_refuses(seen):
  {==}

def Laws.complete_visibility_walk_is_useful(seen):
  {==}

def Laws.missing_visibility_event_refuses(context):
  {==}

def Laws.refused_reference_does_not_complete_group(next):
  {==}

def Laws.accepted_reference_keeps_causal_continuation(next):
  {==}

def Laws.recipient_capacity_does_not_expand(indices):
  {==}


def Laws.guidance_root_matches_descendants(selected):
  {==}


def Laws.guidance_component_is_not_text_prefix():
  {==}


def Laws.guidance_invalid_registration_refuses(present, count, same):
  {==}


def Laws.guidance_existing_registration_survives_capacity(count):
  {==}


def Laws.guidance_full_new_registry_refuses():
  {==}


def Laws.guidance_withdrawn_source_cannot_refresh(storage):
  {==}


def Laws.guidance_ready_source_can_refresh():
  {==}


def Laws.guidance_retention_accepts_last_available_slot():
  {==}


def Laws.guidance_full_capture_registry_refuses():
  {==}


def Laws.guidance_unknown_domain_error_is_not_missing():
  {==}


def Laws.guidance_implicit_withdrawn_source_is_absent(located, matches):
  {==}


def Laws.guidance_explicit_history_remains_selectable():
  {==}


def Laws.guidance_empty_assessment_refuses():
  {==}


def Laws.guidance_32_source_assessment_is_useful():
  {==}


def Laws.guidance_evidence_byte_boundary_is_useful():
  {==}


def Laws.guidance_evidence_word_overflow_refuses():
  {==}


def Laws.guidance_withdrawn_capture_is_historical(definition, captured, observation, latest, capture):
  {==}


def Laws.guidance_exact_capture_is_current():
  {==}


def Laws.guidance_missing_basis_is_not_current(actual, expected):
  {==}


def Laws.guidance_changed_policy_refuses_current():
  {==}


def Laws.guidance_wrong_principal_cannot_supply_profile(actions, resources, operator, candidate, bound):
  {==}


def Laws.guidance_valid_profile_grant_is_useful():
  {==}


def Laws.guidance_blocked_candidate_rests(settlement):
  {==}


def Laws.guidance_uncertain_receipt_keeps_priority(a, b):
  {==}


def Laws.guidance_actual_failure_is_not_projection(raw):
  {==}


def Laws.guidance_missing_output_is_uncertain():
  {==}


def Laws.guidance_ambiguous_quotation_stays_ambiguous(editorial):
  {==}


def Laws.guidance_editorial_quotation_is_explicit():
  {==}


def Laws.memory_unknown_is_not_terminal():
  {==}


def Laws.memory_unknown_keeps_pending_custody():
  {==}


def Laws.memory_exchange_cannot_become_focus_source(authorship):
  {==}


def Laws.memory_human_submission_is_useful():
  {==}


def Laws.memory_union_keeps_source_order():
  {==}


def Laws.memory_exchange_remains_context():
  {==}


def Laws.memory_focus_header_preserves_high_revision():
  {==}


def Laws.memory_equal_focus_still_needs_projection():
  {==}


def Laws.memory_full_existing_set_is_reusable(count, maximum):
  {==}


def Laws.memory_existing_set_cannot_be_reseeded(count, maximum):
  {==}


def Laws.memory_pending_set_cannot_be_released(released, current, present, replacement):
  {==}


def Laws.memory_initial_opt_out_is_an_observation():
  {==}


def Laws.memory_opt_out_keeps_unknown_execution():
  {==}


def Laws.memory_disabled_enrollment_cannot_admit(revision, expected):
  {==}


def Laws.memory_explicit_target_survives_focus_change(focus):
  {==}


def Laws.memory_ambiguous_operator_input_refuses(sequence, inputs, pending, maximum):
  {==}


def Laws.memory_busy_dispatch_blocks_new_work(pending):
  {==}


def Laws.memory_ready_input_can_progress():
  {==}


def Laws.memory_dormant_result_does_not_restore_focus():
  {==}


def Laws.memory_changed_destination_refuses_late_result():
  {==}


def Laws.memory_observed_failure_is_not_selection(bounded, schema, replace):
  {==}


def Laws.memory_context_only_entry_is_refused():
  {==}


def Laws.memory_duplicate_source_cannot_split_cache_unit():
  {==}


def Laws.memory_supplied_unique_selection_is_useful():
  {==}


def Laws.memory_not_started_can_release_unknown_custody():
  {==}


def Laws.memory_uncertain_cancel_is_not_termination():
  {==}


def Laws.memory_disabled_automation_does_not_claim_coverage(issue, observed, revision, observed_revision):
  {==}


def Laws.memory_assistant_is_not_submitted_user_evidence():
  {==}


def Laws.memory_rebuild_uses_selected_epoch():
  {==}


def Laws.memory_unknown_dispatch_cannot_prepare():
  {==}


def Laws.memory_exhausted_sequence_has_no_successor():
  {==}


def Laws.memory_unknown_head_does_not_run(sequence, processed):
  {==}


def Laws.memory_empty_heads_do_not_invent_work():
  {==}


def Laws.memory_full_signed_row_order_is_preserved():
  {==}
