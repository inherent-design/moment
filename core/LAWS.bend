import Base
import ./semantics.bend as Core
import ./execution.bend as Run

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
