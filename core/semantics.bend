import Base
import ./execution.bend as Run

def execution_step(state: Run.State, action: Run.Action) -> Run.Step:
  Run.step(state, action)

def execution_terminal(state: Run.State) -> Bool:
  Run.terminal(state)

# These values describe observations. Authority is a separate decision.
type Truth is Data:
  Yes{}
  No{}
  Unknown{}

type Decision is Data:
  Permit{}
  Deny{}
  Indeterminate{}

def truth.not(value: Truth) -> Truth:
  match value:
    case Yes{}:
      No{}
    case No{}:
      Yes{}
    case Unknown{}:
      Unknown{}

def truth.and(left: Truth, right: Truth) -> Truth:
  match left:
    case No{}:
      No{}
    case Yes{}:
      right
    case Unknown{}:
      match right:
        case No{}:
          No{}
        case Yes{}:
          Unknown{}
        case Unknown{}:
          Unknown{}

def truth.or(left: Truth, right: Truth) -> Truth:
  match left:
    case Yes{}:
      Yes{}
    case No{}:
      right
    case Unknown{}:
      match right:
        case Yes{}:
          Yes{}
        case No{}:
          Unknown{}
        case Unknown{}:
          Unknown{}

def truth.all(values: +List<Truth>) -> Truth:
  match values:
    case Nil{}:
      Yes{}
    case Con{head, tail}:
      truth.and(head, truth.all(tail))

def truth.any(values: +List<Truth>) -> Truth:
  match values:
    case Nil{}:
      No{}
    case Con{head, tail}:
      truth.or(head, truth.any(tail))

def policy.combine(denies: Truth, permits: Truth) -> Decision:
  match denies:
    case Yes{}:
      Deny{}
    case Unknown{}:
      Indeterminate{}
    case No{}:
      match permits:
        case Yes{}:
          Permit{}
        case No{}:
          Deny{}
        case Unknown{}:
          Indeterminate{}

def policy(denies: +List<Truth>, permits: +List<Truth>) -> Decision:
  policy.combine(truth.any(denies), truth.any(permits))

# Native codecs supply exact canonical strings and finite binary64 order keys.
def same_text(left: String, right: String) -> Bool:
  String.eq(left, right)

def same_scope(asys: String, actx: String, bsys: String, bctx: String) -> Bool:
  Bool.and(String.eq(asys, bsys), String.eq(actx, bctx))

def same_ref(asys: String, actx: String, aid: String, bsys: String, bctx: String, bid: String) -> Bool:
  Bool.and(same_scope(asys, actx, bsys, bctx), String.eq(aid, bid))

def text_contains(values: +List<String>, +needle: String) -> Bool:
  match values:
    case Nil{}:
      False{}
    case Con{head, tail}:
      Bool.or(String.eq(head, needle), text_contains(tail, needle))

def text_subset(child: +List<String>, +parent: +List<String>) -> Bool:
  match child:
    case Nil{}:
      True{}
    case Con{head, tail}:
      Bool.and(text_contains(parent, head), text_subset(tail, parent))

def incident_scope(parent_all: Bool, child_all: Bool, child: +List<String>, parent: +List<String>) -> Bool:
  match parent_all:
    case True{}:
      True{}
    case False{}:
      match child_all:
        case True{}:
          False{}
        case False{}:
          text_subset(child, parent)

type Rank is Data:
  Rank{high: U32, low: U32}

def ordered_le(+left_high: U32, left_low: U32, +right_high: U32, right_low: U32) -> Bool:
  Bool.or(U32.is_lt(left_high, right_high), Bool.and(U32.is_eq(left_high, right_high), U32.is_le(left_low, right_low)))

def rank_le(left: Rank, right: Rank) -> Bool:
  Rank{ah, al} = left
  Rank{bh, bl} = right
  ordered_le(ah, al, bh, bl)

def deadline(parent_present: Bool, child_present: Bool, child: Rank, parent: Rank) -> Bool:
  match parent_present:
    case False{}:
      True{}
    case True{}:
      Bool.and(child_present, rank_le(child, parent))

def within(visited: Nat, depth: Nat, nodes: Nat, maximum_depth: Nat) -> Bool:
  Bool.and(Nat.is_le(visited, nodes), Nat.is_le(depth, maximum_depth))

def fits(child: +List<Rank>, parent: +List<Rank>) -> Bool:
  match child:
    case Nil{}:
      match parent:
        case Nil{}:
          True{}
        case Con{head, tail}:
          False{}
    case Con{head, tail}:
      match parent:
        case Nil{}:
          False{}
        case Con{limit, rest}:
          Bool.and(rank_le(head, limit), fits(tail, rest))

type Support is Data:
  Absent{}
  Asserted{}
  Withdrawn{}

type Edit is Data:
  Insert{}
  Keep{}
  Missing{}
  Conflict{}
  Withdraw{}

def record_edit(exists: Bool, same_digest: Bool) -> Edit:
  match exists:
    case False{}:
      Insert{}
    case True{}:
      match same_digest:
        case True{}:
          Keep{}
        case False{}:
          Conflict{}

def assertion_edit(local_record: Bool, same_digest: Bool, support: Support) -> Edit:
  match local_record:
    case False{}:
      Missing{}
    case True{}:
      match support:
        case Absent{}:
          Insert{}
        case Withdrawn{}:
          Conflict{}
        case Asserted{}:
          record_edit(True{}, same_digest)

def assertion_withdraw(support: Support) -> Edit:
  match support:
    case Absent{}:
      Missing{}
    case Asserted{}:
      Withdraw{}
    case Withdrawn{}:
      Keep{}

# Native storage supplies observations; the core owns the admission order.
type GraphIndex is Data:
  GraphIndex{index: Nat, record: Bool}

def graph_phase(changes: +List<GraphIndex>, +records: Bool) -> List<&2, Nat>:
  match changes:
    case Nil{}:
      Nil{}
    case Con{head, tail}:
      GraphIndex{index, record} = head
      rest = graph_phase(tail, records)
      List.filter.put(Nat, index, rest, Bool.not(Bool.xor(record, records)))

def graph_order(+changes: +List<GraphIndex>) -> List<&2, Nat>:
  List.append(&2, Nat, graph_phase(changes, True{}), graph_phase(changes, False{}))

type GrantDecision is Data:
  GrantLink{}
  InvalidChain{}
  UnavailableGrant{}
  WrongPrincipal{}
  EmptyChain{}

def grant_available(present: Bool, revoked: Bool, expiry_present: Bool, expiry: Rank, now: Rank) -> Bool:
  Bool.and(present, Bool.and(Bool.not(revoked), Bool.not(Bool.and(expiry_present, rank_le(expiry, now)))))

def grant_link(+system: String, +context: String, ref_system: String, ref_context: String, +ref_id: String, +seen: +List<String>, present: Bool, revoked: Bool, expiry_present: Bool, expiry: Rank, now: Rank, bound_principal: String, grant_principal: String) -> GrantDecision:
  valid_scope = same_scope(system, context, ref_system, ref_context)
  repeated = text_contains(seen, ref_id)
  depth_ok = Nat.is_lt(List.length(&2, String, seen), 32n)
  Bool.pick(GrantDecision,
    Bool.and(valid_scope, Bool.and(Bool.not(repeated), depth_ok)),
    Bool.pick(GrantDecision,
      grant_available(present, revoked, expiry_present, expiry, now),
      Bool.pick(GrantDecision,
        Bool.or(Bool.not(List.is_empty(&2, String, seen)), String.eq(bound_principal, grant_principal)),
        GrantLink{}, WrongPrincipal{}),
      UnavailableGrant{}),
    InvalidChain{})

def grant_end(seen: +List<String>) -> GrantDecision:
  match seen:
    case Nil{}:
      EmptyChain{}
    case Con{head, tail}:
      GrantLink{}

type BoundDecision is Data:
  Bounded{}
  CurrencyMismatch{}
  BudgetExceeded{}
  DeadlineExceeded{}
  ActionsWidened{}
  IncidentsWidened{}
  ResourcesWidened{}
  LifetimeWidened{}
  NotDelegable{}

def limits_bound(child_currency: String, parent_currency: String, child: +List<Rank>, parent: +List<Rank>, parent_deadline: Bool, child_deadline: Bool, child_at: Rank, parent_at: Rank) -> BoundDecision:
  Bool.pick(BoundDecision, String.eq(child_currency, parent_currency),
    Bool.pick(BoundDecision, fits(child, parent),
      Bool.pick(BoundDecision, deadline(parent_deadline, child_deadline, child_at, parent_at),
        Bounded{}, DeadlineExceeded{}),
      BudgetExceeded{}),
    CurrencyMismatch{})

def delegation_bound(child_actions: +List<String>, parent_actions: +List<String>, parent_all: Bool, child_all: Bool, child_incidents: +List<String>, parent_incidents: +List<String>, child_resources: +List<String>, parent_resources: +List<String>, parent_expiry: Bool, child_expiry: Bool, child_at: Rank, parent_at: Rank, delegable: Bool) -> BoundDecision:
  Bool.pick(BoundDecision, text_subset(child_actions, parent_actions),
    Bool.pick(BoundDecision, incident_scope(parent_all, child_all, child_incidents, parent_incidents),
      Bool.pick(BoundDecision, text_subset(child_resources, parent_resources),
        Bool.pick(BoundDecision, deadline(parent_expiry, child_expiry, child_at, parent_at),
          Bool.pick(BoundDecision, delegable, Bounded{}, NotDelegable{}), LifetimeWidened{}),
        ResourcesWidened{}),
      IncidentsWidened{}),
    ActionsWidened{})

type PolicyRule is Data:
  PolicyRule{permit: Bool, identity: String, condition: String, actions: List<&2, String>}

def rule_contains(rules: +List<PolicyRule>, +identity: String) -> Bool:
  match rules:
    case Nil{}:
      False{}
    case Con{head, tail}:
      PolicyRule{permit, key, condition, actions} = head
      Bool.or(String.eq(key, identity), rule_contains(tail, identity))

def denies_preserved(current: +List<PolicyRule>, +candidate: +List<PolicyRule>) -> Bool:
  match current:
    case Nil{}:
      True{}
    case Con{head, tail}:
      PolicyRule{permit, identity, condition, actions} = head
      Bool.and(Bool.or(permit, rule_contains(candidate, identity)), denies_preserved(tail, candidate))

def permit_narrowed(current: +List<PolicyRule>, +condition: String, +actions: +List<String>) -> Bool:
  match current:
    case Nil{}:
      False{}
    case Con{head, tail}:
      PolicyRule{permit, identity, when, old_actions} = head
      Bool.or(Bool.and(permit, Bool.and(String.eq(when, condition), text_subset(actions, old_actions))), permit_narrowed(tail, condition, actions))

type PolicyBound is Data:
  PolicyBounded{}
  IssuersChanged{}
  DenyRemoved{}
  GrantExceeded{}
  PermitWidened{}

def policy_issuers(+child: +List<String>, +parent: +List<String>) -> PolicyBound:
  Bool.pick(PolicyBound, Bool.and(text_subset(child, parent), text_subset(parent, child)), PolicyBounded{}, IssuersChanged{})

def permits_bounded(candidate: +List<PolicyRule>, +current: +List<PolicyRule>, +grant: +List<String>) -> PolicyBound:
  match candidate:
    case Nil{}:
      PolicyBounded{}
    case Con{head, tail}:
      PolicyRule{permit, identity, condition, actions} = head
      +bounded_actions = actions
      +next = permits_bounded(tail, current, grant)
      Bool.pick(PolicyBound, permit,
        Bool.pick(PolicyBound, text_subset(bounded_actions, grant),
          Bool.pick(PolicyBound, permit_narrowed(current, condition, bounded_actions), next, PermitWidened{}),
          GrantExceeded{}), next)

def policy_rules(+candidate: +List<PolicyRule>, +current: +List<PolicyRule>, grant: +List<String>) -> PolicyBound:
  Bool.pick(PolicyBound, denies_preserved(current, candidate), permits_bounded(candidate, current, grant), DenyRemoved{})
