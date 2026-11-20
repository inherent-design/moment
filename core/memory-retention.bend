import Base
import ./accounting.bend as Budget
import ./collections.bend as Text
import ./memory.bend as Mem

type Category is Data:
  RetentionProfile{}
  RetentionWorking{}
  RetentionAssessment{}

def known_kind(kind: String) -> Bool:
  Text.contains(Con{"profile", Con{"entries", Con{"basis", Con{"outcome", Con{"raw", Nil{}}}}}}, kind)

def known_status(status: String) -> Bool:
  Text.contains(Con{"running", Con{"unknown", Con{"succeeded", Con{"failed", Con{"cancelled", Con{"not-started", Con{"skipped", Nil{}}}}}}}}, status)

def states_fold(values: +List<String>, accepted: Bool) -> Bool:
  match values:
    case Nil{}:
      accepted
    case Con{head, tail}:
      states_fold(tail, Bool.and(accepted, known_status(head)))

def included(category: Category, kind: String) -> Bool:
  match category:
    case RetentionProfile{}:
      String.eq(kind, "profile")
    case RetentionWorking{}:
      String.eq(kind, "entries")
    case RetentionAssessment{}:
      Text.contains(Con{"basis", Con{"outcome", Con{"raw", Nil{}}}}, kind)

def category(+kind: String) -> Category:
  Bool.pick(Category, String.eq(kind, "profile"), RetentionProfile{}, Bool.pick(Category, String.eq(kind, "entries"), RetentionWorking{}, RetentionAssessment{}))

def combine(left: Budget.Amount, right: Budget.Amount) -> Budget.Amount:
  match left:
    case Budget.BudgetOverflow{}:
      Budget.BudgetOverflow{}
    case Budget.BudgetFinite{count}:
      Budget.accumulate(right, count)

def double(value: Budget.Amount) -> Budget.Amount:
  match value:
    case Budget.BudgetOverflow{}:
      Budget.BudgetOverflow{}
    case Budget.BudgetFinite{+count}:
      Budget.add(count, count)

def scale(times: Nat, value: Budget.Amount) -> Budget.Amount:
  match times:
    case Zero{}:
      value
    case Succ{previous}:
      scale(previous, double(value))

def rows(values: +List<Budget.Count>, +overhead: Budget.Count, total: Budget.Amount) -> Budget.Amount:
  match values:
    case Nil{}:
      total
    case Con{head, tail}:
      rows(tail, overhead, Budget.accumulate(Budget.accumulate(total, head), overhead))

type Value is Data:
  RetentionValue{kind: String, bytes: Budget.Count}

type Usage is Data:
  RetentionUsage{amount: Budget.Amount}
  RetentionUnknownKind{}

def value_step(value: Value, +category: Category, total: Usage) -> Usage:
  RetentionValue{+kind, bytes} = value
  match total:
    case RetentionUnknownKind{}:
      RetentionUnknownKind{}
    case RetentionUsage{+amount}:
      Bool.pick(Usage, known_kind(kind), RetentionUsage{Bool.pick(Budget.Amount, included(category, kind), Budget.accumulate(Budget.accumulate(amount, bytes), Budget.BudgetCount{0, 128}), amount)}, RetentionUnknownKind{})

def values_fold(values: +List<Value>, +category: Category, total: Usage) -> Usage:
  match values:
    case Nil{}:
      total
    case Con{head, tail}:
      values_fold(tail, category, value_step(head, category, total))

def metadata(value: Usage, category: Category, assessments: +List<Budget.Count>, working: +List<Budget.Count>, receipts: +List<Budget.Count>, focus: Budget.Count, bindings: Budget.Count) -> Usage:
  match value:
    case RetentionUnknownKind{}:
      RetentionUnknownKind{}
    case RetentionUsage{amount}:
      match category:
        case RetentionProfile{}:
          RetentionUsage{amount}
        case RetentionWorking{}:
          RetentionUsage{combine(rows(receipts, Budget.BudgetCount{0, 192}, rows(working, Budget.BudgetCount{0, 192}, amount)), scale(7n, Budget.BudgetFinite{focus}))}
        case RetentionAssessment{}:
          RetentionUsage{combine(rows(assessments, Budget.BudgetCount{0, 192}, amount), scale(8n, Budget.BudgetFinite{bindings}))}

def usage(+category: Category, values: +List<Value>, assessments: +List<Budget.Count>, working: +List<Budget.Count>, receipts: +List<Budget.Count>, focus: Budget.Count, bindings: Budget.Count) -> Usage:
  metadata(values_fold(values, category, RetentionUsage{Budget.BudgetFinite{Budget.zero()}}), category, assessments, working, receipts, focus, bindings)

type Pressure is Data:
  RetentionFits{}
  RetentionRetire{}
  RetentionFull{}

def pressure_result(fits: Bool, retirable: Bool) -> Pressure:
  Bool.pick(Pressure, fits, RetentionFits{}, Bool.pick(Pressure, retirable, RetentionRetire{}, RetentionFull{}))

def pressure(category: Category, usage: Budget.Amount, extra: Budget.Count, profile: Budget.Count, working: Budget.Count, assessment: Budget.Count) -> Pressure:
  match category:
    case RetentionProfile{}:
      pressure_result(Budget.fits(Budget.accumulate(usage, extra), profile), True{})
    case RetentionWorking{}:
      pressure_result(Budget.fits(Budget.accumulate(usage, extra), working), False{})
    case RetentionAssessment{}:
      pressure_result(Budget.fits(Budget.accumulate(usage, extra), assessment), True{})

type Identity is Data:
  RetentionIdentity{index: U32, kind: String, key: String}

type Collection is Data:
  RetentionCollection{indices: +List<U32>}
  RetentionCollectionKind{}
  RetentionCollectionState{}

def collect_step(value: Identity, +live: +List<String>, selected: Collection) -> Collection:
  RetentionIdentity{index, kind, key} = value
  match selected:
    case RetentionCollection{+indices}:
      Bool.pick(Collection, known_kind(kind), RetentionCollection{Bool.pick(+List<U32>, Text.contains(live, key), indices, Con{index, indices})}, RetentionCollectionKind{})
    case RetentionCollectionKind{}:
      RetentionCollectionKind{}
    case RetentionCollectionState{}:
      RetentionCollectionState{}

def collect_fold(values: +List<Identity>, +live: +List<String>, selected: Collection) -> Collection:
  match values:
    case Nil{}:
      selected
    case Con{head, tail}:
      collect_fold(tail, live, collect_step(head, live, selected))

def collect(values: +List<Identity>, live: +List<String>, states: +List<String>) -> Collection:
  Bool.pick(Collection, states_fold(states, True{}), collect_fold(values, live, RetentionCollection{Nil{}}), RetentionCollectionState{})

type Assessment is Data:
  RetentionAssessmentRow{index: U32, order: Mem.Ordinal, id: String, basis: Bool, status: String}

type Retirement is Data:
  RetentionNoCandidate{}
  RetentionCandidate{index: U32, order: Mem.Ordinal}
  RetentionUnknownState{}

def selected(index: U32, +order: Mem.Ordinal, previous: Retirement) -> Retirement:
  match previous:
    case RetentionNoCandidate{}:
      RetentionCandidate{index, order}
    case RetentionCandidate{old_index, +old_order}:
      Bool.pick(Retirement, Bool.and(Mem.ordinal_le(order, old_order), Bool.not(Mem.ordinal_equal(order, old_order))), RetentionCandidate{index, order}, RetentionCandidate{old_index, old_order})
    case RetentionUnknownState{}:
      RetentionUnknownState{}

def retire_step(row: Assessment, protected: +List<String>, +previous: Retirement) -> Retirement:
  RetentionAssessmentRow{index, order, id, basis, +status} = row
  Bool.pick(Retirement, known_status(status),
    Bool.pick(Retirement, Bool.and(basis, Bool.and(Bool.not(Text.contains(protected, id)), Bool.not(Text.contains(Con{"running", Con{"unknown", Nil{}}}, status)))), selected(index, order, previous), previous), RetentionUnknownState{})

def retire_fold(rows: +List<Assessment>, +protected: +List<String>, previous: Retirement) -> Retirement:
  match rows:
    case Nil{}:
      previous
    case Con{head, tail}:
      retire_fold(tail, protected, retire_step(head, protected, previous))

def retire(rows: +List<Assessment>, protected: +List<String>) -> Retirement:
  retire_fold(rows, protected, RetentionNoCandidate{})

def excess(count: Budget.Count, maximum: Budget.Count) -> Bool:
  Bool.not(Budget.le(count, maximum))

type Availability is Data:
  RetentionNativeAvailable{value: String}
  RetentionNativeUnsupported{}

def known_basis(basis: String) -> Bool:
  Text.contains(Con{"retained", Con{"legacy", Con{"retired", Nil{}}}}, basis)

def availability(raw: Bool, +basis: String, reason_present: Bool, reason: String, +status: String) -> Availability:
  Bool.pick(Availability, Bool.and(known_status(status), known_basis(basis)), RetentionNativeAvailable{
    Bool.pick(String, raw, "retained", Bool.pick(String, String.eq(basis, "legacy"), "legacy", Bool.pick(String, String.eq(basis, "retired"), "retired",
      Bool.pick(String, reason_present, reason, Bool.pick(String, Text.contains(Con{"cancelled", Con{"not-started", Nil{}}}, status), "not-supplied", "pending")))))}, RetentionNativeUnsupported{})


type ValueClass is Data:
  RetentionValueClass{category: Category}
  RetentionValueUnknown{}

def classify(+kind: String) -> ValueClass:
  Bool.pick(ValueClass, known_kind(kind), RetentionValueClass{category(kind)}, RetentionValueUnknown{})
