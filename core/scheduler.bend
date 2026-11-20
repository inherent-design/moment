import Base
import ./accounting.bend as Budget
import ./collections.bend as Text

type Life is Data:
  SchActive{}
  SchCompleted{}
  SchCancelled{}

type Wake is Data:
  SchEvent{}
  SchAt{}
  SchAfter{}
  SchCapacity{}

type Block is Data:
  SchNoBlock{}
  SchBlocked{activity: Budget.Count}

type Facts is Data:
  SchFacts{life: Life, sequence: Budget.Count, block: Block, pending: U32, active: U32, edge: Bool, fired: Bool, pressure: Block}

def active(life: Life) -> Bool:
  match life:
    case SchActive{}:
      True{}
    case _:
      False{}

def cancellable(life: Life) -> Bool:
  match life:
    case SchCompleted{}:
      False{}
    case _:
      True{}

def unblocked(block: Block, activity: Budget.Count) -> Bool:
  match block:
    case SchNoBlock{}:
      True{}
    case SchBlocked{previous}:
      Bool.not(Budget.equal(previous, activity))

def runnable(facts: Facts, activity: Budget.Count) -> Bool:
  SchFacts{life, sequence, block, pending, busy, edge, fired, pressure} = facts
  Bool.and(active(life), Bool.and(unblocked(block, activity), Bool.and(Bool.not(U32.is_zero(pending)), U32.is_zero(busy))))

def ready(facts: Facts, +activity: Budget.Count, coalesce: Bool, last_sources: U32) -> Bool:
  SchFacts{+life, +sequence, +block, +pending, +busy, edge, fired, pressure} = facts
  backed_up = Bool.and(Bool.not(U32.is_zero(busy)), Bool.and(Bool.not(U32.is_lt(pending, 128)), Bool.or(Bool.not(coalesce), Bool.not(U32.is_lt(last_sources, 32)))))
  Bool.and(active(life), Bool.and(unblocked(block, activity), Bool.or(Bool.and(Bool.not(Budget.le(activity, sequence)), Bool.or(Bool.not(backed_up), unblocked(pressure, activity))), Bool.and(Bool.not(U32.is_zero(pending)), U32.is_zero(busy)))))

type Scan is Data:
  SchSkip{}
  SchCancel{}
  SchObserve{}

def scan(facts: Facts, context: String, ended: Bool, activity: Budget.Count) -> Scan:
  SchFacts{life, sequence, block, pending, busy, edge, fired, pressure} = facts
  Bool.pick(Scan, active(life), Bool.pick(Scan, Bool.or(Bool.not(String.eq(context, "open")), ended), SchCancel{}, Bool.pick(Scan, unblocked(block, activity), SchObserve{}, SchSkip{})), SchSkip{})

def needs_events(wake: Wake) -> Bool:
  match wake:
    case SchEvent{}:
      True{}
    case SchAfter{}:
      True{}
    case _:
      False{}

def timer(wake: Wake) -> Bool:
  match wake:
    case SchAt{}:
      True{}
    case SchAfter{}:
      True{}
    case _:
      False{}

def baseline(wake: Wake, edge: Bool) -> Bool:
  match wake:
    case SchEvent{}:
      edge
    case _:
      False{}

type WakeAdmission is Data:
  SchWakeAllowed{}
  SchTimerRearm{}
  SchUnknownResource{}

def resource_known(resource: String) -> Bool:
  Text.contains(Con{"concurrentExecutions", Con{"cpuMillis", Con{"memoryBytes", Con{"outputBytes", Con{"modelTokens", Con{"apiSpendMicrounits", Nil{}}}}}}}, resource)

def wake_admission(wake: Wake, once: Bool, resource: String) -> WakeAdmission:
  match wake:
    case SchAt{}:
      Bool.pick(WakeAdmission, once, SchWakeAllowed{}, SchTimerRearm{})
    case SchAfter{}:
      Bool.pick(WakeAdmission, once, SchWakeAllowed{}, SchTimerRearm{})
    case SchCapacity{}:
      Bool.pick(WakeAdmission, resource_known(resource), SchWakeAllowed{}, SchUnknownResource{})
    case _:
      SchWakeAllowed{}

def room(count: U32) -> Bool:
  U32.is_lt(count, 128)

def visible(present: Bool, incident: Bool, operator: Bool, readable: Bool, creator: String, principal: String, grant: String, chain: +List<String>) -> Bool:
  Bool.and(present, Bool.and(incident, Bool.or(operator, Bool.or(readable, Bool.and(String.eq(creator, principal), Text.contains(chain, grant))))))

type Mode is Data:
  SchQuiet{}
  SchEvents{limit: U32}
  SchTimer{}
  SchCheckCapacity{}

def mode_fields(wake: Wake, sequence: Budget.Count, fired: Bool, activity: Budget.Count, due_present: Bool, due: Budget.Count, now: Budget.Count) -> Mode:
  match wake:
    case SchEvent{}:
      Bool.pick(Mode, Bool.not(Budget.le(activity, sequence)), SchEvents{256}, SchQuiet{})
    case SchCapacity{}:
      SchCheckCapacity{}
    case _:
      Bool.pick(Mode, Bool.and(Bool.not(fired), Bool.and(due_present, Budget.le(due, now))), SchTimer{}, SchQuiet{})

def mode(wake: Wake, facts: Facts, activity: Budget.Count, due_present: Bool, due: Budget.Count, now: Budget.Count) -> Mode:
  SchFacts{life, sequence, block, pending, busy, edge, fired, pressure} = facts
  mode_fields(wake, sequence, fired, activity, due_present, due, now)

type EventGate is Data:
  SchStaleEvent{}
  SchFutureEvent{}
  SchIgnoreEvent{}
  SchInspectEvent{}

def event_gate(previous: Budget.Count, +sequence: Budget.Count, activity: Budget.Count, +kind: String, types: +List<String>) -> EventGate:
  Bool.pick(EventGate, Budget.le(sequence, previous), SchStaleEvent{}, Bool.pick(EventGate, Budget.le(sequence, activity), Bool.pick(EventGate, Bool.and(Bool.not(String.starts_with(kind, "runtime.schedule.")), Text.contains(types, kind)), SchInspectEvent{}, SchIgnoreEvent{}), SchFutureEvent{}))

type Observation is Data:
  SchObservation{fire: Bool, edge: Bool}

def observation(each: Bool, +edge: Bool, +selected: Bool) -> Observation:
  Bool.pick(Observation, each, SchObservation{selected, edge}, SchObservation{Bool.and(selected, Bool.not(edge)), selected})

type Queue is Data:
  SchQueueFull{}
  SchMerge{sources: +List<String>}
  SchAppend{sources: +List<String>}

def merged(+sources: +List<String>) -> Queue:
  Bool.pick(Queue, Nat.is_le(List.length(&2, String, sources), 32n), SchMerge{sources}, SchQueueFull{})

def queue(+pending: U32, coalesce: Bool, last_sources: +List<String>, +sources: +List<String>) -> Queue:
  Bool.pick(Queue, Bool.and(Bool.not(U32.is_zero(pending)), coalesce), merged(Text.union(last_sources, sources)), Bool.pick(Queue, U32.is_lt(pending, 128), SchAppend{sources}, SchQueueFull{}))

def order_result(value: Budget.Amount) -> Budget.Amount:
  Budget.accumulate(value, Budget.one())

def occurrence_order(sequence: Budget.Count, emitted: Budget.Count) -> Budget.Amount:
  order_result(Budget.add(sequence, emitted))

type Advance is Data:
  SchAdvance{cursor: Budget.Count, edge: Bool, stop: Bool, full: Bool}

def advance(previous: Budget.Count, sequence: Budget.Count, activity: Budget.Count, old_edge: Bool, next_edge: Bool, fired: Bool, enqueued: Bool, pending: Bool, +once: Bool) -> Advance:
  +stop = Bool.and(once, pending)
  Bool.pick(Advance, Bool.and(fired, Bool.not(enqueued)), SchAdvance{previous, old_edge, True{}, True{}}, SchAdvance{Bool.pick(Budget.Count, stop, activity, sequence), next_edge, stop, False{}})

def capacity_edge(+old: Bool, +available: Bool, accepted: Bool) -> Bool:
  Bool.pick(Bool, Bool.and(available, Bool.and(Bool.not(old), Bool.not(accepted))), old, available)

def matches(life: Life, present: Bool, expected: String, current: String) -> Bool:
  Bool.and(active(life), Bool.and(present, String.eq(expected, current)))

def completed(once: Bool) -> Life:
  Bool.pick(Life, once, SchCompleted{}, SchActive{})

def retry_fault(code: String) -> Bool:
  String.eq(code, "REVISION_CONFLICT")

def watch(facts: Facts, +activity: Budget.Count, due_present: Bool) -> Bool:
  SchFacts{life, sequence, block, pending, busy, edge, fired, pressure} = facts
  Bool.and(active(life), Bool.and(unblocked(block, activity), Bool.and(Bool.not(fired), due_present)))

type Candidate is Data:
  SchCandidate{index: U32, incident: String, order: Budget.Count, facts: Facts}

type Choice is Data:
  SchNobody{}
  SchChosen{candidate: Candidate}

def candidate_order(candidate: Candidate) -> Budget.Count:
  SchCandidate{index, incident, order, facts} = candidate
  order

def candidate_incident(candidate: Candidate) -> String:
  SchCandidate{index, incident, order, facts} = candidate
  incident

def candidate_eligible(candidate: Candidate, activity: Budget.Count, restricted: Bool, incident: String) -> Bool:
  SchCandidate{index, owner, order, facts} = candidate
  Bool.and(runnable(facts, activity), Bool.or(Bool.not(restricted), String.eq(owner, incident)))

def prefer(+candidate: Candidate, current: Choice) -> Choice:
  match current:
    case SchNobody{}:
      SchChosen{candidate}
    case SchChosen{+previous}:
      Bool.pick(Choice, Budget.le(candidate_order(previous), candidate_order(candidate)), SchChosen{previous}, SchChosen{candidate})

def oldest(candidates: +List<Candidate>, +activity: Budget.Count, +restricted: Bool, +incident: String, +current: Choice) -> Choice:
  match candidates:
    case Nil{}:
      current
    case Con{+head, tail}:
      oldest(tail, activity, restricted, incident, Bool.pick(Choice, candidate_eligible(head, activity, restricted, incident), prefer(head, current), current))

type Key is Data:
  SchNoKey{}
  SchKey{value: String}

def lower_key(+value: String, current: Key) -> Key:
  match current:
    case SchNoKey{}:
      SchKey{value}
    case SchKey{previous}:
      +old = previous
      Bool.pick(Key, String.is_lt(value, old), SchKey{value}, SchKey{old})

def first_key(candidates: +List<Candidate>, +activity: Budget.Count, +after: Bool, +last: String, +current: Key) -> Key:
  match candidates:
    case Nil{}:
      current
    case Con{+head, tail}:
      +incident = candidate_incident(head)
      first_key(tail, activity, after, last, Bool.pick(Key, Bool.and(candidate_eligible(head, activity, False{}, ""), Bool.or(Bool.not(after), String.is_lt(last, incident))), lower_key(incident, current), current))

def fallback(key: Key, candidates: +List<Candidate>, activity: Budget.Count) -> Key:
  match key:
    case SchNoKey{}:
      first_key(candidates, activity, False{}, "", SchNoKey{})
    case found:
      found

def choose_key(key: Key, candidates: +List<Candidate>, activity: Budget.Count) -> Choice:
  match key:
    case SchNoKey{}:
      SchNobody{}
    case SchKey{value}:
      oldest(candidates, activity, True{}, value, SchNobody{})

def choose(has_last: Bool, +last: String, +candidates: +List<Candidate>, +activity: Budget.Count) -> Choice:
  Bool.pick(Choice, has_last, choose_key(fallback(first_key(candidates, activity, True{}, last, SchNoKey{}), candidates, activity), candidates, activity), oldest(candidates, activity, False{}, "", SchNobody{}))

type Selection is Data:
  SchUnrestricted{}
  SchSelected{ids: +List<String>}

def selection(+has_ids: Bool, +ids: +List<String>, event_present: Bool, +subjects: +List<String>) -> Selection:
  Bool.pick(Selection, event_present, SchSelected{Bool.pick(+List<String>, has_ids, Text.intersection(ids, subjects), subjects)}, Bool.pick(Selection, has_ids, SchSelected{ids}, SchUnrestricted{}))

type Causality is Data:
  SchCausality{todo: +List<String>, seen: +List<String>, fuel: U32}

type Demand is Data:
  SchIndependent{}
  SchUnresolved{}
  SchSkipCause{state: Causality}
  SchNeedCause{id: String}

def causality(root: String) -> Causality:
  SchCausality{Con{root, Nil{}}, Nil{}, 128}

def demand_todo(todo: +List<String>, +seen: +List<String>, +fuel: U32) -> Demand:
  match todo:
    case Nil{}:
      SchIndependent{}
    case Con{+head, tail}:
      Bool.pick(Demand, U32.is_zero(fuel), SchUnresolved{}, Bool.pick(Demand, Text.contains(seen, head), SchSkipCause{SchCausality{tail, seen, U32.sub(fuel, 1)}}, SchNeedCause{head}))

def demand(state: Causality) -> Demand:
  SchCausality{todo, seen, fuel} = state
  demand_todo(todo, seen, fuel)

type CauseEvent is Data:
  SchMissingCause{}
  SchCause{id: String, context: String, kind: String, subjects: +List<String>, causes: +List<String>}

type CausalStep is Data:
  SchDependent{}
  SchUnknownCause{}
  SchNextCause{state: Causality}

def step_event(event: CauseEvent, expected: String, tail: +List<String>, +seen: +List<String>, fuel: U32, context: String, schedule: String) -> CausalStep:
  match event:
    case SchMissingCause{}:
      SchUnknownCause{}
    case SchCause{+id, owner, kind, subjects, causes}:
      Bool.pick(CausalStep, Bool.and(String.eq(id, expected), String.eq(owner, context)),
        Bool.pick(CausalStep, Bool.and(String.eq(kind, "runtime.schedule.triggered"), Text.contains(subjects, schedule)), SchDependent{},
          SchNextCause{SchCausality{List.append(&2, String, Text.unseen_fold(causes, Con{id, seen}, Nil{}), tail), Con{id, seen}, U32.sub(fuel, 1)}}), SchUnknownCause{})

def step_todo(todo: +List<String>, seen: +List<String>, +fuel: U32, event: CauseEvent, context: String, schedule: String) -> CausalStep:
  match todo:
    case Nil{}:
      SchUnknownCause{}
    case Con{head, tail}:
      Bool.pick(CausalStep, U32.is_zero(fuel), SchUnknownCause{}, step_event(event, head, tail, seen, fuel, context, schedule))

def step(state: Causality, event: CauseEvent, context: String, schedule: String) -> CausalStep:
  SchCausality{todo, seen, fuel} = state
  step_todo(todo, seen, fuel, event, context, schedule)
