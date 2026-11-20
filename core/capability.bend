import Base
import ./collections.bend as Text

type Schema is Data:
  CapSchema{name: String, version: String, digest: String}

def schema_equal(left: Schema, right: Schema) -> Bool:
  CapSchema{an, av, ad} = left
  CapSchema{bn, bv, bd} = right
  Bool.and(String.eq(an, bn), Bool.and(String.eq(av, bv), String.eq(ad, bd)))

type Advertisement is Data:
  CapAdvertisement{identity: String, provider: String, name: String, version: String, input: Schema, output: Schema, features: +List<String>, isolation: String}

type Requirement is Data:
  CapRequirement{versions: +List<String>, input: Schema, output: Schema, features: +List<String>, isolation: +List<String>}

type Scope is Data:
  CapScope{actions: +List<String>, resources: +List<String>, all_incidents: Bool}

def grant_fold(scopes: +List<Scope>, +name: String, +identity: String, accepted: Bool) -> Bool:
  match scopes:
    case Nil{}:
      accepted
    case Con{head, tail}:
      CapScope{actions, resources, all_incidents} = head
      grant_fold(tail, name, identity, Bool.and(accepted, Bool.and(Text.contains(actions, name), Text.contains(resources, identity))))

def incident_fold(scopes: +List<Scope>, required: Bool) -> Bool:
  match scopes:
    case Nil{}:
      required
    case Con{head, tail}:
      CapScope{actions, resources, all_incidents} = head
      incident_fold(tail, Bool.or(required, Bool.not(all_incidents)))

def reason(accepted: Bool, label: String, +rest: +List<String>) -> +List<String>:
  Bool.pick(+List<String>, accepted, rest, Con{label, rest})

def compatibility(advertisement: Advertisement, requirement: Requirement, +scopes: +List<Scope>, expired: Bool) -> +List<String>:
  CapAdvertisement{identity, provider, +name, version, input, output, features, isolation} = advertisement
  CapRequirement{versions, requested_input, requested_output, requested_features, requested_isolation} = requirement
  reason(Text.contains(versions, version), "version",
    reason(schema_equal(input, requested_input), "inputSchema",
      reason(schema_equal(output, requested_output), "outputSchema",
        reason(Text.subset(requested_features, features), "features",
          reason(Text.contains(requested_isolation, isolation), "isolation",
            reason(Bool.not(expired), "expired",
              reason(Bool.and(Bool.not(List.is_empty(&2, Scope, scopes)), grant_fold(scopes, name, identity, True{})), "grant", Nil{})))))))

type Eligibility is Data:
  CapEligible{}
  CapIneligible{}
  CapUnknown{}

type Assessment is Data:
  CapNeedsPolicy{}
  CapAssessment{unmet: +List<String>, eligibility: Eligibility}

def basis_result(+unmet: +List<String>, incident_required: Bool) -> Assessment:
  +has_unmet = Bool.not(List.is_empty(&2, String, unmet))
  Bool.pick(Assessment, incident_required,
    CapAssessment{List.append(&2, String, unmet, Con{"incident_required", Nil{}}), Bool.pick(Eligibility, has_unmet, CapIneligible{}, CapUnknown{})},
    Bool.pick(Assessment, has_unmet, CapAssessment{unmet, CapIneligible{}}, CapNeedsPolicy{}))

def basis(advertisement: Advertisement, requirement: Requirement, +scopes: +List<Scope>, expired: Bool, incident_present: Bool) -> Assessment:
  basis_result(compatibility(advertisement, requirement, scopes, expired), Bool.and(Bool.not(incident_present), incident_fold(scopes, False{})))

type PolicyObservation is Data:
  CapPolicyAllowed{}
  CapPolicyDenied{}
  CapPolicyUnknown{}
  CapPolicyMissing{}

def policy_result(policy: PolicyObservation) -> Assessment:
  match policy:
    case CapPolicyAllowed{}:
      CapAssessment{Nil{}, CapEligible{}}
    case CapPolicyDenied{}:
      CapAssessment{Con{"policy", Nil{}}, CapIneligible{}}
    case _:
      CapAssessment{Con{"policy_unknown", Nil{}}, CapUnknown{}}

def finish(assessment: Assessment, policy: PolicyObservation) -> Assessment:
  match assessment:
    case CapNeedsPolicy{}:
      policy_result(policy)
    case ready:
      ready

def eligibility_rank(value: Eligibility) -> U32:
  match value:
    case CapEligible{}:
      0
    case CapUnknown{}:
      1
    case CapIneligible{}:
      2

def compare_fields(+left_rank: U32, +right_rank: U32, +left_count: U32, +right_count: U32, left_id: String, right_id: String) -> Cmp:
  Bool.pick(Cmp, U32.is_lt(left_rank, right_rank), LT{}, Bool.pick(Cmp, U32.is_lt(right_rank, left_rank), GT{},
    Bool.pick(Cmp, U32.is_lt(left_count, right_count), LT{}, Bool.pick(Cmp, U32.is_lt(right_count, left_count), GT{}, String.order(left_id, right_id)))))

def compare(left: Eligibility, left_count: U32, left_id: String, right: Eligibility, right_count: U32, right_id: String) -> Cmp:
  compare_fields(eligibility_rank(left), eligibility_rank(right), left_count, right_count, left_id, right_id)

type Publication is Data:
  CapPublishAllowed{}
  CapRetentionFull{}
  CapWrongProvider{}
  CapReservedName{}
  CapExpired{}

def room(count: U32) -> Bool:
  U32.is_lt(count, 4096)

def publish(advertisement: Advertisement, principal: String, methods: +List<String>, count: U32, expired: Bool) -> Publication:
  CapAdvertisement{identity, provider, name, version, input, output, features, isolation} = advertisement
  Bool.pick(Publication, room(count), Bool.pick(Publication, String.eq(provider, principal),
    Bool.pick(Publication, Text.contains(methods, name), CapReservedName{}, Bool.pick(Publication, expired, CapExpired{}, CapPublishAllowed{})), CapWrongProvider{}), CapRetentionFull{})

type ExecutionAdmission is Data:
  CapExecutionAllowed{}
  CapExecutionExpired{}
  CapExecutionClosed{}
  CapExecutionIncident{}

def execution_admission(expired: Bool, context: String, incident_present: Bool, incident_ended: Bool) -> ExecutionAdmission:
  Bool.pick(ExecutionAdmission, expired, CapExecutionExpired{}, Bool.pick(ExecutionAdmission, String.eq(context, "open"),
    Bool.pick(ExecutionAdmission, Bool.and(incident_present, Bool.not(incident_ended)), CapExecutionAllowed{}, CapExecutionIncident{}), CapExecutionClosed{}))

type Preparation is Data:
  CapPrepareAllowed{}
  CapPrepareScope{}
  CapPrepareGrant{}

def prepare(incident: Bool, capability: Bool, operator: Bool, actor: String, requester: String, submitted: String, bound: String, readable: Bool) -> Preparation:
  Bool.pick(Preparation, Bool.and(incident, capability),
    Bool.pick(Preparation, Bool.or(operator, Bool.pick(Bool, String.eq(actor, requester), String.eq(submitted, bound), readable)), CapPrepareAllowed{}, CapPrepareGrant{}), CapPrepareScope{})

def visible(present: Bool, origin_present: Bool, incident: Bool, operator: Bool, +principal: String, requester: String, provider: String, first_grant: String, chain: +List<String>, capability: Bool, readable: Bool) -> Bool:
  Bool.and(present, Bool.and(origin_present, Bool.and(incident, Bool.or(operator,
    Bool.or(Bool.and(String.eq(principal, requester), Text.contains(chain, first_grant)), Bool.or(Bool.and(String.eq(principal, provider), capability), readable))))))

def reconcile(principal: String, provider: String, operator: Bool, readable: Bool) -> Bool:
  Bool.or(String.eq(principal, provider), Bool.or(operator, readable))

def evidence(required: Bool, sources: +List<String>) -> Bool:
  Bool.or(Bool.not(required), Bool.not(List.is_empty(&2, String, sources)))

def selected(advertised: String, requested: String, readable: Bool) -> Bool:
  Bool.and(readable, String.eq(advertised, requested))
