namespace Moment

inductive Truth | yes | no | unknown deriving DecidableEq, Repr
inductive Decision | permit | deny | indeterminate deriving DecidableEq, Repr

def conjunction : Truth → Truth → Truth
  | .no, _ => .no
  | .yes, b => b
  | .unknown, .no => .no
  | .unknown, _ => .unknown

def disjunction : Truth → Truth → Truth
  | .yes, _ => .yes
  | .no, b => b
  | .unknown, .yes => .yes
  | .unknown, _ => .unknown

def negation : Truth → Truth
  | .yes => .no
  | .no => .yes
  | .unknown => .unknown

def combine : Truth → Truth → Decision
  | .yes, _ => .deny
  | .unknown, _ => .indeterminate
  | .no, .yes => .permit
  | .no, .unknown => .indeterminate
  | .no, .no => .deny

theorem deny_precedence (p : Truth) : combine .yes p = .deny := rfl
theorem unknown_deny_blocks_permit : combine .unknown .yes = .indeterminate := rfl
theorem positive_permit : combine .no .yes = .permit := rfl
theorem conjunction_commutes (a b : Truth) : conjunction a b = conjunction b a := by cases a <;> cases b <;> rfl
theorem disjunction_commutes (a b : Truth) : disjunction a b = disjunction b a := by cases a <;> cases b <;> rfl
theorem negation_involution (a : Truth) : negation (negation a) = a := by cases a <;> rfl

inductive Support | absent | asserted | withdrawn deriving DecidableEq, Repr
inductive Edit | insert | keep | missing | conflict | withdraw deriving DecidableEq, Repr
def recordEdit (present sameDigest : Bool) : Edit := if !present then .insert else if sameDigest then .keep else .conflict
def assertionEdit (localRecord sameDigest : Bool) (s : Support) : Edit :=
  if !localRecord then .missing else match s with
  | .absent => .insert
  | .withdrawn => .conflict
  | .asserted => recordEdit true sameDigest

theorem withdrawn_final (same : Bool) : assertionEdit true same .withdrawn = .conflict := rfl
theorem missing_support_refused (same : Bool) (s : Support) : assertionEdit false same s = .missing := rfl

def withdraw : Support → Edit
  | .absent => .missing
  | .asserted => .withdraw
  | .withdrawn => .keep

theorem supported_withdrawal : withdraw .asserted = .withdraw := rfl
theorem withdrawal_idempotent : withdraw .withdrawn = .keep := rfl

def graphOrder (changes : List Bool) : List Nat :=
  let indexed := changes.zipIdx
  (indexed.filter (fun row => row.1)).map Prod.snd ++
    (indexed.filter (fun row => !row.1)).map Prod.snd

def textSubset (child parent : List String) : Bool := child.all parent.contains
theorem text_subset_refl (xs : List String) : textSubset xs xs = true := by
  simp [textSubset, List.all_eq_true]

inductive GrantDecision | grantLink | invalidChain | unavailable | wrongPrincipal | emptyChain
  deriving DecidableEq, Repr
def grantAvailable (present revoked : Bool) (expiry : Option Nat) (now : Nat) : Bool :=
  present && !revoked && !(expiry.any (· ≤ now))
def grantLink (sameScope : Bool) (id : String) (seen : List String)
    (present revoked : Bool) (expiry : Option Nat) (now : Nat)
    (boundPrincipal grantPrincipal : String) : GrantDecision :=
  if !(sameScope && !seen.contains id && seen.length < 32) then .invalidChain
  else if !grantAvailable present revoked expiry now then .unavailable
  else if !(!seen.isEmpty || boundPrincipal == grantPrincipal) then .wrongPrincipal
  else .grantLink
def grantEnd (seen : List String) : GrantDecision :=
  if seen.isEmpty then .emptyChain else .grantLink

theorem revoked_grant_unavailable (present : Bool) (expiry : Option Nat) (now : Nat) :
    grantAvailable present true expiry now = false := by simp [grantAvailable]
theorem available_without_expiry (now : Nat) : grantAvailable true false none now = true := rfl
theorem expiry_is_exclusive (deadline : Nat) : grantAvailable true false (some deadline) deadline = false := by simp [grantAvailable]
theorem foreign_chain_refused (id : String) (seen : List String) (p r : Bool)
    (e : Option Nat) (now : Nat) (a b : String) :
    grantLink false id seen p r e now a b = .invalidChain := by simp [grantLink]
theorem repeated_chain_refused (id : String) (seen : List String) (p r : Bool)
    (e : Option Nat) (now : Nat) (a b : String) (h : seen.contains id = true) :
    grantLink true id seen p r e now a b = .invalidChain := by
  have member : id ∈ seen := by simpa using h
  simp [grantLink, member]

structure PolicyRule where
  permit : Bool
  identity : String
  condition : String
  actions : List String
  deriving DecidableEq, Repr
def deniesPreserved (current candidate : List PolicyRule) : Bool :=
  current.all (fun rule => rule.permit || candidate.any (fun other => other.identity == rule.identity))
def permitNarrowed (current : List PolicyRule) (rule : PolicyRule) : Bool :=
  current.any (fun old => old.permit && old.condition == rule.condition && textSubset rule.actions old.actions)
inductive PolicyBound | bounded | issuersChanged | denyRemoved | grantExceeded | permitWidened
  deriving DecidableEq, Repr
def policyIssuers (child parent : List String) : PolicyBound :=
  if textSubset child parent && textSubset parent child then .bounded else .issuersChanged
def permitsBounded : List PolicyRule → List PolicyRule → List String → PolicyBound
  | [], _, _ => .bounded
  | rule :: tail, current, grant =>
    if !rule.permit then permitsBounded tail current grant
    else if !(textSubset rule.actions grant) then .grantExceeded
    else if !(permitNarrowed current rule) then .permitWidened
    else permitsBounded tail current grant
def policyRules (candidate current : List PolicyRule) (grant : List String) : PolicyBound :=
  if deniesPreserved current candidate then permitsBounded candidate current grant else .denyRemoved

theorem accepted_policy_preserves_denies (candidate current : List PolicyRule) (grant : List String)
    (h : policyRules candidate current grant = .bounded) : deniesPreserved current candidate = true := by
  unfold policyRules at h
  split at h <;> simp_all

theorem accepted_permits_within_grant (candidate current : List PolicyRule) (grant : List String)
    (h : permitsBounded candidate current grant = .bounded) :
    ∀ rule ∈ candidate, rule.permit = true → textSubset rule.actions grant = true := by
  induction candidate with
  | nil => simp
  | cons head tail ih =>
    simp only [List.mem_cons]
    intro rule member permit
    unfold permitsBounded at h
    by_cases hp : head.permit = true
    · simp only [hp, Bool.not_true, Bool.false_eq_true, ↓reduceIte] at h
      split at h
      · contradiction
      · rename_i bound
        split at h
        · contradiction
        · rcases member with rfl | rest
          · simpa using bound
          · exact ih h rule rest permit
    · simp only [Bool.eq_false_iff.mpr hp, Bool.not_false, ↓reduceIte] at h
      rcases member with rfl | rest
      · contradiction
      · exact ih h rule rest permit

inductive RunState | queued | leased | running | cancelling | uncertain | succeeded | failed | cancelled
  deriving DecidableEq, Repr
inductive RunOutcome | success | failure | cancellation | unobserved deriving DecidableEq, Repr
inductive RunAction
  | claim | heartbeat | finish (outcome : RunOutcome) | cancel | lost | retry | observed (outcome : RunOutcome)
  deriving DecidableEq, Repr
inductive RunStep
  | next (state : RunState) (cancellation authority immediate : Bool)
  | notClaimable | inactive | dispatchRequired | notUncertain
  deriving DecidableEq, Repr
def runTerminal : RunState → Bool
  | .succeeded | .failed | .cancelled => true
  | _ => false
def runResult : RunOutcome → RunState
  | .success => .succeeded
  | .failure => .failed
  | .cancellation => .cancelled
  | .unobserved => .uncertain
def runStep : RunState → RunAction → RunStep
  | .queued, .claim => .next .leased false true false
  | _, .claim => .notClaimable
  | .leased, .heartbeat | .running, .heartbeat => .next .running false true false
  | .cancelling, .heartbeat => .next .cancelling false false false
  | _, .heartbeat => .inactive
  | .leased, .finish .success | .leased, .finish .failure => .dispatchRequired
  | .leased, .finish .cancellation => .next .cancelled false false false
  | .leased, .finish .unobserved => .next .uncertain false false false
  | .running, .finish result | .cancelling, .finish result => .next (runResult result) false false false
  | _, .finish _ => .inactive
  | .queued, .cancel => .next .cancelled true false true
  | .leased, .cancel | .running, .cancel | .cancelling, .cancel => .next .cancelling true false false
  | .uncertain, .cancel => .next .uncertain true false false
  | s, .cancel => .next s false false false
  | _, .lost => .next .uncertain false false false
  | .uncertain, .retry => .next .queued false true false
  | _, .retry => .notUncertain
  | .uncertain, .observed result => .next (runResult result) false false false
  | _, .observed _ => .notUncertain

def runApply (s : RunState) (a : RunAction) : RunState :=
  match runStep s a with
  | .next next _ _ _ => next
  | _ => s
def claimTrace : Nat → RunState → RunState
  | 0, s => s
  | n+1, s => claimTrace n (runApply s .claim)

theorem uncertain_claim_refused : runStep .uncertain .claim = .notClaimable := rfl
theorem claim_requires_current_authority : runStep .queued .claim = .next .leased false true false := rfl
theorem retry_requires_current_authority : runStep .uncertain .retry = .next .queued false true false := rfl
theorem leased_effect_needs_dispatch : runStep .leased (.finish .success) = .dispatchRequired := rfl
theorem cancelling_accepts_real_success : runStep .cancelling (.finish .success) = .next .succeeded false false false := rfl
theorem queued_cancel_needs_no_effect : runStep .queued .cancel = .next .cancelled true false true := rfl
theorem terminal_cancel_unchanged (s : RunState) (h : runTerminal s = true) :
    runStep s .cancel = .next s false false false := by cases s <;> simp_all [runTerminal, runStep]
theorem uncertain_claim_trace (n : Nat) : claimTrace n .uncertain = .uncertain := by
  induction n with
  | zero => rfl
  | succ n ih => simpa [claimTrace, runApply, runStep] using ih

#print axioms deny_precedence
#print axioms unknown_deny_blocks_permit
#print axioms positive_permit
#print axioms conjunction_commutes
#print axioms disjunction_commutes
#print axioms negation_involution
#print axioms withdrawn_final
#print axioms missing_support_refused
#print axioms supported_withdrawal
#print axioms withdrawal_idempotent
#print axioms text_subset_refl
#print axioms revoked_grant_unavailable
#print axioms available_without_expiry
#print axioms expiry_is_exclusive
#print axioms foreign_chain_refused
#print axioms repeated_chain_refused
#print axioms accepted_policy_preserves_denies
#print axioms accepted_permits_within_grant
#print axioms uncertain_claim_refused
#print axioms claim_requires_current_authority
#print axioms retry_requires_current_authority
#print axioms leased_effect_needs_dispatch
#print axioms cancelling_accepts_real_success
#print axioms queued_cancel_needs_no_effect
#print axioms terminal_cancel_unchanged
#print axioms uncertain_claim_trace
end Moment

def truthLabel : Moment.Truth → String
  | .yes => "true"
  | .no => "false"
  | .unknown => "unknown"
def decisionLabel : Moment.Decision → String
  | .permit => "permit"
  | .deny => "deny"
  | .indeterminate => "indeterminate"
def supportLabel : Moment.Support → String
  | .absent => "absent"
  | .asserted => "asserted"
  | .withdrawn => "withdrawn"
def editLabel : Moment.Edit → String
  | .insert => "Insert"
  | .keep => "Keep"
  | .missing => "Missing"
  | .conflict => "Conflict"
  | .withdraw => "Withdraw"

def grantLabel : Moment.GrantDecision → String
  | .grantLink => "GrantLink"
  | .invalidChain => "InvalidChain"
  | .unavailable => "UnavailableGrant"
  | .wrongPrincipal => "WrongPrincipal"
  | .emptyChain => "EmptyChain"
def policyBoundLabel : Moment.PolicyBound → String
  | .bounded => "PolicyBounded"
  | .issuersChanged => "IssuersChanged"
  | .denyRemoved => "DenyRemoved"
  | .grantExceeded => "GrantExceeded"
  | .permitWidened => "PermitWidened"
def maskList (size mask : Nat) : List Bool := (List.range size).map (fun i => (mask / 2^i) % 2 == 1)
def chooseMask {α : Type} (xs : List α) (mask : Nat) : List α :=
  ((xs.zipIdx).filter (fun row => (mask / 2^row.2) % 2 == 1)).map Prod.fst
def sampleRules : List Moment.PolicyRule :=
  [⟨true,"read","yes",["read"]⟩,⟨true,"write","yes",["write"]⟩,
   ⟨false,"deny","yes",["read"]⟩,⟨true,"both","yes",["read","write"]⟩]

def runLabel : Moment.RunState → String
  | .queued => "queued"
  | .leased => "leased"
  | .running => "running"
  | .cancelling => "cancel_requested"
  | .uncertain => "unknown"
  | .succeeded => "succeeded"
  | .failed => "failed"
  | .cancelled => "cancelled"
def runStepLabel : Moment.RunStep → String
  | .next s c a i => s!"next:{runLabel s}:{c}:{a}:{i}"
  | .notClaimable => "NotClaimable"
  | .inactive => "Inactive"
  | .dispatchRequired => "DispatchRequired"
  | .notUncertain => "NotUncertain"
def runStates : List Moment.RunState := [.queued,.leased,.running,.cancelling,.uncertain,.succeeded,.failed,.cancelled]
def runActions : List (String × Moment.RunAction) :=
  [("claim",.claim),("heartbeat",.heartbeat),("finish.succeeded",.finish .success),
   ("finish.failed",.finish .failure),("finish.cancelled",.finish .cancellation),("finish.unknown",.finish .unobserved),
   ("cancel",.cancel),("lost",.lost),("retry",.retry),("observed.succeeded",.observed .success),
   ("observed.failed",.observed .failure),("observed.cancelled",.observed .cancellation),("observed.unknown",.observed .unobserved)]

/-- Bounded executable correspondence cases; these do not replace theorems. -/
def main : IO Unit := do
  let values : List Moment.Truth := [.yes,.no,.unknown]
  for a in values do
    IO.println s!"case|not|{truthLabel a}|{truthLabel (Moment.negation a)}"
    for b in values do
      IO.println s!"case|all|{truthLabel a}|{truthLabel b}|{truthLabel (Moment.conjunction a b)}"
      IO.println s!"case|any|{truthLabel a}|{truthLabel b}|{truthLabel (Moment.disjunction a b)}"
      IO.println s!"case|policy|{truthLabel a}|{truthLabel b}|{decisionLabel (Moment.combine a b)}"
  for present in [false,true] do
    for same in [false,true] do
      IO.println s!"case|record|{present}|{same}|{editLabel (Moment.recordEdit present same)}"
      for support in [Moment.Support.absent,.asserted,.withdrawn] do
        IO.println s!"case|assertion|{present}|{same}|{supportLabel support}|{editLabel (Moment.assertionEdit present same support)}"
  for s in [Moment.Support.absent,.asserted,.withdrawn] do
    IO.println s!"case|withdraw|{supportLabel s}|{editLabel (Moment.withdraw s)}"
  for size in List.range 6 do
    for mask in List.range (2^size) do
      let bits := maskList size mask
      let label := if bits.isEmpty then "-" else String.join (bits.map (fun b => if b then "1" else "0"))
      let ordered := String.intercalate "," ((Moment.graphOrder bits).map toString)
      IO.println s!"case|graph|{label}|{ordered}"
  for depth in [0,1,31,32,33] do
    for repeated in [false,true] do
      if depth > 0 || !repeated then
        let seen := (List.range depth).map (fun i => if i == 0 && repeated then "leaf" else s!"seen-{i}")
        for sameScope in [false,true] do
          for present in [false,true] do
            for revoked in [false,true] do
              for expiryAt in [0,100,200,300] do
                for samePrincipal in [false,true] do
                  let expiry := if expiryAt == 0 then none else some expiryAt
                  let actual := Moment.grantLink sameScope "leaf" seen present revoked expiry 200 "caller" (if samePrincipal then "caller" else "other")
                  IO.println s!"case|grant|{depth}|{repeated}|{sameScope}|{present}|{revoked}|{expiryAt}|{samePrincipal}|{grantLabel actual}"
  for seen in [([] : List String),["leaf"]] do
    IO.println s!"case|grantEnd|{seen.length}|{grantLabel (Moment.grantEnd seen)}"
  for candidate in List.range 16 do
    for current in List.range 16 do
      for grant in List.range 4 do
        let result := Moment.policyRules (chooseMask sampleRules candidate) (chooseMask sampleRules current) (chooseMask ["read","write"] grant)
        IO.println s!"case|policyRules|{candidate}|{current}|{grant}|{policyBoundLabel result}"
  for candidate in List.range 4 do
    for current in List.range 4 do
      let result := Moment.policyIssuers (chooseMask ["a","b"] candidate) (chooseMask ["a","b"] current)
      IO.println s!"case|issuers|{candidate}|{current}|{policyBoundLabel result}"
  for state in runStates do
    IO.println s!"case|runTerminal|{runLabel state}|{Moment.runTerminal state}"
    for (label, action) in runActions do
      IO.println s!"case|runStep|{runLabel state}|{label}|{runStepLabel (Moment.runStep state action)}"
      for (second, next) in runActions do
        IO.println s!"case|runTrace|{runLabel state}|{label}|{second}|{runLabel (Moment.runApply (Moment.runApply state action) next)}"
