import Base
import ./collections.bend as Text
import ./accounting.bend as Budget
import ./execution.bend as Run

# Host adapters supply normalized roots/components, actual observations and bytes.
# These decisions neither capture a file nor adopt its text as authority.
def components_fold(root: +List<String>, path: +List<String>, accepted: Bool) -> Bool:
  match root:
    case Nil{}:
      accepted
    case Con{head, tail}:
      match path:
        case Nil{}:
          False{}
        case Con{other, rest}:
          components_fold(tail, rest, Bool.and(accepted, String.eq(head, other)))

def components(root: +List<String>, path: +List<String>) -> Bool:
  components_fold(root, path, True{})

def path(root_host: String, root: +List<String>, path_host: String, selected: +List<String>) -> Bool:
  Bool.and(String.eq(root_host, path_host), components(root, selected))

type Registration is Data:
  GuidanceInvalidPaths{}
  GuidanceRegistryFull{}
  GuidanceNewSource{}
  GuidanceSameSource{}
  GuidanceChangedSource{}

def registration(normalized: Bool, present: Bool, count: U32, same: Bool) -> Registration:
  Bool.pick(Registration, normalized,
    Bool.pick(Registration, present,
      Bool.pick(Registration, same, GuidanceSameSource{}, GuidanceChangedSource{}),
      Bool.pick(Registration, U32.is_ge(count, 256), GuidanceRegistryFull{}, GuidanceNewSource{})), GuidanceInvalidPaths{})

type Refresh is Data:
  GuidanceWithdrawn{}
  GuidanceNoStorage{}
  GuidanceObserve{}

def refresh(active: Bool, storage: Bool) -> Refresh:
  Bool.pick(Refresh, active, Bool.pick(Refresh, storage, GuidanceObserve{}, GuidanceNoStorage{}), GuidanceWithdrawn{})

def retained(count: Budget.Count, maximum_count: Budget.Count, total: Budget.Count, extra: Budget.Count, maximum_bytes: Budget.Count) -> Bool:
  Bool.and(Bool.not(Budget.le(maximum_count, count)), Budget.fits(Budget.add(total, extra), maximum_bytes))

type ObservationError is Data:
  GuidanceMissing{}
  GuidanceDenied{}
  GuidanceTooLarge{}
  GuidanceChanged{}
  GuidanceUnsupported{}
  GuidanceRethrow{}

def observation_error(+code: String, domain: Bool) -> ObservationError:
  Bool.pick(ObservationError, Bool.and(domain, Bool.not(Text.contains(Con{"FORBIDDEN", Con{"LIMIT_EXCEEDED", Con{"IDENTITY_CONFLICT", Con{"INVALID_ARGUMENT", Nil{}}}}}, code))), GuidanceRethrow{},
    Bool.pick(ObservationError, String.eq(code, "ENOENT"), GuidanceMissing{},
      Bool.pick(ObservationError, Text.contains(Con{"EACCES", Con{"EPERM", Con{"FORBIDDEN", Nil{}}}}, code), GuidanceDenied{},
        Bool.pick(ObservationError, String.eq(code, "LIMIT_EXCEEDED"), GuidanceTooLarge{},
          Bool.pick(ObservationError, String.eq(code, "IDENTITY_CONFLICT"), GuidanceChanged{}, GuidanceUnsupported{})))))

def some_fold(values: +List<Bool>, accepted: Bool) -> Bool:
  match values:
    case Nil{}:
      accepted
    case Con{head, tail}:
      some_fold(tail, Bool.or(accepted, head))

def selected(explicit: Bool, active: Bool, located: Bool, matches: +List<Bool>) -> Bool:
  Bool.and(Bool.or(explicit, active), Bool.or(Bool.not(located), some_fold(matches, False{})))

type ReviewSize is Data:
  GuidanceNoSources{}
  GuidanceSourceBound{}
  GuidanceSourcesReady{}

def review_size(+count: U32) -> ReviewSize:
  Bool.pick(ReviewSize, U32.is_eq(count, 0), GuidanceNoSources{}, Bool.pick(ReviewSize, U32.is_lt(32, count), GuidanceSourceBound{}, GuidanceSourcesReady{}))

def review_source(active: Bool, observation: String) -> Bool:
  Bool.and(active, String.eq(observation, "ready"))

def evidence_fold(values: +List<Budget.Count>, total: Budget.Amount) -> Budget.Amount:
  match values:
    case Nil{}:
      total
    case Con{head, tail}:
      evidence_fold(tail, Budget.accumulate(total, head))

def review_bytes(values: +List<Budget.Count>) -> Bool:
  Budget.fits(evidence_fold(values, Budget.BudgetFinite{Budget.zero()}), Budget.BudgetCount{0, 131072})

def current(present: Bool, active: Bool, definition: String, captured_definition: String, observation: String, latest: String, capture: String) -> Bool:
  Bool.and(present, Bool.and(active, Bool.and(String.eq(definition, captured_definition), Bool.and(String.eq(observation, "ready"), String.eq(latest, capture)))))

type Basis is Data:
  GuidanceBasisUnavailable{}
  GuidanceBasisChanged{}
  GuidanceBasisCurrent{}

def basis(present: Bool, actual: String, expected: String) -> Basis:
  Bool.pick(Basis, present, Bool.pick(Basis, String.eq(actual, expected), GuidanceBasisCurrent{}, GuidanceBasisChanged{}), GuidanceBasisUnavailable{})

def policy(current_ref: String, expected_ref: String, current_digest: String, expected_digest: String) -> Bool:
  Bool.and(String.eq(current_ref, expected_ref), String.eq(current_digest, expected_digest))

type Profile is Data:
  GuidanceProfile{provider: String, name: String, version: String, input: String, output: String, isolation: String, reconciliation: String, features: String}

def profile(actual: Profile, expected: Profile) -> Bool:
  GuidanceProfile{a, b, c, d, e, f, g, h} = actual
  GuidanceProfile{u, v, w, x, y, z, r, s} = expected
  Bool.and(String.eq(a, u), Bool.and(String.eq(b, v), Bool.and(String.eq(c, w), Bool.and(String.eq(d, x), Bool.and(String.eq(e, y), Bool.and(String.eq(f, z), Bool.and(String.eq(g, r), String.eq(h, s))))))))

def profile_available(compatible: Bool, readable: Bool, expired: Bool) -> Bool:
  Bool.and(compatible, Bool.and(readable, Bool.not(expired)))

def grant(principal: String, candidate_principal: String, +actions: +List<String>, resources: +List<String>, capability: String, operator: Bool, candidate: String, bound: String) -> Bool:
  Bool.and(String.eq(principal, candidate_principal), Bool.and(Text.contains(actions, "local.moment.guidance"), Bool.and(Text.contains(actions, "guidance.review"), Bool.and(Text.contains(resources, capability), Bool.or(operator, String.eq(candidate, bound))))))

def candidate(state: Run.State, blocked: Bool, settlement: Bool) -> Bool:
  match state:
    case Run.RunQueued{}:
      Bool.not(blocked)
    case Run.RunUncertain{}:
      Bool.not(blocked)
    case Run.RunSucceeded{}:
      Bool.and(Bool.not(blocked), settlement)
    case Run.RunFailed{}:
      Bool.and(Bool.not(blocked), settlement)
    case Run.RunCancelled{}:
      Bool.and(Bool.not(blocked), settlement)
    case _:
      False{}

def uncertain(state: Run.State) -> Bool:
  match state:
    case Run.RunUncertain{}:
      True{}
    case _:
      False{}

def candidate_compare(left: Run.State, left_key: String, right: Run.State, right_key: String) -> Cmp:
  +a = uncertain(left)
  +b = uncertain(right)
  Bool.pick(Cmp, Bool.and(a, Bool.not(b)), LT{}, Bool.pick(Cmp, Bool.and(b, Bool.not(a)), GT{}, String.order(left_key, right_key)))

type ReportDecision is Data:
  GuidanceNotStarted{}
  GuidanceCancelled{}
  GuidanceFailed{}
  GuidanceUnknownOutput{}
  GuidanceProject{}

def result(+kind: String, failure: Bool, raw: Bool) -> ReportDecision:
  Bool.pick(ReportDecision, String.eq(kind, "not_started"), GuidanceNotStarted{},
    Bool.pick(ReportDecision, String.eq(kind, "cancelled"), GuidanceCancelled{},
      Bool.pick(ReportDecision, Bool.or(String.eq(kind, "failed"), failure), GuidanceFailed{},
        Bool.pick(ReportDecision, raw, GuidanceProject{}, GuidanceUnknownOutput{}))))

type Quote is Data:
  GuidanceQuoteUnanchored{}
  GuidanceQuoteExact{}
  GuidanceQuoteAmbiguous{}
  GuidanceQuoteEditorial{}

def quote(+matches: U32, editorial: Bool) -> Quote:
  Bool.pick(Quote, U32.is_eq(matches, 0), GuidanceQuoteUnanchored{},
    Bool.pick(Quote, U32.is_eq(matches, 1), Bool.pick(Quote, editorial, GuidanceQuoteEditorial{}, GuidanceQuoteExact{}), GuidanceQuoteAmbiguous{}))

def editorial(present: Bool, matches: U32, ascii_initial: Bool) -> Bool:
  Bool.and(present, Bool.and(U32.is_eq(matches, 0), ascii_initial))


def capture_room(count: U32) -> Bool:
  U32.is_lt(count, 2048)


def settlement(state: Run.State, blocked: Bool) -> Bool:
  Bool.and(Bool.not(blocked), Run.terminal(state))
