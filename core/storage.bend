import Base
import ./accounting.bend as Budget
import ./collections.bend as Text
import ./execution.bend as Run

# Native ports supply observed PRAGMA versions, authenticated identity/hash
# observations and actual durable outcomes. This core performs no storage I/O.
type Format is Data:
  StorageCurrent{}
  StorageLegacy{}
  StorageEmpty{}
  StorageUnsupported{}

def format(+component: String, +version: Budget.Count) -> Format:
  Bool.pick(Format, Text.contains(Con{"kernel", Con{"memory", Nil{}}}, component),
  Bool.pick(Format, Budget.equal(version, Budget.zero()), StorageEmpty{},
    Bool.pick(Format, String.eq(component, "kernel"),
      Bool.pick(Format, Budget.equal(version, Budget.BudgetCount{0, 2}), StorageCurrent{}, Bool.pick(Format, Budget.equal(version, Budget.one()), StorageLegacy{}, StorageUnsupported{})),
      Bool.pick(Format, String.eq(component, "memory"), Bool.pick(Format, Budget.equal(version, Budget.BudgetCount{0, 3}), StorageCurrent{}, Bool.pick(Format, Bool.or(Budget.equal(version, Budget.one()), Budget.equal(version, Budget.BudgetCount{0, 2})), StorageLegacy{}, StorageUnsupported{})), StorageUnsupported{}))), StorageUnsupported{})


def version_one(version: Budget.Count) -> Bool:
  Budget.equal(version, Budget.one())

def ready(present: Bool, version: Budget.Count, stage: String) -> Bool:
  Bool.or(Bool.not(present), Bool.and(version_one(version), String.eq(stage, "complete")))

type PlanFormats is Data:
  StoragePlanReady{}
  StoragePlanHistorical{}
  StoragePlanUnsupported{}

def plan_formats(+source_kernel: Budget.Count, memory_present: Bool, +source_memory: Budget.Count, +target_kernel: Budget.Count, +target_memory: Budget.Count) -> PlanFormats:
  Bool.pick(PlanFormats, Bool.and(Budget.equal(target_kernel, Budget.BudgetCount{0, 2}), Budget.equal(target_memory, Budget.BudgetCount{0, 2})), StoragePlanHistorical{},
    Bool.pick(PlanFormats, Bool.and(Budget.equal(target_kernel, Budget.BudgetCount{0, 2}), Bool.and(Budget.equal(target_memory, Budget.BudgetCount{0, 3}),
      Bool.and(Bool.or(Budget.equal(source_kernel, Budget.one()), Budget.equal(source_kernel, Budget.BudgetCount{0, 2})),
        Bool.or(Bool.not(memory_present), Bool.or(Budget.equal(source_memory, Budget.one()), Bool.or(Budget.equal(source_memory, Budget.BudgetCount{0, 2}), Budget.equal(source_memory, Budget.BudgetCount{0, 3}))))))), StoragePlanReady{}, StoragePlanUnsupported{}))

def source_format(+actual_present: Bool, +actual: Budget.Count, source_present: Bool, source: Budget.Count, target: Budget.Count, converted: Bool) -> Bool:
  Bool.or(Bool.and(Bool.not(Bool.xor(actual_present, source_present)), Budget.equal(actual, source)), Bool.and(converted, Bool.and(actual_present, Budget.equal(actual, target))))

def preserve_memory(source_kernel: Budget.Count) -> Bool:
  Budget.equal(source_kernel, Budget.BudgetCount{0, 2})

def execution_hold(state: Run.State) -> Bool:
  match state:
    case Run.RunRunning{}:
      True{}
    case Run.RunCancelling{}:
      True{}
    case Run.RunUncertain{}:
      True{}
    case rest:
      False{}

def memory_receipt(status: String) -> Bool:
  Text.contains(Con{"succeeded", Con{"failed", Nil{}}}, status)

def memory_dispatch(status: String) -> Bool:
  Text.contains(Con{"running", Con{"unknown", Nil{}}}, status)

def labor(present: Bool, version: Budget.Count, holder: Bool, preserve: Bool, component: String) -> Bool:
  Bool.or(Bool.not(present), Bool.and(version_one(version), Bool.or(Bool.not(holder), Bool.and(preserve, String.eq(component, "memory")))))

type Journal is Data:
  StorageJournalFresh{}
  StorageJournalResume{}
  StorageJournalReplay{}
  StorageJournalArchive{}
  StorageJournalConflict{}
  StorageJournalUnsupported{}

def journal(present: Bool, version: Budget.Count, actual: String, expected: String, +stage: String) -> Journal:
  Bool.pick(Journal, present,
    Bool.pick(Journal, Bool.and(version_one(version), Text.contains(Con{"prepared", Con{"backed-up", Con{"converted", Con{"verified", Con{"complete", Nil{}}}}}}, stage)),
      Bool.pick(Journal, String.eq(actual, expected), Bool.pick(Journal, String.eq(stage, "complete"), StorageJournalReplay{}, StorageJournalResume{}),
        Bool.pick(Journal, String.eq(stage, "complete"), StorageJournalArchive{}, StorageJournalConflict{})), StorageJournalUnsupported{}), StorageJournalFresh{})

def conversion_needed(stage: String) -> Bool:
  Bool.not(String.eq(stage, "verified"))


def enrollment(actual_session: String, expected_session: String, actual_key: String, expected_key: String, enabled: Bool) -> Bool:
  Bool.and(enabled, Bool.and(String.eq(actual_session, expected_session), String.eq(actual_key, expected_key)))

# An admitted creation intent is distinct from an observed conversion result.
# Native code must validate its private shape and authenticate these bindings.
def initialization(absent: Bool, present: Bool, version: Budget.Count, component: String, stage: String, actual_system: String, expected_system: String, actual_plan: String, expected_plan: String) -> Bool:
  Bool.and(absent, Bool.and(present, Bool.and(version_one(version), Bool.and(String.eq(component, "memory"), Bool.and(String.eq(stage, "verified"), Bool.and(String.eq(actual_system, expected_system), String.eq(actual_plan, expected_plan)))))))
