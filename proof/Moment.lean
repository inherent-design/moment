namespace Moment

inductive Truth | yes | no | unknown deriving DecidableEq, Repr
inductive Decision | permit | deny | indeterminate deriving DecidableEq, Repr

def conjunction : Truth → Truth → Truth
  | .no, _ => .no
  | .yes, b => b
  | .unknown, .no => .no
  | .unknown, _ => .unknown

def disjunction : Truth → Truth → Truth
  | .yes, _ => .yes
  | .no, b => b
  | .unknown, .yes => .yes
  | .unknown, _ => .unknown

def negation : Truth → Truth
  | .yes => .no
  | .no => .yes
  | .unknown => .unknown

def combine : Truth → Truth → Decision
  | .yes, _ => .deny
  | .unknown, _ => .indeterminate
  | .no, .yes => .permit
  | .no, .unknown => .indeterminate
  | .no, .no => .deny

theorem deny_precedence (p : Truth) : combine .yes p = .deny := rfl
theorem unknown_deny_blocks_permit : combine .unknown .yes = .indeterminate := rfl
theorem positive_permit : combine .no .yes = .permit := rfl
theorem conjunction_commutes (a b : Truth) : conjunction a b = conjunction b a := by cases a <;> cases b <;> rfl
theorem disjunction_commutes (a b : Truth) : disjunction a b = disjunction b a := by cases a <;> cases b <;> rfl
theorem negation_involution (a : Truth) : negation (negation a) = a := by cases a <;> rfl

inductive Support | absent | asserted | withdrawn deriving DecidableEq, Repr
inductive Edit | insert | keep | missing | conflict deriving DecidableEq, Repr
def recordEdit (present sameDigest : Bool) : Edit := if !present then .insert else if sameDigest then .keep else .conflict
def assertionEdit (localRecord sameDigest : Bool) (s : Support) : Edit :=
  if !localRecord then .missing else match s with
  | .absent => .insert
  | .withdrawn => .conflict
  | .asserted => recordEdit true sameDigest

theorem withdrawn_final (same : Bool) : assertionEdit true same .withdrawn = .conflict := rfl
theorem missing_support_refused (same : Bool) (s : Support) : assertionEdit false same s = .missing := rfl

#print axioms deny_precedence
#print axioms unknown_deny_blocks_permit
#print axioms positive_permit
#print axioms conjunction_commutes
#print axioms disjunction_commutes
#print axioms negation_involution
#print axioms withdrawn_final
#print axioms missing_support_refused
end Moment

def truthLabel : Moment.Truth → String
  | .yes => "true"
  | .no => "false"
  | .unknown => "unknown"
def decisionLabel : Moment.Decision → String
  | .permit => "permit"
  | .deny => "deny"
  | .indeterminate => "indeterminate"
def supportLabel : Moment.Support → String
  | .absent => "absent"
  | .asserted => "asserted"
  | .withdrawn => "withdrawn"
def editLabel : Moment.Edit → String
  | .insert => "Insert"
  | .keep => "Keep"
  | .missing => "Missing"
  | .conflict => "Conflict"

/-- Bounded executable correspondence cases; these do not replace theorems. -/
def main : IO Unit := do
  let values : List Moment.Truth := [.yes,.no,.unknown]
  for a in values do
    IO.println s!"case|not|{truthLabel a}|{truthLabel (Moment.negation a)}"
    for b in values do
      IO.println s!"case|all|{truthLabel a}|{truthLabel b}|{truthLabel (Moment.conjunction a b)}"
      IO.println s!"case|any|{truthLabel a}|{truthLabel b}|{truthLabel (Moment.disjunction a b)}"
      IO.println s!"case|policy|{truthLabel a}|{truthLabel b}|{decisionLabel (Moment.combine a b)}"
  for present in [false,true] do
    for same in [false,true] do
      IO.println s!"case|record|{present}|{same}|{editLabel (Moment.recordEdit present same)}"
      for support in [Moment.Support.absent,.asserted,.withdrawn] do
        IO.println s!"case|assertion|{present}|{same}|{supportLabel support}|{editLabel (Moment.assertionEdit present same support)}"
