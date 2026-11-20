import Base
import ./collections.bend as Text
import ./accounting.bend as Budget

def all_fold(values: +List<Bool>, accepted: Bool) -> Bool:
  match values:
    case Nil{}:
      accepted
    case Con{head, tail}:
      all_fold(tail, Bool.and(accepted, head))

def all(values: +List<Bool>) -> Bool:
  all_fold(values, True{})

type Detail is Data:
  DetailAllowed{}
  DetailMailbox{}
  DetailRelation{}
  DetailIncident{}
  DetailDependencies{}

def detail(message: Bool, kind: String, roles: +List<Bool>, incident: Bool, scope: Bool, dependencies: +List<Bool>) -> Detail:
  Bool.pick(Detail, message, DetailMailbox{},
    Bool.pick(Detail, Bool.and(String.eq(kind, "relation"), Bool.not(all(roles))), DetailRelation{},
      Bool.pick(Detail, Bool.and(incident, Bool.not(scope)), DetailIncident{},
        Bool.pick(Detail, all(dependencies), DetailAllowed{}, DetailDependencies{}))))

def message_visible(present: Bool, recipient: String, principal: String, incident: Bool) -> Bool:
  Bool.and(Bool.and(present, incident), String.eq(recipient, principal))

type MessageAdmission is Data:
  MessageAllowed{}
  MessageRetention{}
  MessageSummary{}
  MessageIncident{}
  MessageExpired{}

def message(count: U32, bytes: Budget.Count, incident: Bool, scope: Bool, live: Bool) -> MessageAdmission:
  Bool.pick(MessageAdmission, U32.is_ge(count, 4096), MessageRetention{},
    Bool.pick(MessageAdmission, Budget.le(bytes, Budget.BudgetCount{0, 8192}),
      Bool.pick(MessageAdmission, Bool.and(incident, scope),
        Bool.pick(MessageAdmission, live, MessageAllowed{}, MessageExpired{}), MessageIncident{}), MessageSummary{}))

type Parent is Data:
  NoParent{}
  MissingParent{}
  ReplyParent{kind: String, incident: String, recipient: String, sender: String}

type Reply is Data:
  ReplyReady{}
  ReplyRequired{}
  ReplyUnavailable{}
  ReplyNeedsVisibility{}

def reply(kind: String, incident: String, principal: String, recipient: String, parent: Parent) -> Reply:
  match parent:
    case NoParent{}:
      Bool.pick(Reply, String.eq(kind, "response"), ReplyRequired{}, ReplyReady{})
    case MissingParent{}:
      ReplyUnavailable{}
    case ReplyParent{parent_kind, parent_incident, parent_recipient, parent_sender}:
      Bool.pick(Reply, Bool.and(Bool.and(String.eq(parent_kind, "request"), String.eq(incident, parent_incident)), Bool.and(String.eq(parent_recipient, principal), String.eq(parent_sender, recipient))), ReplyNeedsVisibility{}, ReplyUnavailable{})

type RecipientGrant is Data:
  RecipientGrant{index: U32, principal: String}

type Recipient is Data:
  RecipientOwner{}
  RecipientCandidates{indices: +List<U32>}
  RecipientFull{}

type RecipientBag is Data:
  RecipientCollect{count: U32, reversed: +List<U32>}
  RecipientExhausted{}

def recipient_step(principal: String, grant: RecipientGrant, bag: RecipientBag) -> RecipientBag:
  RecipientGrant{index, actor} = grant
  match bag:
    case RecipientExhausted{}:
      RecipientExhausted{}
    case RecipientCollect{+count, +reversed}:
      Bool.pick(RecipientBag, String.eq(actor, principal), Bool.pick(RecipientBag, U32.is_ge(count, 4096), RecipientExhausted{}, RecipientCollect{U32.add(count, 1), Con{index, reversed}}), RecipientCollect{count, reversed})

def recipient_fold(grants: +List<RecipientGrant>, +principal: String, bag: RecipientBag) -> RecipientBag:
  match grants:
    case Nil{}:
      bag
    case Con{head, tail}:
      recipient_fold(tail, principal, recipient_step(principal, head, bag))

def recipient_mode(principal: String, owner: String) -> Bool:
  String.eq(principal, owner)

def recipient_result(result: RecipientBag) -> Recipient:
  match result:
    case RecipientExhausted{}:
      RecipientFull{}
    case RecipientCollect{count, reversed}:
      RecipientCandidates{List.reverse(&2, U32, reversed)}

def recipients(grants: +List<RecipientGrant>, principal: String) -> Recipient:
  recipient_result(recipient_fold(grants, principal, RecipientCollect{0, Nil{}}))

def selected(include_acknowledged: Bool, acknowledged: Bool) -> Bool:
  Bool.or(include_acknowledged, Bool.not(acknowledged))

def message_compare(+left: Budget.Count, left_id: String, +right: Budget.Count, right_id: String) -> Cmp:
  Bool.pick(Cmp, Budget.equal(left, right), String.order(left_id, right_id), Bool.pick(Cmp, Budget.le(left, right), LT{}, GT{}))

def template(kind: String, schema: String, expected: String, selected: String, current: String) -> Bool:
  Bool.and(String.eq(kind, "atom"), Bool.and(String.eq(schema, expected), String.eq(selected, current)))

type TemplateSupport is Data:
  TemplateSupport{record: String, issuer: String, status: String, sources: +List<Bool>}

def supported_fold(items: +List<TemplateSupport>, accepted: Bool, +record: String, +issuers: +List<String>) -> Bool:
  match items accepted:
    case _ True{}:
      True{}
    case Nil{} False{}:
      False{}
    case Con{TemplateSupport{target, issuer, status, sources}, tail} False{}:
      supported_fold(tail, Bool.and(Bool.and(String.eq(target, record), String.eq(status, "asserted")), Bool.and(Text.contains(issuers, issuer), all(sources))), record, issuers)

def supported(items: +List<TemplateSupport>, record: String, issuers: +List<String>) -> Bool:
  supported_fold(items, False{}, record, issuers)

def slots(count: U32, expected: U32, +declared: +List<String>, optional: +List<String>, +markers: +List<String>, malformed: Bool) -> Bool:
  Bool.pick(Bool, malformed, False{}, Bool.and(U32.is_eq(count, expected), Bool.and(Text.subset(optional, declared), Bool.and(Text.subset(markers, declared), Text.subset(declared, markers)))))

type PromptStep is Data:
  PromptFits{}
  PromptRequired{}
  PromptOmit{slot: String, remaining: +List<String>}

def prompt_candidates(declared: +List<String>, optional: +List<String>) -> +List<String>:
  List.reverse(&2, String, Text.intersection(declared, optional))

def prompt_large(candidates: +List<String>) -> PromptStep:
  match candidates:
    case Nil{}:
      PromptRequired{}
    case Con{slot, tail}:
      PromptOmit{slot, tail}

def prompt_step(candidates: +List<String>, used: Budget.Count, ceiling: Budget.Count) -> PromptStep:
  Bool.pick(PromptStep, Budget.le(used, ceiling), PromptFits{}, prompt_large(candidates))

type RefRoute is Data:
  RefMailbox{}
  RefAllowed{}
  RefDenied{}
  RefIncident{}
  RefExecution{}
  RefSchedule{}

def ref_route(+local: Bool, message: Bool, readable: Bool, incident: Bool, execution: Bool, schedule: Bool) -> RefRoute:
  Bool.pick(RefRoute, Bool.and(local, message), RefMailbox{},
    Bool.pick(RefRoute, readable, RefAllowed{}, Bool.pick(RefRoute, local,
      Bool.pick(RefRoute, incident, RefIncident{}, Bool.pick(RefRoute, execution, RefExecution{}, Bool.pick(RefRoute, schedule, RefSchedule{}, RefDenied{}))), RefDenied{})))

def scan_request(items: U32, ceiling: U32, +scanned: U32) -> U32:
  Bool.pick(U32, U32.is_ge(scanned, 4096), 0, Bool.pick(U32, U32.is_ge(items, ceiling), 0, U32.min(256, U32.sub(4096, scanned))))

# The state chooses every event/reference observation. Native ports perform
# only the requested read, with current authenticated access to each reference.
type Group is Data:
  VisibilityGroup{refs: +List<String>}

type Walk is Data:
  VisibilityWalk{todo: +List<String>, seen: +List<String>, fuel: U32}

type Visibility is Data:
  VisibilityAllowed{}
  VisibilityDenied{}
  VisibilityWalking{walk: Walk}
  VisibilityChecking{refs: +List<String>, alternatives: +List<Group>, next: Walk}

type Demand is Data:
  VisibilityComplete{visible: Bool}
  VisibilityContinue{state: Visibility}
  VisibilityNeedEvent{id: String}
  VisibilityNeedRef{key: String}

def visibility_start(operator: Bool, root: String) -> Visibility:
  Bool.pick(Visibility, operator, VisibilityAllowed{}, VisibilityWalking{VisibilityWalk{Con{root, Nil{}}, Nil{}, 64}})

def walk_demand(todo: +List<String>, +seen: +List<String>, +fuel: U32) -> Demand:
  match todo:
    case Nil{}:
      VisibilityComplete{True{}}
    case Con{+head, tail}:
      Bool.pick(Demand, U32.is_zero(fuel), VisibilityComplete{False{}}, Bool.pick(Demand, Text.contains(seen, head), VisibilityContinue{VisibilityWalking{VisibilityWalk{tail, seen, U32.sub(fuel, 1)}}}, VisibilityNeedEvent{head}))

def check_demand(refs: +List<String>, alternatives: +List<Group>, next: Walk) -> Demand:
  match refs:
    case Nil{}:
      VisibilityContinue{VisibilityWalking{next}}
    case Con{key, tail}:
      VisibilityNeedRef{key}

def visibility_demand(state: Visibility) -> Demand:
  match state:
    case VisibilityAllowed{}:
      VisibilityComplete{True{}}
    case VisibilityDenied{}:
      VisibilityComplete{False{}}
    case VisibilityWalking{VisibilityWalk{todo, seen, fuel}}:
      walk_demand(todo, seen, fuel)
    case VisibilityChecking{refs, alternatives, next}:
      check_demand(refs, alternatives, next)

def groups(items: +List<Group>, next: Walk) -> Visibility:
  match items:
    case Nil{}:
      VisibilityDenied{}
    case Con{VisibilityGroup{Nil{}}, tail}:
      groups(tail, next)
    case Con{VisibilityGroup{Con{head, rest}}, tail}:
      VisibilityChecking{Con{head, rest}, tail, next}

type EventObservation is Data:
  VisibilityMissingEvent{}
  VisibilityEvent{id: String, context: String, groups: +List<Group>, causes: +List<String>}

def observed_event(event: EventObservation, expected: String, tail: +List<String>, +seen: +List<String>, fuel: U32, context: String) -> Visibility:
  match event:
    case VisibilityMissingEvent{}:
      VisibilityDenied{}
    case VisibilityEvent{+id, owner, alternatives, causes}:
      Bool.pick(Visibility, Bool.and(String.eq(id, expected), String.eq(owner, context)),
        groups(alternatives, VisibilityWalk{List.append(&2, String, Text.unseen_fold(causes, Con{id, seen}, Nil{}), tail), Con{id, seen}, U32.sub(fuel, 1)}), VisibilityDenied{})

def walk_event(todo: +List<String>, seen: +List<String>, +fuel: U32, event: EventObservation, context: String) -> Visibility:
  match todo:
    case Nil{}:
      VisibilityDenied{}
    case Con{head, tail}:
      Bool.pick(Visibility, U32.is_zero(fuel), VisibilityDenied{}, observed_event(event, head, tail, seen, fuel, context))

def visibility_event(state: Visibility, event: EventObservation, context: String) -> Visibility:
  match state:
    case VisibilityWalking{VisibilityWalk{todo, seen, fuel}}:
      walk_event(todo, seen, fuel, event, context)
    case _:
      VisibilityDenied{}

def checked_ref(refs: +List<String>, alternatives: +List<Group>, next: Walk, visible: Bool) -> Visibility:
  match refs visible:
    case Nil{} _:
      VisibilityDenied{}
    case Con{key, tail} True{}:
      VisibilityChecking{tail, alternatives, next}
    case Con{key, tail} False{}:
      groups(alternatives, next)

def visibility_ref(state: Visibility, visible: Bool) -> Visibility:
  match state:
    case VisibilityChecking{refs, alternatives, next}:
      checked_ref(refs, alternatives, next, visible)
    case _:
      VisibilityDenied{}
