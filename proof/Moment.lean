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

inductive TopVerdict | good | parents | cycle | invalid deriving DecidableEq, Repr
abbrev TopEdge := Nat × Nat

-- Independent reachability specification: production uses Kahn sorting.
def topReach : Nat → List TopEdge → Nat → Nat → Bool
  | 0, _, _, _ => false
  | fuel+1, edges, source, target =>
    edges.any (fun edge => edge.1 == source &&
      (edge.2 == target || topReach fuel edges edge.2 target))
def topBounds (size : Nat) (edges : List TopEdge) : Bool :=
  edges.all (fun edge => edge.1 < size && edge.2 < size)
def topParents (edges : List TopEdge) : Bool :=
  edges.all (fun a => edges.all (fun b => a.1 != b.1 || a.2 == b.2))
def topCheck (size : Nat) (edges : List TopEdge) (exclusive : Bool) : TopVerdict :=
  if !topBounds size edges then .invalid
  else if exclusive && !topParents edges then .parents
  else if (List.range size).any (fun node => topReach size edges node node) then .cycle
  else .good

def topCertificate (edges : List TopEdge) (rank : Nat → Nat) : Bool :=
  edges.all (fun edge => rank edge.1 < rank edge.2)
inductive TopPath (edges : List TopEdge) : Nat → Nat → Prop
  | edge {a b} : (a,b) ∈ edges → TopPath edges a b
  | more {a b c} : (a,b) ∈ edges → TopPath edges b c → TopPath edges a c

theorem certified_edge (edges : List TopEdge) (rank : Nat → Nat)
    (valid : topCertificate edges rank = true) {a b : Nat} (member : (a,b) ∈ edges) :
    rank a < rank b := by
  exact of_decide_eq_true ((List.all_eq_true.mp valid) (a,b) member)
theorem rank_along_path (edges : List TopEdge) (rank : Nat → Nat)
    (valid : topCertificate edges rank = true) {a b : Nat} (path : TopPath edges a b) :
    rank a < rank b := by
  induction path with
  | edge member => exact certified_edge edges rank valid member
  | more member _ ih => exact Nat.lt_trans (certified_edge edges rank valid member) ih
theorem certificate_excludes_cycle (edges : List TopEdge) (rank : Nat → Nat)
    (valid : topCertificate edges rank = true) (a : Nat) : ¬ TopPath edges a a := by
  intro path
  exact Nat.lt_irrefl _ (rank_along_path edges rank valid path)
theorem subset_certificate (whole selected : List TopEdge) (rank : Nat → Nat)
    (valid : topCertificate whole rank = true) (selection : ∀ edge ∈ selected, edge ∈ whole) :
    topCertificate selected rank = true := by
  apply List.all_eq_true.mpr
  intro edge member
  exact (List.all_eq_true.mp valid) edge (selection edge member)
theorem single_edge_is_usable : topCheck 2 [(0,1)] true = .good := rfl
theorem outside_index_refused : topCheck 3 [(0,3)] false = .invalid := rfl

inductive TopProjection | skip | within (scope source target : String) | before (scope source target : String)
  deriving DecidableEq, Repr
def topProject (kind schema : String) (supports : List String) (context perspective : String)
    (framed : Bool) (frame child parent earlier later : String) : TopProjection :=
  if kind != "relation" || !supports.contains "asserted" then .skip
  else if schema == "moment.within" then .within perspective child parent
  else if schema == "moment.precedes" then .before (if framed then frame else context) earlier later
  else .skip
theorem unsupported_relation_is_absent (context : String) :
    topProject "relation" "moment.within" [] context "perspective" false "frame" "child" "parent" "earlier" "later" = .skip := rfl
theorem missing_temporal_frame_is_context (context : String) :
    topProject "relation" "moment.precedes" ["asserted"] context "perspective" false "frame" "child" "parent" "earlier" "later" = .before context "earlier" "later" := rfl
def topCombine : TopVerdict → TopVerdict → TopVerdict
  | .invalid, _ | _, .invalid => .invalid
  | .parents, _ | _, .parents => .parents
  | .cycle, _ | _, .cycle => .cycle
  | _, _ => .good
theorem top_combine_commutes (a b : TopVerdict) : topCombine a b = topCombine b a := by
  cases a <;> cases b <;> rfl
theorem top_combine_associates (a b c : TopVerdict) :
    topCombine (topCombine a b) c = topCombine a (topCombine b c) := by
  cases a <;> cases b <;> cases c <;> rfl

structure AccessScope where
  actions : List String
  allIncidents : Bool
  incidents : List String
  resources : List String
  deriving DecidableEq, Repr
inductive AccessMode | action | resource | incident | context deriving DecidableEq, Repr
def scopeAllows (mode : AccessMode) (scope : AccessScope) (key : String) : Bool :=
  match mode with
  | .action => scope.actions.contains key
  | .resource => scope.resources.contains key
  | .incident => scope.allIncidents || scope.incidents.contains key
  | .context => scope.allIncidents && scope.resources.contains key
def scopesAllow (scopes : List AccessScope) (mode : AccessMode) (key : String) : Bool :=
  !scopes.isEmpty && scopes.all (fun scope => scopeAllows mode scope key)
def accessOperator (principal owner contextOwner : String) (bound : Bool) : Bool :=
  principal == owner && principal == contextOwner && !bound
def accessResource (operator : Bool) (scopes : List AccessScope) (key : String) : Bool :=
  operator || scopesAllow scopes .resource key
def accessIncident (operator : Bool) (scopes : List AccessScope) (key : String) : Bool :=
  operator || scopesAllow scopes .incident key
inductive MethodAdmission | allowed | outsideGrant | schemaOperator | limitsOperator | contextWide
  deriving DecidableEq, Repr
def accessMethod (operator : Bool) (scopes : List AccessScope) (method context : String) : MethodAdmission :=
  if operator then .allowed
  else if !scopesAllow scopes .action method then .outsideGrant
  else if method == "schema.publish" then .schemaOperator
  else if method == "context.limits" then .limitsOperator
  else if ["context.close","policy.activate"].contains method && !scopesAllow scopes .context context then .contextWide
  else .allowed
theorem bound_identity_not_operator (p o c : String) : accessOperator p o c true = false := by simp [accessOperator]
theorem admitted_owner_is_operator (p : String) : accessOperator p p p false = true := by simp [accessOperator]
theorem empty_chain_has_no_resource (key : String) : accessResource false [] key = false := rfl
theorem resource_requires_every_scope (scopes : List AccessScope) (key : String)
    (h : accessResource false scopes key = true) :
    ∀ scope ∈ scopes, scope.resources.contains key = true := by
  have all : scopes.all (fun scope => scopeAllows .resource scope key) = true := by
    have paired : (!scopes.isEmpty && scopes.all (fun scope => scopeAllows .resource scope key)) = true := by
      simpa only [accessResource, scopesAllow, Bool.false_or] using h
    exact (Bool.and_eq_true_iff.mp paired).2
  intro scope member
  exact (List.all_eq_true.mp all) scope member

inductive IncidentState | open | resting | completed | cancelled deriving DecidableEq, Repr
def incidentTerminal : IncidentState → Bool
  | .completed | .cancelled => true
  | _ => false
def incidentRevisable (old current : IncidentState) : Bool := !incidentTerminal old || incidentTerminal current
inductive IncidentEvidence | allowed | missing | completionMissing deriving DecidableEq, Repr
def incidentEvidence (state : IncidentState) (present : Bool) (sources : List String) : IncidentEvidence :=
  if state == .open then .allowed
  else if !present then .missing
  else if state == .completed && sources.isEmpty then .completionMissing
  else .allowed
theorem terminal_incident_cannot_reopen (old current : IncidentState)
    (ended : incidentTerminal old = true) (admitted : incidentRevisable old current = true) :
    incidentTerminal current = true := by simpa [incidentRevisable, ended] using admitted
theorem completion_requires_source (present : Bool) (sources : List String)
    (admitted : incidentEvidence .completed present sources = .allowed) : sources ≠ [] := by
  intro empty
  subst sources
  cases present <;> simp [incidentEvidence] at admitted
theorem open_without_evidence_is_usable : incidentEvidence .open false [] = .allowed := rfl

inductive MutationAdmission | allowed | stale | closed deriving DecidableEq, Repr
def mutationBasis (current expected : Nat) (state method : String) : MutationAdmission :=
  if current != expected then .stale
  else if state == "open" || ["context.close","execution.finish","execution.reconcile","execution.cancel"].contains method then .allowed
  else .closed
theorem stale_basis_refused (current expected : Nat) (state method : String) (stale : current ≠ expected) :
    mutationBasis current expected state method = .stale := by simp [mutationBasis, stale]
theorem closed_context_can_reconcile (revision : Nat) : mutationBasis revision revision "closed" "execution.reconcile" = .allowed := by simp [mutationBasis]

def queryMatch (id schema : String) (support : List String) (ids schemas : Option (List String))
    (status : String) (related : Option (List String)) : Bool :=
  (ids.all (fun xs => xs.contains id)) && (schemas.all (fun xs => xs.contains schema)) &&
    (status == "any" || support.contains status) && (related.all (fun xs => xs.contains id))
def queryRelated (kind : String) (roles : List (String × List String)) (role : Option String) (target : String) : Bool :=
  kind == "relation" && roles.any (fun pair => (role.all (fun name => name == pair.1)) && pair.2.contains target)
theorem empty_id_selection_matches_nothing (id schema status : String) (support : List String)
    (schemas related : Option (List String)) : queryMatch id schema support (some []) schemas status related = false := by simp [queryMatch]

def budgetMaximum : Nat := 9007199254740991
def budgetAdd (a b : Nat) : Option Nat := if a+b ≤ budgetMaximum then some (a+b) else none
def budgetAccumulate (total : Option Nat) (charge : Nat) : Option Nat := total.bind (fun n => budgetAdd n charge)
def budgetCapacity (total : Option Nat) (requested ceiling : Nat) : Bool :=
  total.any (fun n => n+requested ≤ ceiling)
theorem safe_sum_is_exact (a b n : Nat) (h : budgetAdd a b = some n) : n = a+b ∧ n ≤ budgetMaximum := by
  unfold budgetAdd at h
  split at h
  · simp_all
  · contradiction
theorem overflow_stays_overflow (charge : Nat) : budgetAccumulate none charge = none := rfl
theorem capacity_respects_ceiling (total requested ceiling : Nat)
    (h : budgetCapacity (some total) requested ceiling = true) : total+requested ≤ ceiling := by
  simpa [budgetCapacity] using h
theorem wrapped_low_carry (a b : Nat) (ha : a < 4294967296) (hb : b < 4294967296) :
    (if (a+b)%4294967296 < a then 1 else 0) = (a+b)/4294967296 := by
  split <;> omega
theorem limb_sum_is_exact (a b c d : Nat) :
    (a+c+(b+d)/4294967296)*4294967296 + (b+d)%4294967296 = (a*4294967296+b)+(c*4294967296+d) := by
  omega

def budgetCharge (state : RunState) (key : String) (unmeasured : Bool) (ceiling usage : Nat) : Nat :=
  if key == "memoryBytes" then if runTerminal state then 0 else max ceiling usage
  else if !runTerminal state || unmeasured then max ceiling usage else usage
theorem terminal_memory_released (state : RunState) (h : runTerminal state = true) (unknown : Bool) (ceiling usage : Nat) :
    budgetCharge state "memoryBytes" unknown ceiling usage = 0 := by simp [budgetCharge, h]
theorem unknown_cumulative_preserves_reservation (state : RunState) (ceiling usage : Nat) :
    ceiling ≤ budgetCharge state "cpuMillis" true ceiling usage := by simp [budgetCharge, Nat.le_max_left]
def budgetUsage (previous usage ceiling : Nat) (observed : Bool) : Bool :=
  previous ≤ usage && (observed || usage ≤ ceiling)
theorem usage_never_decreases (previous usage ceiling : Nat) (observed : Bool)
    (h : budgetUsage previous usage ceiling observed = true) : previous ≤ usage := by
  have first := (Bool.and_eq_true_iff.mp h).1
  exact of_decide_eq_true first

def budgetSubtract (a b : Nat) : Option Nat := if b ≤ a then some (a-b) else none
theorem safe_difference_is_exact (a b n : Nat) (h : budgetSubtract a b = some n) : n+b = a := by
  unfold budgetSubtract at h
  split at h
  · simp only [Option.some.injEq] at h
    omega
  · contradiction
theorem borrowed_difference_is_exact (a b c d : Nat) (hb : b < 4294967296) (hd : d < 4294967296)
    (ordered : c*4294967296+d ≤ a*4294967296+b) :
    (a-c-(if b < d then 1 else 0))*4294967296 + (b+4294967296-d)%4294967296 =
      (a*4294967296+b)-(c*4294967296+d) := by
  split <;> omega

theorem minimum_is_bounded (xs : List Nat) (initial : Nat) : xs.foldl min initial ≤ initial := by
  induction xs generalizing initial with
  | nil => exact Nat.le_refl _
  | cons head tail ih => exact Nat.le_trans (ih (min initial head)) (Nat.min_le_left initial head)
theorem minimum_below_member (xs : List Nat) (initial value : Nat) (member : value ∈ xs) :
    xs.foldl min initial ≤ value := by
  induction xs generalizing initial with
  | nil => contradiction
  | cons head tail ih =>
    simp only [List.mem_cons] at member
    rcases member with rfl | rest
    · exact Nat.le_trans (minimum_is_bounded tail (min initial value)) (Nat.min_le_right initial value)
    · exact ih (min initial head) rest
inductive LeaseWindow | expired | window (deadline duration : Nat) deriving DecidableEq, Repr
def leaseWindow (now millis : Nat) (bounds : List Nat) : LeaseWindow :=
  let deadline := bounds.foldl min (now+millis)
  if deadline ≤ now then .expired else .window deadline (deadline-now)
theorem lease_window_is_bounded (now millis deadline duration : Nat) (bounds : List Nat)
    (admitted : leaseWindow now millis bounds = .window deadline duration) :
    now < deadline ∧ deadline ≤ now+millis ∧ duration = deadline-now := by
  dsimp only [leaseWindow] at admitted
  split at admitted
  · contradiction
  · rename_i positive
    cases admitted
    exact ⟨Nat.lt_of_not_ge positive,minimum_is_bounded bounds (now+millis),rfl⟩
theorem lease_respects_every_bound (now millis deadline duration bound : Nat) (bounds : List Nat)
    (admitted : leaseWindow now millis bounds = .window deadline duration) (member : bound ∈ bounds) :
    deadline ≤ bound := by
  dsimp only [leaseWindow] at admitted
  split at admitted
  · contradiction
  · cases admitted
    exact minimum_below_member bounds (now+millis) bound member

def leaseFrame (present : Bool) (source current : String) : Bool := present && source == current
def leaseExpired (present framePresent : Bool) (source current : String) (wall wallEnd mono monoEnd : Int) : Bool :=
  present && (!leaseFrame framePresent source current || wallEnd ≤ wall || monoEnd ≤ mono)
def leaseValid (present framePresent : Bool) (source current holder principal id submittedId : String)
    (fence submittedFence : Nat) (wall wallEnd mono monoEnd : Int) : Bool :=
  present && holder == principal && id == submittedId && fence == submittedFence &&
    !leaseExpired present framePresent source current wall wallEnd mono monoEnd
theorem missing_frame_expires (a b : String) (w e m n : Int) : leaseExpired true false a b w e m n = true := by simp [leaseExpired, leaseFrame]
theorem wrong_boot_expires (a b : String) (framePresent : Bool) (w e m n : Int) (changed : a ≠ b) :
    leaseExpired true framePresent a b w e m n = true := by simp [leaseExpired, leaseFrame, changed]
inductive RetryAdmission | allowed | cancelled | unsupported deriving DecidableEq, Repr
def retryAdmission (cancelled : Bool) (basis provider : String) : RetryAdmission :=
  if cancelled then .cancelled else if basis == "idempotent" && provider != "idempotent" then .unsupported else .allowed
theorem cancellation_blocks_retry (basis provider : String) : retryAdmission true basis provider = .cancelled := rfl
inductive Maintenance | keep | lost | cancelDeadline | cancelAuthority deriving DecidableEq, Repr
def executionMaintenance (state : RunState) (expired : Bool) (deadline : Option Nat) (now capabilityExpiry : Nat)
    (grantExpiries : List Nat) : Maintenance :=
  if runTerminal state then .keep
  else if expired then .lost
  else if deadline.any (fun time => time ≤ now) then .cancelDeadline
  else if state == .queued && (capabilityExpiry ≤ now || grantExpiries.any (fun time => time ≤ now)) then .cancelAuthority
  else .keep
theorem terminal_maintenance_unchanged (state : RunState) (ended : runTerminal state = true)
    (expired : Bool) (deadline : Option Nat) (now cap : Nat) (grants : List Nat) :
    executionMaintenance state expired deadline now cap grants = .keep := by simp [executionMaintenance, ended]
def maintenanceApply (state : RunState) : Maintenance → RunState
  | .keep => state
  | .lost => runApply state .lost
  | .cancelDeadline | .cancelAuthority => runApply state .cancel
theorem expired_active_refuses_reclaim (state : RunState) (active : runTerminal state = false)
    (deadline : Option Nat) (now cap : Nat) (grants : List Nat) :
    runStep (maintenanceApply state (executionMaintenance state true deadline now cap grants)) .claim = .notClaimable := by
  simp [executionMaintenance, active, maintenanceApply, runApply, runStep]
theorem fencing_strictly_increases (old next : Nat) (h : budgetAdd old 1 = some next) : old < next := by
  have exactSum := (safe_sum_is_exact old 1 next h).1
  omega
def executionQueued (state : RunState) : Bool := state == .queued
def executionWaitsDeadline (state : RunState) (cancelled : Bool) : Bool := !runTerminal state && !cancelled
def clockDelay (values : List Int) : Option Int :=
  values.foldl (fun minimum value => some (min (minimum.getD value) value)) none |>.map (max 0)
def resourceBlocked (markers : List (List String)) : Bool := markers.any (fun row => !row.isEmpty)

def calendarMaximum : Nat := 315569519999999
def calendarAfter (anchor duration : Nat) : Option Nat :=
  if anchor+duration ≤ calendarMaximum then some (anchor+duration) else none
theorem calendar_result_is_bounded (anchor duration result : Nat)
    (admitted : calendarAfter anchor duration = some result) : anchor ≤ result ∧ result ≤ calendarMaximum := by
  unfold calendarAfter at admitted
  split at admitted
  · simp only [Option.some.injEq] at admitted
    omega
  · contradiction
def requestsFit (requests : List Nat) (ceiling : Nat) : Bool := requests.sum ≤ ceiling
theorem envelope_sum_is_bounded (requests : List Nat) (ceiling : Nat) (bound : ceiling ≤ budgetMaximum)
    (admitted : requestsFit requests ceiling = true) : requests.sum ≤ ceiling ∧ requests.sum ≤ budgetMaximum := by
  have fits : requests.sum ≤ ceiling := of_decide_eq_true admitted
  exact ⟨fits,Nat.le_trans fits bound⟩
def capacityRemaining (entry : Option Nat × Nat) : Nat := entry.1.elim 0 (fun used => entry.2-used)
theorem remaining_within_ceiling (entry : Option Nat × Nat) : capacityRemaining entry ≤ entry.2 := by
  rcases entry with ⟨used,ceiling⟩
  cases used with
  | none => exact Nat.zero_le _
  | some n => exact Nat.sub_le _ _
def capacityAvailable (envelopes : List (Option Nat × Nat)) : Nat :=
  match envelopes with
  | [] => 0
  | head :: tail => (tail.map capacityRemaining).foldl min (capacityRemaining head)
theorem availability_within_every_ceiling (envelopes : List (Option Nat × Nat)) (entry : Option Nat × Nat)
    (member : entry ∈ envelopes) : capacityAvailable envelopes ≤ entry.2 := by
  cases envelopes with
  | nil => contradiction
  | cons head tail =>
    simp only [List.mem_cons] at member
    rcases member with rfl | rest
    · exact Nat.le_trans (minimum_is_bounded (tail.map capacityRemaining) (capacityRemaining entry)) (remaining_within_ceiling entry)
    · exact Nat.le_trans (minimum_below_member (tail.map capacityRemaining) (capacityRemaining head) (capacityRemaining entry) (List.mem_map.mpr ⟨entry,rest,rfl⟩)) (remaining_within_ceiling entry)

inductive SchLife | active | completed | cancelled deriving DecidableEq, Repr
inductive SchWake | event | at | after | capacity deriving DecidableEq, Repr
structure SchFacts where
  life : SchLife := .active
  sequence : Nat := 100
  block : Option Nat := none
  pending : Nat := 0
  busy : Nat := 0
  edge : Bool := false
  fired : Bool := false
  pressure : Option Nat := none
  deriving DecidableEq, Repr
def schUnblocked (block : Option Nat) (activity : Nat) : Bool := block != some activity
def schRunnable (f : SchFacts) (activity : Nat) : Bool :=
  f.life == .active && schUnblocked f.block activity && decide (0 < f.pending) && (f.busy == 0)
def schReady (f : SchFacts) (activity : Nat) (coalesce : Bool) (sources : Nat) : Bool :=
  let backed := decide (0 < f.busy) && decide (128 ≤ f.pending) && (!coalesce || decide (32 ≤ sources))
  f.life == .active && schUnblocked f.block activity &&
    ((decide (f.sequence < activity) && (!backed || schUnblocked f.pressure activity)) || (decide (0 < f.pending) && (f.busy == 0)))
def schScan (f : SchFacts) (context : String) (ended : Bool) (activity : Nat) : String :=
  if f.life != .active then "SchSkip" else if context != "open" || ended then "SchCancel"
  else if schUnblocked f.block activity then "SchObserve" else "SchSkip"
def schMode (wake : SchWake) (f : SchFacts) (activity : Nat) (due : Option Nat) (now : Nat) : String :=
  match wake with
  | .event => if f.sequence < activity then "SchEvents" else "SchQuiet"
  | .capacity => "SchCheckCapacity"
  | _ => if !f.fired && due.any (· ≤ now) then "SchTimer" else "SchQuiet"
def schWakeAdmission (wake : SchWake) (once : Bool) (resource : String) : String :=
  match wake with
  | .at | .after => if once then "SchWakeAllowed" else "SchTimerRearm"
  | .capacity => if ["concurrentExecutions","cpuMillis","memoryBytes","outputBytes","modelTokens","apiSpendMicrounits"].contains resource then "SchWakeAllowed" else "SchUnknownResource"
  | .event => "SchWakeAllowed"
def schEventGate (previous sequence activity : Nat) (kind : String) (types : List String) : String :=
  if sequence ≤ previous then "SchStaleEvent" else if activity < sequence then "SchFutureEvent"
  else if !kind.startsWith "runtime.schedule." && types.contains kind then "SchInspectEvent" else "SchIgnoreEvent"
def schObservation (each edge selected : Bool) : Bool × Bool :=
  if each then (selected,edge) else (selected && !edge,selected)
def schUnique (values : List String) : List String := values.foldl (fun seen value => if seen.contains value then seen else seen ++ [value]) []
def schQueue (pending : Nat) (coalesce : Bool) (previous incoming : List String) : String :=
  if 0 < pending && coalesce then
    let merged := schUnique (previous ++ incoming)
    if merged.length ≤ 32 then "SchMerge:" ++ String.intercalate "," merged else "SchQueueFull"
  else if pending < 128 then "SchAppend:" ++ String.intercalate "," incoming else "SchQueueFull"
structure SchAdvance where
  cursor : Nat
  edge : Bool
  stop : Bool
  full : Bool
  deriving DecidableEq, Repr
def schAdvance (previous sequence activity : Nat) (oldEdge nextEdge fire enqueued pending once : Bool) : SchAdvance :=
  if fire && !enqueued then ⟨previous,oldEdge,true,true⟩
  else ⟨if once && pending then activity else sequence,nextEdge,once && pending,false⟩
def schCapacityEdge (old available accepted : Bool) : Bool :=
  if available && !old && !accepted then old else available
def schMatches (life : SchLife) (present equal : Bool) : Bool := life == .active && present && equal
def schWatch (f : SchFacts) (activity : Nat) (present : Bool) : Bool :=
  f.life == .active && schUnblocked f.block activity && !f.fired && present
def schVisible (present incident operator readable creator bound : Bool) : Bool :=
  present && incident && (operator || readable || (creator && bound))
def schSelection (ids subjects : Option (List String)) : Option (List String) :=
  match subjects with
  | none => ids
  | some values => some (match ids with | none => values | some selected => selected.filter values.contains)
structure SchCandidate where
  index : Nat
  incident : String
  order : Nat
  facts : SchFacts
  deriving DecidableEq, Repr
def schOldest : List SchCandidate → Option SchCandidate
  | [] => none
  | head :: tail => match schOldest tail with
    | none => some head
    | some best => some (if head.order ≤ best.order then head else best)
def schMinimum : List String → Option String
  | [] => none
  | head :: tail => match schMinimum tail with
    | none => some head
    | some best => some (if head < best then head else best)
def schChoose (candidates : List SchCandidate) (activity : Nat) (last : Option String) : Option SchCandidate :=
  let eligible := candidates.filter (fun item => schRunnable item.facts activity)
  let group := match last with
    | none => eligible
    | some previous =>
      let ids := eligible.map SchCandidate.incident
      let successor := (schMinimum (ids.filter (fun id => decide (previous < id)))).orElse (fun _ => schMinimum ids)
      eligible.filter (fun item => some item.incident == successor)
  schOldest group
structure SchCause where
  id : String
  context : String := "context"
  kind : String := "graph.transact.committed"
  subjects : List String := []
  causes : List String := []
  deriving DecidableEq, Repr
def schCausalWalk : Nat → List String → List String → List SchCause → String → String → String
  | _, [], _, _, _, _ => "independent"
  | 0, _ :: _, _, _, _, _ => "unknown"
  | fuel+1, head :: tail, seen, events, context, target =>
    if seen.contains head then schCausalWalk fuel tail seen events context target
    else match events.find? (fun item => item.id == head) with
      | none => "unknown"
      | some item =>
        if item.context != context then "unknown"
        else if item.kind == "runtime.schedule.triggered" && item.subjects.contains target then "dependent"
        else schCausalWalk fuel ((item.causes.filter (fun id => !(head :: seen).contains id)).reverse ++ tail) (head :: seen) events context target

theorem sch_cancelled_never_runnable (f : SchFacts) (activity : Nat) :
    schRunnable { f with life := .cancelled } activity = false := by simp [schRunnable]
theorem sch_blocked_rests (f : SchFacts) (activity : Nat) :
    schRunnable { f with block := some activity } activity = false := by simp [schRunnable, schUnblocked]
theorem sch_full_keeps_cursor (previous sequence activity : Nat) (oldEdge nextEdge pending once : Bool) :
    schAdvance previous sequence activity oldEdge nextEdge true false pending once = ⟨previous,oldEdge,true,true⟩ := rfl
theorem sch_edge_requires_new_rise : schObservation false true true = (false,true) := rfl
theorem sch_each_remains_observable : schObservation true false true = (true,false) := rfl
theorem sch_failed_capacity_not_acknowledged : schCapacityEdge false true false = false := rfl
theorem sch_missing_is_unresolved (fuel : Nat) (head context target : String) :
    schCausalWalk (fuel+1) [head] [] [] context target = "unknown" := rfl
theorem sch_exhaustion_is_unresolved (head : String) (tail seen : List String) (events : List SchCause) (context target : String) :
    schCausalWalk 0 (head::tail) seen events context target = "unknown" := rfl
theorem sch_full_pressure_rests (sequence activity : Nat) :
    schReady { sequence, pending := 128, busy := 1, pressure := some activity } activity false 0 = false := by
  simp [schReady, schUnblocked]
theorem sch_oldest_is_member (values : List SchCandidate) (chosen : SchCandidate) (h : schOldest values = some chosen) : chosen ∈ values := by
  induction values with
  | nil => simp [schOldest] at h
  | cons head tail ih =>
    simp only [schOldest] at h
    cases ht : schOldest tail with
    | none => simp [ht] at h; subst chosen; simp
    | some best =>
      simp only [ht, Option.some.injEq] at h
      split at h
      · subst chosen; simp
      · subst chosen; exact List.mem_cons_of_mem head (ih ht)
theorem sch_selected_group_is_eligible (values : List SchCandidate) (chosen : SchCandidate) (activity : Nat)
    (h : schOldest (values.filter (fun item => schRunnable item.facts activity)) = some chosen) :
    schRunnable chosen.facts activity = true := by
  exact (List.mem_filter.mp (sch_oldest_is_member _ _ h)).2
theorem sch_chosen_is_eligible (values : List SchCandidate) (chosen : SchCandidate) (activity : Nat) (last : Option String)
    (h : schChoose values activity last = some chosen) : schRunnable chosen.facts activity = true := by
  unfold schChoose at h
  cases last with
  | none => exact sch_selected_group_is_eligible _ _ _ h
  | some previous =>
    have member := sch_oldest_is_member _ _ h
    exact (List.mem_filter.mp (List.mem_filter.mp member).1).2

structure CapSchema where
  name : String
  version : String
  digest : String
  deriving DecidableEq, Repr
structure CapAdvert where
  identity : String := "cap"
  provider : String := "provider"
  name : String := "verify"
  version : String := "1"
  input : CapSchema := ⟨"input","1","digest"⟩
  output : CapSchema := ⟨"output","1","digest"⟩
  features : List String := ["bytes"]
  isolation : String := "process"
  deriving DecidableEq, Repr
structure CapRequirement where
  versions : List String := ["1"]
  input : CapSchema := ⟨"input","1","digest"⟩
  output : CapSchema := ⟨"output","1","digest"⟩
  features : List String := ["bytes"]
  isolation : List String := ["process"]
  deriving DecidableEq, Repr
structure CapScope where
  actions : List String := ["verify"]
  resources : List String := ["cap"]
  allIncidents : Bool := true
  deriving DecidableEq, Repr
inductive CapEligibility | eligible | ineligible | unknown deriving DecidableEq, Repr
inductive CapAssessment | needsPolicy | assessed (unmet : List String) (eligibility : CapEligibility) deriving DecidableEq, Repr
inductive CapPolicy | allowed | denied | unknown | missing deriving DecidableEq, Repr
def capGranted (scopes : List CapScope) (advert : CapAdvert) : Bool :=
  !scopes.isEmpty && scopes.all (fun scope => scope.actions.contains advert.name && scope.resources.contains advert.identity)
def capCompatibility (advert : CapAdvert) (requirement : CapRequirement) (scopes : List CapScope) (expired : Bool) : List String :=
  ([ (requirement.versions.contains advert.version,"version"), (advert.input == requirement.input,"inputSchema"),
    (advert.output == requirement.output,"outputSchema"), (requirement.features.all advert.features.contains,"features"),
    (requirement.isolation.contains advert.isolation,"isolation"), (!expired,"expired"), (capGranted scopes advert,"grant") ] : List (Bool × String)).filterMap fun (accepted,label) => if accepted then none else some label
def capBasis (advert : CapAdvert) (requirement : CapRequirement) (scopes : List CapScope) (expired incident : Bool) : CapAssessment :=
  let unmet := capCompatibility advert requirement scopes expired
  if !incident && scopes.any (fun scope => !scope.allIncidents) then .assessed (unmet ++ ["incident_required"]) (if unmet.isEmpty then .unknown else .ineligible)
  else if unmet.isEmpty then .needsPolicy else .assessed unmet .ineligible
def capFinish : CapAssessment → CapPolicy → CapAssessment
  | .needsPolicy, .allowed => .assessed [] .eligible
  | .needsPolicy, .denied => .assessed ["policy"] .ineligible
  | .needsPolicy, _ => .assessed ["policy_unknown"] .unknown
  | .assessed unmet eligibility, _ => .assessed unmet eligibility
def capRank : CapEligibility → Nat | .eligible => 0 | .unknown => 1 | .ineligible => 2
def capCompare (a b : CapEligibility) (ac bc : Nat) (ai bi : String) : String :=
  if capRank a < capRank b then "LT" else if capRank b < capRank a then "GT"
  else if ac < bc then "LT" else if bc < ac then "GT" else if ai < bi then "LT" else if bi < ai then "GT" else "EQ"
def capPublish (advert : CapAdvert) (principal : String) (methods : List String) (count : Nat) (expired : Bool) : String :=
  if 4096 ≤ count then "CapRetentionFull" else if advert.provider != principal then "CapWrongProvider"
  else if methods.contains advert.name then "CapReservedName" else if expired then "CapExpired" else "CapPublishAllowed"
def capExecutionAdmission (expired : Bool) (context : String) (incident : Bool) (status : IncidentState) : String :=
  if expired then "CapExecutionExpired" else if context != "open" then "CapExecutionClosed"
  else if !incident || incidentTerminal status then "CapExecutionIncident" else "CapExecutionAllowed"
def capPrepare (incident capability operator self bound readable : Bool) : String :=
  if !(incident && capability) then "CapPrepareScope"
  else if operator || (if self then bound else readable) then "CapPrepareAllowed" else "CapPrepareGrant"
def capVisible (present origin incident operator requester provider bound capability readable : Bool) : Bool :=
  present && origin && incident && (operator || (requester && bound) || (provider && capability) || readable)
def capReconcile (provider operator readable : Bool) : Bool := provider || operator || readable
def capEvidence (required present : Bool) : Bool := !required || present

theorem cap_policy_missing_is_unknown : capFinish .needsPolicy .missing = .assessed ["policy_unknown"] .unknown := rfl
theorem cap_policy_unknown_is_unknown : capFinish .needsPolicy .unknown = .assessed ["policy_unknown"] .unknown := rfl
theorem cap_policy_denied_is_ineligible : capFinish .needsPolicy .denied = .assessed ["policy"] .ineligible := rfl
theorem cap_policy_allowed_is_useful : capFinish .needsPolicy .allowed = .assessed [] .eligible := rfl
theorem cap_policy_cannot_erase_basis (unmet : List String) (eligibility : CapEligibility) (policy : CapPolicy) :
    capFinish (.assessed unmet eligibility) policy = .assessed unmet eligibility := rfl
theorem cap_empty_chain_has_no_authority (advert : CapAdvert) : capGranted [] advert = false := rfl
theorem cap_hidden_incident_hides_execution (present origin operator requester provider bound capability readable : Bool) :
    capVisible present origin false operator requester provider bound capability readable = false := by simp [capVisible]
theorem cap_missing_origin_hides_execution (present incident operator requester provider bound capability readable : Bool) :
    capVisible present false incident operator requester provider bound capability readable = false := by simp [capVisible]
theorem cap_reconciliation_needs_access : capReconcile false false false = false := rfl
theorem cap_required_evidence_needs_source : capEvidence true false = false := rfl
theorem cap_opening_without_required_evidence_is_useful : capEvidence false false = true := rfl
theorem cap_eligible_requires_observed_policy (advert : CapAdvert) (requirement : CapRequirement) (scopes : List CapScope)
    (expired incident : Bool) (policy : CapPolicy)
    (h : capFinish (capBasis advert requirement scopes expired incident) policy = .assessed [] .eligible) : policy = .allowed := by
  dsimp only [capBasis] at h
  split at h
  · split at h <;> simp [capFinish] at h
  · split at h
    · cases policy <;> simp_all [capFinish]
    · simp [capFinish] at h
theorem cap_compare_reflexive (eligibility : CapEligibility) (count : Nat) (id : String) :
    capCompare eligibility eligibility count count id id = "EQ" := by simp [capCompare]

def pqInitial (records assertions : Nat) : Option Nat :=
  if records ≤ 4096 && assertions ≤ 16384 then some (32768-records-assertions) else none
def pqCharge (budget : Option Nat) (cost : Nat) : Option Nat :=
  match budget with | none => none | some remaining => if cost ≤ remaining then some (remaining-cost) else none
def pqCharges (budget : Option Nat) (costs : List Nat) : Option Nat := costs.foldl pqCharge budget
structure PqAssertion where
  index : Nat
  system : String
  context : String
  issuer : String
  record : String
  sources : Nat
  deriving DecidableEq, Repr
structure PqProjection where
  budget : Option Nat
  indices : List Nat := []
  records : List String := []
  provenance : Nat := 0
  deriving DecidableEq, Repr
def pqProject (assertions : List PqAssertion) (issuers : List String) (budget : Option Nat) : PqProjection :=
  assertions.foldl (fun state item =>
    if item.system == "system" && item.context == "context" && issuers.contains item.issuer then
      { budget := pqCharge state.budget item.sources, indices := state.indices ++ [item.index], records := state.records ++ [item.record], provenance := state.provenance+item.sources }
    else state) {budget}
def pqSupported (status : String) (visible : List Bool) : Bool := status == "asserted" && visible.all id
def pqSelected (kind schema : String) (names : List String) (readable supported : Bool) : Bool :=
  kind == "relation" && names.contains schema && readable && supported
def pqObserved (found operator : Bool) : Option Bool := if found then some true else if operator then some false else none
structure PqEdge where
  subjects : List String
  targets : List (String × Bool)
  deriving DecidableEq, Repr
structure PqAccum where
  budget : Option Nat
  next : List String := []
  seen : List String
  deriving DecidableEq, Repr
inductive PqTraversal | walking (state : PqAccum) | found (budget : Option Nat) | unknown (budget : Option Nat) deriving DecidableEq, Repr
def pqTarget (destination : String) (result : PqTraversal) (target : String × Bool) : PqTraversal :=
  match result with
  | .walking state =>
    if !target.2 then result else if target.1 == destination then .found state.budget
    else if state.seen.contains target.1 then result else if state.seen.length < 512 then
      .walking {state with next := state.next ++ [target.1],seen := state.seen ++ [target.1]}
    else .unknown state.budget
  | _ => result
def pqEdge (source destination : String) (result : PqTraversal) (edge : PqEdge) : PqTraversal :=
  match result with
  | .walking state =>
    let budget := pqCharges state.budget [1,edge.subjects.length,edge.targets.length]
    if budget.isNone then .unknown budget else
      let next := .walking {state with budget}
      if edge.subjects.contains source then edge.targets.foldl (pqTarget destination) next else next
  | _ => result
inductive PqSearch
  | pending (frontier seen : List String) (budget : Option Nat)
  | done (value : Option Bool) (budget : Option Nat)
  deriving DecidableEq, Repr
def pqLayer (edges : List PqEdge) (destination : String) (operator : Bool) : PqSearch → PqSearch
  | .done value budget => .done value budget
  | .pending frontier seen budget =>
    let result := frontier.foldl (fun result source => edges.foldl (pqEdge source destination) result) (.walking {budget,seen})
    match result with
    | .found budget => .done (some true) budget
    | .unknown budget => .done none budget
    | .walking state => if state.next.isEmpty then .done (pqObserved false operator) state.budget else .pending state.next state.seen state.budget
def pqLayers (edges : List PqEdge) (destination : String) (operator : Bool) : Nat → PqSearch → PqSearch
  | 0, state => state
  | count+1, state => pqLayers edges destination operator count (pqLayer edges destination operator state)
def pqRelated (edges : List PqEdge) (start destination : String) (hops : Nat) (operator : Bool) (budget : Option Nat) : PqSearch :=
  if budget.isNone then .done none none else
    match pqLayers edges destination operator hops (.pending [start] [start] budget) with
    | .pending _ _ remaining => .done (pqObserved false operator) remaining
    | settled => settled

theorem pq_charge_exhaustion_is_final (cost : Nat) : pqCharge none cost = none := rfl
theorem pq_charge_never_increases (remaining cost result : Nat) (h : pqCharge (some remaining) cost = some result) : result ≤ remaining := by
  dsimp only [pqCharge] at h
  split at h
  · cases h; exact Nat.sub_le _ _
  · simp at h
theorem pq_zero_charge_preserves (remaining : Nat) : pqCharge (some remaining) 0 = some remaining := by simp [pqCharge]
theorem pq_initial_limits_are_useful : pqInitial 4096 16384 = some 12288 := rfl
theorem pq_foreign_context_is_ignored (item : PqAssertion) (issuers : List String) (budget : Option Nat) :
    pqProject [{item with context := "foreign"}] issuers budget = {budget} := by simp [pqProject]
theorem pq_withdrawn_support_is_inactive (visible : List Bool) : pqSupported "withdrawn" visible = false := rfl
theorem pq_hidden_source_is_inactive (visible : List Bool) (h : false ∈ visible) : pqSupported "asserted" visible = false := by
  induction visible with
  | nil => simp at h
  | cons head tail ih => cases head <;> simp_all [pqSupported]
theorem pq_missing_proof_under_restriction_is_unknown : pqObserved false false = none := rfl
theorem pq_visible_positive_is_useful (operator : Bool) : pqObserved true operator = some true := rfl
theorem pq_budget_exhaustion_is_unknown (edges : List PqEdge) (start destination : String) (hops : Nat) (operator : Bool) :
    pqRelated edges start destination hops operator none = .done none none := rfl
theorem pq_settled_result_is_preserved (edges : List PqEdge) (destination : String) (operator : Bool) (hops : Nat) (value : Option Bool) (budget : Option Nat) :
    pqLayers edges destination operator hops (.done value budget) = .done value budget := by
  induction hops with
  | zero => rfl
  | succ count ih => simpa [pqLayers,pqLayer] using ih

def ctlField : List String → Bool
  | [] => true
  | [head] => ["value","ref","support","digest","revision","recordedAt","recordedBy"].contains head
  | head :: _ :: _ => head == "value" || head == "ref"
def ctlSchemaPath (path : List String) : Bool :=
  [[],["value"],["value","schema"],["value","schema","name"]].contains path
def ctlProjection (count : Nat) (paths : List (List String)) (schema : Bool) : String :=
  if count > 64 then "ProjectionTooMany"
  else if !(paths.all ctlField) then "ProjectionUnknown"
  else if schema && !(paths.any ctlSchemaPath) then "ProjectionSchemaHidden"
  else "ProjectionAllowed"
def ctlProposal (id basis expected policy current : String) (changes : List (Option String)) (executions : Nat) : String :=
  if basis != expected || policy != current then "ProposalStale"
  else if changes.isEmpty && executions == 0 then "ProposalEmpty"
  else if changes.contains (some id) then "ProposalAlias" else "ProposalAllowed"
def ctlCommit (state recorded current policy selected : String) : String :=
  if state ≠ "proposed" then "CommitTerminal"
  else if recorded ≠ current ∨ policy ≠ selected then "CommitStale" else "CommitAllowed"
def ctlExecutions (incident : String) : List String → List (String × String) → String
  | _, [] => "PlanAllowed"
  | seen, (id, scope) :: tail =>
    if scope != incident then "PlanIncident"
    else if seen.contains id then "PlanAlias" else ctlExecutions incident (id :: seen) tail
def ctlPlan (identity incident : String) (changes : List (Option String)) (items : List (String × String)) : String :=
  ctlExecutions incident (identity :: changes.filterMap id) items
def ctlVisible (present incident operator : Bool) (origin principal grant : String) (chain : List String) (readable : Bool) : Bool :=
  present && incident && (operator || readable || (origin == principal && chain.contains grant))
def ctlNamespace (names : List String) : Bool :=
  names.any (["policies","grants","rules","capabilities","schedules","views","guidanceSources","guidanceCaptures"].contains ·)
def ctlRevoke (operator : Bool) (target bound issuer principal : String) (chain : List String) : Bool :=
  operator || target == bound || (issuer == principal && chain.contains bound)
def ctlActions (requested installed capabilities : List String) : Bool :=
  requested.all ((installed ++ capabilities).contains ·)
def ctlSchema (name : String) (installed : Bool) (submitted actual : String) (present : Bool) (previous : String) : String :=
  if name.startsWith "moment." && !installed then "SchemaReserved"
  else if submitted != actual then "SchemaDigest"
  else if present && previous != submitted then "SchemaConflict" else "SchemaAllowed"
def ctlBindings (names : List String) : Bool :=
  names.all (["occurrence.id","occurrence.eventIds","schedule.id","contextId","principalId","incidentId","action","resourceRefs","contextRevision","now","event.id","event.ids","event.type","event.subjectRefs"].contains ·)
def ctlBound (operator submittedPresent boundPresent : Bool) (submitted bound : String) : Bool :=
  operator || (submittedPresent && boundPresent && submitted == bound)

theorem ctl_root_is_usable : ctlProjection 1 [[]] true = "ProjectionAllowed" := rfl
theorem ctl_projection_bound (count : Nat) (paths : List (List String)) (schema : Bool) (h : count > 64) :
    ctlProjection count paths schema = "ProjectionTooMany" := by simp [ctlProjection,h]
theorem ctl_support_descendant_is_hidden (tail : List String) : ctlField ("support" :: "value" :: tail) = false := rfl
theorem ctl_empty_proposal_refused : ctlProposal "p" "1" "1" "policy" "policy" [] 0 = "ProposalEmpty" := rfl
theorem ctl_fresh_proposal_usable : ctlProposal "p" "1" "1" "policy" "policy" [some "a"] 0 = "ProposalAllowed" := rfl
theorem ctl_stale_basis_refused (id basis expected policy current : String) (changes : List (Option String)) (executions : Nat) (h : basis ≠ expected) :
    ctlProposal id basis expected policy current changes executions = "ProposalStale" := by simp [ctlProposal,h]
theorem ctl_commit_requires_current_basis (state recorded current policy selected : String)
    (h : ctlCommit state recorded current policy selected = "CommitAllowed") :
    state = "proposed" ∧ recorded = current ∧ policy = selected := by
  dsimp only [ctlCommit] at h
  split at h
  · simp at h
  · rename_i hs
    split at h
    · simp at h
    · rename_i hb
      exact ⟨by simpa using hs,Classical.byContradiction (fun hn => hb (Or.inl hn)),Classical.byContradiction (fun hn => hb (Or.inr hn))⟩
theorem ctl_current_commit_is_usable (revision policy : String) :
    ctlCommit "proposed" revision revision policy policy = "CommitAllowed" := by simp [ctlCommit]
theorem ctl_cross_incident_plan_refused (seen : List String) (id scope incident : String) (tail : List (String × String)) (h : scope ≠ incident) :
    ctlExecutions incident seen ((id,scope) :: tail) = "PlanIncident" := by simp [ctlExecutions,h]
theorem ctl_hidden_incident_hides_transition (present operator : Bool) (origin principal grant : String) (chain : List String) (readable : Bool) :
    ctlVisible present false operator origin principal grant chain readable = false := by simp [ctlVisible]
theorem ctl_no_bound_selection (submittedPresent : Bool) (submitted bound : String) :
    ctlBound false submittedPresent false submitted bound = false := by simp [ctlBound]
theorem ctl_matching_bound_selection (grant : String) : ctlBound false true true grant grant = true := by simp [ctlBound]
theorem ctl_reserved_schema_requires_installed (name submitted actual : String) (h : name.startsWith "moment." = true) :
    ctlSchema name false submitted actual false "" = "SchemaReserved" := by simp [ctlSchema,h]
theorem ctl_unchanged_schema_is_usable (digest : String) : ctlSchema "user.test" false digest digest true digest = "SchemaAllowed" := by simp [ctlSchema]

def reactSource (present : Bool) (revision current : Nat) : String :=
  if !present || revision > current then "ReactionSourceMissing" else "ReactionNeedsVisibility"
def reactEvent (visible : Bool) (kind : String) (types : List String) : String :=
  if !visible then "ReactionEventHidden"
  else if types.isEmpty || types.contains kind then "ReactionEventUse" else "ReactionEventSkip"
def reactMode (events requested types : Nat) : String :=
  if events > 0 then "ReactionEvents" else if requested == 0 && types == 0 then "ReactionOnce" else "ReactionNone"
inductive ReactionProgress | pending (unresolved : Bool) | matched deriving DecidableEq, Repr
def reactObserve : ReactionProgress → Truth → ReactionProgress
  | .matched, _ => .matched
  | .pending _, .yes => .matched
  | .pending unknown, .no => .pending unknown
  | .pending _, .unknown => .pending true
def reactFinish : ReactionProgress → String
  | .matched => "ReactionEligible"
  | .pending true => "ReactionIndeterminate"
  | .pending false => "ReactionIneligible"
def reactCompare (left right : Nat) : Int := if left < right then -1 else if left == right then 0 else 1

theorem react_future_source_unavailable (present : Bool) (revision current : Nat) (h : revision > current) :
    reactSource present revision current = "ReactionSourceMissing" := by simp [reactSource,h]
theorem react_hidden_event_is_not_trigger (kind : String) (types : List String) :
    reactEvent false kind types = "ReactionEventHidden" := rfl
theorem react_eventless_is_usable : reactMode 0 0 0 = "ReactionOnce" := rfl
theorem react_named_event_is_not_eventless : reactMode 0 1 0 = "ReactionNone" := rfl
theorem react_match_absorbs_trace (remaining : List Truth) : remaining.foldl reactObserve .matched = .matched := by
  induction remaining with
  | nil => rfl
  | cons head tail ih => simpa [List.foldl,reactObserve] using ih
theorem react_unknown_survives_false : reactObserve (.pending true) .no = .pending true := rfl
theorem react_positive_resolves_unknown : reactFinish (reactObserve (.pending true) .yes) = "ReactionEligible" := rfl
theorem react_compare_reflexive (n : Nat) : reactCompare n n = 0 := by simp [reactCompare]

#print axioms react_future_source_unavailable
#print axioms react_hidden_event_is_not_trigger
#print axioms react_eventless_is_usable
#print axioms react_named_event_is_not_eventless
#print axioms react_match_absorbs_trace
#print axioms react_unknown_survives_false
#print axioms react_positive_resolves_unknown
#print axioms react_compare_reflexive

#print axioms ctl_root_is_usable
#print axioms ctl_projection_bound
#print axioms ctl_support_descendant_is_hidden
#print axioms ctl_empty_proposal_refused
#print axioms ctl_fresh_proposal_usable
#print axioms ctl_stale_basis_refused
#print axioms ctl_commit_requires_current_basis
#print axioms ctl_current_commit_is_usable
#print axioms ctl_cross_incident_plan_refused
#print axioms ctl_hidden_incident_hides_transition
#print axioms ctl_no_bound_selection
#print axioms ctl_matching_bound_selection
#print axioms ctl_reserved_schema_requires_installed
#print axioms ctl_unchanged_schema_is_usable

#print axioms pq_charge_exhaustion_is_final
#print axioms pq_charge_never_increases
#print axioms pq_zero_charge_preserves
#print axioms pq_initial_limits_are_useful
#print axioms pq_foreign_context_is_ignored
#print axioms pq_withdrawn_support_is_inactive
#print axioms pq_hidden_source_is_inactive
#print axioms pq_missing_proof_under_restriction_is_unknown
#print axioms pq_visible_positive_is_useful
#print axioms pq_budget_exhaustion_is_unknown
#print axioms pq_settled_result_is_preserved
#print axioms cap_policy_missing_is_unknown
#print axioms cap_policy_unknown_is_unknown
#print axioms cap_policy_denied_is_ineligible
#print axioms cap_policy_allowed_is_useful
#print axioms cap_policy_cannot_erase_basis
#print axioms cap_empty_chain_has_no_authority
#print axioms cap_hidden_incident_hides_execution
#print axioms cap_missing_origin_hides_execution
#print axioms cap_reconciliation_needs_access
#print axioms cap_required_evidence_needs_source
#print axioms cap_opening_without_required_evidence_is_useful
#print axioms cap_eligible_requires_observed_policy
#print axioms cap_compare_reflexive
#print axioms sch_cancelled_never_runnable
#print axioms sch_blocked_rests
#print axioms sch_full_keeps_cursor
#print axioms sch_edge_requires_new_rise
#print axioms sch_each_remains_observable
#print axioms sch_failed_capacity_not_acknowledged
#print axioms sch_missing_is_unresolved
#print axioms sch_exhaustion_is_unresolved
#print axioms sch_full_pressure_rests
#print axioms sch_oldest_is_member
#print axioms sch_selected_group_is_eligible
#print axioms sch_chosen_is_eligible
#print axioms calendar_result_is_bounded
#print axioms envelope_sum_is_bounded
#print axioms remaining_within_ceiling
#print axioms availability_within_every_ceiling
#print axioms safe_difference_is_exact
#print axioms borrowed_difference_is_exact
#print axioms minimum_is_bounded
#print axioms minimum_below_member
#print axioms lease_window_is_bounded
#print axioms lease_respects_every_bound
#print axioms missing_frame_expires
#print axioms wrong_boot_expires
#print axioms terminal_maintenance_unchanged
#print axioms expired_active_refuses_reclaim
#print axioms cancellation_blocks_retry
#print axioms fencing_strictly_increases
#print axioms safe_sum_is_exact
#print axioms overflow_stays_overflow
#print axioms capacity_respects_ceiling
#print axioms wrapped_low_carry
#print axioms limb_sum_is_exact
#print axioms terminal_memory_released
#print axioms unknown_cumulative_preserves_reservation
#print axioms usage_never_decreases
#print axioms bound_identity_not_operator
#print axioms admitted_owner_is_operator
#print axioms empty_chain_has_no_resource
#print axioms resource_requires_every_scope
#print axioms terminal_incident_cannot_reopen
#print axioms completion_requires_source
#print axioms open_without_evidence_is_usable
#print axioms stale_basis_refused
#print axioms closed_context_can_reconcile
#print axioms empty_id_selection_matches_nothing
#print axioms certified_edge
#print axioms rank_along_path
#print axioms certificate_excludes_cycle
#print axioms subset_certificate
#print axioms single_edge_is_usable
#print axioms outside_index_refused
#print axioms unsupported_relation_is_absent
#print axioms missing_temporal_frame_is_context
#print axioms top_combine_commutes
#print axioms top_combine_associates
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

def schLives : List (Moment.SchLife × String) := [(.active,"active"),(.completed,"completed"),(.cancelled,"cancelled")]
def schWakes : List (Moment.SchWake × String) := [(.event,"event"),(.at,"at"),(.after,"after"),(.capacity,"capacity")]
def schSourceLists : List (List String) := [[],["a"],["a","b"],["b","a"],(List.range 32).map toString,(List.range 33).map toString]
def schIncoming : List (List String) := [[],["a"],["b","a"],["new"],["31","0"]]
def schFilters : List (Option (List String)) := [none,some [],some ["a","b"],some ["c","a"]]
def schCandidates (mask : Nat) : List Moment.SchCandidate :=
  ([ ("b",9),("a",5),("a",3),("c",7) ] : List (String × Nat)).zipIdx.map fun ((owner,order),index) =>
    { index, incident := owner, order, facts := { pending := if mask / 2^index % 2 == 1 then 1 else 0 } }
def schCauses (mask dependent broken : Nat) : List Moment.SchCause :=
  ([0,1] : List Nat).filterMap fun index =>
    if broken == 1 && index == 1 then none else some {
      id := "n" ++ toString index,
      context := if broken == 2 && index == 1 then "foreign" else "context",
      kind := if dependent / 2^index % 2 == 1 then "runtime.schedule.triggered" else "graph.transact.committed",
      subjects := ["target"],
      causes := ([0,1] : List Nat).filterMap fun target => if mask / 2^(index*2+target) % 2 == 1 then some ("n" ++ toString target) else none }

def capPolicies : List (Moment.CapPolicy × String) := [(.allowed,"allowed"),(.denied,"denied"),(.unknown,"unknown"),(.missing,"missing")]
def capEligibilities : List (Moment.CapEligibility × String) := [(.eligible,"eligible"),(.unknown,"unknown"),(.ineligible,"ineligible")]
def capAssessmentLabel : Moment.CapAssessment → String
  | .needsPolicy => "needsPolicy"
  | .assessed unmet eligibility =>
    (match eligibility with | .eligible => "eligible" | .unknown => "unknown" | .ineligible => "ineligible") ++ ":" ++ String.intercalate "," unmet
def capRequirement (mask : Nat) : Moment.CapRequirement :=
  { versions := if mask % 2 == 1 then [] else ["1"],
    input := ⟨"input",if mask / 2 % 2 == 1 then "other" else "1","digest"⟩,
    output := ⟨"output","1",if mask / 4 % 2 == 1 then "other" else "digest"⟩,
    features := if mask / 8 % 2 == 1 then ["missing"] else ["bytes"],
    isolation := if mask / 16 % 2 == 1 then [] else ["process"] }
def capScopes (mask : Nat) (restricted : Bool) : List Moment.CapScope :=
  [{actions := if mask / 64 % 2 == 1 then [] else ["verify"],allIncidents := !restricted}]
def capSchemaVariant (name : String) (code : Nat) : Moment.CapSchema :=
  ⟨if code == 1 then "other" else name,if code == 2 then "other" else "1",if code == 3 then "other" else "digest"⟩

def pqBudgetLabel (budget : Option Nat) : String := budget.map toString |>.getD "unknown"
def pqSearchLabel : Moment.PqSearch → String
  | .done value budget => (value.map toString |>.getD "unknown") ++ ":" ++ pqBudgetLabel budget
  | .pending _ _ _ => "unfinished"
def pqCosts (size code : Nat) : List Nat := (List.range size).map fun index => ([0,1,32768,2147483647] : List Nat)[code / 4^index % 4]!
def pqAssertions (size code : Nat) : List Moment.PqAssertion := (List.range size).map fun index =>
  let kind := code / 4^index % 4
  { index, system := if kind == 3 && index % 2 == 0 then "foreign" else "system", context := if kind == 3 && index % 2 == 1 then "foreign" else "context", issuer := if kind == 2 then "delegate" else "owner", record := if kind == 1 then "two" else "one", sources := if kind == 0 then 0 else if kind == 1 then 1000 else 32768 }
def pqProjectionLabel (projection : Moment.PqProjection) : String :=
  if projection.budget.isNone then "unknown" else "ready:" ++ pqBudgetLabel projection.budget ++ ":" ++ toString projection.provenance ++ ":" ++ String.intercalate "," (projection.indices.map toString) ++ ":" ++ String.intercalate "," projection.records
def pqVisible (size code : Nat) : List Bool := (List.range size).map fun index => code / 2^index % 2 == 1
def pqRoleCosts (size code : Nat) : List Nat := (List.range size).map fun index => ([0,1,1000] : List Nat)[code / 3^index % 3]!

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

def topLabel : Moment.TopVerdict → String
  | .good => "TopGood"
  | .parents => "TopParents"
  | .cycle => "TopCycle"
  | .invalid => "TopInvalid"
def topVerdicts : List Moment.TopVerdict := [.good,.parents,.cycle,.invalid]
def topEdges (size mask : Nat) : List Moment.TopEdge :=
  chooseMask ((List.range size).flatMap (fun a => (List.range size).map (fun b => (a,b)))) mask
def pqGraph (size mask : Nat) : List Moment.PqEdge := (topEdges size mask).map fun (source,target) =>
  { subjects := ["n" ++ toString source],targets := [("n" ++ toString target,true)] }
def topExtra : List (Nat × List Moment.TopEdge) :=
  [(3,[(3,0)]),(3,[(0,3)]),(3,[(4,0)]),(3,[(0,4294967295)]),(0,[(0,0)]),
   (3,[(0,1),(0,2),(3,1)]),(2,[(0,1),(0,1)]),(2,[(0,1),(1,0),(0,1)]),(3,[(0,1),(0,1),(0,2)])]
def topProjectionLabel : Moment.TopProjection → String
  | .skip => "skip"
  | .within scope a b => s!"within:{scope}:{a}:{b}"
  | .before scope a b => s!"precedes:{scope}:{a}:{b}"
def topSupports : List (List String) := [[],["withdrawn"],["asserted"],["withdrawn","asserted"]]

def accessMethods : List String := ["graph.query","graph.transact","schema.publish","context.limits","context.close","policy.activate"]
def accessSamples : List Moment.AccessScope :=
  [⟨accessMethods,true,[],["one","ctx"]⟩,⟨accessMethods,false,["incident"],["one","ctx"]⟩,
   ⟨["graph.query","graph.transact"],true,[],["two"]⟩,⟨[],false,[],[]⟩]
def accessChain (depth code : Nat) : List Moment.AccessScope :=
  (List.range depth).map (fun i => (accessSamples[code / 4^i % 4]?).getD ⟨[],false,[],[]⟩)
def methodAdmissionLabel : Moment.MethodAdmission → String
  | .allowed => "MethodAllowed"
  | .outsideGrant => "MethodOutsideGrant"
  | .schemaOperator => "MethodSchemaOperator"
  | .limitsOperator => "MethodLimitsOperator"
  | .contextWide => "MethodContextWide"
def incidentStates : List Moment.IncidentState := [.open,.resting,.completed,.cancelled]
def incidentStateLabel : Moment.IncidentState → String
  | .open => "open"
  | .resting => "resting"
  | .completed => "completed"
  | .cancelled => "cancelled"
def incidentEvidenceLabel : Moment.IncidentEvidence → String
  | .allowed => "IncidentEvidenceAllowed"
  | .missing => "IncidentEvidenceMissing"
  | .completionMissing => "IncidentCompletionMissing"
def mutationLabel : Moment.MutationAdmission → String
  | .allowed => "MutationAllowed"
  | .stale => "MutationStale"
  | .closed => "MutationClosed"
def queryFilters (name : String) : List (Option (List String)) := [none,some [],some [name],some ["other"]]
def queryRoles : List (List (String × List String)) := [[],[("subject",["one"])],[("object",["two"])],[("subject",["one"]),("object",["two"])]]

def budgetValues : List Nat := [0,1,2,4294967295,4294967296,4294967297,281474976710655,281474976710656,281474976710657,9007199254740990,9007199254740991]
def budgetCapacityValues : List Nat := [0,1,4294967295,4294967296,9007199254740990,9007199254740991]
def budgetFields : List String := ["cpuMillis","memoryBytes","outputBytes","modelTokens","apiSpendMicrounits"]
def budgetLabel : Option Nat → String
  | none => "overflow"
  | some n => toString n
def budgetTrace (stateMask unknownMask code : Nat) (scope : String) : Option Nat × Nat :=
  ((List.range 2).filter (fun i => scope == "all" || scope == "shared" || (scope == "a" && i == 0))).foldl
    (fun (amount, concurrent) i =>
      let active := (stateMask / 2^i) % 2 == 1
      let unknown := (unknownMask / 2^i) % 2 == 1
      let ceiling := ([1,2,Moment.budgetMaximum][code / 3^i % 3]?).getD 0
      (Moment.budgetAccumulate amount (Moment.budgetCharge (if active then .running else .succeeded) "cpuMillis" unknown ceiling 1), concurrent + if active then 1 else 0)) (some 0,0)

def leaseWindowLabel : Moment.LeaseWindow → String
  | .expired => "expired"
  | .window deadline duration => s!"{deadline}:{duration}"
def clockBounds (size code : Nat) : List Nat :=
  (List.range size).map (fun i => ([50,100,101,1100,30100][code / 5^i % 5]?).getD 0)
def retryLabel : Moment.RetryAdmission → String
  | .allowed => "RetryAllowed"
  | .cancelled => "RetryCancelled"
  | .unsupported => "RetryUnsupported"
def maintenanceLabel : Moment.Maintenance → String
  | .keep => "ClockKeep"
  | .lost => "ClockLost"
  | .cancelDeadline => "ClockCancelDeadline"
  | .cancelAuthority => "ClockCancelAuthority"
def clockDelayValues (size code : Nat) : List Int :=
  (List.range size).map (fun i => ([-4,-1,0,1,4][code / 5^i % 5]?).getD 0)
def overrunMarkers (size code : Nat) : List (List String) :=
  (List.range size).map (fun i => ([[],["cpuMillis"],["memoryBytes"],["cpuMillis","memoryBytes"]][code / 4^i % 4]?).getD [])
def capacitySamples : List (Option Nat × Nat) :=
  [(some 0,0),(some 0,1),(some 1,1),(some 1,Moment.budgetMaximum),(some Moment.budgetMaximum,Moment.budgetMaximum),(none,Moment.budgetMaximum)]
def capacityEnvelopes (size code : Nat) : List (Option Nat × Nat) :=
  (List.range size).map (fun i => (capacitySamples[code / 6^i % 6]?).getD (none,0))
def resourceRequests (size code : Nat) : List Nat :=
  (List.range size).map (fun i => ([0,1,Moment.budgetMaximum][code / 3^i % 3]?).getD 0)

/-- Bounded executable correspondence cases; these do not replace theorems. -/
def ctlPaths : List (List String) := [[],["value"],["value","schema"],["value","schema","name"],["value","schema","name","x"],["value","value","a/b"],["ref"],["ref","id"],["support"],["support","x"],["digest"],["revision"],["recordedAt"],["recordedBy"],["other"],["digest","x"]]
def ctlChanges : List (List (Option String)) := [[],[some "p"],[some "a"],[none],[some "a",none]]
def ctlItems : List (String × String) := [("a","i"),("b","i"),("p","i"),("a","other")]
def ctlChains : List (List String) := [[],["g"],["other"]]
def ctlNames : List String := ["policies","transitions","executions","schemas","guidanceSources","unknown"]
def ctlBindingSamples : List (List String) := [[],["now"],["arbitrary"],["now","event.id"],["now","arbitrary"]]
def fromCode {α : Type} (values : List α) (size code : Nat) : List α :=
  (List.range size).filterMap (fun i => values[code / values.length^i % values.length]?)

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
  for size in List.range 4 do
    for mask in List.range (2^(size*size)) do
      for exclusive in [false,true] do
        IO.println s!"case|topology|{size}|{mask}|{exclusive}|{topLabel (Moment.topCheck size (topEdges size mask) exclusive)}"
  for ((size, edges), index) in topExtra.zipIdx do
    for exclusive in [false,true] do
      IO.println s!"case|topologyExtra|{index}|{exclusive}|{topLabel (Moment.topCheck size edges exclusive)}"
  for kind in ["relation","atom"] do
    for schema in ["moment.within","moment.precedes","moment.partOf"] do
      for (supports, index) in topSupports.zipIdx do
        for framed in [false,true] do
          IO.println s!"case|topologyProjection|{kind}|{schema}|{index}|{framed}|{topProjectionLabel (Moment.topProject kind schema supports "context" "perspective" framed "frame" "child" "parent" "earlier" "later")}"
  IO.println "case|topologyCombine|-|TopGood"
  for a in topVerdicts do
    for b in topVerdicts do
      IO.println s!"case|topologyCombine|{topLabel a}|{topLabel b}|{topLabel (Moment.topCombine a b)}"
  for mask in List.range 512 do
    for rankMask in List.range 27 do
      let rank := fun i => rankMask / 3^i % 3
      let valid := Moment.topCertificate (topEdges 3 mask) rank
      IO.println s!"case|topologyCertificate|{mask}|{rankMask}|{if valid then "TopGood" else "TopInvalid"}"
  for ownerMatches in [false,true] do
    for contextMatches in [false,true] do
      for bound in [false,true] do
        IO.println s!"case|accessOperator|{ownerMatches}|{contextMatches}|{bound}|{Moment.accessOperator "caller" (if ownerMatches then "caller" else "owner") (if contextMatches then "caller" else "other") bound}"
  for depth in List.range 4 do
    for code in List.range (4^depth) do
      let chain := accessChain depth code
      for operator in [false,true] do
        for key in ["one","two","ctx","foreign"] do
          IO.println s!"case|accessResource|{depth}|{code}|{operator}|{key}|{Moment.accessResource operator chain key}"
        for key in ["incident","other","missing"] do
          IO.println s!"case|accessIncident|{depth}|{code}|{operator}|{key}|{Moment.accessIncident operator chain key}"
        for method in accessMethods do
          IO.println s!"case|accessMethod|{depth}|{code}|{operator}|{method}|{methodAdmissionLabel (Moment.accessMethod operator chain method "ctx")}"
  for state in incidentStates do
    IO.println s!"case|incidentTerminal|{incidentStateLabel state}|{Moment.incidentTerminal state}"
    for next in incidentStates do
      IO.println s!"case|incidentEdit|{incidentStateLabel state}|{incidentStateLabel next}|{Moment.incidentRevisable state next}"
    for (evidence, index) in ([none,some [],some ["one"]] : List (Option (List String))).zipIdx do
      IO.println s!"case|incidentEvidence|{incidentStateLabel state}|{index}|{incidentEvidenceLabel (Moment.incidentEvidence state evidence.isSome (evidence.getD []))}"
  for revision in [0,4294967295,4294967296,9007199254740991] do
    for same in [false,true] do
      for state in ["open","closed"] do
        for method in ["graph.transact","incident.update","context.close","execution.finish","execution.reconcile","execution.cancel"] do
          let expected := if same then revision else if revision == 0 then 1 else 0
          IO.println s!"case|mutationBasis|{revision}|{same}|{state}|{method}|{mutationLabel (Moment.mutationBasis revision expected state method)}"
  for (ids, idsIndex) in (queryFilters "id").zipIdx do
    for (schemas, schemasIndex) in (queryFilters "schema").zipIdx do
      for status in ["any","asserted","withdrawn"] do
        for (support, supportIndex) in topSupports.zipIdx do
          for (related, relatedIndex) in (queryFilters "id").zipIdx do
            IO.println s!"case|querySelection|{idsIndex}|{schemasIndex}|{status}|{supportIndex}|{relatedIndex}|{Moment.queryMatch "id" "schema" support ids schemas status related}"
  for kind in ["atom","relation"] do
    for (role, roleIndex) in ([none,some "subject",some "object",some "missing"] : List (Option String)).zipIdx do
      for target in ["one","two","three"] do
        for (roles, rolesIndex) in queryRoles.zipIdx do
          IO.println s!"case|queryRelated|{kind}|{roleIndex}|{target}|{rolesIndex}|{Moment.queryRelated kind roles role target}"
  for a in budgetValues do
    for b in budgetValues do
      IO.println s!"case|budgetAdd|{a}|{b}|{budgetLabel (Moment.budgetAdd a b)}"
      IO.println s!"case|budgetLe|{a}|{b}|{decide (a ≤ b)}"
  for key in budgetFields ++ ["concurrentExecutions"] do
    for total in budgetCapacityValues do
      for requested in budgetCapacityValues do
        for ceiling in budgetCapacityValues do
          IO.println s!"case|budgetCapacity|{key}|{total}|{requested}|{ceiling}|{Moment.budgetCapacity (some total) requested ceiling}"
  for state in runStates do
    for key in budgetFields do
      for ceiling in [0,1,Moment.budgetMaximum] do
        for usage in [0,1,Moment.budgetMaximum] do
          for unknown in (if key == "outputBytes" then [false] else [false,true]) do
            IO.println s!"case|budgetCharge|{runLabel state}|{key}|{ceiling}|{usage}|{unknown}|{Moment.budgetCharge state key unknown ceiling usage}:{if Moment.runTerminal state then 0 else 1}"
  for key in budgetFields do
    for previous in [0,1,Moment.budgetMaximum] do
      for usage in [0,1,Moment.budgetMaximum] do
        for ceiling in [0,1,Moment.budgetMaximum] do
          for observed in [false,true] do
            IO.println s!"case|budgetUsage|{key}|{previous}|{usage}|{ceiling}|{observed}|{Moment.budgetUsage previous usage ceiling observed}"
  for stateMask in List.range 4 do
    for unknownMask in List.range 4 do
      for code in List.range 9 do
        for scope in ["all","a","shared","missing"] do
          let (amount, concurrent) := budgetTrace stateMask unknownMask code scope
          IO.println s!"case|budgetTrace|{stateMask}|{unknownMask}|{code}|{scope}|{budgetLabel amount}:{concurrent}"
  for a in budgetValues do
    IO.println s!"case|fenceNext|{a}|{budgetLabel (Moment.budgetAdd a 1)}"
    IO.println s!"case|singleSlot|{a}|{decide (a = 1)}"
    for b in budgetValues do
      IO.println s!"case|budgetSubtract|{a}|{b}|{budgetLabel (Moment.budgetSubtract a b)}"
      IO.println s!"case|fenceEqual|{a}|{b}|{decide (a = b)}"
  for millis in [1,1000,30000] do
    for size in List.range 3 do
      for code in List.range (5^size) do
        IO.println s!"case|leaseWindow|{millis}|{size}|{code}|{leaseWindowLabel (Moment.leaseWindow 100 millis (clockBounds size code))}"
  for present in [false,true] do
    for framePresent in [false,true] do
      for boot in [false,true] do
        for wall in ([99,100,101] : List Int) do
          for mono in ([399,400,401] : List Int) do
            IO.println s!"case|leaseExpiry|{present}|{framePresent}|{boot}|{wall}|{mono}|{Moment.leaseExpired present framePresent (if boot then "boot" else "other") "boot" wall 100 mono 400}"
        for holder in [false,true] do
          for identity in [false,true] do
            for fence in [false,true] do
              for live in [false,true] do
                for token in [1,4294967296,9007199254740991] do
                  let actual := Moment.leaseValid present framePresent (if boot then "boot" else "other") "boot" (if holder then "holder" else "other") "holder" "lease" (if identity then "lease" else "different") token (if fence then token else 0) (if live then 99 else 100) 100 1 401
                  IO.println s!"case|leaseValid|{present}|{framePresent}|{boot}|{holder}|{identity}|{fence}|{live}|{token}|{actual}"
  for cancelled in [false,true] do
    for basis in ["not_started","idempotent"] do
      for provider in ["lookup","idempotent","manual"] do
        IO.println s!"case|retryAdmission|{cancelled}|{basis}|{provider}|{retryLabel (Moment.retryAdmission cancelled basis provider)}"
  for state in runStates do
    IO.println s!"case|executionQueued|{runLabel state}|{Moment.executionQueued state}"
    for cancelled in [false,true] do
      IO.println s!"case|executionDeadline|{runLabel state}|{cancelled}|{Moment.executionWaitsDeadline state cancelled}"
    for expired in [false,true] do
      for (deadline, index) in ([none,some 99,some 100,some 101] : List (Option Nat)).zipIdx do
        for cap in [99,101] do
          for (grants, grantIndex) in ([[],[99],[101]] : List (List Nat)).zipIdx do
            IO.println s!"case|executionMaintenance|{runLabel state}|{expired}|{index}|{cap}|{grantIndex}|{maintenanceLabel (Moment.executionMaintenance state expired deadline 100 cap grants)}"
  for size in List.range 4 do
    for code in List.range (5^size) do
      let result := (Moment.clockDelay (clockDelayValues size code)).map toString |>.getD "idle"
      IO.println s!"case|clockDelay|{size}|{code}|{result}"
    for code in List.range (4^size) do
      IO.println s!"case|resourceBlocked|{size}|{code}|{Moment.resourceBlocked (overrunMarkers size code)}"
    for code in List.range (6^size) do
      IO.println s!"case|capacityAvailable|{size}|{code}|{Moment.capacityAvailable (capacityEnvelopes size code)}"
  for key in budgetFields ++ ["concurrentExecutions"] do
    for size in List.range 3 do
      for code in List.range (3^size) do
        for ceiling in [0,1,Moment.budgetMaximum] do
          IO.println s!"case|resourceEnvelope|{key}|{size}|{code}|{ceiling}|{Moment.requestsFit (resourceRequests size code) ceiling}"
  for anchor in [0,1,Moment.calendarMaximum-1,Moment.calendarMaximum] do
    for duration in [0,1,2,Moment.budgetMaximum] do
      IO.println s!"case|calendarAfter|{anchor}|{duration}|{budgetLabel (Moment.calendarAfter anchor duration)}"
  for (life,label) in schLives do
    IO.println s!"case|scheduleCancel|{label}|{life != .completed}"
    for present in [false,true] do
      for equal in [false,true] do
        IO.println s!"case|scheduleMatches|{label}|{present}|{equal}|{Moment.schMatches life present equal}"
    for blocked in [false,true] do
      for pressure in [false,true] do
        for pending in [0,1,128] do
          for busy in [0,1] do
            for coalesce in [false,true] do
              for sources in [0,32] do
                for sequence in [99,100] do
                  let f : Moment.SchFacts := { life, sequence, block := if blocked then some 100 else none, pending, busy, pressure := if pressure then some 100 else none }
                  IO.println s!"case|scheduleReady|{label}|{blocked}|{pressure}|{pending}|{busy}|{coalesce}|{sources}|{sequence}|{Moment.schReady f 100 coalesce sources}"
      for context in ["open","closed"] do
        for ended in [false,true] do
          IO.println s!"case|scheduleScan|{label}|{blocked}|{context}|{ended}|{Moment.schScan { life, block := if blocked then some 100 else none } context ended 100}"
      for fired in [false,true] do
        for present in [false,true] do
          IO.println s!"case|scheduleWatch|{label}|{blocked}|{fired}|{present}|{Moment.schWatch { life, block := if blocked then some 100 else none, fired } 100 present}"
  for (wake,label) in schWakes do
    IO.println s!"case|scheduleNeedsEvents|{label}|{wake == .event || wake == .after}"
    for edge in [false,true] do
      IO.println s!"case|scheduleBaseline|{label}|{edge}|{wake == .event && edge}"
    for once in [false,true] do
      for resource in ["cpuMillis","missing"] do
        IO.println s!"case|scheduleWake|{label}|{once}|{resource}|{Moment.schWakeAdmission wake once resource}"
    for fired in [false,true] do
      for (due,index) in ([none,some 99,some 101] : List (Option Nat)).zipIdx do
        for sequence in [99,100] do
          IO.println s!"case|scheduleMode|{label}|{fired}|{index}|{sequence}|{Moment.schMode wake { sequence, fired } 100 due 100}"
  for previous in [0,99,100] do
    for sequence in [98,99,100,101] do
      for kind in ["graph.transact.committed","runtime.schedule.triggered","other"] do
        IO.println s!"case|scheduleEventGate|{previous}|{sequence}|{kind}|{Moment.schEventGate previous sequence 100 kind ["graph.transact.committed","runtime.schedule.triggered"]}"
  for each in [false,true] do
    for edge in [false,true] do
      for selected in [false,true] do
        let (fire,next) := Moment.schObservation each edge selected
        IO.println s!"case|scheduleObservation|{each}|{edge}|{selected}|{fire}:{next}"
  for pending in [0,1,128] do
    for coalesce in [false,true] do
      for (previous,index) in schSourceLists.zipIdx do
        for (incoming,next) in schIncoming.zipIdx do
          IO.println s!"case|scheduleQueue|{pending}|{coalesce}|{index}|{next}|{Moment.schQueue pending coalesce previous incoming}"
  for oldEdge in [false,true] do
    for nextEdge in [false,true] do
      for fire in [false,true] do
        for enqueued in [false,true] do
          for pending in [false,true] do
            for once in [false,true] do
              let result := Moment.schAdvance 99 100 101 oldEdge nextEdge fire enqueued pending once
              IO.println s!"case|scheduleAdvance|{oldEdge}|{nextEdge}|{fire}|{enqueued}|{pending}|{once}|{result.cursor}:{result.edge}:{result.stop}:{result.full}"
  for old in [false,true] do
    for available in [false,true] do
      for accepted in [false,true] do
        IO.println s!"case|scheduleCapacityEdge|{old}|{available}|{accepted}|{Moment.schCapacityEdge old available accepted}"
  for present in [false,true] do
    for incident in [false,true] do
      for operator in [false,true] do
        for readable in [false,true] do
          for creator in [false,true] do
            for bound in [false,true] do
              IO.println s!"case|scheduleVisible|{present}|{incident}|{operator}|{readable}|{creator}|{bound}|{Moment.schVisible present incident operator readable creator bound}"
  for (ids,index) in schFilters.zipIdx do
    for (subjects,next) in schFilters.zipIdx do
      let result := (Moment.schSelection ids subjects).map (fun values => "selected:" ++ String.intercalate "," values) |>.getD "unrestricted"
      IO.println s!"case|scheduleSelection|{index}|{next}|{result}"
  for mask in List.range 16 do
    for (last,index) in ([none,some "a",some "b",some "c",some "z"] : List (Option String)).zipIdx do
      let result := (Moment.schChoose (schCandidates mask) 100 last).map (fun item => toString item.index) |>.getD "none"
      IO.println s!"case|scheduleChoose|{mask}|{index}|{result}"
  for mask in List.range 16 do
    for dependent in List.range 4 do
      for broken in List.range 3 do
        IO.println s!"case|scheduleCausality|{mask}|{dependent}|{broken}|{Moment.schCausalWalk 128 ["n0"] [] (schCauses mask dependent broken) "context" "target"}"
  for count in [0,127,128,129] do
    IO.println s!"case|scheduleRoom|{count}|{decide (count < 128)}"
  for sequence in budgetValues do
    for emitted in [0,1,128] do
      IO.println s!"case|scheduleOrder|{sequence}|{emitted}|{budgetLabel (Moment.budgetAdd sequence (emitted+1))}"
  for once in [false,true] do
    IO.println s!"case|scheduleCompleted|{once}|{if once then "completed" else "active"}"
  for code in ["REVISION_CONFLICT","FORBIDDEN","INTERNAL"] do
    IO.println s!"case|scheduleRetryFault|{code}|{code == "REVISION_CONFLICT"}"
  for mask in List.range 128 do
    for restricted in [false,true] do
      for incident in [false,true] do
        for (policy,label) in capPolicies do
          let basis := Moment.capBasis {} (capRequirement mask) (capScopes mask restricted) (mask / 32 % 2 == 1) incident
          IO.println s!"case|capabilityBasis|{mask}|{restricted}|{incident}|{label}|{capAssessmentLabel (Moment.capFinish basis policy)}"
  for (a,alabel) in capEligibilities do
    for (b,blabel) in capEligibilities do
      for ac in [0,1,8] do
        for bc in [0,1,8] do
          for ai in ["a","b"] do
            for bi in ["a","b"] do
              IO.println s!"case|capabilityCompare|{alabel}|{ac}|{ai}|{blabel}|{bc}|{bi}|{Moment.capCompare a b ac bc ai bi}"
  for count in [0,4095,4096] do
    for provider in [false,true] do
      for reserved in [false,true] do
        for expired in [false,true] do
          IO.println s!"case|capabilityPublish|{count}|{provider}|{reserved}|{expired}|{Moment.capPublish {} (if provider then "provider" else "other") (if reserved then ["verify"] else []) count expired}"
  for count in [0,4095,4096,4097] do
    IO.println s!"case|executionRoom|{count}|{decide (count < 4096)}"
  for expired in [false,true] do
    for context in ["open","closed"] do
      for incident in [false,true] do
        for status in incidentStates do
          IO.println s!"case|executionAdmission|{expired}|{context}|{incident}|{incidentStateLabel status}|{Moment.capExecutionAdmission expired context incident status}"
  for present in [false,true] do
    for expiry in [99,100,101] do
      IO.println s!"case|executionDeadlineAdmission|{present}|{expiry}|{!present || decide (100 < expiry)}"
  for incident in [false,true] do
    for capability in [false,true] do
      for operator in [false,true] do
        for self in [false,true] do
          for bound in [false,true] do
            for readable in [false,true] do
              IO.println s!"case|executionPrepare|{incident}|{capability}|{operator}|{self}|{bound}|{readable}|{Moment.capPrepare incident capability operator self bound readable}"
  for present in [false,true] do
    for origin in [false,true] do
      for incident in [false,true] do
        for operator in [false,true] do
          for requester in [false,true] do
            for provider in [false,true] do
              for bound in [false,true] do
                for capability in [false,true] do
                  for readable in [false,true] do
                    IO.println s!"case|executionVisible|{present}|{origin}|{incident}|{operator}|{requester}|{provider}|{bound}|{capability}|{readable}|{Moment.capVisible present origin incident operator requester provider bound capability readable}"
  for provider in [false,true] do
    for operator in [false,true] do
      for readable in [false,true] do
        IO.println s!"case|executionReconcile|{provider}|{operator}|{readable}|{Moment.capReconcile provider operator readable}"
  for required in [false,true] do
    for present in [false,true] do
      IO.println s!"case|executionEvidence|{required}|{present}|{Moment.capEvidence required present}"
  for operator in [false,true] do
    for bound in [false,true] do
      IO.println s!"case|capabilityBoundGrant|{operator}|{bound}|{operator || bound}"
  for same in [false,true] do
    for readable in [false,true] do
      IO.println s!"case|capabilitySelected|{same}|{readable}|{same && readable}"
  for (policy,label) in capPolicies do
    IO.println s!"case|capabilityEmptyChain|{label}|{capAssessmentLabel (Moment.capFinish (Moment.capBasis {} {} [] false true) policy)}"
  for a in List.range 4 do
    for b in List.range 4 do
      IO.println s!"case|capabilitySchema|{a}|{b}|{capAssessmentLabel (Moment.capFinish (Moment.capBasis {} {input := capSchemaVariant "input" a,output := capSchemaVariant "output" b} [{}] false true) .allowed)}"
  for records in [0,4096,4097,2147483647] do
    for assertions in [0,16384,16385,2147483647] do
      IO.println s!"case|policyQueryInitial|{records}|{assertions}|{pqBudgetLabel (Moment.pqInitial records assertions)}"
  for (budget,index) in ([none,some 0,some 1,some 32768] : List (Option Nat)).zipIdx do
    for size in List.range 4 do
      for code in List.range (4^size) do
        IO.println s!"case|policyQueryCharge|{index}|{size}|{code}|{pqBudgetLabel (Moment.pqCharges budget (pqCosts size code))}"
  for records in [0,4096] do
    for size in List.range 4 do
      for code in List.range (4^size) do
        for mask in List.range 4 do
          IO.println s!"case|policyQueryProjection|{records}|{size}|{code}|{mask}|{pqProjectionLabel (Moment.pqProject (pqAssertions size code) (chooseMask ["owner","delegate"] mask) (Moment.pqInitial records size))}"
  for status in ["asserted","withdrawn"] do
    for size in List.range 4 do
      for code in List.range (2^size) do
        IO.println s!"case|policyQuerySupported|{status}|{size}|{code}|{Moment.pqSupported status (pqVisible size code)}"
  for kind in ["atom","relation"] do
    for schema in ["edge","other"] do
      for readable in [false,true] do
        for supported in [false,true] do
          IO.println s!"case|policyQuerySelected|{kind}|{schema}|{readable}|{supported}|{Moment.pqSelected kind schema ["edge"] readable supported}"
  for found in [false,true] do
    for operator in [false,true] do
      IO.println s!"case|policyQueryObserved|{found}|{operator}|{(Moment.pqObserved found operator).map toString |>.getD "unknown"}"
  for records in [0,1,4] do
    for assertions in [0,1,4] do
      for provenance in [0,1000,32768] do
        for budget in [10,32768] do
          for size in List.range 4 do
            for code in List.range (3^size) do
              let roles := if records == 0 then [] else pqRoleCosts size code
              IO.println s!"case|policyQueryExistsBudget|{records}|{assertions}|{provenance}|{budget}|{size}|{code}|{pqBudgetLabel (Moment.pqCharges (some budget) ([records,assertions,provenance,1] ++ roles ++ roles))}"
  for size in List.range 4 do
    for mask in List.range (2^(size*size)) do
      for (budget,index) in ([none,some 0,some 2,some 3,some 6,some 9,some 15] : List (Option Nat)).zipIdx do
        for hops in [1,2,8] do
          for operator in [false,true] do
            IO.println s!"case|policyQueryRelated|{size}|{mask}|{index}|{hops}|{operator}|{pqSearchLabel (Moment.pqRelated (pqGraph size mask) "n0" ("n" ++ toString (size-1)) hops operator budget)}"

  for size in List.range 3 do
    for code in List.range (16^size) do
      let paths := fromCode ctlPaths size code
      for schema in [false,true] do
        IO.println s!"case|controlProjection|{size}|{code}|{schema}|{Moment.ctlProjection size paths schema}"
  for count in [0,1,64,65,1000] do
    for schema in [false,true] do
      IO.println s!"case|controlProjectionCount|{count}|{schema}|{Moment.ctlProjection count (List.replicate count ["value"]) schema}"
  for revision in [0,1,9007199254740991] do
    for sameBasis in [false,true] do
      for samePolicy in [false,true] do
        for (changes,index) in ctlChanges.zipIdx do
          for executions in [0,1,1000] do
            IO.println s!"case|controlProposal|{revision}|{sameBasis}|{samePolicy}|{index}|{executions}|{Moment.ctlProposal "p" (toString revision) (if sameBasis then toString revision else if revision == 0 then "1" else "0") "policy" (if samePolicy then "policy" else "other") changes executions}"
  for state in ["proposed","committed","cancelled"] do
    for revision in [0,1,9007199254740991] do
      for sameBasis in [false,true] do
        for samePolicy in [false,true] do
          IO.println s!"case|controlCommit|{state}|{revision}|{sameBasis}|{samePolicy}|{Moment.ctlCommit state (toString revision) (if sameBasis then toString revision else if revision == 0 then "1" else "0") "policy" (if samePolicy then "policy" else "other")}"
  for (changes,index) in ctlChanges.zipIdx do
    for size in List.range 3 do
      for code in List.range (4^size) do
        IO.println s!"case|controlPlan|{index}|{size}|{code}|{Moment.ctlPlan "p" "i" changes (fromCode ctlItems size code)}"
  for present in [false,true] do
    for incident in [false,true] do
      for operator in [false,true] do
        for own in [false,true] do
          for (chain,index) in ctlChains.zipIdx do
            for readable in [false,true] do
              IO.println s!"case|controlVisible|{present}|{incident}|{operator}|{own}|{index}|{readable}|{Moment.ctlVisible present incident operator (if own then "caller" else "other") "caller" "g" chain readable}"
  for size in List.range 3 do
    for code in List.range (6^size) do
      IO.println s!"case|controlNamespace|{size}|{code}|{Moment.ctlNamespace (fromCode ctlNames size code)}"
  for operator in [false,true] do
    for bound in [false,true] do
      for issuer in [false,true] do
        for (chain,index) in ctlChains.zipIdx do
          IO.println s!"case|controlRevoke|{operator}|{bound}|{issuer}|{index}|{Moment.ctlRevoke operator (if bound then "g" else "target") "g" (if issuer then "caller" else "other") "caller" chain}"
  for requested in List.range 4 do
    for installed in List.range 4 do
      for capabilities in List.range 4 do
        IO.println s!"case|controlActions|{requested}|{installed}|{capabilities}|{Moment.ctlActions (chooseMask ["read","write"] requested) (chooseMask ["read","write"] installed) (chooseMask ["read","write"] capabilities)}"
  for name in ["moment.test","user.test"] do
    for installed in [false,true] do
      for actual in [false,true] do
        for present in [false,true] do
          for same in [false,true] do
            IO.println s!"case|controlSchema|{name}|{installed}|{actual}|{present}|{same}|{Moment.ctlSchema name installed "digest" (if actual then "digest" else "other") present (if same then "digest" else "other")}"
  for (names,index) in ctlBindingSamples.zipIdx do
    IO.println s!"case|controlBindings|{index}|{Moment.ctlBindings names}"
  for operator in [false,true] do
    for submitted in [false,true] do
      for bound in [false,true] do
        for same in [false,true] do
          IO.println s!"case|controlBound|{operator}|{submitted}|{bound}|{same}|{Moment.ctlBound operator submitted bound "g" (if same then "g" else "other")}"

  for present in [false,true] do
    for revision in budgetValues do
      for current in budgetValues do
        IO.println s!"case|reactionSource|{present}|{revision}|{current}|{Moment.reactSource present revision current}"
  for visible in [false,true] do
    for kind in ["wanted","other"] do
      for (types,index) in [[],["wanted"],["other"]].zipIdx do
        IO.println s!"case|reactionEvent|{visible}|{kind}|{index}|{Moment.reactEvent visible kind types}"
  for events in [0,1,1000] do
    for requested in [0,1,1000] do
      for types in [0,1,1000] do
        IO.println s!"case|reactionMode|{events}|{requested}|{types}|{Moment.reactMode events requested types}"
  for size in List.range 5 do
    for code in List.range (3^size) do
      let observations := fromCode values size code
      IO.println s!"case|reactionTrace|{size}|{code}|{Moment.reactFinish (observations.foldl Moment.reactObserve (.pending false))}"
  for left in budgetValues do
    for right in budgetValues do
      IO.println s!"case|resourceCompare|{left}|{right}|{Moment.reactCompare left right}"

  for value in budgetValues do
    IO.println s!"case|counterNext|{value}|{budgetLabel (if value < Moment.budgetMaximum then some (value+1) else none)}"
