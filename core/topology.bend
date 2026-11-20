import Base

type Edge is Data:
  TopEdge{source: U32, target: U32}

type Verdict is Data:
  TopGood{}
  TopParents{}
  TopCycle{}
  TopInvalid{}

type Build is Type:
  TopBuilt{degree: Array<U32>, next: Array<List<&2, U32>>, parent: Array<U32>}
  TopBadParents{}
  TopBadIndex{}

type Sorted is Type:
  TopSorted{rank: Array<U32>, visited: U32}
  TopExhausted{}

def unpack(-A: Type, -B: Type, -R: Type, pair: A & B, continuation: A -> B -> R) -> R:
  (a, b) = pair
  continuation(a, b)

def parent_allows(exclusive: Bool, +old: U32, target: U32) -> Bool:
  Bool.or(Bool.not(exclusive), Bool.or(U32.is_zero(old), U32.is_eq(old, U32.inc(target))))

def enqueue(hit: Bool, item: U32, rest: List<&2, U32>) -> List<&2, U32>:
  match hit:
    case True{}:
      Con{item, rest}
    case False{}:
      rest

def add_checked(allowed: Bool, +source: U32, +target: U32, count: U32, degree: Array<U32>, next: Array<List<&2, U32>>, parent: Array<U32>) -> Build:
  match allowed:
    case False{}:
      TopBadParents{}
    case True{}:
      degree[target] <- U32.inc(count)
      parent[source] <- U32.inc(target)
      unpack(Array<List<&2, U32>>, List<&2, U32>, Build, Array.get(List<&2, U32>, next, source), ns => refs =>
        TopBuilt{degree, Array.set(List<&2, U32>, ns, source, Con{target, refs}), parent})

def add_indexed(valid: Bool, exclusive: Bool, +source: U32, +target: U32, degree: Array<U32>, next: Array<List<&2, U32>>, parent: Array<U32>) -> Build:
  match valid:
    case False{}:
      TopBadIndex{}
    case True{}:
      unpack(Array<U32>, U32, Build, degree[target], ds => count =>
        unpack(Array<U32>, U32, Build, parent[source], ps => old =>
          add_checked(parent_allows(exclusive, old, target), source, target, count, ds, next, ps)))

def add(state: Build, edge: Edge, exclusive: Bool, +size: U32) -> Build:
  match state:
    case TopBadParents{}:
      TopEdge{source, target} = edge
      Bool.pick(Build, Bool.and(U32.is_lt(source, size), U32.is_lt(target, size)), TopBadParents{}, TopBadIndex{})
    case TopBadIndex{}:
      TopBadIndex{}
    case TopBuilt{degree, next, parent}:
      TopEdge{a, b} = edge
      +source = a
      +target = b
      add_indexed(Bool.and(U32.is_lt(source, size), U32.is_lt(target, size)), exclusive, source, target, degree, next, parent)

def prepare(edges: +List<Edge>, state: Build, +exclusive: Bool, +size: U32) -> Build:
  match edges:
    case Nil{}:
      state
    case Con{head, tail}:
      prepare(tail, add(state, head, exclusive, size), exclusive, size)

def zeros(fuel: Nat, +index: U32, degree: Array<U32>, queue: List<&2, U32>) -> Array<U32> & List<&2, U32>:
  match fuel:
    case 0n:
      (degree, queue)
    case 1n+rest:
      unpack(Array<U32>, U32, Array<U32> & List<&2, U32>, degree[index], ds => count =>
        zeros(rest, U32.inc(index), ds, enqueue(U32.is_zero(count), index, queue)))

def release_one(+target: U32, queue: List<&2, U32>, pair: Array<U32> & U32) -> Array<U32> & List<&2, U32>:
  (degree, +count) = pair
  degree[target] <- U32.sub(count, 1)
  (degree, enqueue(U32.is_eq(count, 1), target, queue))

def release(targets: +List<U32>, degree: Array<U32>, queue: List<&2, U32>) -> Array<U32> & List<&2, U32>:
  match targets:
    case Nil{}:
      (degree, queue)
    case Con{head, tail}:
      +target = head
      unpack(Array<U32>, List<&2, U32>, Array<U32> & List<&2, U32>, release_one(target, queue, degree[target]), ds => qs =>
        release(tail, ds, qs))

def walk(fuel: Nat, queue: +List<U32>, +count: U32, degree: Array<U32>, next: Array<List<&2, U32>>, rank: Array<U32>) -> Sorted:
  match fuel queue:
    case 0n _:
      TopExhausted{}
    case 1n+rest Nil{}:
      TopSorted{rank, count}
    case 1n+rest Con{head, tail}:
      +node = head
      rank[node] <- count
      unpack(Array<List<&2, U32>>, List<&2, U32>, Sorted, Array.get(List<&2, U32>, next, node), ns => targets =>
        unpack(Array<U32>, List<&2, U32>, Sorted, release(targets, degree, tail), ds => qs =>
          walk(rest, qs, U32.inc(count), ds, ns, rank)))

# Check the complete edge set against the produced certificate. A visible
# fragment or a sorting result alone is insufficient for graph admission.
def certify(edges: +List<Edge>, rank: Array<U32>, valid: Bool) -> Verdict:
  match edges:
    case Nil{}:
      Bool.pick(Verdict, valid, TopGood{}, TopInvalid{})
    case Con{head, tail}:
      TopEdge{source, target} = head
      unpack(Array<U32>, U32, Verdict, rank[source], rs => a =>
        unpack(Array<U32>, U32, Verdict, rs[target], rt => b =>
          certify(tail, rt, Bool.and(valid, U32.is_lt(a, b)))))

def finish_count(complete: Bool, edges: +List<Edge>, rank: Array<U32>) -> Verdict:
  match complete:
    case False{}:
      TopCycle{}
    case True{}:
      certify(edges, rank, True{})

def finish(sorted: Sorted, size: U32, edges: +List<Edge>) -> Verdict:
  match sorted:
    case TopExhausted{}:
      TopInvalid{}
    case TopSorted{rank, visited}:
      finish_count(U32.is_eq(visited, size), edges, rank)

def start(state: Build, +size: U32, edges: +List<Edge>, rank: Array<U32>) -> Verdict:
  match state:
    case TopBadParents{}:
      TopParents{}
    case TopBadIndex{}:
      TopInvalid{}
    case TopBuilt{degree, next, parent}:
      unpack(Array<U32>, List<&2, U32>, Verdict, zeros(U32.to_nat(size), 0, degree, Nil{}), ds => queue =>
        finish(walk(Nat.add(U32.to_nat(size), 1n), queue, 0, ds, next, rank), size, edges))

def check(exclusive: Bool, +size: U32, +edges: +List<Edge>, degree: Array<U32>, next: Array<List<&2, U32>>, parent: Array<U32>, rank: Array<U32>) -> Verdict:
  start(prepare(edges, TopBuilt{degree, next, parent}, exclusive, size), size, edges, rank)

type Projection is Data:
  TopSkip{}
  TopWithin{scope: String, source: String, target: String}
  TopBefore{scope: String, source: String, target: String}

def project(active: Bool, structural: Bool, temporal: Bool, context: String, perspective: String, framed: Bool, frame: String, child: String, parent: String, earlier: String, later: String) -> Projection:
  Bool.pick(Projection, active,
    Bool.pick(Projection, structural, TopWithin{perspective, child, parent},
      Bool.pick(Projection, temporal, TopBefore{Bool.pick(String, framed, frame, context), earlier, later}, TopSkip{})),
    TopSkip{})

# Invalid representations refuse; parent conflicts precede cycle errors.
def combine_child(result: Verdict, rest: Verdict) -> Verdict:
  match result rest:
    case TopInvalid{} _:
      TopInvalid{}
    case _ TopInvalid{}:
      TopInvalid{}
    case TopParents{} _:
      TopParents{}
    case _ TopParents{}:
      TopParents{}
    case TopCycle{} _:
      TopCycle{}
    case _ TopCycle{}:
      TopCycle{}
    case _ _:
      TopGood{}

def combine_fold(results: +List<Verdict>, accumulated: Verdict) -> Verdict:
  match results:
    case Nil{}:
      accumulated
    case Con{head, tail}:
      combine_fold(tail, combine_child(accumulated, head))

def combine(results: +List<Verdict>) -> Verdict:
  combine_fold(results, TopGood{})
