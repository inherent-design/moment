import Base
import ./execution.bend as Run

# Exact nonnegative safe integers, not JavaScript-host Nat arithmetic.
type Count is Data:
  BudgetCount{high: U32, low: U32}

type Amount is Data:
  BudgetFinite{count: Count}
  BudgetOverflow{}

def zero() -> Count:
  BudgetCount{0, 0}

def one() -> Count:
  BudgetCount{0, 1}

def le(left: Count, right: Count) -> Bool:
  BudgetCount{+a, b} = left
  BudgetCount{+c, d} = right
  Bool.or(U32.is_lt(a, c), Bool.and(U32.is_eq(a, c), Bool.not(U32.is_lt(d, b))))

def maximum(+left: Count, +right: Count) -> Count:
  Bool.pick(Count, le(left, right), right, left)

def added(+high: U32, low: U32) -> Amount:
  Bool.pick(Amount, Bool.not(U32.is_lt(2097151, high)), BudgetFinite{BudgetCount{high, low}}, BudgetOverflow{})

def add(left: Count, right: Count) -> Amount:
  BudgetCount{a, +b} = left
  BudgetCount{c, d} = right
  +low = U32.add(b, d)
  added(U32.add(U32.add(a, c), Bool.pick(U32, U32.is_lt(low, b), 1, 0)), low)

def subtract_checked(allowed: Bool, left: Count, right: Count) -> Amount:
  match allowed:
    case False{}:
      BudgetOverflow{}
    case True{}:
      BudgetCount{a, +b} = left
      BudgetCount{c, +d} = right
      BudgetFinite{BudgetCount{U32.sub(U32.sub(a, c), Bool.pick(U32, U32.is_lt(b, d), 1, 0)), U32.sub(b, d)}}

# Unrepresentable negative differences refuse rather than wrapping.
def subtract(+left: Count, +right: Count) -> Amount:
  subtract_checked(le(right, left), left, right)

def equal(left: Count, right: Count) -> Bool:
  BudgetCount{a, b} = left
  BudgetCount{c, d} = right
  Bool.and(U32.is_eq(a, c), U32.is_eq(b, d))

def accumulate(value: Amount, extra: Count) -> Amount:
  match value:
    case BudgetOverflow{}:
      BudgetOverflow{}
    case BudgetFinite{count}:
      add(count, extra)

def fits(value: Amount, ceiling: Count) -> Bool:
  match value:
    case BudgetOverflow{}:
      False{}
    case BudgetFinite{count}:
      le(count, ceiling)

type Quantities is Data:
  BudgetQuantities{cpu: Count, memory: Count, output: Count, tokens: Count, spend: Count, concurrent: Count}

type Balance is Data:
  BudgetBalance{cpu: Amount, memory: Amount, output: Amount, tokens: Amount, spend: Amount, concurrent: Amount}

def empty() -> Balance:
  BudgetBalance{BudgetFinite{zero()}, BudgetFinite{zero()}, BudgetFinite{zero()}, BudgetFinite{zero()}, BudgetFinite{zero()}, BudgetFinite{zero()}}

def include(balance: Balance, extra: Quantities) -> Balance:
  BudgetBalance{a, b, c, d, e, f} = balance
  BudgetQuantities{u, v, w, x, y, z} = extra
  BudgetBalance{accumulate(a, u), accumulate(b, v), accumulate(c, w), accumulate(d, x), accumulate(e, y), accumulate(f, z)}

def within(balance: Balance, ceiling: Quantities) -> Bool:
  BudgetBalance{a, b, c, d, e, f} = balance
  BudgetQuantities{u, v, w, x, y, z} = ceiling
  Bool.and(fits(a, u), Bool.and(fits(b, v), Bool.and(fits(c, w), Bool.and(fits(d, x), Bool.and(fits(e, y), fits(f, z))))))

def capacity(balance: Balance, requested: Quantities, ceiling: Quantities) -> Bool:
  within(include(balance, requested), ceiling)

def quantities_le(left: Quantities, right: Quantities) -> Bool:
  BudgetQuantities{a, b, c, d, e, f} = left
  BudgetQuantities{u, v, w, x, y, z} = right
  Bool.and(le(a, u), Bool.and(le(b, v), Bool.and(le(c, w), Bool.and(le(d, x), Bool.and(le(e, y), le(f, z))))))

def usage_allowed(previous: Quantities, +usage: Quantities, ceiling: Quantities, observed: Bool) -> Bool:
  Bool.and(quantities_le(previous, usage), Bool.or(observed, quantities_le(usage, ceiling)))

def cumulative(active: Bool, unmeasured: Bool, ceiling: Count, +usage: Count) -> Count:
  Bool.pick(Count, Bool.or(active, unmeasured), maximum(ceiling, usage), usage)

def charges(+active: Bool, ceiling: Quantities, usage: Quantities, cpu_unknown: Bool, output_unknown: Bool, tokens_unknown: Bool, spend_unknown: Bool) -> Quantities:
  BudgetQuantities{a, b, c, d, e, f} = ceiling
  BudgetQuantities{u, v, w, x, y, z} = usage
  BudgetQuantities{cumulative(active, cpu_unknown, a, u), Bool.pick(Count, active, maximum(b, v), zero()), cumulative(active, output_unknown, c, w), cumulative(active, tokens_unknown, d, x), cumulative(active, spend_unknown, e, y), Bool.pick(Count, active, one(), zero())}

type Reservation is Data:
  BudgetReservation{state: Run.State, ceiling: Quantities, usage: Quantities, cpu_unknown: Bool, output_unknown: Bool, tokens_unknown: Bool, spend_unknown: Bool}

def charge(entry: Reservation) -> Quantities:
  BudgetReservation{state, ceiling, usage, cpu_unknown, output_unknown, tokens_unknown, spend_unknown} = entry
  charges(Bool.not(Run.terminal(state)), ceiling, usage, cpu_unknown, output_unknown, tokens_unknown, spend_unknown)

def total_fold(entries: +List<Reservation>, accumulated: Balance) -> Balance:
  match entries:
    case Nil{}:
      accumulated
    case Con{head, tail}:
      total_fold(tail, include(accumulated, charge(head)))

def total(entries: +List<Reservation>) -> Balance:
  total_fold(entries, empty())

def requests_fold(requests: +List<Quantities>, accumulated: Balance) -> Balance:
  match requests:
    case Nil{}:
      accumulated
    case Con{head, tail}:
      requests_fold(tail, include(accumulated, head))

def envelope(requests: +List<Quantities>, ceiling: Quantities) -> Bool:
  within(requests_fold(requests, empty()), ceiling)

type Envelope is Data:
  CapacityEnvelope{used: Amount, ceiling: Count}

def remaining_result(amount: Amount) -> Count:
  match amount:
    case BudgetOverflow{}:
      zero()
    case BudgetFinite{count}:
      count

def remaining(envelope: Envelope) -> Count:
  CapacityEnvelope{used, ceiling} = envelope
  match used:
    case BudgetOverflow{}:
      zero()
    case BudgetFinite{count}:
      remaining_result(subtract(ceiling, count))

def available_fold(envelopes: +List<Envelope>, +minimum: Count) -> Count:
  match envelopes:
    case Nil{}:
      minimum
    case Con{head, tail}:
      +left = remaining(head)
      available_fold(tail, Bool.pick(Count, le(left, minimum), left, minimum))

def available(envelopes: +List<Envelope>) -> Count:
  match envelopes:
    case Nil{}:
      zero()
    case Con{head, tail}:
      available_fold(tail, remaining(head))
