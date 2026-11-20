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
