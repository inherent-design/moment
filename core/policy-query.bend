import Base
import ./collections.bend as Text
import ./accounting.bend as Exact

type Budget is Data:
  PQExhausted{}
  PQBudget{remaining: U32}

def initial(+records: U32, +assertions: U32) -> Budget:
  Bool.pick(Budget, Bool.and(U32.is_le(records, 4096), U32.is_le(assertions, 16384)), PQBudget{U32.sub(U32.sub(32768, records), assertions)}, PQExhausted{})

def charge(budget: Budget, +cost: U32) -> Budget:
  match budget:
    case PQExhausted{}:
      PQExhausted{}
    case PQBudget{+remaining}:
      Bool.pick(Budget, U32.is_le(cost, remaining), PQBudget{U32.sub(remaining, cost)}, PQExhausted{})

def available(budget: Budget) -> Bool:
  match budget:
    case PQExhausted{}:
      False{}
    case _:
      True{}

def edge_charge(budget: Budget, subjects: U32, objects: U32) -> Budget:
  charge(charge(charge(budget, 1), subjects), objects)

def charges(costs: +List<U32>, budget: Budget) -> Budget:
  match costs:
    case Nil{}:
      budget
    case Con{head, tail}:
      charges(tail, charge(budget, head))

type Assertion is Data:
  PQAssertion{index: U32, system: String, context: String, issuer: String, record: String, sources: U32}

type Projection is Data:
  PQProjection{budget: Budget, indices: +List<U32>, records: +List<String>, provenance: U32}

def projected(accepted: Bool, index: U32, record: String, +cost: U32, projection: Projection) -> Projection:
  PQProjection{+budget, +indices, +records, +provenance} = projection
  Bool.pick(Projection, accepted, PQProjection{charge(budget, cost), Con{index, indices}, Con{record, records}, U32.add(provenance, cost)}, PQProjection{budget, indices, records, provenance})

def project_step(assertion: Assertion, system: String, context: String, issuers: +List<String>, projection: Projection) -> Projection:
  PQAssertion{index, owner_system, owner_context, issuer, record, sources} = assertion
  projected(Bool.and(String.eq(system, owner_system), Bool.and(String.eq(context, owner_context), Text.contains(issuers, issuer))), index, record, sources, projection)

def project_fold(assertions: +List<Assertion>, +system: String, +context: String, +issuers: +List<String>, projection: Projection) -> Projection:
  match assertions:
    case Nil{}:
      projection
    case Con{head, tail}:
      project_fold(tail, system, context, issuers, project_step(head, system, context, issuers, projection))

def project_finish(projection: Projection) -> Projection:
  PQProjection{budget, indices, records, provenance} = projection
  PQProjection{budget, List.reverse(&2, U32, indices), List.reverse(&2, String, records), provenance}

def project(assertions: +List<Assertion>, system: String, context: String, issuers: +List<String>, budget: Budget) -> Projection:
  project_finish(project_fold(assertions, system, context, issuers, PQProjection{budget, Nil{}, Nil{}, 0}))

def readable_fold(values: +List<Bool>, accepted: Bool) -> Bool:
  match values:
    case Nil{}:
      accepted
    case Con{head, tail}:
      readable_fold(tail, Bool.and(accepted, head))

def supported(status: String, sources: +List<Bool>) -> Bool:
  Bool.and(String.eq(status, "asserted"), readable_fold(sources, True{}))

def selected(kind: String, schema: String, names: +List<String>, readable: Bool, asserted: Bool) -> Bool:
  Bool.and(String.eq(kind, "relation"), Bool.and(Text.contains(names, schema), Bool.and(readable, asserted)))

type Verdict is Data:
  PQYes{}
  PQNo{}
  PQUnknown{}

def observed(found: Bool, operator: Bool) -> Verdict:
  Bool.pick(Verdict, found, PQYes{}, Bool.pick(Verdict, operator, PQNo{}, PQUnknown{}))

type Header is Data:
  PQHeader{index: U32, subjects: U32, objects: U32}

type Plan is Data:
  PQPlan{budget: Budget, indices: +List<U32>, omitted: Bool}

def plan_step(header: Header, plan: Plan) -> Plan:
  PQHeader{index, subjects, objects} = header
  PQPlan{+budget, +indices, +omitted} = plan
  +next = edge_charge(budget, subjects, objects)
  Bool.pick(Plan, Bool.or(omitted, Bool.not(available(next))), PQPlan{budget, indices, True{}}, PQPlan{next, Con{index, indices}, False{}})

def plan_fold(headers: +List<Header>, plan: Plan) -> Plan:
  match headers:
    case Nil{}:
      plan
    case Con{head, tail}:
      plan_fold(tail, plan_step(head, plan))

def plan_finish(plan: Plan) -> Plan:
  PQPlan{budget, indices, omitted} = plan
  PQPlan{budget, List.reverse(&2, U32, indices), omitted}

def plan(headers: +List<Header>, budget: Budget) -> Plan:
  plan_finish(plan_fold(headers, PQPlan{budget, Nil{}, False{}}))

type Target is Data:
  PQTarget{key: String, readable: Bool}

type Edge is Data:
  PQEdge{subject_count: Exact.Count, target_count: Exact.Count, subjects: +List<String>, targets: +List<Target>}
  PQOmittedEdge{}

type Traversal is Data:
  PQFound{budget: Budget}
  PQUnresolved{budget: Budget}
  PQAdvance{budget: Budget, next: +List<String>, seen: +List<String>, count: U32}

def target_fields(traversal: Traversal, +key: String, readable: Bool, destination: String) -> Traversal:
  match traversal:
    case PQAdvance{+budget, +next, +seen, +count}:
      Bool.pick(Traversal, readable, Bool.pick(Traversal, String.eq(key, destination), PQFound{budget},
        Bool.pick(Traversal, Text.contains(seen, key), PQAdvance{budget, next, seen, count},
          Bool.pick(Traversal, U32.is_lt(count, 512), PQAdvance{budget, Con{key, next}, Con{key, seen}, U32.inc(count)}, PQUnresolved{budget}))), PQAdvance{budget, next, seen, count})
    case settled:
      settled

def target_step(target: Target, destination: String, traversal: Traversal) -> Traversal:
  PQTarget{key, readable} = target
  target_fields(traversal, key, readable, destination)

def targets_fold(targets: +List<Target>, +destination: String, traversal: Traversal) -> Traversal:
  match targets:
    case Nil{}:
      traversal
    case Con{head, tail}:
      targets_fold(tail, destination, target_step(head, destination, traversal))

def edge_targets(matched: Bool, targets: +List<Target>, destination: String, traversal: Traversal) -> Traversal:
  match matched:
    case False{}:
      traversal
    case True{}:
      targets_fold(targets, destination, traversal)

def edge_ready(budget: Budget, subjects: +List<String>, targets: +List<Target>, source: String, destination: String, next: +List<String>, seen: +List<String>, count: U32) -> Traversal:
  match budget:
    case PQExhausted{}:
      PQUnresolved{PQExhausted{}}
    case PQBudget{remaining}:
      edge_targets(Text.contains(subjects, source), targets, destination, PQAdvance{PQBudget{remaining}, next, seen, count})

def count_budget(budget: Budget, cost: Exact.Count) -> Budget:
  Exact.BudgetCount{high, low} = cost
  Bool.pick(Budget, U32.is_zero(high), charge(budget, low), PQExhausted{})

def role_budget(subjects: Exact.Count, objects: Exact.Count, budget: Budget) -> Budget:
  count_budget(count_budget(charge(budget, 1), subjects), objects)

def edge_body(edge: Edge, source: String, destination: String, budget: Budget, next: +List<String>, seen: +List<String>, count: U32) -> Traversal:
  match edge:
    case PQOmittedEdge{}:
      PQUnresolved{PQExhausted{}}
    case PQEdge{subject_count, target_count, subjects, targets}:
      edge_ready(role_budget(subject_count, target_count, budget), subjects, targets, source, destination, next, seen, count)

def edge_step(edge: Edge, source: String, destination: String, traversal: Traversal) -> Traversal:
  match traversal:
    case PQAdvance{budget, next, seen, count}:
      edge_body(edge, source, destination, budget, next, seen, count)
    case settled:
      settled

def edges_fold(edges: +List<Edge>, +source: String, +destination: String, traversal: Traversal) -> Traversal:
  match edges:
    case Nil{}:
      traversal
    case Con{head, tail}:
      edges_fold(tail, source, destination, edge_step(head, source, destination, traversal))

def source_step(source: String, edges: +List<Edge>, destination: String, traversal: Traversal) -> Traversal:
  match traversal:
    case PQAdvance{budget, next, seen, count}:
      edges_fold(edges, source, destination, PQAdvance{budget, next, seen, count})
    case settled:
      settled

def sources_fold(sources: +List<String>, +edges: +List<Edge>, +destination: String, traversal: Traversal) -> Traversal:
  match sources:
    case Nil{}:
      traversal
    case Con{head, tail}:
      sources_fold(tail, edges, destination, source_step(head, edges, destination, traversal))

type Search is Data:
  PQDone{verdict: Verdict, budget: Budget}
  PQSearch{frontier: +List<String>, seen: +List<String>, count: U32, budget: Budget}

def layer_result(traversal: Traversal, operator: Bool) -> Search:
  match traversal:
    case PQFound{budget}:
      PQDone{PQYes{}, budget}
    case PQUnresolved{budget}:
      PQDone{PQUnknown{}, budget}
    case PQAdvance{+budget, +next, seen, count}:
      Bool.pick(Search, List.is_empty(&2, String, next), PQDone{observed(False{}, operator), budget}, PQSearch{List.reverse(&2, String, next), seen, count, budget})

def layer(search: Search, edges: +List<Edge>, destination: String, operator: Bool) -> Search:
  match search:
    case PQSearch{frontier, seen, count, budget}:
      layer_result(sources_fold(frontier, edges, destination, PQAdvance{budget, Nil{}, seen, count}), operator)
    case settled:
      settled

def layers(hops: Nat, +edges: +List<Edge>, +destination: String, +operator: Bool, search: Search) -> Search:
  match hops:
    case 0n:
      search
    case 1n+p:
      layers(p, edges, destination, operator, layer(search, edges, destination, operator))

def search_finish(search: Search, operator: Bool) -> Search:
  match search:
    case PQSearch{frontier, seen, count, budget}:
      PQDone{observed(False{}, operator), budget}
    case settled:
      settled

def related_budget(budget: Budget, edges: +List<Edge>, +start: String, destination: String, hops: Nat, +operator: Bool) -> Search:
  match budget:
    case PQExhausted{}:
      PQDone{PQUnknown{}, PQExhausted{}}
    case PQBudget{remaining}:
      search_finish(layers(hops, edges, destination, operator, PQSearch{Con{start, Nil{}}, Con{start, Nil{}}, 1, PQBudget{remaining}}), operator)

def related(edges: +List<Edge>, start: String, destination: String, hops: Nat, operator: Bool, budget: Budget) -> Search:
  related_budget(budget, edges, start, destination, hops, operator)
