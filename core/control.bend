import Base
import ./collections.bend as Text

# Paths are decoded JSON Pointer tokens, not authority to read their target.
type Path is Data:
  ProjectionPath{tokens: +List<String>}

type Projection is Data:
  ProjectionAllowed{}
  ProjectionTooMany{}
  ProjectionUnknown{}
  ProjectionSchemaHidden{}

def field(path: +List<String>) -> Bool:
  match path:
    case Nil{}:
      True{}
    case Con{head, tail}:
      +name = head
      Bool.or(Bool.or(String.eq(name, "value"), String.eq(name, "ref")),
        Bool.and(List.is_empty(&2, String, tail), Text.contains(Con{"support", Con{"digest", Con{"revision", Con{"recordedAt", Con{"recordedBy", Nil{}}}}}}, name)))

def schema_name(path: +List<String>) -> Bool:
  match path:
    case Nil{}:
      True{}
    case Con{head, tail}:
      Bool.and(String.eq(head, "name"), List.is_empty(&2, String, tail))

def schema_tail(path: +List<String>) -> Bool:
  match path:
    case Nil{}:
      True{}
    case Con{head, tail}:
      Bool.and(String.eq(head, "schema"), schema_name(tail))

def schema_path(path: +List<String>) -> Bool:
  match path:
    case Nil{}:
      True{}
    case Con{head, tail}:
      Bool.and(String.eq(head, "value"), schema_tail(tail))

def fields(paths: +List<Path>) -> Bool:
  match paths:
    case Nil{}:
      True{}
    case Con{ProjectionPath{path}, tail}:
      Bool.and(field(path), fields(tail))

def schema_visible(paths: +List<Path>) -> Bool:
  match paths:
    case Nil{}:
      False{}
    case Con{ProjectionPath{path}, tail}:
      Bool.or(schema_path(path), schema_visible(tail))

def projection_room(count: U32) -> Bool:
  U32.is_le(count, 64)

def projection(count: U32, +paths: +List<Path>, schema: Bool) -> Projection:
  Bool.pick(Projection, Bool.not(projection_room(count)), ProjectionTooMany{},
    Bool.pick(Projection, fields(paths),
      Bool.pick(Projection, Bool.and(schema, Bool.not(schema_visible(paths))), ProjectionSchemaHidden{}, ProjectionAllowed{}), ProjectionUnknown{}))

type Change is Data:
  DeclaredChange{id: String}
  ExistingChange{}

type Proposal is Data:
  ProposalAllowed{}
  ProposalStale{}
  ProposalEmpty{}
  ProposalAlias{}

def aliases(changes: +List<Change>, +id: String) -> Bool:
  match changes:
    case Nil{}:
      False{}
    case Con{DeclaredChange{other}, tail}:
      Bool.or(String.eq(other, id), aliases(tail, id))
    case Con{ExistingChange{}, tail}:
      aliases(tail, id)

def proposal(id: String, basis: String, expected: String, policy: String, current: String, +changes: +List<Change>, executions: U32) -> Proposal:
  Bool.pick(Proposal, Bool.and(String.eq(basis, expected), String.eq(policy, current)),
    Bool.pick(Proposal, Bool.and(List.is_empty(&2, Change, changes), U32.is_eq(executions, 0)), ProposalEmpty{},
      Bool.pick(Proposal, aliases(changes, id), ProposalAlias{}, ProposalAllowed{})), ProposalStale{})

type Commit is Data:
  CommitAllowed{}
  CommitTerminal{}
  CommitStale{}

def commit(state: String, recorded: String, current: String, policy: String, selected: String) -> Commit:
  Bool.pick(Commit, String.eq(state, "proposed"),
    Bool.pick(Commit, Bool.and(String.eq(recorded, current), String.eq(policy, selected)), CommitAllowed{}, CommitStale{}), CommitTerminal{})

type ExecutionItem is Data:
  PlanExecution{id: String, incident: String}

type Plan is Data:
  PlanAllowed{}
  PlanIncident{}
  PlanAlias{}

def declared(changes: +List<Change>) -> +List<String>:
  match changes:
    case Nil{}:
      Nil{}
    case Con{DeclaredChange{id}, tail}:
      Con{id, declared(tail)}
    case Con{ExistingChange{}, tail}:
      declared(tail)

def executions(items: +List<ExecutionItem>, +incident: String, +seen: +List<String>) -> Plan:
  match items:
    case Nil{}:
      PlanAllowed{}
    case Con{PlanExecution{id, selected}, tail}:
      +key = id
      Bool.pick(Plan, String.eq(selected, incident),
        Bool.pick(Plan, Text.contains(seen, key), PlanAlias{}, executions(tail, incident, Con{key, seen})), PlanIncident{})

def plan(id: String, incident: String, changes: +List<Change>, items: +List<ExecutionItem>) -> Plan:
  executions(items, incident, Con{id, declared(changes)})

def visible(present: Bool, incident: Bool, operator: Bool, origin: String, principal: String, grant: String, chain: +List<String>, readable: Bool) -> Bool:
  Bool.and(Bool.and(present, incident), Bool.or(operator, Bool.or(readable, Bool.and(String.eq(origin, principal), Text.contains(chain, grant)))))

def namespace(names: +List<String>) -> Bool:
  match names:
    case Nil{}:
      False{}
    case Con{head, tail}:
      Bool.or(Text.contains(Con{"policies", Con{"grants", Con{"rules", Con{"capabilities", Con{"schedules", Con{"views", Con{"guidanceSources", Con{"guidanceCaptures", Nil{}}}}}}}}}, head), namespace(tail))

def revoke(operator: Bool, target: String, +bound: String, issuer: String, principal: String, chain: +List<String>) -> Bool:
  Bool.or(operator, Bool.or(String.eq(target, bound), Bool.and(String.eq(issuer, principal), Text.contains(chain, bound))))

def actions(requested: +List<String>, installed: +List<String>, capabilities: +List<String>) -> Bool:
  Text.subset(requested, Text.union(installed, capabilities))

type SchemaAdmission is Data:
  SchemaAllowed{}
  SchemaReserved{}
  SchemaDigest{}
  SchemaConflict{}

def schema(name: String, installed: Bool, +submitted: String, actual: String, present: Bool, previous: String) -> SchemaAdmission:
  Bool.pick(SchemaAdmission, Bool.and(String.starts_with(name, "moment."), Bool.not(installed)), SchemaReserved{},
    Bool.pick(SchemaAdmission, String.eq(submitted, actual),
      Bool.pick(SchemaAdmission, Bool.and(present, Bool.not(String.eq(previous, submitted))), SchemaConflict{}, SchemaAllowed{}), SchemaDigest{}))

def binding_names(names: +List<String>) -> Bool:
  Text.subset(names, Con{"occurrence.id", Con{"occurrence.eventIds", Con{"schedule.id", Con{"contextId", Con{"principalId", Con{"incidentId", Con{"action", Con{"resourceRefs", Con{"contextRevision", Con{"now", Con{"event.id", Con{"event.ids", Con{"event.type", Con{"event.subjectRefs", Nil{}}}}}}}}}}}}}}})
