import Base
import ./semantics.bend as Core

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
