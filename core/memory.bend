import Base
import ./accounting.bend as Budget
import ./collections.bend as Text

def terminal(status: String) -> Bool:
  Text.contains(Con{"succeeded", Con{"failed", Con{"cancelled", Con{"skipped", Nil{}}}}}, status)

def pending(status: String) -> Bool:
  Text.contains(Con{"pending", Con{"running", Con{"unknown", Nil{}}}}, status)

def gap(status: String) -> Bool:
  Text.contains(Con{"failed", Con{"cancelled", Nil{}}}, status)

def user(+authorship: String) -> Bool:
  Bool.or(String.eq(authorship, "human"), String.eq(authorship, "unknown"))

def focus_source(authorship: String, origin: String) -> Bool:
  Bool.and(Bool.not(String.eq(origin, "referenced-exchange")), user(authorship))

def selectable(cache: +List<String>, incoming: +List<String>, focus: +List<String>) -> +List<String>:
  Text.union(Text.union(cache, incoming), focus)

def context_fold(sources: +List<String>, +selected: +List<String>, +reversed: +List<String>) -> +List<String>:
  match sources:
    case Nil{}:
      List.reverse(&2, String, reversed)
    case Con{+head, tail}:
      context_fold(tail, selected, Bool.pick(+List<String>, Text.contains(selected, head), reversed, Con{head, reversed}))

def context(sources: +List<String>, selected: +List<String>) -> +List<String>:
  context_fold(sources, selected, Nil{})

type FocusHeader is Data:
  MemoryFocusStale{}
  MemoryProjectionChanged{}
  MemoryFocusReady{}
  MemoryFocusNeedsProjection{}

def focus_header(current: Budget.Count, expected: Budget.Count) -> FocusHeader:
  Bool.pick(FocusHeader, Budget.equal(current, expected), MemoryFocusNeedsProjection{}, MemoryFocusStale{})

def focus_projection(projection: Bool) -> FocusHeader:
  Bool.pick(FocusHeader, projection, MemoryFocusReady{}, MemoryProjectionChanged{})

type FocusSelect is Data:
  MemorySetFull{}
  MemorySeedForExisting{}
  MemoryCreateSet{}
  MemoryReuseSet{}

def focus_select(present: Bool, seed: Bool, count: Budget.Count, maximum: Budget.Count) -> FocusSelect:
  Bool.pick(FocusSelect, present, Bool.pick(FocusSelect, seed, MemorySeedForExisting{}, MemoryReuseSet{}),
    Bool.pick(FocusSelect, Budget.le(maximum, count), MemorySetFull{}, MemoryCreateSet{}))

type FocusRelease is Data:
  MemoryReleaseMissing{}
  MemoryReleasePending{}
  MemoryReleaseReplacement{}
  MemoryReleaseUnexpected{}
  MemoryReleaseTarget{id: String}

def release_next(+next: String, +released: String, active: Bool, replacement: Bool) -> FocusRelease:
  Bool.pick(FocusRelease, Bool.or(String.eq(next, ""), String.eq(next, released)), MemoryReleaseReplacement{},
    Bool.pick(FocusRelease, Bool.and(replacement, Bool.not(active)), MemoryReleaseUnexpected{}, MemoryReleaseTarget{next}))

def focus_release(present: Bool, pending: Bool, +released: String, +current: String, replacement_present: Bool, replacement: String) -> FocusRelease:
  +active = String.eq(current, released)
  Bool.pick(FocusRelease, present,
    Bool.pick(FocusRelease, pending, MemoryReleasePending{}, release_next(Bool.pick(String, active, replacement, current), released, active, replacement_present)), MemoryReleaseMissing{})

def focus_changed(created: Bool, edited: Bool, target: String, current: String) -> Bool:
  Bool.or(Bool.or(created, edited), Bool.not(String.eq(target, current)))

type Configuration is Data:
  MemoryConfigurationStale{}
  MemoryConfigurationFull{}
  MemoryConfigurationChange{}
  MemoryConfigurationSame{}

def configure(+revision: Budget.Count, expected: Budget.Count, receipts: Budget.Count, maximum: Budget.Count, current: Bool, requested: Bool) -> Configuration:
  Bool.pick(Configuration, Budget.equal(revision, expected),
    Bool.pick(Configuration, Budget.le(maximum, receipts), MemoryConfigurationFull{},
      Bool.pick(Configuration, Bool.or(Budget.equal(revision, Budget.zero()), Bool.xor(current, requested)), MemoryConfigurationChange{}, MemoryConfigurationSame{})), MemoryConfigurationStale{})

def disable_input(enabled: Bool, automatic: Bool, status: String) -> Bool:
  Bool.and(Bool.not(enabled), Bool.and(automatic, String.eq(status, "pending")))

type Enrollment is Data:
  MemoryEnrollmentDisabled{}
  MemoryEnrollmentStale{}
  MemoryEnrollmentReady{}

def enrollment(enabled: Bool, revision: Budget.Count, expected: Budget.Count) -> Enrollment:
  Bool.pick(Enrollment, enabled, Bool.pick(Enrollment, Budget.equal(revision, expected), MemoryEnrollmentReady{}, MemoryEnrollmentStale{}), MemoryEnrollmentDisabled{})

type Admission is Data:
  MemoryTargetMissing{}
  MemoryTargetAmbiguous{}
  MemoryInputFull{}
  MemoryBacklogFull{}
  MemoryInputReady{}

def admission(present: Bool, explicit: Bool, automatic: Bool, focus: Budget.Count, sequence: Budget.Count, maximum_inputs: Budget.Count, pending: Budget.Count, maximum_pending: Budget.Count) -> Admission:
  Bool.pick(Admission, present,
    Bool.pick(Admission, Bool.and(Bool.not(explicit), Bool.and(Bool.not(automatic), Bool.not(Budget.equal(focus, Budget.zero())))), MemoryTargetAmbiguous{},
      Bool.pick(Admission, Budget.le(sequence, maximum_inputs), Bool.pick(Admission, Budget.le(maximum_pending, pending), MemoryBacklogFull{}, MemoryInputReady{}), MemoryInputFull{})), MemoryTargetMissing{})

type Claim is Data:
  MemoryBusy{}
  MemoryIdle{}
  MemoryLoadInput{}

def claim(active: Bool, pending: Bool) -> Claim:
  Bool.pick(Claim, active, MemoryBusy{}, Bool.pick(Claim, pending, MemoryLoadInput{}, MemoryIdle{}))

type CompletionBasis is Data:
  MemoryBasisIdentity{}
  MemoryBasisStale{}
  MemoryBasisActive{}
  MemoryBasisDormant{}

def basis(present: Bool, +target: String, dispatch_target_present: Bool, dispatch_target: String, target_revision: Budget.Count, target_basis: Budget.Count, processed: Budget.Count, processed_basis: Budget.Count, focus_revision: Budget.Count, focus_basis: Budget.Count, current: String, cache_revision: Budget.Count, cache_basis: Budget.Count) -> CompletionBasis:
  +active = String.eq(current, target)
  Bool.pick(CompletionBasis, Bool.and(present, Bool.or(Bool.not(dispatch_target_present), String.eq(target, dispatch_target))),
    Bool.pick(CompletionBasis, Bool.and(Bool.and(Budget.equal(target_revision, target_basis), Budget.equal(processed, processed_basis)), Bool.or(Bool.not(Bool.and(Budget.equal(focus_revision, focus_basis), active)), Budget.equal(cache_revision, cache_basis))),
      Bool.pick(CompletionBasis, active, MemoryBasisActive{}, MemoryBasisDormant{}), MemoryBasisStale{}), MemoryBasisIdentity{})

type Output is Data:
  MemoryObservedFailure{}
  MemoryInvalidOutput{}
  MemoryKeepEntries{}
  MemoryCheckSelection{}

def output(failure: Bool, bounded: Bool, schema: Bool, replace: Bool) -> Output:
  Bool.pick(Output, failure, MemoryObservedFailure{}, Bool.pick(Output, Bool.and(bounded, schema), Bool.pick(Output, replace, MemoryCheckSelection{}, MemoryKeepEntries{}), MemoryInvalidOutput{}))

def distinct_fold(values: +List<String>, +seen: +List<String>, accepted: Bool) -> Bool:
  match values:
    case Nil{}:
      accepted
    case Con{+head, tail}:
      distinct_fold(tail, Con{head, seen}, Bool.and(accepted, Bool.not(Text.contains(seen, head))))

type Selection is Data:
  MemorySelectionBound{}
  MemorySelectionUnknown{}
  MemorySelectionReady{}

def selection(count: Budget.Count, capacity: Budget.Count, +selected: +List<String>, eligible: +List<String>) -> Selection:
  Bool.pick(Selection, Bool.and(Budget.le(count, capacity), distinct_fold(selected, Nil{}, True{})),
    Bool.pick(Selection, Text.subset(selected, eligible), MemorySelectionReady{}, MemorySelectionUnknown{}), MemorySelectionBound{})

type Reconciliation is Data:
  MemoryReconcileInvalid{}
  MemoryReconcileOutput{}
  MemoryReconcileFailure{}
  MemoryReconcileRetry{}
  MemoryReconcileCancelled{}

def reconcile(present: Bool, actual: String, expected: String, status: String, +kind: String) -> Reconciliation:
  Bool.pick(Reconciliation, Bool.and(present, Bool.and(String.eq(actual, expected), String.eq(status, "unknown"))),
    Bool.pick(Reconciliation, String.eq(kind, "observed"), MemoryReconcileOutput{},
      Bool.pick(Reconciliation, String.eq(kind, "failed"), MemoryReconcileFailure{},
        Bool.pick(Reconciliation, String.eq(kind, "not_started"), MemoryReconcileRetry{},
          Bool.pick(Reconciliation, String.eq(kind, "cancelled"), MemoryReconcileCancelled{}, MemoryReconcileInvalid{})))), MemoryReconcileInvalid{})

def cancel_uncertain(present: Bool, current: String, requested: String, sequence: Budget.Count, expected: Budget.Count) -> Bool:
  Bool.and(present, Bool.and(String.eq(current, requested), Budget.equal(sequence, expected)))

def cancel_status(+status: String) -> String:
  Bool.pick(String, String.eq(status, "pending"), "cancelled", status)

type Automation is Data:
  MemoryAutomationOff{}
  MemoryAutomationUnavailable{}
  MemoryAutomationObserved{}
  MemoryAutomationAwaiting{}

def automation(enabled: Bool, issue: Bool, observed: Bool, revision: Budget.Count, observed_revision: Budget.Count) -> Automation:
  Bool.pick(Automation, enabled,
    Bool.pick(Automation, issue, MemoryAutomationUnavailable{},
      Bool.pick(Automation, Bool.and(observed, Budget.equal(revision, observed_revision)), MemoryAutomationObserved{}, MemoryAutomationAwaiting{})), MemoryAutomationOff{})

type Observation is Data:
  MemoryObservationReject{}
  MemoryObservationSkip{}
  MemoryObservationQueue{}

def observation(+authorship: String) -> Observation:
  Bool.pick(Observation, String.eq(authorship, "harness"), MemoryObservationSkip{}, Bool.pick(Observation, user(authorship), MemoryObservationQueue{}, MemoryObservationReject{}))

def head_matches(sequence: Budget.Count, next: Budget.Amount) -> Bool:
  match next:
    case Budget.BudgetOverflow{}:
      False{}
    case Budget.BudgetFinite{expected}:
      Budget.equal(sequence, expected)

def head_due(status: String, sequence: Budget.Count, processed: Budget.Count) -> Bool:
  Bool.and(String.eq(status, "pending"), head_matches(sequence, Budget.add(processed, Budget.one())))

# Signed SQLite ordinals use a biased opaque 64-bit order. Only comparison
# reuses the limb primitive; resource arithmetic is never applied to ordinals.
type Ordinal is Data:
  MemoryOrdinal{high: U32, low: U32}

def ordinal_le(left: Ordinal, right: Ordinal) -> Bool:
  MemoryOrdinal{a, b} = left
  MemoryOrdinal{c, d} = right
  Budget.le(Budget.BudgetCount{a, b}, Budget.BudgetCount{c, d})

def ordinal_equal(left: Ordinal, right: Ordinal) -> Bool:
  MemoryOrdinal{a, b} = left
  MemoryOrdinal{c, d} = right
  Budget.equal(Budget.BudgetCount{a, b}, Budget.BudgetCount{c, d})

type Head is Data:
  MemoryHead{index: U32, order: Ordinal, status: String, sequence: Budget.Count, processed: Budget.Count}

type NextHead is Data:
  MemoryNoHead{}
  MemoryNextHead{index: U32, order: Ordinal}

def choose_head(index: U32, +order: Ordinal, selected: NextHead) -> NextHead:
  match selected:
    case MemoryNoHead{}:
      MemoryNextHead{index, order}
    case MemoryNextHead{old_index, +old_order}:
      Bool.pick(NextHead, Bool.and(ordinal_le(order, old_order), Bool.not(ordinal_equal(order, old_order))), MemoryNextHead{index, order}, MemoryNextHead{old_index, old_order})

def head_step(head: Head, +selected: NextHead) -> NextHead:
  MemoryHead{index, order, status, sequence, processed} = head
  Bool.pick(NextHead, head_due(status, sequence, processed), choose_head(index, order, selected), selected)

def head_fold(heads: +List<Head>, selected: NextHead) -> NextHead:
  match heads:
    case Nil{}:
      selected
    case Con{head, tail}:
      head_fold(tail, head_step(head, selected))

def next_head(heads: +List<Head>) -> NextHead:
  head_fold(heads, MemoryNoHead{})

def rebuild_basis(explicit: Bool, cache: Budget.Count, expected_cache: Budget.Count, working: Budget.Count, expected_working: Budget.Count) -> Bool:
  Bool.pick(Bool, explicit, Budget.equal(working, expected_working), Budget.equal(cache, expected_cache))

def dispatch(present: Bool, actual: String, expected: String, status: String, preparing: Bool) -> Bool:
  Bool.and(present, Bool.and(String.eq(actual, expected), Bool.or(Bool.not(preparing), String.eq(status, "running"))))
