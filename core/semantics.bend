import Base
import ./execution.bend as Run
import ./topology.bend as Top
import ./accounting.bend as Budget
import ./collections.bend as Text
import ./scheduler.bend as Sched
import ./capability.bend as Cap
import ./policy-query.bend as PQ
import ./control.bend as Control

def execution_step(state: Run.State, action: Run.Action) -> Run.Step:
  Run.step(state, action)

def execution_terminal(state: Run.State) -> Bool:
  Run.terminal(state)

def topology_check(exclusive: Bool, size: U32, edges: +List<Top.Edge>, degree: Array<U32>, next: Array<List<&2, U32>>, parent: Array<U32>, rank: Array<U32>) -> Top.Verdict:
  Top.check(exclusive, size, edges, degree, next, parent, rank)

def topology_certify(edges: +List<Top.Edge>, rank: Array<U32>) -> Top.Verdict:
  Top.certify(edges, rank, True{})

def resource_add(left: Budget.Count, right: Budget.Count) -> Budget.Amount:
  Budget.add(left, right)

def resource_subtract(left: Budget.Count, right: Budget.Count) -> Budget.Amount:
  Budget.subtract(left, right)

def resource_le(left: Budget.Count, right: Budget.Count) -> Bool:
  Budget.le(left, right)

def resource_totals(entries: +List<Budget.Reservation>) -> Budget.Balance:
  Budget.total(entries)

def resource_capacity(balance: Budget.Balance, requested: Budget.Quantities, ceiling: Budget.Quantities) -> Bool:
  Budget.capacity(balance, requested, ceiling)

def resource_usage(previous: Budget.Quantities, usage: Budget.Quantities, ceiling: Budget.Quantities, observed: Bool) -> Bool:
  Budget.usage_allowed(previous, usage, ceiling, observed)

def resource_envelope(requests: +List<Budget.Quantities>, ceiling: Budget.Quantities) -> Bool:
  Budget.envelope(requests, ceiling)

def resource_available(envelopes: +List<Budget.Envelope>) -> Budget.Count:
  Budget.available(envelopes)

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

def text_contains(values: +List<String>, needle: String) -> Bool:
  Text.contains(values, needle)

def text_subset(child: +List<String>, +parent: +List<String>) -> Bool:
  Text.subset(child, parent)

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

def topology_record(kind: String, +schema: String, supports: +List<String>, context: String, perspective: String, framed: Bool, frame: String, child: String, parent: String, earlier: String, later: String) -> Top.Projection:
  Top.project(Bool.and(String.eq(kind, "relation"), text_contains(supports, "asserted")), String.eq(schema, "moment.within"), String.eq(schema, "moment.precedes"), context, perspective, framed, frame, child, parent, earlier, later)

def topology_combine(results: +List<Top.Verdict>) -> Top.Verdict:
  Top.combine(results)

type AccessScope is Data:
  AccessScope{actions: +List<String>, all_incidents: Bool, incidents: +List<String>, resources: +List<String>}

type AccessMode is Data:
  AccessAction{}
  AccessResource{}
  AccessIncident{}
  AccessContext{}

def scope_allows(mode: AccessMode, scope: AccessScope, key: String) -> Bool:
  match mode:
    case AccessAction{}:
      AccessScope{actions, all_incidents, incidents, resources} = scope
      text_contains(actions, key)
    case AccessResource{}:
      AccessScope{actions, all_incidents, incidents, resources} = scope
      text_contains(resources, key)
    case AccessIncident{}:
      AccessScope{actions, all_incidents, incidents, resources} = scope
      Bool.or(all_incidents, text_contains(incidents, key))
    case AccessContext{}:
      AccessScope{actions, all_incidents, incidents, resources} = scope
      Bool.and(all_incidents, text_contains(resources, key))

def scopes_fold(scopes: +List<AccessScope>, +mode: AccessMode, +key: String, accepted: Bool) -> Bool:
  match scopes:
    case Nil{}:
      accepted
    case Con{head, tail}:
      scopes_fold(tail, mode, key, Bool.and(accepted, scope_allows(mode, head, key)))

def scopes_allow(scopes: +List<AccessScope>, +mode: AccessMode, +key: String) -> Bool:
  match scopes:
    case Nil{}:
      False{}
    case Con{head, tail}:
      scopes_fold(tail, mode, key, scope_allows(mode, head, key))

def access_operator(+principal: String, owner: String, context_owner: String, bound: Bool) -> Bool:
  Bool.and(String.eq(principal, owner), Bool.and(String.eq(principal, context_owner), Bool.not(bound)))

def access_resource(operator: Bool, scopes: +List<AccessScope>, key: String) -> Bool:
  Bool.or(operator, scopes_allow(scopes, AccessResource{}, key))

def access_incident(operator: Bool, scopes: +List<AccessScope>, key: String) -> Bool:
  Bool.or(operator, scopes_allow(scopes, AccessIncident{}, key))

type MethodAdmission is Data:
  MethodAllowed{}
  MethodOutsideGrant{}
  MethodSchemaOperator{}
  MethodLimitsOperator{}
  MethodContextWide{}

def method_context(+method: String, scopes: +List<AccessScope>, context: String) -> MethodAdmission:
  wide = Bool.or(String.eq(method, "context.close"), String.eq(method, "policy.activate"))
  Bool.pick(MethodAdmission, Bool.and(wide, Bool.not(scopes_allow(scopes, AccessContext{}, context))), MethodContextWide{}, MethodAllowed{})

def method_delegate(+method: String, scopes: +List<AccessScope>, context: String) -> MethodAdmission:
  Bool.pick(MethodAdmission, String.eq(method, "schema.publish"), MethodSchemaOperator{},
    Bool.pick(MethodAdmission, String.eq(method, "context.limits"), MethodLimitsOperator{}, method_context(method, scopes, context)))

def access_method(operator: Bool, +scopes: +List<AccessScope>, +method: String, context: String) -> MethodAdmission:
  Bool.pick(MethodAdmission, operator, MethodAllowed{},
    Bool.pick(MethodAdmission, scopes_allow(scopes, AccessAction{}, method), method_delegate(method, scopes, context), MethodOutsideGrant{}))

type MutationAdmission is Data:
  MutationAllowed{}
  MutationStale{}
  MutationClosed{}

def mutation_basis(current: String, expected: String, state: String, method: String) -> MutationAdmission:
  Bool.pick(MutationAdmission, String.eq(current, expected),
    Bool.pick(MutationAdmission, Bool.or(String.eq(state, "open"), text_contains(Con{"context.close", Con{"execution.finish", Con{"execution.reconcile", Con{"execution.cancel", Nil{}}}}}, method)), MutationAllowed{}, MutationClosed{}), MutationStale{})

type IncidentState is Data:
  IncidentOpen{}
  IncidentResting{}
  IncidentCompleted{}
  IncidentCancelled{}

def incident_terminal(state: IncidentState) -> Bool:
  match state:
    case IncidentCompleted{}:
      True{}
    case IncidentCancelled{}:
      True{}
    case _:
      False{}

def incident_revisable(old: IncidentState, current: IncidentState) -> Bool:
  Bool.or(Bool.not(incident_terminal(old)), incident_terminal(current))

type IncidentEvidence is Data:
  IncidentEvidenceAllowed{}
  IncidentEvidenceMissing{}
  IncidentCompletionMissing{}

def incident_sources(sources: +List<String>) -> IncidentEvidence:
  match sources:
    case Nil{}:
      IncidentCompletionMissing{}
    case Con{head, tail}:
      IncidentEvidenceAllowed{}

def incident_evidence(state: IncidentState, present: Bool, sources: +List<String>) -> IncidentEvidence:
  match state:
    case IncidentOpen{}:
      IncidentEvidenceAllowed{}
    case IncidentCompleted{}:
      Bool.pick(IncidentEvidence, present, incident_sources(sources), IncidentEvidenceMissing{})
    case _:
      Bool.pick(IncidentEvidence, present, IncidentEvidenceAllowed{}, IncidentEvidenceMissing{})

def query_match(+id: String, schema: String, support: +List<String>, ids_present: Bool, ids: +List<String>, schemas_present: Bool, schemas: +List<String>, +status: String, related_present: Bool, related: +List<String>) -> Bool:
  Bool.and(Bool.or(Bool.not(ids_present), text_contains(ids, id)),
    Bool.and(Bool.or(Bool.not(schemas_present), text_contains(schemas, schema)),
      Bool.and(Bool.or(String.eq(status, "any"), text_contains(support, status)),
        Bool.or(Bool.not(related_present), text_contains(related, id)))))

type QueryRole is Data:
  QueryRole{name: String, members: +List<String>}

def role_connects(roles: +List<QueryRole>, +role_present: Bool, +role: String, +target: String, hit: Bool) -> Bool:
  match roles:
    case Nil{}:
      hit
    case Con{head, tail}:
      QueryRole{name, members} = head
      role_connects(tail, role_present, role, target, Bool.or(hit, Bool.and(Bool.or(Bool.not(role_present), String.eq(name, role)), text_contains(members, target))))

def query_related(kind: String, roles: +List<QueryRole>, role_present: Bool, role: String, target: String) -> Bool:
  Bool.and(String.eq(kind, "relation"), role_connects(roles, role_present, role, target, False{}))

def fence_equal(left: Budget.Count, right: Budget.Count) -> Bool:
  Budget.equal(left, right)

def fence_next(current: Budget.Count) -> Budget.Amount:
  Budget.add(current, Budget.one())

def count_minimum(values: +List<Budget.Count>, +minimum: Budget.Count) -> Budget.Count:
  match values:
    case Nil{}:
      minimum
    case Con{head, tail}:
      +value = head
      count_minimum(tail, Bool.pick(Budget.Count, Budget.le(value, minimum), value, minimum))

type LeaseWindow is Data:
  ClockWindow{deadline: Budget.Count, duration: Budget.Count}
  ClockExpired{}
  ClockUnrepresentable{}

def lease_duration(value: Budget.Amount, deadline: Budget.Count) -> LeaseWindow:
  match value:
    case Budget.BudgetOverflow{}:
      ClockUnrepresentable{}
    case Budget.BudgetFinite{count}:
      ClockWindow{deadline, count}

def lease_positive(expired: Bool, +now: Budget.Count, +deadline: Budget.Count) -> LeaseWindow:
  Bool.pick(LeaseWindow, expired, ClockExpired{}, lease_duration(Budget.subtract(deadline, now), deadline))

def lease_requested(value: Budget.Amount, +now: Budget.Count, bounds: +List<Budget.Count>) -> LeaseWindow:
  match value:
    case Budget.BudgetOverflow{}:
      ClockUnrepresentable{}
    case Budget.BudgetFinite{count}:
      +deadline = count_minimum(bounds, count)
      lease_positive(Budget.le(deadline, now), now, deadline)

def lease_window(+now: Budget.Count, millis: Budget.Count, bounds: +List<Budget.Count>) -> LeaseWindow:
  lease_requested(Budget.add(now, millis), now, bounds)

def calendar_bound(+sum: Budget.Amount, maximum: Budget.Count) -> Budget.Amount:
  Bool.pick(Budget.Amount, Budget.fits(sum, maximum), sum, Budget.BudgetOverflow{})

def calendar_after(anchor: Budget.Count, duration: Budget.Count, maximum: Budget.Count) -> Budget.Amount:
  calendar_bound(Budget.add(anchor, duration), maximum)

def lease_frame(meta_present: Bool, source_boot: String, current_boot: String) -> Bool:
  Bool.and(meta_present, String.eq(source_boot, current_boot))

def lease_expired(present: Bool, meta_present: Bool, source_boot: String, current_boot: String, wall: Rank, wall_deadline: Rank, monotonic: Rank, monotonic_deadline: Rank) -> Bool:
  Bool.and(present, Bool.or(Bool.not(lease_frame(meta_present, source_boot, current_boot)), Bool.or(rank_le(wall_deadline, wall), rank_le(monotonic_deadline, monotonic))))

def lease_valid(present: Bool, holder: String, principal: String, lease_id: String, submitted_id: String, fence: Budget.Count, submitted_fence: Budget.Count, expired: Bool) -> Bool:
  Bool.and(present, Bool.and(String.eq(holder, principal), Bool.and(String.eq(lease_id, submitted_id), Bool.and(Budget.equal(fence, submitted_fence), Bool.not(expired)))))

type RetryAdmission is Data:
  RetryAllowed{}
  RetryCancelled{}
  RetryUnsupported{}

def retry_admission(cancelled: Bool, basis: String, provider: String) -> RetryAdmission:
  Bool.pick(RetryAdmission, cancelled, RetryCancelled{}, Bool.pick(RetryAdmission, Bool.and(String.eq(basis, "idempotent"), Bool.not(String.eq(provider, "idempotent"))), RetryUnsupported{}, RetryAllowed{}))

type Maintenance is Data:
  ClockKeep{}
  ClockLost{}
  ClockCancelDeadline{}
  ClockCancelAuthority{}

def expiry_fold(expiries: +List<Rank>, +now: Rank, hit: Bool) -> Bool:
  match expiries:
    case Nil{}:
      hit
    case Con{head, tail}:
      expiry_fold(tail, now, Bool.or(hit, rank_le(head, now)))

def queued_maintenance(state: Run.State, capability_expired: Bool, grant_expired: Bool) -> Maintenance:
  match state:
    case Run.RunQueued{}:
      Bool.pick(Maintenance, Bool.or(capability_expired, grant_expired), ClockCancelAuthority{}, ClockKeep{})
    case _:
      ClockKeep{}

def execution_maintenance(+state: Run.State, expired: Bool, deadline_present: Bool, deadline: Rank, +now: Rank, capability_expiry: Rank, grant_expiries: +List<Rank>) -> Maintenance:
  Bool.pick(Maintenance, Run.terminal(state), ClockKeep{}, Bool.pick(Maintenance, expired, ClockLost{},
    Bool.pick(Maintenance, Bool.and(deadline_present, rank_le(deadline, now)), ClockCancelDeadline{},
      queued_maintenance(state, rank_le(capability_expiry, now), expiry_fold(grant_expiries, now, False{})))))

def marker_present(values: +List<String>) -> Bool:
  match values:
    case Nil{}:
      False{}
    case Con{head, tail}:
      True{}

def overrun_fold(markers: +List<+List<String>>, hit: Bool) -> Bool:
  match markers:
    case Nil{}:
      hit
    case Con{head, tail}:
      overrun_fold(tail, Bool.or(hit, marker_present(head)))

def resource_blocked(markers: +List<+List<String>>) -> Bool:
  overrun_fold(markers, False{})

def resource_single_slot(value: Budget.Count) -> Bool:
  Budget.equal(value, Budget.one())

def execution_queued(state: Run.State) -> Bool:
  match state:
    case Run.RunQueued{}:
      True{}
    case _:
      False{}

def execution_waits_deadline(state: Run.State, cancelled: Bool) -> Bool:
  Bool.and(Bool.not(Run.terminal(state)), Bool.not(cancelled))

type ClockCandidate is Data:
  ClockCandidate{index: U32, value: Rank}

type ClockDelay is Data:
  ClockIdle{}
  ClockImmediate{}
  ClockSelected{index: U32}

def delay_finish(candidate: ClockCandidate, zero: Rank) -> ClockDelay:
  ClockCandidate{index, value} = candidate
  Bool.pick(ClockDelay, rank_le(value, zero), ClockImmediate{}, ClockSelected{index})

def delay_fold(values: +List<ClockCandidate>, +minimum: ClockCandidate, zero: Rank) -> ClockDelay:
  match values:
    case Nil{}:
      delay_finish(minimum, zero)
    case Con{head, tail}:
      ClockCandidate{index, +value} = head
      ClockCandidate{old_index, +old_value} = minimum
      delay_fold(tail, Bool.pick(ClockCandidate, rank_le(value, old_value), ClockCandidate{index, value}, ClockCandidate{old_index, old_value}), zero)

def clock_delay(values: +List<ClockCandidate>, zero: Rank) -> ClockDelay:
  match values:
    case Nil{}:
      ClockIdle{}
    case Con{head, tail}:
      delay_fold(tail, head, zero)

def schedule_room(count: U32) -> Bool:
  Sched.room(count)

def schedule_visible(present: Bool, incident: Bool, operator: Bool, readable: Bool, creator: String, principal: String, grant: String, chain: +List<String>) -> Bool:
  Sched.visible(present, incident, operator, readable, creator, principal, grant, chain)

def schedule_needs_events(wake: Sched.Wake) -> Bool:
  Sched.needs_events(wake)

def schedule_baseline(wake: Sched.Wake, edge: Bool) -> Bool:
  Sched.baseline(wake, edge)

def schedule_wake_admission(wake: Sched.Wake, once: Bool, resource: String) -> Sched.WakeAdmission:
  Sched.wake_admission(wake, once, resource)

def schedule_scan(facts: Sched.Facts, context: String, ended: Bool, activity: Budget.Count) -> Sched.Scan:
  Sched.scan(facts, context, ended, activity)

def schedule_mode(wake: Sched.Wake, facts: Sched.Facts, activity: Budget.Count, present: Bool, due: Budget.Count, now: Budget.Count) -> Sched.Mode:
  Sched.mode(wake, facts, activity, present, due, now)

def schedule_selection(has_ids: Bool, ids: +List<String>, event_present: Bool, subjects: +List<String>) -> Sched.Selection:
  Sched.selection(has_ids, ids, event_present, subjects)

def schedule_event_gate(previous: Budget.Count, sequence: Budget.Count, activity: Budget.Count, kind: String, types: +List<String>) -> Sched.EventGate:
  Sched.event_gate(previous, sequence, activity, kind, types)

def schedule_observation(each: Bool, edge: Bool, selected: Bool) -> Sched.Observation:
  Sched.observation(each, edge, selected)

def schedule_queue(pending: U32, coalesce: Bool, previous: +List<String>, incoming: +List<String>) -> Sched.Queue:
  Sched.queue(pending, coalesce, previous, incoming)

def schedule_order(sequence: Budget.Count, emitted: Budget.Count) -> Budget.Amount:
  Sched.occurrence_order(sequence, emitted)

def schedule_advance(previous: Budget.Count, sequence: Budget.Count, activity: Budget.Count, old_edge: Bool, next_edge: Bool, fired: Bool, enqueued: Bool, pending: Bool, once: Bool) -> Sched.Advance:
  Sched.advance(previous, sequence, activity, old_edge, next_edge, fired, enqueued, pending, once)

def schedule_capacity_edge(old: Bool, available: Bool, accepted: Bool) -> Bool:
  Sched.capacity_edge(old, available, accepted)

def schedule_matches(life: Sched.Life, present: Bool, expected: String, current: String) -> Bool:
  Sched.matches(life, present, expected, current)

def schedule_completed(once: Bool) -> Sched.Life:
  Sched.completed(once)

def schedule_cancellable(life: Sched.Life) -> Bool:
  Sched.cancellable(life)

def schedule_retry_fault(code: String) -> Bool:
  Sched.retry_fault(code)

def schedule_watch(facts: Sched.Facts, activity: Budget.Count, present: Bool) -> Bool:
  Sched.watch(facts, activity, present)

def schedule_ready(facts: Sched.Facts, activity: Budget.Count, coalesce: Bool, last_sources: U32) -> Bool:
  Sched.ready(facts, activity, coalesce, last_sources)

def schedule_choose(has_last: Bool, last: String, candidates: +List<Sched.Candidate>, activity: Budget.Count) -> Sched.Choice:
  Sched.choose(has_last, last, candidates, activity)

def schedule_causality(root: String) -> Sched.Causality:
  Sched.causality(root)

def schedule_causal_demand(state: Sched.Causality) -> Sched.Demand:
  Sched.demand(state)

def schedule_causal_step(state: Sched.Causality, event: Sched.CauseEvent, context: String, schedule: String) -> Sched.CausalStep:
  Sched.step(state, event, context, schedule)

def capability_basis(advertisement: Cap.Advertisement, requirement: Cap.Requirement, scopes: +List<Cap.Scope>, expiry: Rank, now: Rank, incident_present: Bool) -> Cap.Assessment:
  Cap.basis(advertisement, requirement, scopes, rank_le(expiry, now), incident_present)

def capability_finish(assessment: Cap.Assessment, policy: Cap.PolicyObservation) -> Cap.Assessment:
  Cap.finish(assessment, policy)

def capability_compare(left: Cap.Eligibility, left_count: U32, left_id: String, right: Cap.Eligibility, right_count: U32, right_id: String) -> Cmp:
  Cap.compare(left, left_count, left_id, right, right_count, right_id)

def capability_publish(advertisement: Cap.Advertisement, principal: String, methods: +List<String>, count: U32, expiry: Rank, now: Rank) -> Cap.Publication:
  Cap.publish(advertisement, principal, methods, count, rank_le(expiry, now))

def execution_room(count: U32) -> Bool:
  Cap.room(count)

def execution_admission(expiry: Rank, now: Rank, context: String, incident_present: Bool, incident: IncidentState) -> Cap.ExecutionAdmission:
  Cap.execution_admission(rank_le(expiry, now), context, incident_present, incident_terminal(incident))

def execution_deadline(present: Bool, expiry: Rank, now: Rank) -> Bool:
  Bool.or(Bool.not(present), Bool.not(rank_le(expiry, now)))

def execution_prepare(incident: Bool, capability: Bool, operator: Bool, actor: String, requester: String, submitted: String, bound: String, readable: Bool) -> Cap.Preparation:
  Cap.prepare(incident, capability, operator, actor, requester, submitted, bound, readable)

def execution_visible(present: Bool, origin_present: Bool, incident: Bool, operator: Bool, principal: String, requester: String, provider: String, first_grant: String, chain: +List<String>, capability: Bool, readable: Bool) -> Bool:
  Cap.visible(present, origin_present, incident, operator, principal, requester, provider, first_grant, chain, capability, readable)

def execution_reconcile(principal: String, provider: String, operator: Bool, readable: Bool) -> Bool:
  Cap.reconcile(principal, provider, operator, readable)

def execution_evidence(required: Bool, sources: +List<String>) -> Bool:
  Cap.evidence(required, sources)

def capability_selected(advertised: String, requested: String, readable: Bool) -> Bool:
  Cap.selected(advertised, requested, readable)

def policy_query_initial(records: U32, assertions: U32) -> PQ.Budget:
  PQ.initial(records, assertions)

def policy_query_available(budget: PQ.Budget) -> Bool:
  PQ.available(budget)

def policy_query_charges(costs: +List<U32>, budget: PQ.Budget) -> PQ.Budget:
  PQ.charges(costs, budget)

def policy_query_projection(assertions: +List<PQ.Assertion>, system: String, context: String, issuers: +List<String>, budget: PQ.Budget) -> PQ.Projection:
  PQ.project(assertions, system, context, issuers, budget)

def policy_query_supported(status: String, sources: +List<Bool>) -> Bool:
  PQ.supported(status, sources)

def policy_query_selected(kind: String, schema: String, names: +List<String>, readable: Bool, asserted: Bool) -> Bool:
  PQ.selected(kind, schema, names, readable, asserted)

def policy_query_observed(found: Bool, operator: Bool) -> PQ.Verdict:
  PQ.observed(found, operator)

def policy_query_plan(headers: +List<PQ.Header>, budget: PQ.Budget) -> PQ.Plan:
  PQ.plan(headers, budget)

def policy_query_related(edges: +List<PQ.Edge>, start: String, destination: String, hops: Nat, operator: Bool, budget: PQ.Budget) -> PQ.Search:
  PQ.related(edges, start, destination, hops, operator, budget)

def policy_query_exists_budget(budget: PQ.Budget, records: U32, assertions: U32, provenance: U32, +roles: +List<U32>) -> PQ.Budget:
  PQ.charges(roles, PQ.charges(roles, PQ.charge(PQ.charge(PQ.charge(PQ.charge(budget, records), assertions), provenance), 1)))

def control_projection(count: U32, paths: +List<Control.Path>, schema: Bool) -> Control.Projection:
  Control.projection(count, paths, schema)

def control_proposal(id: String, basis: String, expected: String, policy: String, current: String, changes: +List<Control.Change>, executions: U32) -> Control.Proposal:
  Control.proposal(id, basis, expected, policy, current, changes, executions)

def control_commit(state: String, recorded: String, current: String, policy: String, selected: String) -> Control.Commit:
  Control.commit(state, recorded, current, policy, selected)

def control_plan(id: String, incident: String, changes: +List<Control.Change>, items: +List<Control.ExecutionItem>) -> Control.Plan:
  Control.plan(id, incident, changes, items)

def control_visible(present: Bool, incident: Bool, operator: Bool, origin: String, principal: String, grant: String, chain: +List<String>, readable: Bool) -> Bool:
  Control.visible(present, incident, operator, origin, principal, grant, chain, readable)

def control_namespace(names: +List<String>) -> Bool:
  Control.namespace(names)

def control_revoke(operator: Bool, target: String, bound: String, issuer: String, principal: String, chain: +List<String>) -> Bool:
  Control.revoke(operator, target, bound, issuer, principal, chain)

def control_actions(requested: +List<String>, installed: +List<String>, capabilities: +List<String>) -> Bool:
  Control.actions(requested, installed, capabilities)

def control_schema(name: String, installed: Bool, submitted: String, actual: String, present: Bool, previous: String) -> Control.SchemaAdmission:
  Control.schema(name, installed, submitted, actual, present, previous)

def control_bindings(names: +List<String>) -> Bool:
  Control.binding_names(names)

def control_bound(operator: Bool, submitted_present: Bool, bound_present: Bool, submitted: String, bound: String) -> Bool:
  Bool.or(operator, Bool.and(Bool.and(submitted_present, bound_present), String.eq(submitted, bound)))

def control_projection_room(count: U32) -> Bool:
  Control.projection_room(count)
