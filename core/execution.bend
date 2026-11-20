import Base

type State is Data:
  RunQueued{}
  RunLeased{}
  RunRunning{}
  RunCancelling{}
  RunUncertain{}
  RunSucceeded{}
  RunFailed{}
  RunCancelled{}

type Outcome is Data:
  RunSuccess{}
  RunFailure{}
  RunCancellation{}
  RunUnobserved{}

type Action is Data:
  RunClaim{}
  RunHeartbeat{}
  RunFinish{outcome: Outcome}
  RunCancel{}
  RunLost{}
  RunRetry{}
  RunObserved{outcome: Outcome}

# An accepted state decision supplies no lease, provider identity or evidence.
# Native ports must still validate those observations and current authority.
type Step is Data:
  RunNext{state: State, cancellation: Bool, authority: Bool, immediate: Bool}
  RunNotClaimable{}
  RunInactive{}
  RunDispatchRequired{}
  RunNotUncertain{}

def terminal(state: State) -> Bool:
  match state:
    case RunSucceeded{}:
      True{}
    case RunFailed{}:
      True{}
    case RunCancelled{}:
      True{}
    case rest:
      False{}

def result(outcome: Outcome) -> State:
  match outcome:
    case RunSuccess{}:
      RunSucceeded{}
    case RunFailure{}:
      RunFailed{}
    case RunCancellation{}:
      RunCancelled{}
    case RunUnobserved{}:
      RunUncertain{}

def finish_leased(outcome: Outcome) -> Step:
  match outcome:
    case RunSuccess{}:
      RunDispatchRequired{}
    case RunFailure{}:
      RunDispatchRequired{}
    case RunCancellation{}:
      RunNext{RunCancelled{}, False{}, False{}, False{}}
    case RunUnobserved{}:
      RunNext{RunUncertain{}, False{}, False{}, False{}}

def step(state: State, action: Action) -> Step:
  match state action:
    case RunQueued{} RunClaim{}:
      RunNext{RunLeased{}, False{}, True{}, False{}}
    case state RunClaim{}:
      RunNotClaimable{}
    case RunLeased{} RunHeartbeat{}:
      RunNext{RunRunning{}, False{}, True{}, False{}}
    case RunRunning{} RunHeartbeat{}:
      RunNext{RunRunning{}, False{}, True{}, False{}}
    case RunCancelling{} RunHeartbeat{}:
      RunNext{RunCancelling{}, False{}, False{}, False{}}
    case state RunHeartbeat{}:
      RunInactive{}
    case RunLeased{} RunFinish{outcome}:
      finish_leased(outcome)
    case RunRunning{} RunFinish{outcome}:
      RunNext{result(outcome), False{}, False{}, False{}}
    case RunCancelling{} RunFinish{outcome}:
      RunNext{result(outcome), False{}, False{}, False{}}
    case state RunFinish{outcome}:
      RunInactive{}
    case RunQueued{} RunCancel{}:
      RunNext{RunCancelled{}, True{}, False{}, True{}}
    case RunLeased{} RunCancel{}:
      RunNext{RunCancelling{}, True{}, False{}, False{}}
    case RunRunning{} RunCancel{}:
      RunNext{RunCancelling{}, True{}, False{}, False{}}
    case RunCancelling{} RunCancel{}:
      RunNext{RunCancelling{}, True{}, False{}, False{}}
    case RunUncertain{} RunCancel{}:
      RunNext{RunUncertain{}, True{}, False{}, False{}}
    case state RunCancel{}:
      RunNext{state, False{}, False{}, False{}}
    case state RunLost{}:
      RunNext{RunUncertain{}, False{}, False{}, False{}}
    case RunUncertain{} RunRetry{}:
      RunNext{RunQueued{}, False{}, True{}, False{}}
    case state RunRetry{}:
      RunNotUncertain{}
    case RunUncertain{} RunObserved{outcome}:
      RunNext{result(outcome), False{}, False{}, False{}}
    case state RunObserved{outcome}:
      RunNotUncertain{}
