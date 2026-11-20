import Base

# These values describe observations. Authority is a separate decision.
type Truth is Data:
  Yes{}
  No{}
  Unknown{}

type Decision is Data:
  Permit{}
  Deny{}
  Indeterminate{}

def truth.not(value: Truth) -> Truth:
  match value:
    case Yes{}:
      No{}
    case No{}:
      Yes{}
    case Unknown{}:
      Unknown{}

def truth.and(left: Truth, right: Truth) -> Truth:
  match left:
    case No{}:
      No{}
    case Yes{}:
      right
    case Unknown{}:
      match right:
        case No{}:
          No{}
        case Yes{}:
          Unknown{}
        case Unknown{}:
          Unknown{}

def truth.or(left: Truth, right: Truth) -> Truth:
  match left:
    case Yes{}:
      Yes{}
    case No{}:
      right
    case Unknown{}:
      match right:
        case Yes{}:
          Yes{}
        case No{}:
          Unknown{}
        case Unknown{}:
          Unknown{}

def truth.all(values: +List<Truth>) -> Truth:
  match values:
    case Nil{}:
      Yes{}
    case Con{head, tail}:
      truth.and(head, truth.all(tail))

def truth.any(values: +List<Truth>) -> Truth:
  match values:
    case Nil{}:
      No{}
    case Con{head, tail}:
      truth.or(head, truth.any(tail))

def policy.combine(denies: Truth, permits: Truth) -> Decision:
  match denies:
    case Yes{}:
      Deny{}
    case Unknown{}:
      Indeterminate{}
    case No{}:
      match permits:
        case Yes{}:
          Permit{}
        case No{}:
          Deny{}
        case Unknown{}:
          Indeterminate{}

def policy(denies: +List<Truth>, permits: +List<Truth>) -> Decision:
  policy.combine(truth.any(denies), truth.any(permits))

# Native codecs supply exact canonical strings and finite binary64 order keys.
def same_text(left: String, right: String) -> Bool:
  String.eq(left, right)

def same_scope(asys: String, actx: String, bsys: String, bctx: String) -> Bool:
  Bool.and(String.eq(asys, bsys), String.eq(actx, bctx))

def same_ref(asys: String, actx: String, aid: String, bsys: String, bctx: String, bid: String) -> Bool:
  Bool.and(same_scope(asys, actx, bsys, bctx), String.eq(aid, bid))

def text_contains(values: +List<String>, +needle: String) -> Bool:
  match values:
    case Nil{}:
      False{}
    case Con{head, tail}:
      Bool.or(String.eq(head, needle), text_contains(tail, needle))

def text_subset(child: +List<String>, +parent: +List<String>) -> Bool:
  match child:
    case Nil{}:
      True{}
    case Con{head, tail}:
      Bool.and(text_contains(parent, head), text_subset(tail, parent))

def incident_scope(parent_all: Bool, child_all: Bool, child: +List<String>, parent: +List<String>) -> Bool:
  match parent_all:
    case True{}:
      True{}
    case False{}:
      match child_all:
        case True{}:
          False{}
        case False{}:
          text_subset(child, parent)

type Rank is Data:
  Rank{high: U32, low: U32}

def ordered_le(+left_high: U32, left_low: U32, +right_high: U32, right_low: U32) -> Bool:
  Bool.or(U32.is_lt(left_high, right_high), Bool.and(U32.is_eq(left_high, right_high), U32.is_le(left_low, right_low)))

def rank_le(left: Rank, right: Rank) -> Bool:
  Rank{ah, al} = left
  Rank{bh, bl} = right
  ordered_le(ah, al, bh, bl)

def deadline(parent_present: Bool, child_present: Bool, child: Rank, parent: Rank) -> Bool:
  match parent_present:
    case False{}:
      True{}
    case True{}:
      Bool.and(child_present, rank_le(child, parent))

def within(visited: Nat, depth: Nat, nodes: Nat, maximum_depth: Nat) -> Bool:
  Bool.and(Nat.is_le(visited, nodes), Nat.is_le(depth, maximum_depth))

def fits(child: +List<Rank>, parent: +List<Rank>) -> Bool:
  match child:
    case Nil{}:
      match parent:
        case Nil{}:
          True{}
        case Con{head, tail}:
          False{}
    case Con{head, tail}:
      match parent:
        case Nil{}:
          False{}
        case Con{limit, rest}:
          Bool.and(rank_le(head, limit), fits(tail, rest))

type Support is Data:
  Absent{}
  Asserted{}
  Withdrawn{}

type Edit is Data:
  Insert{}
  Keep{}
  Missing{}
  Conflict{}

def record_edit(exists: Bool, same_digest: Bool) -> Edit:
  match exists:
    case False{}:
      Insert{}
    case True{}:
      match same_digest:
        case True{}:
          Keep{}
        case False{}:
          Conflict{}

def assertion_edit(local_record: Bool, same_digest: Bool, support: Support) -> Edit:
  match local_record:
    case False{}:
      Missing{}
    case True{}:
      match support:
        case Absent{}:
          Insert{}
        case Withdrawn{}:
          Conflict{}
        case Asserted{}:
          record_edit(True{}, same_digest)
