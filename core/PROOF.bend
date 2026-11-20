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
