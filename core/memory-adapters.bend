import Base
import ./accounting.bend as Budget
import ./collections.bend as Text

# Native codecs supply observed roles, phases, provenance and actual byte counts.
# Visibility and selection do not establish human authorship or authority.
def visible_assistant(role: String, phase_present: Bool, phase: String) -> Bool:
  Bool.and(String.eq(role, "assistant"), Bool.or(Bool.not(phase_present), Text.contains(Con{"commentary", Con{"final", Con{"final_answer", Nil{}}}}, phase)))

type FrameAction is Data:
  MemoryExchangeFrame{}
  MemoryUserFrame{}
  MemoryIgnoredFrame{}

def frame(+role: String, phase_present: Bool, phase: String) -> FrameAction:
  Bool.pick(FrameAction, visible_assistant(role, phase_present, phase), MemoryExchangeFrame{},
    Bool.pick(FrameAction, String.eq(role, "user"), MemoryUserFrame{}, MemoryIgnoredFrame{}))

type Frame is Data:
  MemoryFrame{index: U32, role: String, phase_present: Bool, phase: String, output_parts: Budget.Count}

type Exchange is Data:
  MemoryNoExchange{}
  MemoryLatestExchange{index: U32}

def exchange_step(value: Frame, +previous: Exchange) -> Exchange:
  MemoryFrame{index, role, phase_present, phase, output_parts} = value
  Bool.pick(Exchange, Bool.and(visible_assistant(role, phase_present, phase), Bool.not(Budget.equal(output_parts, Budget.zero()))), MemoryLatestExchange{index}, previous)

def exchange_fold(frames: +List<Frame>, previous: Exchange) -> Exchange:
  match frames:
    case Nil{}:
      previous
    case Con{head, tail}:
      exchange_fold(tail, exchange_step(head, previous))

def exchange(frames: +List<Frame>) -> Exchange:
  exchange_fold(frames, MemoryNoExchange{})

def parts_fold(parts: +List<Budget.Count>, +maximum: Budget.Count, accepted: Bool) -> Bool:
  match parts:
    case Nil{}:
      accepted
    case Con{head, tail}:
      parts_fold(tail, maximum, Bool.and(accepted, Budget.le(head, maximum)))

def parts(count: Budget.Count, bytes: +List<Budget.Count>, maximum: Budget.Count) -> Bool:
  Bool.and(Budget.le(count, Budget.BudgetCount{0, 16}), parts_fold(bytes, maximum, True{}))

type HistoryPart is Data:
  MemoryHarnessPart{}
  MemoryOversizePart{}
  MemoryUnknownUserPart{}

def history_part(provenance: String, bytes: Budget.Count, maximum: Budget.Count) -> HistoryPart:
  Bool.pick(HistoryPart, String.eq(provenance, "harness"), MemoryHarnessPart{},
    Bool.pick(HistoryPart, Budget.le(bytes, maximum), MemoryUnknownUserPart{}, MemoryOversizePart{}))

def history_full(count: Budget.Count, maximum: Budget.Count) -> Bool:
  Bool.not(Budget.le(count, maximum))

type Project is Data:
  MemoryProject{id: String, contexts: +List<String>}

def project_fold(projects: +List<Project>, +project: String, +context: String, accepted: Bool) -> Bool:
  match projects:
    case Nil{}:
      accepted
    case Con{head, tail}:
      MemoryProject{id, contexts} = head
      project_fold(tail, project, context, Bool.or(accepted, Bool.and(String.eq(id, project), Text.contains(contexts, context))))

def project(registry_system: String, system: String, +project: String, context: String, projects: +List<Project>, associated: +List<String>) -> Bool:
  Bool.and(String.eq(registry_system, system), Bool.and(project_fold(projects, project, context, False{}), Text.contains(associated, project)))

type BindingError is Data:
  MemoryBindingIntegrity{}
  MemoryBindingUnavailable{}
  MemoryBindingComponent{}

def binding_error(+code: String) -> BindingError:
  Bool.pick(BindingError, String.eq(code, "IDENTITY_CONFLICT"), MemoryBindingIntegrity{},
    Bool.pick(BindingError, Text.contains(Con{"NOT_FOUND", Con{"FORBIDDEN", Con{"POLICY_INDETERMINATE", Con{"GRANT_EXPIRED", Con{"CONTEXT_CLOSED", Nil{}}}}}}, code), MemoryBindingUnavailable{}, MemoryBindingComponent{}))

type WorkerBootstrap is Data:
  MemoryWorkerBootstrap{state: String, mark_unknown: Bool}

def worker_mode(provider: Bool, unavailable: Bool, active: Bool) -> String:
  Bool.pick(String, active, "unknown", Bool.pick(String, provider, Bool.pick(String, unavailable, "unavailable", "ready"), "disabled"))

def worker_bootstrap(provider: Bool, unavailable: Bool, +active: Bool, recover: Bool, status: String) -> WorkerBootstrap:
  MemoryWorkerBootstrap{worker_mode(provider, unavailable, active), Bool.and(active, Bool.and(recover, String.eq(status, "running")))}

def worker_enabled(closed: Bool, provider: Bool, unavailable: Bool) -> Bool:
  Bool.and(Bool.not(closed), Bool.and(provider, Bool.not(unavailable)))

def worker_queue_needed(state: String, active: Bool) -> Bool:
  Bool.and(String.eq(state, "ready"), Bool.not(active))

type WorkerWakeAction is Data:
  MemoryWakeBusy{}
  MemoryWakeScheduled{}
  MemoryWakeSchedule{}

type WorkerWake is Data:
  MemoryWorkerWake{queued: Bool, action: WorkerWakeAction}

def worker_wake(state: String, active: Bool, pending: Bool, busy: Bool, scheduled: Bool) -> WorkerWake:
  MemoryWorkerWake{Bool.and(worker_queue_needed(state, active), pending),
    Bool.pick(WorkerWakeAction, busy, MemoryWakeBusy{}, Bool.pick(WorkerWakeAction, scheduled, MemoryWakeScheduled{}, MemoryWakeSchedule{}))}

type WorkerDemand is Data:
  MemoryWorkerRecover{}
  MemoryWorkerPrepare{}
  MemoryWorkerIdle{}

def worker_demand(active: Bool, pending: Bool) -> WorkerDemand:
  Bool.pick(WorkerDemand, active, MemoryWorkerRecover{}, Bool.pick(WorkerDemand, pending, MemoryWorkerPrepare{}, MemoryWorkerIdle{}))

type WorkerFault is Data:
  MemoryWorkerUnknown{}
  MemoryWorkerNotStarted{}
  MemoryWorkerCleanup{}
  MemoryWorkerUnavailable{}

def worker_fault(dispatched: Bool, current: Bool, not_started: Bool) -> WorkerFault:
  Bool.pick(WorkerFault, dispatched,
    Bool.pick(WorkerFault, current, Bool.pick(WorkerFault, not_started, MemoryWorkerNotStarted{}, MemoryWorkerUnknown{}), MemoryWorkerCleanup{}), MemoryWorkerUnavailable{})

def worker_again(continuing: Bool, requested: Bool, state: String, reconciled: Bool, closed: Bool) -> Bool:
  Bool.and(Bool.not(closed), Bool.or(continuing, Bool.and(requested, Bool.or(String.eq(state, "ready"), reconciled))))

def worker_cancel(present: Bool, actual_session: String, requested_session: String, actual_sequence: Budget.Count, requested_sequence: Budget.Count, result: String) -> Bool:
  Bool.and(present, Bool.and(String.eq(result, "unknown"), Bool.and(String.eq(actual_session, requested_session), Budget.equal(actual_sequence, requested_sequence))))
