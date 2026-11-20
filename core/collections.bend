import Base

def contains_fold(values: +List<String>, +needle: String, hit: Bool) -> Bool:
  match values:
    case Nil{}:
      hit
    case Con{head, tail}:
      contains_fold(tail, needle, Bool.or(hit, String.eq(head, needle)))

def contains(values: +List<String>, needle: String) -> Bool:
  contains_fold(values, needle, False{})

def subset_fold(values: +List<String>, +parent: +List<String>, accepted: Bool) -> Bool:
  match values:
    case Nil{}:
      accepted
    case Con{head, tail}:
      subset_fold(tail, parent, Bool.and(accepted, contains(parent, head)))

def subset(values: +List<String>, parent: +List<String>) -> Bool:
  subset_fold(values, parent, True{})

def unique_fold(values: +List<String>, +seen: +List<String>, +reversed: +List<String>) -> +List<String>:
  match values:
    case Nil{}:
      List.reverse(&2, String, reversed)
    case Con{head, tail}:
      +value = head
      +present = contains(seen, value)
      unique_fold(tail, Bool.pick(+List<String>, present, seen, Con{value, seen}), Bool.pick(+List<String>, present, reversed, Con{value, reversed}))

def union(left: +List<String>, right: +List<String>) -> +List<String>:
  unique_fold(List.append(&2, String, left, right), Nil{}, Nil{})

def intersection_fold(values: +List<String>, +allowed: +List<String>, +reversed: +List<String>) -> +List<String>:
  match values:
    case Nil{}:
      List.reverse(&2, String, reversed)
    case Con{head, tail}:
      +value = head
      intersection_fold(tail, allowed, Bool.pick(+List<String>, contains(allowed, value), Con{value, reversed}, reversed))

def intersection(values: +List<String>, allowed: +List<String>) -> +List<String>:
  intersection_fold(values, allowed, Nil{})

def unseen_fold(values: +List<String>, +seen: +List<String>, +reversed: +List<String>) -> +List<String>:
  match values:
    case Nil{}:
      reversed
    case Con{head, tail}:
      +value = head
      unseen_fold(tail, seen, Bool.pick(+List<String>, contains(seen, value), reversed, Con{value, reversed}))
