import Base
import ./accounting.bend as Budget
import ./collections.bend as Text

# Domain policy. Native path codecs supply normalized components; both native
# controller and physical adapter consume this one component projection.
def protected_parts() -> +List<String>:
  Con{"state", Con{"recipient-state", Con{"recovery", Con{"runtime", Con{"retention", Con{"storage-minimization", Con{"world", Con{"worlds", Con{"saves", Con{"backups", Con{"lods", Nil{}}}}}}}}}}}}

def protected_kind(kind: String) -> Bool:
  Text.contains(Con{"authored", Con{"world", Con{"state", Con{"recovery", Con{"private", Nil{}}}}}}, kind)

def protection(kind: String, pins: Budget.Count) -> Bool:
  Bool.or(protected_kind(kind), Bool.not(Budget.equal(pins, Budget.zero())))

def protected_path(parts: +List<String>) -> Bool:
  Bool.not(List.is_empty(&2, String, Text.intersection(parts, protected_parts())))

def local_representation(kind: String) -> Bool:
  Text.contains(Con{"present", Con{"exact-shared", Nil{}}}, kind)

def protected_availability(kind: String, availability: String) -> Bool:
  Bool.or(Bool.not(protected_kind(kind)), String.eq(availability, "present"))

def observation(+kind: String, present: Bool, archive: Bool) -> String:
  Bool.pick(String, present, Bool.pick(String, String.eq(kind, "intentionally-retired"), "unexpectedly-present", "present-unverified"),
    Bool.pick(String, Bool.and(String.eq(kind, "packed"), archive), "materialization-required", "absent"))

type Payload is Data:
  CapturePayload{id: String, kind: String, availability: String, digest: String, bytes: Budget.Count, pins: Budget.Count, parts: +List<String>}

type Candidate is Data:
  CaptureCandidateReady{}
  CaptureCandidateProtected{}
  CaptureCandidateAbsent{}
  CaptureCandidateDifferent{}
  CaptureCandidateBudget{}

def protected_payload(+kind: String, pins: Budget.Count, parts: +List<String>, allowed: +List<String>) -> Bool:
  Bool.or(Bool.not(Text.contains(allowed, kind)), Bool.or(protection(kind, pins), protected_path(parts)))

def candidate(source: Payload, target: Payload, +allowed: +List<String>, used: Budget.Amount, maximum: Budget.Count) -> Candidate:
  CapturePayload{a, ak, av, ad, ab, ap, ax} = source
  CapturePayload{b, bk, bv, bd, +bb, bp, bx} = target
  Bool.pick(Candidate, Bool.or(String.eq(a, b), Bool.or(protected_payload(ak, ap, ax, allowed), protected_payload(bk, bp, bx, allowed))), CaptureCandidateProtected{},
    Bool.pick(Candidate, Bool.not(Bool.and(local_representation(av), local_representation(bv))), CaptureCandidateAbsent{},
      Bool.pick(Candidate, Bool.not(Bool.and(String.eq(ad, bd), Budget.equal(ab, bb))), CaptureCandidateDifferent{},
        Bool.pick(Candidate, Budget.fits(Budget.accumulate(used, bb), maximum), CaptureCandidateReady{}, CaptureCandidateBudget{}))))

type ObservedFile is Data:
  CaptureFile{digest: String, bytes: Budget.Count, mode: U32, uid: Budget.Count, gid: Budget.Count, flags: U32, attrs: String}

type ObservedPair is Data:
  CapturePairReady{}
  CapturePairBytes{}
  CapturePairMetadata{}
  CapturePairExecutable{}

def observed_pair(source: Payload, target: Payload, a: ObservedFile, b: ObservedFile) -> ObservedPair:
  CapturePayload{_, _, _, sd, sb, _, _} = source
  CapturePayload{_, _, _, td, tb, _, _} = target
  CaptureFile{ad, ab, +am, au, ag, af, ax} = a
  CaptureFile{bd, bb, +bm, bu, bg, bf, bx} = b
  Bool.pick(ObservedPair, Bool.not(Bool.and(String.eq(sd, ad), Bool.and(String.eq(td, bd), Bool.and(Budget.equal(sb, ab), Budget.equal(tb, bb))))), CapturePairBytes{},
    Bool.pick(ObservedPair, Bool.not(Bool.and(U32.is_eq(am, bm), Bool.and(Budget.equal(au, bu), Bool.and(Budget.equal(ag, bg), Bool.and(U32.is_eq(af, bf), String.eq(ax, bx)))))), CapturePairMetadata{},
      Bool.pick(ObservedPair, U32.is_zero(U32.and(U32.or(am, bm), 73)), CapturePairReady{}, CapturePairExecutable{})))

def distinct_fold(values: +List<String>, +seen: +List<String>, accepted: Bool) -> Bool:
  match values:
    case Nil{}:
      accepted
    case Con{+head, tail}:
      distinct_fold(tail, Con{head, seen}, Bool.and(accepted, Bool.not(Text.contains(seen, head))))

def targets(+count: Budget.Count, maximum: Budget.Count, ids: +List<String>) -> Bool:
  Bool.and(Bool.not(Budget.equal(count, Budget.zero())), Bool.and(Budget.le(count, maximum), distinct_fold(ids, Nil{}, True{})))

def survivors(sources: +List<String>, targets: +List<String>) -> Bool:
  List.is_empty(&2, String, Text.intersection(sources, targets))

def capacity(count: Budget.Count, maximum_count: Budget.Count, bytes: Budget.Amount, maximum_bytes: Budget.Count) -> Bool:
  Bool.and(Budget.le(count, maximum_count), Budget.fits(bytes, maximum_bytes))

# Full system identity and scope sort precede grouping. Native grouping is an
# index over this structured key, never another project/context policy.
type Group is Data:
  CaptureRunGroup{system: String, project: Bool, scope: String, tree_present: Bool, tree: String, category: String}

def group(system: String, context: String, +project_present: Bool, project: String, tree_present: Bool, tree: String, category: String) -> Group:
  CaptureRunGroup{system, project_present, Bool.pick(String, project_present, project, context), tree_present, tree, category}

def run_compare(+a: Budget.Count, ai: String, +b: Budget.Count, bi: String) -> Cmp:
  Bool.pick(Cmp, Budget.equal(a, b), String.order(ai, bi), Bool.pick(Cmp, Budget.le(a, b), GT{}, LT{}))

def id_compare(a: String, b: String) -> Cmp:
  String.order(a, b)

type Inputs is Data:
  CaptureInputsReady{}
  CaptureInputsDuplicate{}
  CaptureInputsUnknown{}

def inputs(count: Budget.Count, unique: Budget.Count, states: +List<String>) -> Inputs:
  Bool.pick(Inputs, Budget.equal(count, unique),
    Bool.pick(Inputs, Text.subset(states, Con{"active", Con{"completed", Con{"cancelled", Nil{}}}}), CaptureInputsReady{}, CaptureInputsUnknown{}), CaptureInputsDuplicate{})

type Run is Data:
  CaptureRun{id: String, state: String, current: Bool, pins: Budget.Count}

def active(state: String, current: Bool) -> Bool:
  Bool.or(current, String.eq(state, "active"))

def active_fold(runs: +List<Run>, found: Bool) -> Bool:
  match runs:
    case Nil{}:
      found
    case Con{CaptureRun{_, state, current, _}, tail}:
      active_fold(tail, Bool.or(found, active(state, current)))

def group_fold(runs: +List<Run>, +has_active: Bool, +seen: U32, +selected: +List<String>) -> +List<String>:
  match runs:
    case Nil{}:
      List.reverse(&2, String, selected)
    case Con{CaptureRun{id, +state, current, pins}, tail}:
      +completed = String.eq(state, "completed")
      +room = U32.is_lt(seen, 2)
      +keep = Bool.or(Bool.not(Budget.equal(pins, Budget.zero())), Bool.pick(Bool, has_active, active(state, current), Bool.and(completed, room)))
      group_fold(tail, has_active, Bool.pick(U32, Bool.and(completed, room), U32.add(seen, 1), seen), Bool.pick(+List<String>, keep, Con{id, selected}, selected))

def select_group(+runs: +List<Run>) -> +List<String>:
  group_fold(runs, active_fold(runs, False{}), 0, Nil{})

# The core requests each dependency observation and admits each identity once.
# The caller supplies a complete immutable finite frontier and its exact size.
type DependencyState is Data:
  CaptureDepsWalking{todo: +List<String>, selected: +List<String>, fuel: Budget.Count}
  CaptureDepsMissingState{id: String}
  CaptureDepsExhaustedState{}

type DependencyDemand is Data:
  CaptureDepsReady{ids: +List<String>}
  CaptureDepsRequest{id: String, tail: +List<String>, selected: +List<String>, fuel: Budget.Count}
  CaptureDepsFailure{reason: String, id: String}

def dependency_start(+ids: +List<String>, size: Budget.Count) -> DependencyState:
  CaptureDepsWalking{ids, ids, size}

def dependency_walk(todo: +List<String>, selected: +List<String>, +fuel: Budget.Count) -> DependencyDemand:
  match todo:
    case Nil{}:
      CaptureDepsReady{selected}
    case Con{+head, tail}:
      Bool.pick(DependencyDemand, Budget.equal(fuel, Budget.zero()), CaptureDepsFailure{"exhausted", head}, CaptureDepsRequest{head, tail, selected, fuel})

def dependency_demand(state: DependencyState) -> DependencyDemand:
  match state:
    case CaptureDepsWalking{todo, selected, fuel}:
      dependency_walk(todo, selected, fuel)
    case CaptureDepsMissingState{id}:
      CaptureDepsFailure{"missing", id}
    case CaptureDepsExhaustedState{}:
      CaptureDepsFailure{"exhausted", ""}

def dependency_join(added: +List<String>, tail: +List<String>, selected: +List<String>, fuel: Budget.Count) -> DependencyState:
  match added:
    case Nil{}:
      CaptureDepsWalking{tail, selected, fuel}
    case Con{head, rest}:
      +values: +List<String> = Con{head, rest}
      CaptureDepsWalking{List.append(&2, String, tail, values), List.append(&2, String, selected, values), fuel}

def dependency_advance(tail: +List<String>, +selected: +List<String>, dependencies: +List<String>, remaining: Budget.Amount) -> DependencyState:
  match remaining:
    case Budget.BudgetOverflow{}:
      CaptureDepsExhaustedState{}
    case Budget.BudgetFinite{fuel}:
      +unique = Text.union(Nil{}, dependencies)
      +added = List.reverse(&2, String, Text.unseen_fold(unique, selected, Nil{}))
      dependency_join(added, tail, selected, fuel)

def dependency_observe(request: DependencyDemand, present: Bool, dependencies: +List<String>) -> DependencyState:
  match request:
    case CaptureDepsRequest{+id, tail, selected, fuel}:
      Bool.pick(DependencyState, present, dependency_advance(tail, selected, dependencies, Budget.subtract(fuel, Budget.one())), CaptureDepsMissingState{id})
    case CaptureDepsReady{ids}:
      CaptureDepsWalking{Nil{}, ids, Budget.zero()}
    case CaptureDepsFailure{reason, id}:
      CaptureDepsMissingState{id}

type Generation is Data:
  CaptureGenerationReady{}
  CaptureGenerationStale{}
  CaptureGenerationExhausted{}

def generation_finish(next: Budget.Amount, generation: Budget.Count, previous_present: Bool, previous: String, head_present: Bool, head_digest: String) -> Generation:
  match next:
    case Budget.BudgetOverflow{}:
      CaptureGenerationExhausted{}
    case Budget.BudgetFinite{count}:
      Bool.pick(Generation, Bool.and(Budget.equal(count, generation), Bool.and(Bool.not(Bool.xor(previous_present, head_present)), String.eq(previous, head_digest))), CaptureGenerationReady{}, CaptureGenerationStale{})

def generation(generation: Budget.Count, previous_present: Bool, previous: String, head_present: Bool, head: Budget.Count, head_digest: String) -> Generation:
  generation_finish(Budget.add(head, Budget.one()), generation, previous_present, previous, head_present, head_digest)

def pointer(current: String, before: String, digest: String, published: String) -> Bool:
  Bool.or(String.eq(current, before), String.eq(digest, published))

type Receipt is Data:
  CaptureReceiptReplay{}
  CaptureReceiptUnknown{}
  CaptureReceiptRefused{}
  CaptureReceiptUnsupported{}
  CaptureReceiptConflict{}

def receipt(+state: String, completed: Budget.Count, files: Budget.Count, +expected: Budget.Count) -> Receipt:
  Bool.pick(Receipt, String.eq(state, "complete"), Bool.pick(Receipt, Bool.and(Budget.equal(completed, expected), Budget.equal(files, expected)), CaptureReceiptReplay{}, CaptureReceiptConflict{}),
    Bool.pick(Receipt, String.eq(state, "incomplete"), CaptureReceiptUnknown{}, Bool.pick(Receipt, String.eq(state, "refused"), CaptureReceiptRefused{}, CaptureReceiptUnsupported{})))


def manifest_header(+generation: Budget.Count, previous: Bool) -> Bool:
  Bool.and(Budget.le(Budget.one(), generation), Bool.not(Bool.xor(previous, Bool.not(Budget.equal(generation, Budget.one())))))

def declaration(+availability: String, restoration: Budget.Count, evidence: Budget.Count, disposition: Budget.Count, same_path: Bool) -> Bool:
  Bool.pick(Bool, String.eq(availability, "packed"), Bool.and(Bool.not(Budget.equal(restoration, Budget.zero())), Bool.and(Bool.not(Budget.equal(evidence, Budget.zero())), Bool.not(same_path))),
    Bool.pick(Bool, String.eq(availability, "intentionally-retired"), Bool.not(Budget.equal(disposition, Budget.zero())), True{}))


def custody(enabled: Bool, confirmed: Bool, owner_alive: Bool, participants: Budget.Count, unknown_writers: Budget.Count) -> Bool:
  Bool.and(enabled, Bool.and(confirmed, Bool.and(owner_alive, Bool.and(Bool.not(Budget.equal(participants, Budget.zero())), Budget.equal(unknown_writers, Budget.zero())))))


def lock_reclaim(actual_operation: String, +expected_operation: String, actual_scope: String, expected_scope: String, retired: Bool) -> Bool:
  Bool.and(retired, Bool.and(Bool.not(String.eq(expected_operation, "")), Bool.and(String.eq(actual_operation, expected_operation), String.eq(actual_scope, expected_scope))))


def sum_fold(values: +List<Budget.Count>, total: Budget.Amount) -> Budget.Amount:
  match values:
    case Nil{}:
      total
    case Con{head, tail}:
      sum_fold(tail, Budget.accumulate(total, head))

def sum(values: +List<Budget.Count>) -> Budget.Amount:
  sum_fold(values, Budget.BudgetFinite{Budget.zero()})
