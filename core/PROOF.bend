import Base
import ./semantics.bend as Core
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
