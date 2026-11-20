function word_to_u32(w) {
  let x = 0;
  for (let i = 0; w.$ === "WCon"; i++) {
    x |= Number(w.head) << i;
    w = w.tail;
  }
  return x >>> 0;
}

function u32_to_word(x) {
  let w = {$: "WNil"};
  for (let i = 31; i >= 0; i--) {
    w = {$: "WCon", head: ((x >>> i) & 1) === 1, tail: w};
  }
  return w;
}

function cmp_new(a, b) {
  return {$: a < b ? "LT" : a === b ? "EQ" : "GT"};
}

function tup_new(a, b) {
  return {$: "Tuple", fst: a, snd: b};
}

function nat_divmod(a, b) {
  return tup_new(b && Math.trunc(a / b), b ? a % b : a);
}

function nat_chk(n) {
  if (n > 281474976710655) {
    throw "bend: a Nat past the largest immediate 2^48-1";
  }
  return n;
}

function nat_in(n) {
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 53) {
    throw "bend: expected a Nat host number: an integer from 0 to 2^53";
  }
  return n;
}

function f32_show(x) {
  let s = "nan";
  for (let p = 1; x === x && p <= 9 && f32_round(s) !== x; p += 1) {
    s = String(Number(x.toExponential(p - 1)));
  }
  return (Object.is(x, -0) ? "-0" : s).replace("Infinity", "inf");
}

function f32_bits(x) {
  return new Uint32Array(new Float32Array([x]).buffer)[0];
}

function f32_from_bits(u) {
  return new Float32Array(new Uint32Array([u]).buffer)[0];
}

function f32_read(s) {
  const re = /^[\t\n\v\f\r ]*[+-]?((\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?|inf(inity)?|nan)$/i;
  return re.test(s) ? {$: "Some", value: f32_round(
    s.replace(/inf\w*/i, "Infinity"))} : {$: "None"};
}

const f32_round = function f32_round(s) {
  const d = Number(s);
  const a = Math.abs(d);
  const f = Math.fround(a);
  const g = 2 * a - Math.min(f, 2 ** 128);
  if (g === f || Math.fround(g) !== g || g === Infinity) {
    return Math.sign(d) * f;
  }
  let k = 0;
  while (a * 2 ** k % 1 !== 0) {
    k += 1;
  }
  const [, i, r, e] = /(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  const n = Number(e ?? 0) - r.length;
  const x = BigInt(i + r) * 2n ** BigInt(k) * 10n ** BigInt(Math.max(n, 0));
  const y = BigInt(a * 2 ** k) * 10n ** BigInt(Math.max(-n, 0));
  return Math.sign(d) * (x === y || x > y !== g > f ? f : g);
};

const char_new = function char_new(c) {
  return c < 55296 || c >= 57344 && c <= 1114111 ? String.fromCodePoint(c) : String.fromCharCode(56320, c >>> 22, c >>> 11 & 2047, c & 2047);
};

function char_len(s, at = 0) {
  return s[at] === "\uDC00" ? 4 : s.codePointAt(at) > 0xFFFF ? 2 : 1;
}

function char_code(s) {
  return s.length < 4 ? s.codePointAt(0)
    : (s.charCodeAt(1) << 22 | s.charCodeAt(2) << 11 | s.charCodeAt(3)) >>> 0;
}

function string_contains(s, p) {
  // A match starts at a Char, not inside a packed U32 code.
  for (let at = 0; at <= s.length; at += char_len(s, at)) {
    if (s.startsWith(p, at)) {
      return true;
    }
  }
  return false;
}

function str_out(s) {
  return s.replace(/\uDC00[^]{3}/gu, "\uFFFD");
}

function str_in(s) {
  return s.replace(/\p{Cs}/gu, "\uFFFD");
}

// Array
// =====

function array_new(d, v, lgs) {
  if (d > 31 - lgs) {
    throw "bend: an array past the deepest block class 31 (depth + log2 words per cell)";
  }
  return Array(2 ** d).fill(v);
}

function array_node(a, b) {
  if (a.length !== b.length) {
    throw "bend: runtime fail-stop";
  }
  return a.concat(b);
}

function array_rmw(a, i, f) {
  const old = a[i %= a.length];
  a[i] = f(old);
  return tup_new(a, old);
}

// Run
// ===

function run_tail(f, x) {
  return {$: "$JMP", f: f.j?.f === f ? f.j : f, x};
}

function run_clo(j) {
  const f = (x) => run_loop(j(x));
  f.j = j;
  j.f = f;
  return f;
}

function run_loop(r) {
  while (r !== null && typeof r === "object" && r.$ === "$JMP") {
    r = r.f(r.x);
  }
  return r;
}

function run_lib(f, n) {
  return (...a) => a.length < n ? run_lib((...b) => f(...a, ...b), n - a.length)
    : run_loop(f(...a));
}

// Effect
// ======

const $0eff = Object.create(null);
const io_file_append = new Set();

function io_eff(k, run) {
  if (arguments.length > 2) {
    throw new Error("bend: " + k + " takes no need: an effect that waits parks itself");
  }
  if (k in $0eff) {
    throw new Error("bend: two effects register " + k);
  }
  $0eff[k] = run;
}
// Program
// =======

function $execution_terminal(_state_0) {
  if (_state_0.$ === "RunSucceeded") {
    return true;
  } else if (_state_0.$ === "RunFailed") {
    return true;
  } else if (_state_0.$ === "RunCancelled") {
    return true;
  } else {
    return false;
  }
}

function $execution_result(_outcome_0) {
  if (_outcome_0.$ === "RunSuccess") {
    return {$: "RunSucceeded"};
  } else if (_outcome_0.$ === "RunFailure") {
    return {$: "RunFailed"};
  } else if (_outcome_0.$ === "RunCancellation") {
    return {$: "RunCancelled"};
  } else {
    return {$: "RunUncertain"};
  }
}

function $execution_finish_leased(_outcome_0) {
  if (_outcome_0.$ === "RunSuccess") {
    return {$: "RunDispatchRequired"};
  } else if (_outcome_0.$ === "RunFailure") {
    return {$: "RunDispatchRequired"};
  } else if (_outcome_0.$ === "RunCancellation") {
    return {$: "RunNext", "state": {$: "RunCancelled"}, "cancellation": false, "authority": false, "immediate": false};
  } else {
    return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": false, "authority": false, "immediate": false};
  }
}

function $execution_step(_state_0, _action_0) {
  if (_state_0.$ === "RunQueued") {
    if (_action_0.$ === "RunClaim") {
      return {$: "RunNext", "state": {$: "RunLeased"}, "cancellation": false, "authority": true, "immediate": false};
    } else if (_action_0.$ === "RunHeartbeat") {
      return {$: "RunInactive"};
    } else if (_action_0.$ === "RunFinish") {
      return {$: "RunInactive"};
    } else if (_action_0.$ === "RunCancel") {
      return {$: "RunNext", "state": {$: "RunCancelled"}, "cancellation": true, "authority": false, "immediate": true};
    } else if (_action_0.$ === "RunLost") {
      return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunRetry") {
      return {$: "RunNotUncertain"};
    } else {
      return {$: "RunNotUncertain"};
    }
  } else if (_state_0.$ === "RunLeased") {
    if (_action_0.$ === "RunClaim") {
      return {$: "RunNotClaimable"};
    } else if (_action_0.$ === "RunHeartbeat") {
      return {$: "RunNext", "state": {$: "RunRunning"}, "cancellation": false, "authority": true, "immediate": false};
    } else if (_action_0.$ === "RunFinish") {
      const _outcome_2 = _action_0["outcome"];
      return $execution_finish_leased(_outcome_2);
    } else if (_action_0.$ === "RunCancel") {
      return {$: "RunNext", "state": {$: "RunCancelling"}, "cancellation": true, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunLost") {
      return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunRetry") {
      return {$: "RunNotUncertain"};
    } else {
      return {$: "RunNotUncertain"};
    }
  } else if (_state_0.$ === "RunRunning") {
    if (_action_0.$ === "RunClaim") {
      return {$: "RunNotClaimable"};
    } else if (_action_0.$ === "RunHeartbeat") {
      return {$: "RunNext", "state": {$: "RunRunning"}, "cancellation": false, "authority": true, "immediate": false};
    } else if (_action_0.$ === "RunFinish") {
      const _outcome_4 = _action_0["outcome"];
      return {$: "RunNext", "state": $$execution_result(_outcome_4), "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunCancel") {
      return {$: "RunNext", "state": {$: "RunCancelling"}, "cancellation": true, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunLost") {
      return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunRetry") {
      return {$: "RunNotUncertain"};
    } else {
      return {$: "RunNotUncertain"};
    }
  } else if (_state_0.$ === "RunCancelling") {
    if (_action_0.$ === "RunClaim") {
      return {$: "RunNotClaimable"};
    } else if (_action_0.$ === "RunHeartbeat") {
      return {$: "RunNext", "state": {$: "RunCancelling"}, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunFinish") {
      const _outcome_6 = _action_0["outcome"];
      return {$: "RunNext", "state": $$execution_result(_outcome_6), "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunCancel") {
      return {$: "RunNext", "state": {$: "RunCancelling"}, "cancellation": true, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunLost") {
      return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunRetry") {
      return {$: "RunNotUncertain"};
    } else {
      return {$: "RunNotUncertain"};
    }
  } else if (_state_0.$ === "RunUncertain") {
    if (_action_0.$ === "RunClaim") {
      return {$: "RunNotClaimable"};
    } else if (_action_0.$ === "RunHeartbeat") {
      return {$: "RunInactive"};
    } else if (_action_0.$ === "RunFinish") {
      return {$: "RunInactive"};
    } else if (_action_0.$ === "RunCancel") {
      return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": true, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunLost") {
      return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunRetry") {
      return {$: "RunNext", "state": {$: "RunQueued"}, "cancellation": false, "authority": true, "immediate": false};
    } else {
      const _outcome_9 = _action_0["outcome"];
      return {$: "RunNext", "state": $$execution_result(_outcome_9), "cancellation": false, "authority": false, "immediate": false};
    }
  } else {
    if (_action_0.$ === "RunClaim") {
      return {$: "RunNotClaimable"};
    } else if (_action_0.$ === "RunHeartbeat") {
      return {$: "RunInactive"};
    } else if (_action_0.$ === "RunFinish") {
      return {$: "RunInactive"};
    } else if (_action_0.$ === "RunCancel") {
      return {$: "RunNext", "state": _state_0, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunLost") {
      return {$: "RunNext", "state": {$: "RunUncertain"}, "cancellation": false, "authority": false, "immediate": false};
    } else if (_action_0.$ === "RunRetry") {
      return {$: "RunNotUncertain"};
    } else {
      return {$: "RunNotUncertain"};
    }
  }
}

function $topology_unpack(_pair_0, _continuation_0) {
  const _a_0 = _pair_0["fst"];
  const _b_0 = _pair_0["snd"];
  return run_tail(_continuation_0(_a_0), _b_0);
}

function $topology_parent_allows(_exclusive_0, _old_0, _target_0) {
  const _x_0 = ((_target_0 + 1) >>> 0);
  const _x_1 = (_old_0 === 0);
  const _x_2 = (_old_0 === _x_0);
  const _x_3 = $$Bool_not(_exclusive_0);
  const _x_4 = (_x_1 || _x_2);
  return (_x_3 || _x_4);
}

function $topology_enqueue(_hit_0, _item_0, _rest_0) {
  if (_hit_0) {
    return {$: "Con", "head": _item_0, "tail": _rest_0};
  } else {
    return _rest_0;
  }
}

function $topology_add_checked(_allowed_0, _source_0, _target_0, _count_0, _degree_0, _next_0, _parent_0) {
  if (!_allowed_0) {
    return {$: "TopBadParents"};
  } else {
    const _x_0 = ((_count_0 + 1) >>> 0);
    const _degree_1 = (_degree_0[_target_0 % _degree_0.length] = _x_0, _degree_0);
    const _x_1 = ((_target_0 + 1) >>> 0);
    const _parent_1 = (_parent_0[_source_0 % _parent_0.length] = _x_1, _parent_0);
    return $topology_unpack(tup_new(_next_0, _next_0[_source_0 % _next_0.length]), run_clo($topology_add_checked_c0(_target_0,_parent_1,_degree_1,_source_0)));
  }
}

function $topology_add_checked_c0(_target_0,_parent_1,_degree_1,_source_0) {
  return (_x_2) => {
    return run_clo($topology_add_checked_c1(_target_0,_parent_1,_degree_1,_source_0,_x_2));
  }
}
function $topology_add_checked_c1(_target_0,_parent_1,_degree_1,_source_0,_x_2) {
  return (_x_3) => {
    const _x_4 = {$: "Con", "head": _target_0, "tail": _x_3};
    return {$: "TopBuilt", "degree": _degree_1, "next": (_x_2[_source_0 % _x_2.length] = _x_4, _x_2), "parent": _parent_1};
  }
}
function $topology_add_indexed(_valid_0, _exclusive_0, _source_0, _target_0, _degree_0, _next_0, _parent_0) {
  if (!_valid_0) {
    return {$: "TopBadIndex"};
  } else {
    return $topology_unpack(tup_new(_degree_0, _degree_0[_target_0 % _degree_0.length]), run_clo($topology_add_indexed_c0(_parent_0,_source_0,_target_0,_exclusive_0,_next_0)));
  }
}

function $topology_add_indexed_c0(_parent_0,_source_0,_target_0,_exclusive_0,_next_0) {
  return (_x_0) => {
    return run_clo($topology_add_indexed_c1(_parent_0,_source_0,_x_0,_target_0,_exclusive_0,_next_0));
  }
}
function $topology_add_indexed_c1(_parent_0,_source_0,_x_0,_target_0,_exclusive_0,_next_0) {
  return (_x_1) => {
    return $topology_unpack(tup_new(_parent_0, _parent_0[_source_0 % _parent_0.length]), run_clo($topology_add_indexed_c2(_source_0,_x_1,_x_0,_target_0,_exclusive_0,_next_0)));
  }
}
function $topology_add_indexed_c2(_source_0,_x_1,_x_0,_target_0,_exclusive_0,_next_0) {
  return (_x_2) => {
    return run_clo($topology_add_indexed_c3(_source_0,_x_1,_x_0,_target_0,_exclusive_0,_x_2,_next_0));
  }
}
function $topology_add_indexed_c3(_source_0,_x_1,_x_0,_target_0,_exclusive_0,_x_2,_next_0) {
  return (_x_3) => {
    return $topology_add_checked($$topology_parent_allows(_exclusive_0, _x_3, _target_0), _source_0, _target_0, _x_1, _x_0, _next_0, _x_2);
  }
}
function $topology_add(_state_0, _edge_0, _exclusive_0, _size_0) {
  if (_state_0.$ === "TopBadParents") {
    const _source_0 = _edge_0["source"];
    const _target_0 = _edge_0["target"];
    return $Bool_pick($$Bool_and((_source_0 < _size_0), (_target_0 < _size_0)), {$: "TopBadParents"}, {$: "TopBadIndex"});
  } else if (_state_0.$ === "TopBadIndex") {
    return {$: "TopBadIndex"};
  } else {
    const _degree_0 = _state_0["degree"];
    const _next_0 = _state_0["next"];
    const _parent_0 = _state_0["parent"];
    const _a_0 = _edge_0["source"];
    const _b_0 = _edge_0["target"];
    const _source_1 = _a_0;
    const _target_1 = _b_0;
    return $topology_add_indexed($$Bool_and((_source_1 < _size_0), (_target_1 < _size_0)), _exclusive_0, _source_1, _target_1, _degree_0, _next_0, _parent_0);
  }
}

function $topology_prepare($0, $1, $2, $3) {
  for (;;) {
    {
      const _edges_0 = $0;
      const _state_0 = $1;
      const _exclusive_0 = $2;
      const _size_0 = $3;
      if (_edges_0.$ === "Nil") {
        return _state_0;
      } else {
        const _head_0 = _edges_0["head"];
        const _tail_0 = _edges_0["tail"];
        $0 = _tail_0;
        $1 = $$topology_add(_state_0, _head_0, _exclusive_0, _size_0);
        $2 = _exclusive_0;
        $3 = _size_0;
        continue;
      }
    }
  }
}

function $topology_zeros(_fuel_0, _index_0, _degree_0, _queue_0) {
  if (_fuel_0 == 0) {
    return {$: "Tuple", "fst": _degree_0, "snd": _queue_0};
  } else {
    const _rest_0 = (_fuel_0 - 1);
    return $topology_unpack(tup_new(_degree_0, _degree_0[_index_0 % _degree_0.length]), run_clo($topology_zeros_c0(_index_0,_queue_0,_rest_0)));
  }
}

function $topology_zeros_c0(_index_0,_queue_0,_rest_0) {
  return (_x_0) => {
    return run_clo($topology_zeros_c1(_index_0,_queue_0,_x_0,_rest_0));
  }
}
function $topology_zeros_c1(_index_0,_queue_0,_x_0,_rest_0) {
  return (_x_1) => {
    return $topology_zeros(_rest_0, ((_index_0 + 1) >>> 0), _x_0, $$topology_enqueue((_x_1 === 0), _index_0, _queue_0));
  }
}
function $topology_release_one(_target_0, _queue_0, _pair_0) {
  const _degree_0 = _pair_0["fst"];
  const _count_0 = _pair_0["snd"];
  const _x_0 = ((_count_0 - 1) >>> 0);
  const _degree_1 = (_degree_0[_target_0 % _degree_0.length] = _x_0, _degree_0);
  return {$: "Tuple", "fst": _degree_1, "snd": $$topology_enqueue((_count_0 === 1), _target_0, _queue_0)};
}

function $topology_release(_targets_0, _degree_0, _queue_0) {
  if (_targets_0.$ === "Nil") {
    return {$: "Tuple", "fst": _degree_0, "snd": _queue_0};
  } else {
    const _head_0 = _targets_0["head"];
    const _tail_0 = _targets_0["tail"];
    const _target_0 = _head_0;
    return $topology_unpack($$topology_release_one(_target_0, _queue_0, tup_new(_degree_0, _degree_0[_target_0 % _degree_0.length])), run_clo($topology_release_c0(_tail_0)));
  }
}

function $topology_release_c0(_tail_0) {
  return (_x_0) => {
    return run_clo($topology_release_c1(_x_0,_tail_0));
  }
}
function $topology_release_c1(_x_0,_tail_0) {
  return (_x_1) => {
    return $topology_release(_tail_0, _x_0, _x_1);
  }
}
function $topology_walk(_fuel_0, _queue_0, _count_0, _degree_0, _next_0, _rank_0) {
  if (_fuel_0 == 0) {
    return {$: "TopExhausted"};
  } else {
    const _rest_0 = (_fuel_0 - 1);
    if (_queue_0.$ === "Nil") {
      return {$: "TopSorted", "rank": _rank_0, "visited": _count_0};
    } else {
      const _head_0 = _queue_0["head"];
      const _tail_0 = _queue_0["tail"];
      const _node_0 = _head_0;
      const _rank_1 = (_rank_0[_node_0 % _rank_0.length] = _count_0, _rank_0);
      return $topology_unpack(tup_new(_next_0, _next_0[_node_0 % _next_0.length]), run_clo($topology_walk_c0(_degree_0,_rest_0,_rank_1,_tail_0,_count_0)));
    }
  }
}

function $topology_walk_c0(_degree_0,_rest_0,_rank_1,_tail_0,_count_0) {
  return (_x_0) => {
    return run_clo($topology_walk_c1(_degree_0,_rest_0,_rank_1,_tail_0,_x_0,_count_0));
  }
}
function $topology_walk_c1(_degree_0,_rest_0,_rank_1,_tail_0,_x_0,_count_0) {
  return (_x_1) => {
    return $topology_unpack($$topology_release(_x_1, _degree_0, _tail_0), run_clo($topology_walk_c2(_rest_0,_rank_1,_x_0,_count_0)));
  }
}
function $topology_walk_c2(_rest_0,_rank_1,_x_0,_count_0) {
  return (_x_2) => {
    return run_clo($topology_walk_c3(_rest_0,_rank_1,_x_0,_x_2,_count_0));
  }
}
function $topology_walk_c3(_rest_0,_rank_1,_x_0,_x_2,_count_0) {
  return (_x_3) => {
    return $topology_walk(_rest_0, _x_3, ((_count_0 + 1) >>> 0), _x_2, _x_0, _rank_1);
  }
}
function $topology_certify(_edges_0, _rank_0, _valid_0) {
  if (_edges_0.$ === "Nil") {
    return $Bool_pick(_valid_0, {$: "TopGood"}, {$: "TopInvalid"});
  } else {
    const _t_0 = _edges_0["head"];
    const _source_0 = _t_0["source"];
    const _target_0 = _t_0["target"];
    const _tail_0 = _edges_0["tail"];
    return $topology_unpack(tup_new(_rank_0, _rank_0[_source_0 % _rank_0.length]), run_clo($topology_certify_c0(_target_0,_tail_0,_valid_0)));
  }
}

function $topology_certify_c0(_target_0,_tail_0,_valid_0) {
  return (_x_0) => {
    return run_clo($topology_certify_c1(_x_0,_target_0,_tail_0,_valid_0));
  }
}
function $topology_certify_c1(_x_0,_target_0,_tail_0,_valid_0) {
  return (_x_1) => {
    return $topology_unpack(tup_new(_x_0, _x_0[_target_0 % _x_0.length]), run_clo($topology_certify_c2(_x_1,_tail_0,_valid_0)));
  }
}
function $topology_certify_c2(_x_1,_tail_0,_valid_0) {
  return (_x_2) => {
    return run_clo($topology_certify_c3(_x_2,_x_1,_tail_0,_valid_0));
  }
}
function $topology_certify_c3(_x_2,_x_1,_tail_0,_valid_0) {
  return (_x_3) => {
    return $topology_certify(_tail_0, _x_2, $$Bool_and(_valid_0, (_x_1 < _x_3)));
  }
}
function $topology_finish_count(_complete_0, _edges_0, _rank_0) {
  if (!_complete_0) {
    return {$: "TopCycle"};
  } else {
    return $topology_certify(_edges_0, _rank_0, true);
  }
}

function $topology_finish(_sorted_0, _size_0, _edges_0) {
  if (_sorted_0.$ === "TopExhausted") {
    return {$: "TopInvalid"};
  } else {
    const _rank_0 = _sorted_0["rank"];
    const _visited_0 = _sorted_0["visited"];
    return $topology_finish_count((_visited_0 === _size_0), _edges_0, _rank_0);
  }
}

function $topology_start(_state_0, _size_0, _edges_0, _rank_0) {
  if (_state_0.$ === "TopBadParents") {
    return {$: "TopParents"};
  } else if (_state_0.$ === "TopBadIndex") {
    return {$: "TopInvalid"};
  } else {
    const _degree_0 = _state_0["degree"];
    const _next_0 = _state_0["next"];
    return $topology_unpack($$topology_zeros((_size_0 ), 0, _degree_0, {$: "Nil"}), run_clo($topology_start_c0(_edges_0,_rank_0,_next_0,_size_0)));
  }
}

function $topology_start_c0(_edges_0,_rank_0,_next_0,_size_0) {
  return (_x_0) => {
    return run_clo($topology_start_c1(_edges_0,_x_0,_rank_0,_next_0,_size_0));
  }
}
function $topology_start_c1(_edges_0,_x_0,_rank_0,_next_0,_size_0) {
  return (_x_1) => {
    const _x_2 = (_size_0 );
    return $topology_finish($$topology_walk(nat_chk(_x_2 + 1), _x_1, 0, _x_0, _next_0, _rank_0), _size_0, _edges_0);
  }
}
function $topology_check(_exclusive_0, _size_0, _edges_0, _degree_0, _next_0, _parent_0, _rank_0) {
  return $topology_start($$topology_prepare(_edges_0, {$: "TopBuilt", "degree": _degree_0, "next": _next_0, "parent": _parent_0}, _exclusive_0, _size_0), _size_0, _edges_0, _rank_0);
}

function $topology_project(_active_0, _structural_0, _temporal_0, _context_0, _perspective_0, _framed_0, _frame_0, _child_0, _parent_0, _earlier_0, _later_0) {
  return $Bool_pick(_active_0, $$Bool_pick(_structural_0, {$: "TopWithin", "scope": _perspective_0, "source": _child_0, "target": _parent_0}, $$Bool_pick(_temporal_0, {$: "TopBefore", "scope": $$Bool_pick(_framed_0, _frame_0, _context_0), "source": _earlier_0, "target": _later_0}, {$: "TopSkip"})), {$: "TopSkip"});
}

function $topology_combine_child(_result_0, _rest_0) {
  if (_result_0.$ === "TopInvalid") {
    if (_rest_0.$ === "TopInvalid") {
      return {$: "TopInvalid"};
    } else if (_rest_0.$ === "TopParents") {
      return {$: "TopInvalid"};
    } else if (_rest_0.$ === "TopCycle") {
      return {$: "TopInvalid"};
    } else {
      return {$: "TopInvalid"};
    }
  } else if (_result_0.$ === "TopParents") {
    if (_rest_0.$ === "TopInvalid") {
      return {$: "TopInvalid"};
    } else if (_rest_0.$ === "TopParents") {
      return {$: "TopParents"};
    } else if (_rest_0.$ === "TopCycle") {
      return {$: "TopParents"};
    } else {
      return {$: "TopParents"};
    }
  } else if (_result_0.$ === "TopCycle") {
    if (_rest_0.$ === "TopInvalid") {
      return {$: "TopInvalid"};
    } else if (_rest_0.$ === "TopParents") {
      return {$: "TopParents"};
    } else if (_rest_0.$ === "TopCycle") {
      return {$: "TopCycle"};
    } else {
      return {$: "TopCycle"};
    }
  } else {
    if (_rest_0.$ === "TopInvalid") {
      return {$: "TopInvalid"};
    } else if (_rest_0.$ === "TopParents") {
      return {$: "TopParents"};
    } else if (_rest_0.$ === "TopCycle") {
      return {$: "TopCycle"};
    } else {
      return {$: "TopGood"};
    }
  }
}

function $topology_combine_fold($0, $1) {
  for (;;) {
    {
      const _results_0 = $0;
      const _accumulated_0 = $1;
      if (_results_0.$ === "Nil") {
        return _accumulated_0;
      } else {
        const _head_0 = _results_0["head"];
        const _tail_0 = _results_0["tail"];
        $0 = _tail_0;
        $1 = $$topology_combine_child(_accumulated_0, _head_0);
        continue;
      }
    }
  }
}

function $topology_combine(_results_0) {
  return $topology_combine_fold(_results_0, {$: "TopGood"});
}

function $accounting_zero() {
  return {$: "BudgetCount", "high": 0, "low": 0};
}

function $accounting_one() {
  return {$: "BudgetCount", "high": 0, "low": 1};
}

function $accounting_le(_left_0, _right_0) {
  const _a_0 = _left_0["high"];
  const _b_0 = _left_0["low"];
  const _c_0 = _right_0["high"];
  const _d_0 = _right_0["low"];
  const _x_0 = (_a_0 < _c_0);
  const _x_1 = $$Bool_and((_a_0 === _c_0), $$Bool_not((_d_0 < _b_0)));
  return (_x_0 || _x_1);
}

function $accounting_maximum(_left_0, _right_0) {
  return $Bool_pick($$accounting_le(_left_0, _right_0), _right_0, _left_0);
}

function $accounting_added(_high_0, _low_0) {
  return $Bool_pick($$Bool_not((2097151 < _high_0)), {$: "BudgetFinite", "count": {$: "BudgetCount", "high": _high_0, "low": _low_0}}, {$: "BudgetOverflow"});
}

function $accounting_add(_left_0, _right_0) {
  const _a_0 = _left_0["high"];
  const _b_0 = _left_0["low"];
  const _c_0 = _right_0["high"];
  const _d_0 = _right_0["low"];
  const _low_0 = ((_b_0 + _d_0) >>> 0);
  const _x_0 = ((_a_0 + _c_0) >>> 0);
  const _x_1 = $$Bool_pick((_low_0 < _b_0), 1, 0);
  return $accounting_added(((_x_0 + _x_1) >>> 0), _low_0);
}

function $accounting_subtract_checked(_allowed_0, _left_0, _right_0) {
  if (!_allowed_0) {
    return {$: "BudgetOverflow"};
  } else {
    const _a_0 = _left_0["high"];
    const _b_0 = _left_0["low"];
    const _c_0 = _right_0["high"];
    const _d_0 = _right_0["low"];
    const _x_0 = ((_a_0 - _c_0) >>> 0);
    const _x_1 = $$Bool_pick((_b_0 < _d_0), 1, 0);
    return {$: "BudgetFinite", "count": {$: "BudgetCount", "high": ((_x_0 - _x_1) >>> 0), "low": ((_b_0 - _d_0) >>> 0)}};
  }
}

function $accounting_subtract(_left_0, _right_0) {
  return $accounting_subtract_checked($$accounting_le(_right_0, _left_0), _left_0, _right_0);
}

function $accounting_equal(_left_0, _right_0) {
  const _a_0 = _left_0["high"];
  const _b_0 = _left_0["low"];
  const _c_0 = _right_0["high"];
  const _d_0 = _right_0["low"];
  return $Bool_and((_a_0 === _c_0), (_b_0 === _d_0));
}

function $accounting_accumulate(_value_0, _extra_0) {
  if (_value_0.$ === "BudgetOverflow") {
    return {$: "BudgetOverflow"};
  } else {
    const _count_0 = _value_0["count"];
    return $accounting_add(_count_0, _extra_0);
  }
}

function $accounting_fits(_value_0, _ceiling_0) {
  if (_value_0.$ === "BudgetOverflow") {
    return false;
  } else {
    const _count_0 = _value_0["count"];
    return $accounting_le(_count_0, _ceiling_0);
  }
}

function $accounting_empty() {
  return {$: "BudgetBalance", "cpu": {$: "BudgetFinite", "count": $$accounting_zero()}, "memory": {$: "BudgetFinite", "count": $$accounting_zero()}, "output": {$: "BudgetFinite", "count": $$accounting_zero()}, "tokens": {$: "BudgetFinite", "count": $$accounting_zero()}, "spend": {$: "BudgetFinite", "count": $$accounting_zero()}, "concurrent": {$: "BudgetFinite", "count": $$accounting_zero()}};
}

function $accounting_include(_balance_0, _extra_0) {
  const _a_0 = _balance_0["cpu"];
  const _b_0 = _balance_0["memory"];
  const _c_0 = _balance_0["output"];
  const _d_0 = _balance_0["tokens"];
  const _e_0 = _balance_0["spend"];
  const _f_0 = _balance_0["concurrent"];
  const _u_0 = _extra_0["cpu"];
  const _v_0 = _extra_0["memory"];
  const _w_0 = _extra_0["output"];
  const _x_0 = _extra_0["tokens"];
  const _y_0 = _extra_0["spend"];
  const _z_0 = _extra_0["concurrent"];
  return {$: "BudgetBalance", "cpu": $$accounting_accumulate(_a_0, _u_0), "memory": $$accounting_accumulate(_b_0, _v_0), "output": $$accounting_accumulate(_c_0, _w_0), "tokens": $$accounting_accumulate(_d_0, _x_0), "spend": $$accounting_accumulate(_e_0, _y_0), "concurrent": $$accounting_accumulate(_f_0, _z_0)};
}

function $accounting_within(_balance_0, _ceiling_0) {
  const _a_0 = _balance_0["cpu"];
  const _b_0 = _balance_0["memory"];
  const _c_0 = _balance_0["output"];
  const _d_0 = _balance_0["tokens"];
  const _e_0 = _balance_0["spend"];
  const _f_0 = _balance_0["concurrent"];
  const _u_0 = _ceiling_0["cpu"];
  const _v_0 = _ceiling_0["memory"];
  const _w_0 = _ceiling_0["output"];
  const _x_0 = _ceiling_0["tokens"];
  const _y_0 = _ceiling_0["spend"];
  const _z_0 = _ceiling_0["concurrent"];
  return $Bool_and($$accounting_fits(_a_0, _u_0), $$Bool_and($$accounting_fits(_b_0, _v_0), $$Bool_and($$accounting_fits(_c_0, _w_0), $$Bool_and($$accounting_fits(_d_0, _x_0), $$Bool_and($$accounting_fits(_e_0, _y_0), $$accounting_fits(_f_0, _z_0))))));
}

function $accounting_capacity(_balance_0, _requested_0, _ceiling_0) {
  return $accounting_within($$accounting_include(_balance_0, _requested_0), _ceiling_0);
}

function $accounting_quantities_le(_left_0, _right_0) {
  const _a_0 = _left_0["cpu"];
  const _b_0 = _left_0["memory"];
  const _c_0 = _left_0["output"];
  const _d_0 = _left_0["tokens"];
  const _e_0 = _left_0["spend"];
  const _f_0 = _left_0["concurrent"];
  const _u_0 = _right_0["cpu"];
  const _v_0 = _right_0["memory"];
  const _w_0 = _right_0["output"];
  const _x_0 = _right_0["tokens"];
  const _y_0 = _right_0["spend"];
  const _z_0 = _right_0["concurrent"];
  return $Bool_and($$accounting_le(_a_0, _u_0), $$Bool_and($$accounting_le(_b_0, _v_0), $$Bool_and($$accounting_le(_c_0, _w_0), $$Bool_and($$accounting_le(_d_0, _x_0), $$Bool_and($$accounting_le(_e_0, _y_0), $$accounting_le(_f_0, _z_0))))));
}

function $accounting_usage_allowed(_previous_0, _usage_0, _ceiling_0, _observed_0) {
  const _x_0 = $$accounting_quantities_le(_usage_0, _ceiling_0);
  return $Bool_and($$accounting_quantities_le(_previous_0, _usage_0), (_observed_0 || _x_0));
}

function $accounting_cumulative(_active_0, _unmeasured_0, _ceiling_0, _usage_0) {
  return $Bool_pick((_active_0 || _unmeasured_0), $$accounting_maximum(_ceiling_0, _usage_0), _usage_0);
}

function $accounting_charges(_active_0, _ceiling_0, _usage_0, _cpu_unknown_0, _output_unknown_0, _tokens_unknown_0, _spend_unknown_0) {
  const _a_0 = _ceiling_0["cpu"];
  const _b_0 = _ceiling_0["memory"];
  const _c_0 = _ceiling_0["output"];
  const _d_0 = _ceiling_0["tokens"];
  const _e_0 = _ceiling_0["spend"];
  const _u_0 = _usage_0["cpu"];
  const _v_0 = _usage_0["memory"];
  const _w_0 = _usage_0["output"];
  const _x_0 = _usage_0["tokens"];
  const _y_0 = _usage_0["spend"];
  return {$: "BudgetQuantities", "cpu": $$accounting_cumulative(_active_0, _cpu_unknown_0, _a_0, _u_0), "memory": $$Bool_pick(_active_0, $$accounting_maximum(_b_0, _v_0), $$accounting_zero()), "output": $$accounting_cumulative(_active_0, _output_unknown_0, _c_0, _w_0), "tokens": $$accounting_cumulative(_active_0, _tokens_unknown_0, _d_0, _x_0), "spend": $$accounting_cumulative(_active_0, _spend_unknown_0, _e_0, _y_0), "concurrent": $$Bool_pick(_active_0, $$accounting_one(), $$accounting_zero())};
}

function $accounting_charge(_entry_0) {
  const _state_0 = _entry_0["state"];
  const _ceiling_0 = _entry_0["ceiling"];
  const _usage_0 = _entry_0["usage"];
  const _cpu_unknown_0 = _entry_0["cpu_unknown"];
  const _output_unknown_0 = _entry_0["output_unknown"];
  const _tokens_unknown_0 = _entry_0["tokens_unknown"];
  const _spend_unknown_0 = _entry_0["spend_unknown"];
  return $accounting_charges($$Bool_not($$execution_terminal(_state_0)), _ceiling_0, _usage_0, _cpu_unknown_0, _output_unknown_0, _tokens_unknown_0, _spend_unknown_0);
}

function $accounting_total_fold($0, $1) {
  for (;;) {
    {
      const _entries_0 = $0;
      const _accumulated_0 = $1;
      if (_entries_0.$ === "Nil") {
        return _accumulated_0;
      } else {
        const _head_0 = _entries_0["head"];
        const _tail_0 = _entries_0["tail"];
        $0 = _tail_0;
        $1 = $$accounting_include(_accumulated_0, $$accounting_charge(_head_0));
        continue;
      }
    }
  }
}

function $accounting_total(_entries_0) {
  return $accounting_total_fold(_entries_0, $$accounting_empty());
}

function $accounting_requests_fold($0, $1) {
  for (;;) {
    {
      const _requests_0 = $0;
      const _accumulated_0 = $1;
      if (_requests_0.$ === "Nil") {
        return _accumulated_0;
      } else {
        const _head_0 = _requests_0["head"];
        const _tail_0 = _requests_0["tail"];
        $0 = _tail_0;
        $1 = $$accounting_include(_accumulated_0, _head_0);
        continue;
      }
    }
  }
}

function $accounting_envelope(_requests_0, _ceiling_0) {
  return $accounting_within($$accounting_requests_fold(_requests_0, $$accounting_empty()), _ceiling_0);
}

function $accounting_remaining_result(_amount_0) {
  if (_amount_0.$ === "BudgetOverflow") {
    return $accounting_zero();
  } else {
    const _count_0 = _amount_0["count"];
    return _count_0;
  }
}

function $accounting_remaining(_envelope_0) {
  const _t_0 = _envelope_0["used"];
  if (_t_0.$ === "BudgetOverflow") {
    return $accounting_zero();
  } else {
    const _count_0 = _t_0["count"];
    const _ceiling_1 = _envelope_0["ceiling"];
    return $accounting_remaining_result($$accounting_subtract(_ceiling_1, _count_0));
  }
}

function $accounting_available_fold($0, $1) {
  for (;;) {
    {
      const _envelopes_0 = $0;
      const _minimum_0 = $1;
      if (_envelopes_0.$ === "Nil") {
        return _minimum_0;
      } else {
        const _head_0 = _envelopes_0["head"];
        const _tail_0 = _envelopes_0["tail"];
        const _left_0 = $$accounting_remaining(_head_0);
        $0 = _tail_0;
        $1 = $$Bool_pick($$accounting_le(_left_0, _minimum_0), _left_0, _minimum_0);
        continue;
      }
    }
  }
}

function $accounting_available(_envelopes_0) {
  if (_envelopes_0.$ === "Nil") {
    return $accounting_zero();
  } else {
    const _head_0 = _envelopes_0["head"];
    const _tail_0 = _envelopes_0["tail"];
    return $accounting_available_fold(_tail_0, $$accounting_remaining(_head_0));
  }
}

function $collections_contains_fold($0, $1, $2) {
  for (;;) {
    {
      const _values_0 = $0;
      const _needle_0 = $1;
      const _hit_0 = $2;
      if (_values_0.$ === "Nil") {
        return _hit_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        const _x_0 = $$String_eq(_head_0, _needle_0);
        $0 = _tail_0;
        $1 = _needle_0;
        $2 = (_hit_0 || _x_0);
        continue;
      }
    }
  }
}

function $collections_contains(_values_0, _needle_0) {
  return $collections_contains_fold(_values_0, _needle_0, false);
}

function $collections_subset_fold($0, $1, $2) {
  for (;;) {
    {
      const _values_0 = $0;
      const _parent_0 = $1;
      const _accepted_0 = $2;
      if (_values_0.$ === "Nil") {
        return _accepted_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        $0 = _tail_0;
        $1 = _parent_0;
        $2 = $$Bool_and(_accepted_0, $$collections_contains(_parent_0, _head_0));
        continue;
      }
    }
  }
}

function $collections_subset(_values_0, _parent_0) {
  return $collections_subset_fold(_values_0, _parent_0, true);
}

function $collections_unique_fold($0, $1, $2) {
  for (;;) {
    {
      const _values_0 = $0;
      const _seen_0 = $1;
      const _reversed_0 = $2;
      if (_values_0.$ === "Nil") {
        return $List_reverse(_reversed_0);
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        const _value_0 = _head_0;
        const _present_0 = $$collections_contains(_seen_0, _value_0);
        $0 = _tail_0;
        $1 = $$Bool_pick(_present_0, _seen_0, {$: "Con", "head": _value_0, "tail": _seen_0});
        $2 = $$Bool_pick(_present_0, _reversed_0, {$: "Con", "head": _value_0, "tail": _reversed_0});
        continue;
      }
    }
  }
}

function $collections_union(_left_0, _right_0) {
  return $collections_unique_fold($$List_append(_left_0, _right_0), {$: "Nil"}, {$: "Nil"});
}

function $collections_intersection_fold($0, $1, $2) {
  for (;;) {
    {
      const _values_0 = $0;
      const _allowed_0 = $1;
      const _reversed_0 = $2;
      if (_values_0.$ === "Nil") {
        return $List_reverse(_reversed_0);
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        const _value_0 = _head_0;
        $0 = _tail_0;
        $1 = _allowed_0;
        $2 = $$Bool_pick($$collections_contains(_allowed_0, _value_0), {$: "Con", "head": _value_0, "tail": _reversed_0}, _reversed_0);
        continue;
      }
    }
  }
}

function $collections_intersection(_values_0, _allowed_0) {
  return $collections_intersection_fold(_values_0, _allowed_0, {$: "Nil"});
}

function $collections_unseen_fold($0, $1, $2) {
  for (;;) {
    {
      const _values_0 = $0;
      const _seen_0 = $1;
      const _reversed_0 = $2;
      if (_values_0.$ === "Nil") {
        return _reversed_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        const _value_0 = _head_0;
        $0 = _tail_0;
        $1 = _seen_0;
        $2 = $$Bool_pick($$collections_contains(_seen_0, _value_0), _reversed_0, {$: "Con", "head": _value_0, "tail": _reversed_0});
        continue;
      }
    }
  }
}

function $scheduler_active(_life_0) {
  if (_life_0.$ === "SchActive") {
    return true;
  } else {
    return false;
  }
}

function $scheduler_cancellable(_life_0) {
  if (_life_0.$ === "SchCompleted") {
    return false;
  } else {
    return true;
  }
}

function $scheduler_unblocked(_block_0, _activity_0) {
  if (_block_0.$ === "SchNoBlock") {
    return true;
  } else {
    const _previous_0 = _block_0["activity"];
    return $Bool_not($$accounting_equal(_previous_0, _activity_0));
  }
}

function $scheduler_runnable(_facts_0, _activity_0) {
  const _life_0 = _facts_0["life"];
  const _block_0 = _facts_0["block"];
  const _pending_0 = _facts_0["pending"];
  const _busy_0 = _facts_0["active"];
  return $Bool_and($$scheduler_active(_life_0), $$Bool_and($$scheduler_unblocked(_block_0, _activity_0), $$Bool_and($$Bool_not((_pending_0 === 0)), (_busy_0 === 0))));
}

function $scheduler_ready(_facts_0, _activity_0, _coalesce_0, _last_sources_0) {
  const _life_0 = _facts_0["life"];
  const _sequence_0 = _facts_0["sequence"];
  const _block_0 = _facts_0["block"];
  const _pending_0 = _facts_0["pending"];
  const _busy_0 = _facts_0["active"];
  const _pressure_0 = _facts_0["pressure"];
  const _x_0 = $$Bool_not(_coalesce_0);
  const _x_1 = $$Bool_not((_last_sources_0 < 32));
  const _backed_up_0 = $$Bool_and($$Bool_not((_busy_0 === 0)), $$Bool_and($$Bool_not((_pending_0 < 128)), (_x_0 || _x_1)));
  const _x_2 = $$Bool_not(_backed_up_0);
  const _x_3 = $$scheduler_unblocked(_pressure_0, _activity_0);
  const _x_4 = $$Bool_and($$Bool_not($$accounting_le(_activity_0, _sequence_0)), (_x_2 || _x_3));
  const _x_5 = $$Bool_and($$Bool_not((_pending_0 === 0)), (_busy_0 === 0));
  return $Bool_and($$scheduler_active(_life_0), $$Bool_and($$scheduler_unblocked(_block_0, _activity_0), (_x_4 || _x_5)));
}

function $scheduler_scan(_facts_0, _context_0, _ended_0, _activity_0) {
  const _life_0 = _facts_0["life"];
  const _block_0 = _facts_0["block"];
  const _x_0 = $$Bool_not($$String_eq(_context_0, "open"));
  return $Bool_pick($$scheduler_active(_life_0), $$Bool_pick((_x_0 || _ended_0), {$: "SchCancel"}, $$Bool_pick($$scheduler_unblocked(_block_0, _activity_0), {$: "SchObserve"}, {$: "SchSkip"})), {$: "SchSkip"});
}

function $scheduler_needs_events(_wake_0) {
  if (_wake_0.$ === "SchEvent") {
    return true;
  } else if (_wake_0.$ === "SchAfter") {
    return true;
  } else {
    return false;
  }
}

function $scheduler_timer(_wake_0) {
  if (_wake_0.$ === "SchAt") {
    return true;
  } else if (_wake_0.$ === "SchAfter") {
    return true;
  } else {
    return false;
  }
}

function $scheduler_baseline(_wake_0, _edge_0) {
  if (_wake_0.$ === "SchEvent") {
    return _edge_0;
  } else {
    return false;
  }
}

function $scheduler_resource_known(_resource_0) {
  return $collections_contains({$: "Con", "head": "concurrentExecutions", "tail": {$: "Con", "head": "cpuMillis", "tail": {$: "Con", "head": "memoryBytes", "tail": {$: "Con", "head": "outputBytes", "tail": {$: "Con", "head": "modelTokens", "tail": {$: "Con", "head": "apiSpendMicrounits", "tail": {$: "Nil"}}}}}}}, _resource_0);
}

function $scheduler_wake_admission(_wake_0, _once_0, _resource_0) {
  if (_wake_0.$ === "SchAt") {
    return $Bool_pick(_once_0, {$: "SchWakeAllowed"}, {$: "SchTimerRearm"});
  } else if (_wake_0.$ === "SchAfter") {
    return $Bool_pick(_once_0, {$: "SchWakeAllowed"}, {$: "SchTimerRearm"});
  } else if (_wake_0.$ === "SchCapacity") {
    return $Bool_pick($$scheduler_resource_known(_resource_0), {$: "SchWakeAllowed"}, {$: "SchUnknownResource"});
  } else {
    return {$: "SchWakeAllowed"};
  }
}

function $scheduler_room(_count_0) {
  return (_count_0 < 128);
}

function $scheduler_visible(_present_0, _incident_0, _operator_0, _readable_0, _creator_0, _principal_0, _grant_0, _chain_0) {
  const _x_0 = $$Bool_and($$String_eq(_creator_0, _principal_0), $$collections_contains(_chain_0, _grant_0));
  const _x_1 = (_readable_0 || _x_0);
  return $Bool_and(_present_0, $$Bool_and(_incident_0, (_operator_0 || _x_1)));
}

function $scheduler_mode_fields(_wake_0, _sequence_0, _fired_0, _activity_0, _due_present_0, _due_0, _now_0) {
  if (_wake_0.$ === "SchEvent") {
    return $Bool_pick($$Bool_not($$accounting_le(_activity_0, _sequence_0)), {$: "SchEvents", "limit": 256}, {$: "SchQuiet"});
  } else if (_wake_0.$ === "SchCapacity") {
    return {$: "SchCheckCapacity"};
  } else {
    return $Bool_pick($$Bool_and($$Bool_not(_fired_0), $$Bool_and(_due_present_0, $$accounting_le(_due_0, _now_0))), {$: "SchTimer"}, {$: "SchQuiet"});
  }
}

function $scheduler_mode(_wake_0, _facts_0, _activity_0, _due_present_0, _due_0, _now_0) {
  const _sequence_0 = _facts_0["sequence"];
  const _fired_0 = _facts_0["fired"];
  return $scheduler_mode_fields(_wake_0, _sequence_0, _fired_0, _activity_0, _due_present_0, _due_0, _now_0);
}

function $scheduler_event_gate(_previous_0, _sequence_0, _activity_0, _kind_0, _types_0) {
  return $Bool_pick($$accounting_le(_sequence_0, _previous_0), {$: "SchStaleEvent"}, $$Bool_pick($$accounting_le(_sequence_0, _activity_0), $$Bool_pick($$Bool_and($$Bool_not($$String_starts_with(_kind_0, "runtime.schedule.")), $$collections_contains(_types_0, _kind_0)), {$: "SchInspectEvent"}, {$: "SchIgnoreEvent"}), {$: "SchFutureEvent"}));
}

function $scheduler_observation(_each_0, _edge_0, _selected_0) {
  return $Bool_pick(_each_0, {$: "SchObservation", "fire": _selected_0, "edge": _edge_0}, {$: "SchObservation", "fire": $$Bool_and(_selected_0, $$Bool_not(_edge_0)), "edge": _selected_0});
}

function $scheduler_merged(_sources_0) {
  return $Bool_pick($$Nat_is_le($$List_length(_sources_0), 32), {$: "SchMerge", "sources": _sources_0}, {$: "SchQueueFull"});
}

function $scheduler_queue(_pending_0, _coalesce_0, _last_sources_0, _sources_0) {
  return $Bool_pick($$Bool_and($$Bool_not((_pending_0 === 0)), _coalesce_0), $$scheduler_merged($$collections_union(_last_sources_0, _sources_0)), $$Bool_pick((_pending_0 < 128), {$: "SchAppend", "sources": _sources_0}, {$: "SchQueueFull"}));
}

function $scheduler_order_result(_value_0) {
  return $accounting_accumulate(_value_0, $$accounting_one());
}

function $scheduler_occurrence_order(_sequence_0, _emitted_0) {
  return $scheduler_order_result($$accounting_add(_sequence_0, _emitted_0));
}

function $scheduler_advance(_previous_0, _sequence_0, _activity_0, _old_edge_0, _next_edge_0, _fired_0, _enqueued_0, _pending_0, _once_0) {
  const _stop_0 = $$Bool_and(_once_0, _pending_0);
  return $Bool_pick($$Bool_and(_fired_0, $$Bool_not(_enqueued_0)), {$: "SchAdvance", "cursor": _previous_0, "edge": _old_edge_0, "stop": true, "full": true}, {$: "SchAdvance", "cursor": $$Bool_pick(_stop_0, _activity_0, _sequence_0), "edge": _next_edge_0, "stop": _stop_0, "full": false});
}

function $scheduler_capacity_edge(_old_0, _available_0, _accepted_0) {
  return $Bool_pick($$Bool_and(_available_0, $$Bool_and($$Bool_not(_old_0), $$Bool_not(_accepted_0))), _old_0, _available_0);
}

function $scheduler_matches(_life_0, _present_0, _expected_0, _current_0) {
  return $Bool_and($$scheduler_active(_life_0), $$Bool_and(_present_0, $$String_eq(_expected_0, _current_0)));
}

function $scheduler_completed(_once_0) {
  return $Bool_pick(_once_0, {$: "SchCompleted"}, {$: "SchActive"});
}

function $scheduler_retry_fault(_code_0) {
  return $String_eq(_code_0, "REVISION_CONFLICT");
}

function $scheduler_watch(_facts_0, _activity_0, _due_present_0) {
  const _life_0 = _facts_0["life"];
  const _block_0 = _facts_0["block"];
  const _fired_0 = _facts_0["fired"];
  return $Bool_and($$scheduler_active(_life_0), $$Bool_and($$scheduler_unblocked(_block_0, _activity_0), $$Bool_and($$Bool_not(_fired_0), _due_present_0)));
}

function $scheduler_candidate_order(_candidate_0) {
  const _order_0 = _candidate_0["order"];
  return _order_0;
}

function $scheduler_candidate_incident(_candidate_0) {
  const _incident_0 = _candidate_0["incident"];
  return _incident_0;
}

function $scheduler_candidate_eligible(_candidate_0, _activity_0, _restricted_0, _incident_0) {
  const _owner_0 = _candidate_0["incident"];
  const _facts_0 = _candidate_0["facts"];
  const _x_0 = $$Bool_not(_restricted_0);
  const _x_1 = $$String_eq(_owner_0, _incident_0);
  return $Bool_and($$scheduler_runnable(_facts_0, _activity_0), (_x_0 || _x_1));
}

function $scheduler_prefer(_candidate_0, _current_0) {
  if (_current_0.$ === "SchNobody") {
    return {$: "SchChosen", "candidate": _candidate_0};
  } else {
    const _previous_0 = _current_0["candidate"];
    return $Bool_pick($$accounting_le($$scheduler_candidate_order(_previous_0), $$scheduler_candidate_order(_candidate_0)), {$: "SchChosen", "candidate": _previous_0}, {$: "SchChosen", "candidate": _candidate_0});
  }
}

function $scheduler_oldest($0, $1, $2, $3, $4) {
  for (;;) {
    {
      const _candidates_0 = $0;
      const _activity_0 = $1;
      const _restricted_0 = $2;
      const _incident_0 = $3;
      const _current_0 = $4;
      if (_candidates_0.$ === "Nil") {
        return _current_0;
      } else {
        const _head_0 = _candidates_0["head"];
        const _tail_0 = _candidates_0["tail"];
        $0 = _tail_0;
        $1 = _activity_0;
        $2 = _restricted_0;
        $3 = _incident_0;
        $4 = $$Bool_pick($$scheduler_candidate_eligible(_head_0, _activity_0, _restricted_0, _incident_0), $$scheduler_prefer(_head_0, _current_0), _current_0);
        continue;
      }
    }
  }
}

function $scheduler_lower_key(_value_0, _current_0) {
  if (_current_0.$ === "SchNoKey") {
    return {$: "SchKey", "value": _value_0};
  } else {
    const _previous_0 = _current_0["value"];
    const _old_0 = _previous_0;
    return $Bool_pick($$String_is_lt(_value_0, _old_0), {$: "SchKey", "value": _value_0}, {$: "SchKey", "value": _old_0});
  }
}

function $scheduler_first_key($0, $1, $2, $3, $4) {
  for (;;) {
    {
      const _candidates_0 = $0;
      const _activity_0 = $1;
      const _after_0 = $2;
      const _last_0 = $3;
      const _current_0 = $4;
      if (_candidates_0.$ === "Nil") {
        return _current_0;
      } else {
        const _head_0 = _candidates_0["head"];
        const _tail_0 = _candidates_0["tail"];
        const _incident_0 = $$scheduler_candidate_incident(_head_0);
        const _x_0 = $$Bool_not(_after_0);
        const _x_1 = $$String_is_lt(_last_0, _incident_0);
        $0 = _tail_0;
        $1 = _activity_0;
        $2 = _after_0;
        $3 = _last_0;
        $4 = $$Bool_pick($$Bool_and($$scheduler_candidate_eligible(_head_0, _activity_0, false, ""), (_x_0 || _x_1)), $$scheduler_lower_key(_incident_0, _current_0), _current_0);
        continue;
      }
    }
  }
}

function $scheduler_fallback(_key_0, _candidates_0, _activity_0) {
  if (_key_0.$ === "SchNoKey") {
    return $scheduler_first_key(_candidates_0, _activity_0, false, "", {$: "SchNoKey"});
  } else {
    return _key_0;
  }
}

function $scheduler_choose_key(_key_0, _candidates_0, _activity_0) {
  if (_key_0.$ === "SchNoKey") {
    return {$: "SchNobody"};
  } else {
    const _value_0 = _key_0["value"];
    return $scheduler_oldest(_candidates_0, _activity_0, true, _value_0, {$: "SchNobody"});
  }
}

function $scheduler_choose(_has_last_0, _last_0, _candidates_0, _activity_0) {
  return $Bool_pick(_has_last_0, $$scheduler_choose_key($$scheduler_fallback($$scheduler_first_key(_candidates_0, _activity_0, true, _last_0, {$: "SchNoKey"}), _candidates_0, _activity_0), _candidates_0, _activity_0), $$scheduler_oldest(_candidates_0, _activity_0, false, "", {$: "SchNobody"}));
}

function $scheduler_selection(_has_ids_0, _ids_0, _event_present_0, _subjects_0) {
  return $Bool_pick(_event_present_0, {$: "SchSelected", "ids": $$Bool_pick(_has_ids_0, $$collections_intersection(_ids_0, _subjects_0), _subjects_0)}, $$Bool_pick(_has_ids_0, {$: "SchSelected", "ids": _ids_0}, {$: "SchUnrestricted"}));
}

function $scheduler_causality(_root_0) {
  return {$: "SchCausality", "todo": {$: "Con", "head": _root_0, "tail": {$: "Nil"}}, "seen": {$: "Nil"}, "fuel": 128};
}

function $scheduler_demand_todo(_todo_0, _seen_0, _fuel_0) {
  if (_todo_0.$ === "Nil") {
    return {$: "SchIndependent"};
  } else {
    const _head_0 = _todo_0["head"];
    const _tail_0 = _todo_0["tail"];
    return $Bool_pick((_fuel_0 === 0), {$: "SchUnresolved"}, $$Bool_pick($$collections_contains(_seen_0, _head_0), {$: "SchSkipCause", "state": {$: "SchCausality", "todo": _tail_0, "seen": _seen_0, "fuel": ((_fuel_0 - 1) >>> 0)}}, {$: "SchNeedCause", "id": _head_0}));
  }
}

function $scheduler_demand(_state_0) {
  const _todo_0 = _state_0["todo"];
  const _seen_0 = _state_0["seen"];
  const _fuel_0 = _state_0["fuel"];
  return $scheduler_demand_todo(_todo_0, _seen_0, _fuel_0);
}

function $scheduler_step_event(_event_0, _expected_0, _tail_0, _seen_0, _fuel_0, _context_0, _schedule_0) {
  if (_event_0.$ === "SchMissingCause") {
    return {$: "SchUnknownCause"};
  } else {
    const _id_0 = _event_0["id"];
    const _owner_0 = _event_0["context"];
    const _kind_0 = _event_0["kind"];
    const _subjects_0 = _event_0["subjects"];
    const _causes_0 = _event_0["causes"];
    return $Bool_pick($$Bool_and($$String_eq(_id_0, _expected_0), $$String_eq(_owner_0, _context_0)), $$Bool_pick($$Bool_and($$String_eq(_kind_0, "runtime.schedule.triggered"), $$collections_contains(_subjects_0, _schedule_0)), {$: "SchDependent"}, {$: "SchNextCause", "state": {$: "SchCausality", "todo": $$List_append($$collections_unseen_fold(_causes_0, {$: "Con", "head": _id_0, "tail": _seen_0}, {$: "Nil"}), _tail_0), "seen": {$: "Con", "head": _id_0, "tail": _seen_0}, "fuel": ((_fuel_0 - 1) >>> 0)}}), {$: "SchUnknownCause"});
  }
}

function $scheduler_step_todo(_todo_0, _seen_0, _fuel_0, _event_0, _context_0, _schedule_0) {
  if (_todo_0.$ === "Nil") {
    return {$: "SchUnknownCause"};
  } else {
    const _head_0 = _todo_0["head"];
    const _tail_0 = _todo_0["tail"];
    return $Bool_pick((_fuel_0 === 0), {$: "SchUnknownCause"}, $$scheduler_step_event(_event_0, _head_0, _tail_0, _seen_0, _fuel_0, _context_0, _schedule_0));
  }
}

function $scheduler_step(_state_0, _event_0, _context_0, _schedule_0) {
  const _todo_0 = _state_0["todo"];
  const _seen_0 = _state_0["seen"];
  const _fuel_0 = _state_0["fuel"];
  return $scheduler_step_todo(_todo_0, _seen_0, _fuel_0, _event_0, _context_0, _schedule_0);
}

function $capability_schema_equal(_left_0, _right_0) {
  const _an_0 = _left_0["name"];
  const _av_0 = _left_0["version"];
  const _ad_0 = _left_0["digest"];
  const _bn_0 = _right_0["name"];
  const _bv_0 = _right_0["version"];
  const _bd_0 = _right_0["digest"];
  return $Bool_and($$String_eq(_an_0, _bn_0), $$Bool_and($$String_eq(_av_0, _bv_0), $$String_eq(_ad_0, _bd_0)));
}

function $capability_grant_fold($0, $1, $2, $3) {
  for (;;) {
    {
      const _scopes_0 = $0;
      const _name_0 = $1;
      const _identity_0 = $2;
      const _accepted_0 = $3;
      if (_scopes_0.$ === "Nil") {
        return _accepted_0;
      } else {
        const _t_0 = _scopes_0["head"];
        const _actions_0 = _t_0["actions"];
        const _resources_0 = _t_0["resources"];
        const _tail_0 = _scopes_0["tail"];
        $0 = _tail_0;
        $1 = _name_0;
        $2 = _identity_0;
        $3 = $$Bool_and(_accepted_0, $$Bool_and($$collections_contains(_actions_0, _name_0), $$collections_contains(_resources_0, _identity_0)));
        continue;
      }
    }
  }
}

function $capability_incident_fold($0, $1) {
  for (;;) {
    {
      const _scopes_0 = $0;
      const _required_0 = $1;
      if (_scopes_0.$ === "Nil") {
        return _required_0;
      } else {
        const _t_0 = _scopes_0["head"];
        const _all_incidents_0 = _t_0["all_incidents"];
        const _tail_0 = _scopes_0["tail"];
        const _x_0 = $$Bool_not(_all_incidents_0);
        $0 = _tail_0;
        $1 = (_required_0 || _x_0);
        continue;
      }
    }
  }
}

function $capability_reason(_accepted_0, _label_0, _rest_0) {
  return $Bool_pick(_accepted_0, _rest_0, {$: "Con", "head": _label_0, "tail": _rest_0});
}

function $capability_compatibility(_advertisement_0, _requirement_0, _scopes_0, _expired_0) {
  const _identity_0 = _advertisement_0["identity"];
  const _name_0 = _advertisement_0["name"];
  const _version_0 = _advertisement_0["version"];
  const _input_0 = _advertisement_0["input"];
  const _output_0 = _advertisement_0["output"];
  const _features_0 = _advertisement_0["features"];
  const _isolation_0 = _advertisement_0["isolation"];
  const _versions_0 = _requirement_0["versions"];
  const _requested_input_0 = _requirement_0["input"];
  const _requested_output_0 = _requirement_0["output"];
  const _requested_features_0 = _requirement_0["features"];
  const _requested_isolation_0 = _requirement_0["isolation"];
  return $capability_reason($$collections_contains(_versions_0, _version_0), "version", $$capability_reason($$capability_schema_equal(_input_0, _requested_input_0), "inputSchema", $$capability_reason($$capability_schema_equal(_output_0, _requested_output_0), "outputSchema", $$capability_reason($$collections_subset(_requested_features_0, _features_0), "features", $$capability_reason($$collections_contains(_requested_isolation_0, _isolation_0), "isolation", $$capability_reason($$Bool_not(_expired_0), "expired", $$capability_reason($$Bool_and($$Bool_not($$List_is_empty(_scopes_0)), $$capability_grant_fold(_scopes_0, _name_0, _identity_0, true)), "grant", {$: "Nil"})))))));
}

function $capability_basis_result(_unmet_0, _incident_required_0) {
  const _has_unmet_0 = $$Bool_not($$List_is_empty(_unmet_0));
  return $Bool_pick(_incident_required_0, {$: "CapAssessment", "unmet": $$List_append(_unmet_0, {$: "Con", "head": "incident_required", "tail": {$: "Nil"}}), "eligibility": $$Bool_pick(_has_unmet_0, {$: "CapIneligible"}, {$: "CapUnknown"})}, $$Bool_pick(_has_unmet_0, {$: "CapAssessment", "unmet": _unmet_0, "eligibility": {$: "CapIneligible"}}, {$: "CapNeedsPolicy"}));
}

function $capability_basis(_advertisement_0, _requirement_0, _scopes_0, _expired_0, _incident_present_0) {
  return $capability_basis_result($$capability_compatibility(_advertisement_0, _requirement_0, _scopes_0, _expired_0), $$Bool_and($$Bool_not(_incident_present_0), $$capability_incident_fold(_scopes_0, false)));
}

function $capability_policy_result(_policy_0) {
  if (_policy_0.$ === "CapPolicyAllowed") {
    return {$: "CapAssessment", "unmet": {$: "Nil"}, "eligibility": {$: "CapEligible"}};
  } else if (_policy_0.$ === "CapPolicyDenied") {
    return {$: "CapAssessment", "unmet": {$: "Con", "head": "policy", "tail": {$: "Nil"}}, "eligibility": {$: "CapIneligible"}};
  } else {
    return {$: "CapAssessment", "unmet": {$: "Con", "head": "policy_unknown", "tail": {$: "Nil"}}, "eligibility": {$: "CapUnknown"}};
  }
}

function $capability_finish(_assessment_0, _policy_0) {
  if (_assessment_0.$ === "CapNeedsPolicy") {
    return $capability_policy_result(_policy_0);
  } else {
    return _assessment_0;
  }
}

function $capability_eligibility_rank(_value_0) {
  if (_value_0.$ === "CapEligible") {
    return 0;
  } else if (_value_0.$ === "CapUnknown") {
    return 1;
  } else {
    return 2;
  }
}

function $capability_compare_fields(_left_rank_0, _right_rank_0, _left_count_0, _right_count_0, _left_id_0, _right_id_0) {
  return $Bool_pick((_left_rank_0 < _right_rank_0), {$: "LT"}, $$Bool_pick((_right_rank_0 < _left_rank_0), {$: "GT"}, $$Bool_pick((_left_count_0 < _right_count_0), {$: "LT"}, $$Bool_pick((_right_count_0 < _left_count_0), {$: "GT"}, $$String_order(_left_id_0, _right_id_0)))));
}

function $capability_compare(_left_0, _left_count_0, _left_id_0, _right_0, _right_count_0, _right_id_0) {
  return $capability_compare_fields($$capability_eligibility_rank(_left_0), $$capability_eligibility_rank(_right_0), _left_count_0, _right_count_0, _left_id_0, _right_id_0);
}

function $capability_room(_count_0) {
  return (_count_0 < 4096);
}

function $capability_publish(_advertisement_0, _principal_0, _methods_0, _count_0, _expired_0) {
  const _provider_0 = _advertisement_0["provider"];
  const _name_0 = _advertisement_0["name"];
  return $Bool_pick($$capability_room(_count_0), $$Bool_pick($$String_eq(_provider_0, _principal_0), $$Bool_pick($$collections_contains(_methods_0, _name_0), {$: "CapReservedName"}, $$Bool_pick(_expired_0, {$: "CapExpired"}, {$: "CapPublishAllowed"})), {$: "CapWrongProvider"}), {$: "CapRetentionFull"});
}

function $capability_execution_admission(_expired_0, _context_0, _incident_present_0, _incident_ended_0) {
  return $Bool_pick(_expired_0, {$: "CapExecutionExpired"}, $$Bool_pick($$String_eq(_context_0, "open"), $$Bool_pick($$Bool_and(_incident_present_0, $$Bool_not(_incident_ended_0)), {$: "CapExecutionAllowed"}, {$: "CapExecutionIncident"}), {$: "CapExecutionClosed"}));
}

function $capability_prepare(_incident_0, _capability_0, _operator_0, _actor_0, _requester_0, _submitted_0, _bound_0, _readable_0) {
  const _x_0 = $$Bool_pick($$String_eq(_actor_0, _requester_0), $$String_eq(_submitted_0, _bound_0), _readable_0);
  return $Bool_pick($$Bool_and(_incident_0, _capability_0), $$Bool_pick((_operator_0 || _x_0), {$: "CapPrepareAllowed"}, {$: "CapPrepareGrant"}), {$: "CapPrepareScope"});
}

function $capability_visible(_present_0, _origin_present_0, _incident_0, _operator_0, _principal_0, _requester_0, _provider_0, _first_grant_0, _chain_0, _capability_0, _readable_0) {
  const _x_0 = $$Bool_and($$String_eq(_principal_0, _provider_0), _capability_0);
  const _x_1 = $$Bool_and($$String_eq(_principal_0, _requester_0), $$collections_contains(_chain_0, _first_grant_0));
  const _x_2 = (_x_0 || _readable_0);
  const _x_3 = (_x_1 || _x_2);
  return $Bool_and(_present_0, $$Bool_and(_origin_present_0, $$Bool_and(_incident_0, (_operator_0 || _x_3))));
}

function $capability_reconcile(_principal_0, _provider_0, _operator_0, _readable_0) {
  const _x_0 = $$String_eq(_principal_0, _provider_0);
  const _x_1 = (_operator_0 || _readable_0);
  return (_x_0 || _x_1);
}

function $capability_evidence(_required_0, _sources_0) {
  const _x_0 = $$Bool_not(_required_0);
  const _x_1 = $$Bool_not($$List_is_empty(_sources_0));
  return (_x_0 || _x_1);
}

function $capability_selected(_advertised_0, _requested_0, _readable_0) {
  return $Bool_and(_readable_0, $$String_eq(_advertised_0, _requested_0));
}

function $policy_query_initial(_records_0, _assertions_0) {
  const _x_0 = ((32768 - _records_0) >>> 0);
  return $Bool_pick($$Bool_and((_records_0 <= 4096), (_assertions_0 <= 16384)), {$: "PQBudget", "remaining": ((_x_0 - _assertions_0) >>> 0)}, {$: "PQExhausted"});
}

function $policy_query_charge(_budget_0, _cost_0) {
  if (_budget_0.$ === "PQExhausted") {
    return {$: "PQExhausted"};
  } else {
    const _remaining_0 = _budget_0["remaining"];
    return $Bool_pick((_cost_0 <= _remaining_0), {$: "PQBudget", "remaining": ((_remaining_0 - _cost_0) >>> 0)}, {$: "PQExhausted"});
  }
}

function $policy_query_available(_budget_0) {
  if (_budget_0.$ === "PQExhausted") {
    return false;
  } else {
    return true;
  }
}

function $policy_query_edge_charge(_budget_0, _subjects_0, _objects_0) {
  return $policy_query_charge($$policy_query_charge($$policy_query_charge(_budget_0, 1), _subjects_0), _objects_0);
}

function $policy_query_charges($0, $1) {
  for (;;) {
    {
      const _costs_0 = $0;
      const _budget_0 = $1;
      if (_costs_0.$ === "Nil") {
        return _budget_0;
      } else {
        const _head_0 = _costs_0["head"];
        const _tail_0 = _costs_0["tail"];
        $0 = _tail_0;
        $1 = $$policy_query_charge(_budget_0, _head_0);
        continue;
      }
    }
  }
}

function $policy_query_projected(_accepted_0, _index_0, _record_0, _cost_0, _projection_0) {
  const _budget_0 = _projection_0["budget"];
  const _indices_0 = _projection_0["indices"];
  const _records_0 = _projection_0["records"];
  const _provenance_0 = _projection_0["provenance"];
  return $Bool_pick(_accepted_0, {$: "PQProjection", "budget": $$policy_query_charge(_budget_0, _cost_0), "indices": {$: "Con", "head": _index_0, "tail": _indices_0}, "records": {$: "Con", "head": _record_0, "tail": _records_0}, "provenance": ((_provenance_0 + _cost_0) >>> 0)}, {$: "PQProjection", "budget": _budget_0, "indices": _indices_0, "records": _records_0, "provenance": _provenance_0});
}

function $policy_query_project_step(_assertion_0, _system_0, _context_0, _issuers_0, _projection_0) {
  const _index_0 = _assertion_0["index"];
  const _owner_system_0 = _assertion_0["system"];
  const _owner_context_0 = _assertion_0["context"];
  const _issuer_0 = _assertion_0["issuer"];
  const _record_0 = _assertion_0["record"];
  const _sources_0 = _assertion_0["sources"];
  return $policy_query_projected($$Bool_and($$String_eq(_system_0, _owner_system_0), $$Bool_and($$String_eq(_context_0, _owner_context_0), $$collections_contains(_issuers_0, _issuer_0))), _index_0, _record_0, _sources_0, _projection_0);
}

function $policy_query_project_fold($0, $1, $2, $3, $4) {
  for (;;) {
    {
      const _assertions_0 = $0;
      const _system_0 = $1;
      const _context_0 = $2;
      const _issuers_0 = $3;
      const _projection_0 = $4;
      if (_assertions_0.$ === "Nil") {
        return _projection_0;
      } else {
        const _head_0 = _assertions_0["head"];
        const _tail_0 = _assertions_0["tail"];
        $0 = _tail_0;
        $1 = _system_0;
        $2 = _context_0;
        $3 = _issuers_0;
        $4 = $$policy_query_project_step(_head_0, _system_0, _context_0, _issuers_0, _projection_0);
        continue;
      }
    }
  }
}

function $policy_query_project_finish(_projection_0) {
  const _budget_0 = _projection_0["budget"];
  const _indices_0 = _projection_0["indices"];
  const _records_0 = _projection_0["records"];
  const _provenance_0 = _projection_0["provenance"];
  return {$: "PQProjection", "budget": _budget_0, "indices": $$List_reverse(_indices_0), "records": $$List_reverse(_records_0), "provenance": _provenance_0};
}

function $policy_query_project(_assertions_0, _system_0, _context_0, _issuers_0, _budget_0) {
  return $policy_query_project_finish($$policy_query_project_fold(_assertions_0, _system_0, _context_0, _issuers_0, {$: "PQProjection", "budget": _budget_0, "indices": {$: "Nil"}, "records": {$: "Nil"}, "provenance": 0}));
}

function $policy_query_readable_fold($0, $1) {
  for (;;) {
    {
      const _values_0 = $0;
      const _accepted_0 = $1;
      if (_values_0.$ === "Nil") {
        return _accepted_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        $0 = _tail_0;
        $1 = $$Bool_and(_accepted_0, _head_0);
        continue;
      }
    }
  }
}

function $policy_query_supported(_status_0, _sources_0) {
  return $Bool_and($$String_eq(_status_0, "asserted"), $$policy_query_readable_fold(_sources_0, true));
}

function $policy_query_selected(_kind_0, _schema_0, _names_0, _readable_0, _asserted_0) {
  return $Bool_and($$String_eq(_kind_0, "relation"), $$Bool_and($$collections_contains(_names_0, _schema_0), $$Bool_and(_readable_0, _asserted_0)));
}

function $policy_query_observed(_found_0, _operator_0) {
  return $Bool_pick(_found_0, {$: "PQYes"}, $$Bool_pick(_operator_0, {$: "PQNo"}, {$: "PQUnknown"}));
}

function $policy_query_plan_step(_header_0, _plan_0) {
  const _index_0 = _header_0["index"];
  const _subjects_0 = _header_0["subjects"];
  const _objects_0 = _header_0["objects"];
  const _budget_0 = _plan_0["budget"];
  const _indices_0 = _plan_0["indices"];
  const _omitted_0 = _plan_0["omitted"];
  const _next_0 = $$policy_query_edge_charge(_budget_0, _subjects_0, _objects_0);
  const _x_0 = $$Bool_not($$policy_query_available(_next_0));
  return $Bool_pick((_omitted_0 || _x_0), {$: "PQPlan", "budget": _budget_0, "indices": _indices_0, "omitted": true}, {$: "PQPlan", "budget": _next_0, "indices": {$: "Con", "head": _index_0, "tail": _indices_0}, "omitted": false});
}

function $policy_query_plan_fold($0, $1) {
  for (;;) {
    {
      const _headers_0 = $0;
      const _plan_0 = $1;
      if (_headers_0.$ === "Nil") {
        return _plan_0;
      } else {
        const _head_0 = _headers_0["head"];
        const _tail_0 = _headers_0["tail"];
        $0 = _tail_0;
        $1 = $$policy_query_plan_step(_head_0, _plan_0);
        continue;
      }
    }
  }
}

function $policy_query_plan_finish(_plan_0) {
  const _budget_0 = _plan_0["budget"];
  const _indices_0 = _plan_0["indices"];
  const _omitted_0 = _plan_0["omitted"];
  return {$: "PQPlan", "budget": _budget_0, "indices": $$List_reverse(_indices_0), "omitted": _omitted_0};
}

function $policy_query_plan(_headers_0, _budget_0) {
  return $policy_query_plan_finish($$policy_query_plan_fold(_headers_0, {$: "PQPlan", "budget": _budget_0, "indices": {$: "Nil"}, "omitted": false}));
}

function $policy_query_target_fields(_traversal_0, _key_0, _readable_0, _destination_0) {
  if (_traversal_0.$ === "PQAdvance") {
    const _budget_0 = _traversal_0["budget"];
    const _next_0 = _traversal_0["next"];
    const _seen_0 = _traversal_0["seen"];
    const _count_0 = _traversal_0["count"];
    return $Bool_pick(_readable_0, $$Bool_pick($$String_eq(_key_0, _destination_0), {$: "PQFound", "budget": _budget_0}, $$Bool_pick($$collections_contains(_seen_0, _key_0), {$: "PQAdvance", "budget": _budget_0, "next": _next_0, "seen": _seen_0, "count": _count_0}, $$Bool_pick((_count_0 < 512), {$: "PQAdvance", "budget": _budget_0, "next": {$: "Con", "head": _key_0, "tail": _next_0}, "seen": {$: "Con", "head": _key_0, "tail": _seen_0}, "count": ((_count_0 + 1) >>> 0)}, {$: "PQUnresolved", "budget": _budget_0}))), {$: "PQAdvance", "budget": _budget_0, "next": _next_0, "seen": _seen_0, "count": _count_0});
  } else {
    return _traversal_0;
  }
}

function $policy_query_target_step(_target_0, _destination_0, _traversal_0) {
  const _key_0 = _target_0["key"];
  const _readable_0 = _target_0["readable"];
  return $policy_query_target_fields(_traversal_0, _key_0, _readable_0, _destination_0);
}

function $policy_query_targets_fold($0, $1, $2) {
  for (;;) {
    {
      const _targets_0 = $0;
      const _destination_0 = $1;
      const _traversal_0 = $2;
      if (_targets_0.$ === "Nil") {
        return _traversal_0;
      } else {
        const _head_0 = _targets_0["head"];
        const _tail_0 = _targets_0["tail"];
        $0 = _tail_0;
        $1 = _destination_0;
        $2 = $$policy_query_target_step(_head_0, _destination_0, _traversal_0);
        continue;
      }
    }
  }
}

function $policy_query_edge_targets(_matched_0, _targets_0, _destination_0, _traversal_0) {
  if (!_matched_0) {
    return _traversal_0;
  } else {
    return $policy_query_targets_fold(_targets_0, _destination_0, _traversal_0);
  }
}

function $policy_query_edge_ready(_budget_0, _subjects_0, _targets_0, _source_0, _destination_0, _next_0, _seen_0, _count_0) {
  if (_budget_0.$ === "PQExhausted") {
    return {$: "PQUnresolved", "budget": {$: "PQExhausted"}};
  } else {
    const _remaining_0 = _budget_0["remaining"];
    return $policy_query_edge_targets($$collections_contains(_subjects_0, _source_0), _targets_0, _destination_0, {$: "PQAdvance", "budget": {$: "PQBudget", "remaining": _remaining_0}, "next": _next_0, "seen": _seen_0, "count": _count_0});
  }
}

function $policy_query_count_budget(_budget_0, _cost_0) {
  const _high_0 = _cost_0["high"];
  const _low_0 = _cost_0["low"];
  return $Bool_pick((_high_0 === 0), $$policy_query_charge(_budget_0, _low_0), {$: "PQExhausted"});
}

function $policy_query_role_budget(_subjects_0, _objects_0, _budget_0) {
  return $policy_query_count_budget($$policy_query_count_budget($$policy_query_charge(_budget_0, 1), _subjects_0), _objects_0);
}

function $policy_query_edge_body(_edge_0, _source_0, _destination_0, _budget_0, _next_0, _seen_0, _count_0) {
  if (_edge_0.$ === "PQOmittedEdge") {
    return {$: "PQUnresolved", "budget": {$: "PQExhausted"}};
  } else {
    const _subject_count_0 = _edge_0["subject_count"];
    const _target_count_0 = _edge_0["target_count"];
    const _subjects_0 = _edge_0["subjects"];
    const _targets_0 = _edge_0["targets"];
    return $policy_query_edge_ready($$policy_query_role_budget(_subject_count_0, _target_count_0, _budget_0), _subjects_0, _targets_0, _source_0, _destination_0, _next_0, _seen_0, _count_0);
  }
}

function $policy_query_edge_step(_edge_0, _source_0, _destination_0, _traversal_0) {
  if (_traversal_0.$ === "PQAdvance") {
    const _budget_0 = _traversal_0["budget"];
    const _next_0 = _traversal_0["next"];
    const _seen_0 = _traversal_0["seen"];
    const _count_0 = _traversal_0["count"];
    return $policy_query_edge_body(_edge_0, _source_0, _destination_0, _budget_0, _next_0, _seen_0, _count_0);
  } else {
    return _traversal_0;
  }
}

function $policy_query_edges_fold($0, $1, $2, $3) {
  for (;;) {
    {
      const _edges_0 = $0;
      const _source_0 = $1;
      const _destination_0 = $2;
      const _traversal_0 = $3;
      if (_edges_0.$ === "Nil") {
        return _traversal_0;
      } else {
        const _head_0 = _edges_0["head"];
        const _tail_0 = _edges_0["tail"];
        $0 = _tail_0;
        $1 = _source_0;
        $2 = _destination_0;
        $3 = $$policy_query_edge_step(_head_0, _source_0, _destination_0, _traversal_0);
        continue;
      }
    }
  }
}

function $policy_query_source_step(_source_0, _edges_0, _destination_0, _traversal_0) {
  if (_traversal_0.$ === "PQAdvance") {
    const _budget_0 = _traversal_0["budget"];
    const _next_0 = _traversal_0["next"];
    const _seen_0 = _traversal_0["seen"];
    const _count_0 = _traversal_0["count"];
    return $policy_query_edges_fold(_edges_0, _source_0, _destination_0, {$: "PQAdvance", "budget": _budget_0, "next": _next_0, "seen": _seen_0, "count": _count_0});
  } else {
    return _traversal_0;
  }
}

function $policy_query_sources_fold($0, $1, $2, $3) {
  for (;;) {
    {
      const _sources_0 = $0;
      const _edges_0 = $1;
      const _destination_0 = $2;
      const _traversal_0 = $3;
      if (_sources_0.$ === "Nil") {
        return _traversal_0;
      } else {
        const _head_0 = _sources_0["head"];
        const _tail_0 = _sources_0["tail"];
        $0 = _tail_0;
        $1 = _edges_0;
        $2 = _destination_0;
        $3 = $$policy_query_source_step(_head_0, _edges_0, _destination_0, _traversal_0);
        continue;
      }
    }
  }
}

function $policy_query_layer_result(_traversal_0, _operator_0) {
  if (_traversal_0.$ === "PQFound") {
    const _budget_0 = _traversal_0["budget"];
    return {$: "PQDone", "verdict": {$: "PQYes"}, "budget": _budget_0};
  } else if (_traversal_0.$ === "PQUnresolved") {
    const _budget_1 = _traversal_0["budget"];
    return {$: "PQDone", "verdict": {$: "PQUnknown"}, "budget": _budget_1};
  } else {
    const _budget_2 = _traversal_0["budget"];
    const _next_0 = _traversal_0["next"];
    const _seen_0 = _traversal_0["seen"];
    const _count_0 = _traversal_0["count"];
    return $Bool_pick($$List_is_empty(_next_0), {$: "PQDone", "verdict": $$policy_query_observed(false, _operator_0), "budget": _budget_2}, {$: "PQSearch", "frontier": $$List_reverse(_next_0), "seen": _seen_0, "count": _count_0, "budget": _budget_2});
  }
}

function $policy_query_layer(_search_0, _edges_0, _destination_0, _operator_0) {
  if (_search_0.$ === "PQSearch") {
    const _frontier_0 = _search_0["frontier"];
    const _seen_0 = _search_0["seen"];
    const _count_0 = _search_0["count"];
    const _budget_0 = _search_0["budget"];
    return $policy_query_layer_result($$policy_query_sources_fold(_frontier_0, _edges_0, _destination_0, {$: "PQAdvance", "budget": _budget_0, "next": {$: "Nil"}, "seen": _seen_0, "count": _count_0}), _operator_0);
  } else {
    return _search_0;
  }
}

function $policy_query_layers($0, $1, $2, $3, $4) {
  for (;;) {
    {
      const _hops_0 = $0;
      const _edges_0 = $1;
      const _destination_0 = $2;
      const _operator_0 = $3;
      const _search_0 = $4;
      if (_hops_0 == 0) {
        return _search_0;
      } else {
        const _p_0 = (_hops_0 - 1);
        $0 = _p_0;
        $1 = _edges_0;
        $2 = _destination_0;
        $3 = _operator_0;
        $4 = $$policy_query_layer(_search_0, _edges_0, _destination_0, _operator_0);
        continue;
      }
    }
  }
}

function $policy_query_search_finish(_search_0, _operator_0) {
  if (_search_0.$ === "PQSearch") {
    const _budget_0 = _search_0["budget"];
    return {$: "PQDone", "verdict": $$policy_query_observed(false, _operator_0), "budget": _budget_0};
  } else {
    return _search_0;
  }
}

function $policy_query_related_budget(_budget_0, _edges_0, _start_0, _destination_0, _hops_0, _operator_0) {
  if (_budget_0.$ === "PQExhausted") {
    return {$: "PQDone", "verdict": {$: "PQUnknown"}, "budget": {$: "PQExhausted"}};
  } else {
    const _remaining_0 = _budget_0["remaining"];
    return $policy_query_search_finish($$policy_query_layers(_hops_0, _edges_0, _destination_0, _operator_0, {$: "PQSearch", "frontier": {$: "Con", "head": _start_0, "tail": {$: "Nil"}}, "seen": {$: "Con", "head": _start_0, "tail": {$: "Nil"}}, "count": 1, "budget": {$: "PQBudget", "remaining": _remaining_0}}), _operator_0);
  }
}

function $policy_query_related(_edges_0, _start_0, _destination_0, _hops_0, _operator_0, _budget_0) {
  return $policy_query_related_budget(_budget_0, _edges_0, _start_0, _destination_0, _hops_0, _operator_0);
}

function $control_field(_path_0) {
  if (_path_0.$ === "Nil") {
    return true;
  } else {
    const _head_0 = _path_0["head"];
    const _tail_0 = _path_0["tail"];
    const _name_0 = _head_0;
    const _x_0 = $$String_eq(_name_0, "value");
    const _x_1 = $$String_eq(_name_0, "ref");
    const _x_2 = (_x_0 || _x_1);
    const _x_3 = $$Bool_and($$List_is_empty(_tail_0), $$collections_contains({$: "Con", "head": "support", "tail": {$: "Con", "head": "digest", "tail": {$: "Con", "head": "revision", "tail": {$: "Con", "head": "recordedAt", "tail": {$: "Con", "head": "recordedBy", "tail": {$: "Nil"}}}}}}, _name_0));
    return (_x_2 || _x_3);
  }
}

function $control_schema_name(_path_0) {
  if (_path_0.$ === "Nil") {
    return true;
  } else {
    const _head_0 = _path_0["head"];
    const _tail_0 = _path_0["tail"];
    return $Bool_and($$String_eq(_head_0, "name"), $$List_is_empty(_tail_0));
  }
}

function $control_schema_tail(_path_0) {
  if (_path_0.$ === "Nil") {
    return true;
  } else {
    const _head_0 = _path_0["head"];
    const _tail_0 = _path_0["tail"];
    return $Bool_and($$String_eq(_head_0, "schema"), $$control_schema_name(_tail_0));
  }
}

function $control_schema_path(_path_0) {
  if (_path_0.$ === "Nil") {
    return true;
  } else {
    const _head_0 = _path_0["head"];
    const _tail_0 = _path_0["tail"];
    return $Bool_and($$String_eq(_head_0, "value"), $$control_schema_tail(_tail_0));
  }
}

function $control_fields(_paths_0) {
  if (_paths_0.$ === "Nil") {
    return true;
  } else {
    const _t_0 = _paths_0["head"];
    const _path_0 = _t_0["tokens"];
    const _tail_0 = _paths_0["tail"];
    return $Bool_and($$control_field(_path_0), $$control_fields(_tail_0));
  }
}

function $control_schema_visible(_paths_0) {
  if (_paths_0.$ === "Nil") {
    return false;
  } else {
    const _t_0 = _paths_0["head"];
    const _path_0 = _t_0["tokens"];
    const _tail_0 = _paths_0["tail"];
    const _x_0 = $$control_schema_path(_path_0);
    const _x_1 = $$control_schema_visible(_tail_0);
    return (_x_0 || _x_1);
  }
}

function $control_projection_room(_count_0) {
  return (_count_0 <= 64);
}

function $control_projection(_count_0, _paths_0, _schema_0) {
  return $Bool_pick($$Bool_not($$control_projection_room(_count_0)), {$: "ProjectionTooMany"}, $$Bool_pick($$control_fields(_paths_0), $$Bool_pick($$Bool_and(_schema_0, $$Bool_not($$control_schema_visible(_paths_0))), {$: "ProjectionSchemaHidden"}, {$: "ProjectionAllowed"}), {$: "ProjectionUnknown"}));
}

function $control_aliases($0, $1) {
  for (;;) {
    {
      const _changes_0 = $0;
      const _id_0 = $1;
      if (_changes_0.$ === "Nil") {
        return false;
      } else {
        const _t_0 = _changes_0["head"];
        if (_t_0.$ === "DeclaredChange") {
          const _other_0 = _t_0["id"];
          const _tail_0 = _changes_0["tail"];
          const _x_0 = $$String_eq(_other_0, _id_0);
          const _x_1 = $$control_aliases(_tail_0, _id_0);
          return (_x_0 || _x_1);
        } else {
          const _tail_1 = _changes_0["tail"];
          $0 = _tail_1;
          $1 = _id_0;
          continue;
        }
      }
    }
  }
}

function $control_proposal(_id_0, _basis_0, _expected_0, _policy_0, _current_0, _changes_0, _executions_0) {
  return $Bool_pick($$Bool_and($$String_eq(_basis_0, _expected_0), $$String_eq(_policy_0, _current_0)), $$Bool_pick($$Bool_and($$List_is_empty(_changes_0), (_executions_0 === 0)), {$: "ProposalEmpty"}, $$Bool_pick($$control_aliases(_changes_0, _id_0), {$: "ProposalAlias"}, {$: "ProposalAllowed"})), {$: "ProposalStale"});
}

function $control_commit(_state_0, _recorded_0, _current_0, _policy_0, _selected_0) {
  return $Bool_pick($$String_eq(_state_0, "proposed"), $$Bool_pick($$Bool_and($$String_eq(_recorded_0, _current_0), $$String_eq(_policy_0, _selected_0)), {$: "CommitAllowed"}, {$: "CommitStale"}), {$: "CommitTerminal"});
}

function $control_declared($0) {
  for (;;) {
    {
      const _changes_0 = $0;
      if (_changes_0.$ === "Nil") {
        return {$: "Nil"};
      } else {
        const _t_0 = _changes_0["head"];
        if (_t_0.$ === "DeclaredChange") {
          const _id_0 = _t_0["id"];
          const _tail_0 = _changes_0["tail"];
          return {$: "Con", "head": _id_0, "tail": $$control_declared(_tail_0)};
        } else {
          const _tail_1 = _changes_0["tail"];
          $0 = _tail_1;
          continue;
        }
      }
    }
  }
}

function $control_executions(_items_0, _incident_0, _seen_0) {
  if (_items_0.$ === "Nil") {
    return {$: "PlanAllowed"};
  } else {
    const _t_0 = _items_0["head"];
    const _id_0 = _t_0["id"];
    const _selected_0 = _t_0["incident"];
    const _tail_0 = _items_0["tail"];
    const _key_0 = _id_0;
    return $Bool_pick($$String_eq(_selected_0, _incident_0), $$Bool_pick($$collections_contains(_seen_0, _key_0), {$: "PlanAlias"}, $$control_executions(_tail_0, _incident_0, {$: "Con", "head": _key_0, "tail": _seen_0})), {$: "PlanIncident"});
  }
}

function $control_plan(_id_0, _incident_0, _changes_0, _items_0) {
  return $control_executions(_items_0, _incident_0, {$: "Con", "head": _id_0, "tail": $$control_declared(_changes_0)});
}

function $control_visible(_present_0, _incident_0, _operator_0, _origin_0, _principal_0, _grant_0, _chain_0, _readable_0) {
  const _x_0 = $$Bool_and($$String_eq(_origin_0, _principal_0), $$collections_contains(_chain_0, _grant_0));
  const _x_1 = (_readable_0 || _x_0);
  return $Bool_and($$Bool_and(_present_0, _incident_0), (_operator_0 || _x_1));
}

function $control_namespace(_names_0) {
  if (_names_0.$ === "Nil") {
    return false;
  } else {
    const _head_0 = _names_0["head"];
    const _tail_0 = _names_0["tail"];
    const _x_0 = $$collections_contains({$: "Con", "head": "policies", "tail": {$: "Con", "head": "grants", "tail": {$: "Con", "head": "rules", "tail": {$: "Con", "head": "capabilities", "tail": {$: "Con", "head": "schedules", "tail": {$: "Con", "head": "views", "tail": {$: "Con", "head": "guidanceSources", "tail": {$: "Con", "head": "guidanceCaptures", "tail": {$: "Nil"}}}}}}}}}, _head_0);
    const _x_1 = $$control_namespace(_tail_0);
    return (_x_0 || _x_1);
  }
}

function $control_revoke(_operator_0, _target_0, _bound_0, _issuer_0, _principal_0, _chain_0) {
  const _x_0 = $$String_eq(_target_0, _bound_0);
  const _x_1 = $$Bool_and($$String_eq(_issuer_0, _principal_0), $$collections_contains(_chain_0, _bound_0));
  const _x_2 = (_x_0 || _x_1);
  return (_operator_0 || _x_2);
}

function $control_actions(_requested_0, _installed_0, _capabilities_0) {
  return $collections_subset(_requested_0, $$collections_union(_installed_0, _capabilities_0));
}

function $control_schema(_name_0, _installed_0, _submitted_0, _actual_0, _present_0, _previous_0) {
  return $Bool_pick($$Bool_and($$String_starts_with(_name_0, "moment."), $$Bool_not(_installed_0)), {$: "SchemaReserved"}, $$Bool_pick($$String_eq(_submitted_0, _actual_0), $$Bool_pick($$Bool_and(_present_0, $$Bool_not($$String_eq(_previous_0, _submitted_0))), {$: "SchemaConflict"}, {$: "SchemaAllowed"}), {$: "SchemaDigest"}));
}

function $control_binding_names(_names_0) {
  return $collections_subset(_names_0, {$: "Con", "head": "occurrence.id", "tail": {$: "Con", "head": "occurrence.eventIds", "tail": {$: "Con", "head": "schedule.id", "tail": {$: "Con", "head": "contextId", "tail": {$: "Con", "head": "principalId", "tail": {$: "Con", "head": "incidentId", "tail": {$: "Con", "head": "action", "tail": {$: "Con", "head": "resourceRefs", "tail": {$: "Con", "head": "contextRevision", "tail": {$: "Con", "head": "now", "tail": {$: "Con", "head": "event.id", "tail": {$: "Con", "head": "event.ids", "tail": {$: "Con", "head": "event.type", "tail": {$: "Con", "head": "event.subjectRefs", "tail": {$: "Nil"}}}}}}}}}}}}}}});
}

function $awareness_all_fold($0, $1) {
  for (;;) {
    {
      const _values_0 = $0;
      const _accepted_0 = $1;
      if (_values_0.$ === "Nil") {
        return _accepted_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        $0 = _tail_0;
        $1 = $$Bool_and(_accepted_0, _head_0);
        continue;
      }
    }
  }
}

function $awareness_all(_values_0) {
  return $awareness_all_fold(_values_0, true);
}

function $awareness_detail(_message_0, _kind_0, _roles_0, _incident_0, _scope_0, _dependencies_0) {
  return $Bool_pick(_message_0, {$: "DetailMailbox"}, $$Bool_pick($$Bool_and($$String_eq(_kind_0, "relation"), $$Bool_not($$awareness_all(_roles_0))), {$: "DetailRelation"}, $$Bool_pick($$Bool_and(_incident_0, $$Bool_not(_scope_0)), {$: "DetailIncident"}, $$Bool_pick($$awareness_all(_dependencies_0), {$: "DetailAllowed"}, {$: "DetailDependencies"}))));
}

function $awareness_message_visible(_present_0, _recipient_0, _principal_0, _incident_0) {
  return $Bool_and($$Bool_and(_present_0, _incident_0), $$String_eq(_recipient_0, _principal_0));
}

function $awareness_message(_count_0, _bytes_0, _incident_0, _scope_0, _live_0) {
  return $Bool_pick((_count_0 >= 4096), {$: "MessageRetention"}, $$Bool_pick($$accounting_le(_bytes_0, {$: "BudgetCount", "high": 0, "low": 8192}), $$Bool_pick($$Bool_and(_incident_0, _scope_0), $$Bool_pick(_live_0, {$: "MessageAllowed"}, {$: "MessageExpired"}), {$: "MessageIncident"}), {$: "MessageSummary"}));
}

function $awareness_reply(_kind_0, _incident_0, _principal_0, _recipient_0, _parent_0) {
  if (_parent_0.$ === "NoParent") {
    return $Bool_pick($$String_eq(_kind_0, "response"), {$: "ReplyRequired"}, {$: "ReplyReady"});
  } else if (_parent_0.$ === "MissingParent") {
    return {$: "ReplyUnavailable"};
  } else {
    const _parent_kind_0 = _parent_0["kind"];
    const _parent_incident_0 = _parent_0["incident"];
    const _parent_recipient_0 = _parent_0["recipient"];
    const _parent_sender_0 = _parent_0["sender"];
    return $Bool_pick($$Bool_and($$Bool_and($$String_eq(_parent_kind_0, "request"), $$String_eq(_incident_0, _parent_incident_0)), $$Bool_and($$String_eq(_parent_recipient_0, _principal_0), $$String_eq(_parent_sender_0, _recipient_0))), {$: "ReplyNeedsVisibility"}, {$: "ReplyUnavailable"});
  }
}

function $awareness_recipient_step(_principal_0, _grant_0, _bag_0) {
  const _index_0 = _grant_0["index"];
  const _actor_0 = _grant_0["principal"];
  if (_bag_0.$ === "RecipientExhausted") {
    return {$: "RecipientExhausted"};
  } else {
    const _count_0 = _bag_0["count"];
    const _reversed_0 = _bag_0["reversed"];
    return $Bool_pick($$String_eq(_actor_0, _principal_0), $$Bool_pick((_count_0 >= 4096), {$: "RecipientExhausted"}, {$: "RecipientCollect", "count": ((_count_0 + 1) >>> 0), "reversed": {$: "Con", "head": _index_0, "tail": _reversed_0}}), {$: "RecipientCollect", "count": _count_0, "reversed": _reversed_0});
  }
}

function $awareness_recipient_fold($0, $1, $2) {
  for (;;) {
    {
      const _grants_0 = $0;
      const _principal_0 = $1;
      const _bag_0 = $2;
      if (_grants_0.$ === "Nil") {
        return _bag_0;
      } else {
        const _head_0 = _grants_0["head"];
        const _tail_0 = _grants_0["tail"];
        $0 = _tail_0;
        $1 = _principal_0;
        $2 = $$awareness_recipient_step(_principal_0, _head_0, _bag_0);
        continue;
      }
    }
  }
}

function $awareness_recipient_mode(_principal_0, _owner_0) {
  return $String_eq(_principal_0, _owner_0);
}

function $awareness_recipient_result(_result_0) {
  if (_result_0.$ === "RecipientExhausted") {
    return {$: "RecipientFull"};
  } else {
    const _reversed_0 = _result_0["reversed"];
    return {$: "RecipientCandidates", "indices": $$List_reverse(_reversed_0)};
  }
}

function $awareness_recipients(_grants_0, _principal_0) {
  return $awareness_recipient_result($$awareness_recipient_fold(_grants_0, _principal_0, {$: "RecipientCollect", "count": 0, "reversed": {$: "Nil"}}));
}

function $awareness_selected(_include_acknowledged_0, _acknowledged_0) {
  const _x_0 = $$Bool_not(_acknowledged_0);
  return (_include_acknowledged_0 || _x_0);
}

function $awareness_message_compare(_left_0, _left_id_0, _right_0, _right_id_0) {
  return $Bool_pick($$accounting_equal(_left_0, _right_0), $$String_order(_left_id_0, _right_id_0), $$Bool_pick($$accounting_le(_left_0, _right_0), {$: "LT"}, {$: "GT"}));
}

function $awareness_template(_kind_0, _schema_0, _expected_0, _selected_0, _current_0) {
  return $Bool_and($$String_eq(_kind_0, "atom"), $$Bool_and($$String_eq(_schema_0, _expected_0), $$String_eq(_selected_0, _current_0)));
}

function $awareness_supported_fold($0, $1, $2, $3) {
  for (;;) {
    {
      const _items_0 = $0;
      const _accepted_0 = $1;
      const _record_0 = $2;
      const _issuers_0 = $3;
      if (_items_0.$ === "Nil") {
        if (_accepted_0) {
          return true;
        } else {
          return false;
        }
      } else {
        const _t_0 = _items_0["head"];
        const _target_0 = _t_0["record"];
        const _issuer_0 = _t_0["issuer"];
        const _status_0 = _t_0["status"];
        const _sources_0 = _t_0["sources"];
        const _tail_0 = _items_0["tail"];
        if (_accepted_0) {
          return true;
        } else {
          $0 = _tail_0;
          $1 = $$Bool_and($$Bool_and($$String_eq(_target_0, _record_0), $$String_eq(_status_0, "asserted")), $$Bool_and($$collections_contains(_issuers_0, _issuer_0), $$awareness_all(_sources_0)));
          $2 = _record_0;
          $3 = _issuers_0;
          continue;
        }
      }
    }
  }
}

function $awareness_supported(_items_0, _record_0, _issuers_0) {
  return $awareness_supported_fold(_items_0, false, _record_0, _issuers_0);
}

function $awareness_slots(_count_0, _expected_0, _declared_0, _optional_0, _markers_0, _malformed_0) {
  return $Bool_pick(_malformed_0, false, $$Bool_and((_count_0 === _expected_0), $$Bool_and($$collections_subset(_optional_0, _declared_0), $$Bool_and($$collections_subset(_markers_0, _declared_0), $$collections_subset(_declared_0, _markers_0)))));
}

function $awareness_prompt_candidates(_declared_0, _optional_0) {
  return $List_reverse($$collections_intersection(_declared_0, _optional_0));
}

function $awareness_prompt_large(_candidates_0) {
  if (_candidates_0.$ === "Nil") {
    return {$: "PromptRequired"};
  } else {
    const _slot_0 = _candidates_0["head"];
    const _tail_0 = _candidates_0["tail"];
    return {$: "PromptOmit", "slot": _slot_0, "remaining": _tail_0};
  }
}

function $awareness_prompt_step(_candidates_0, _used_0, _ceiling_0) {
  return $Bool_pick($$accounting_le(_used_0, _ceiling_0), {$: "PromptFits"}, $$awareness_prompt_large(_candidates_0));
}

function $awareness_ref_route(_local_0, _message_0, _readable_0, _incident_0, _execution_0, _schedule_0) {
  return $Bool_pick($$Bool_and(_local_0, _message_0), {$: "RefMailbox"}, $$Bool_pick(_readable_0, {$: "RefAllowed"}, $$Bool_pick(_local_0, $$Bool_pick(_incident_0, {$: "RefIncident"}, $$Bool_pick(_execution_0, {$: "RefExecution"}, $$Bool_pick(_schedule_0, {$: "RefSchedule"}, {$: "RefDenied"}))), {$: "RefDenied"})));
}

function $awareness_scan_request(_items_0, _ceiling_0, _scanned_0) {
  return $Bool_pick((_scanned_0 >= 4096), 0, $$Bool_pick((_items_0 >= _ceiling_0), 0, $$U32_min(256, ((4096 - _scanned_0) >>> 0))));
}

function $awareness_visibility_start(_operator_0, _root_0) {
  return $Bool_pick(_operator_0, {$: "VisibilityAllowed"}, {$: "VisibilityWalking", "walk": {$: "VisibilityWalk", "todo": {$: "Con", "head": _root_0, "tail": {$: "Nil"}}, "seen": {$: "Nil"}, "fuel": 64}});
}

function $awareness_walk_demand(_todo_0, _seen_0, _fuel_0) {
  if (_todo_0.$ === "Nil") {
    return {$: "VisibilityComplete", "visible": true};
  } else {
    const _head_0 = _todo_0["head"];
    const _tail_0 = _todo_0["tail"];
    return $Bool_pick((_fuel_0 === 0), {$: "VisibilityComplete", "visible": false}, $$Bool_pick($$collections_contains(_seen_0, _head_0), {$: "VisibilityContinue", "state": {$: "VisibilityWalking", "walk": {$: "VisibilityWalk", "todo": _tail_0, "seen": _seen_0, "fuel": ((_fuel_0 - 1) >>> 0)}}}, {$: "VisibilityNeedEvent", "id": _head_0}));
  }
}

function $awareness_check_demand(_refs_0, _alternatives_0, _next_0) {
  if (_refs_0.$ === "Nil") {
    return {$: "VisibilityContinue", "state": {$: "VisibilityWalking", "walk": _next_0}};
  } else {
    const _key_0 = _refs_0["head"];
    return {$: "VisibilityNeedRef", "key": _key_0};
  }
}

function $awareness_visibility_demand(_state_0) {
  if (_state_0.$ === "VisibilityAllowed") {
    return {$: "VisibilityComplete", "visible": true};
  } else if (_state_0.$ === "VisibilityDenied") {
    return {$: "VisibilityComplete", "visible": false};
  } else if (_state_0.$ === "VisibilityWalking") {
    const _t_0 = _state_0["walk"];
    const _todo_0 = _t_0["todo"];
    const _seen_0 = _t_0["seen"];
    const _fuel_0 = _t_0["fuel"];
    return $awareness_walk_demand(_todo_0, _seen_0, _fuel_0);
  } else {
    const _refs_0 = _state_0["refs"];
    const _alternatives_0 = _state_0["alternatives"];
    const _next_0 = _state_0["next"];
    return $awareness_check_demand(_refs_0, _alternatives_0, _next_0);
  }
}

function $awareness_groups($0, $1) {
  for (;;) {
    {
      const _items_0 = $0;
      const _next_0 = $1;
      if (_items_0.$ === "Nil") {
        return {$: "VisibilityDenied"};
      } else {
        const _t_0 = _items_0["head"];
        const _t_1 = _t_0["refs"];
        if (_t_1.$ === "Nil") {
          const _tail_0 = _items_0["tail"];
          $0 = _tail_0;
          $1 = _next_0;
          continue;
        } else {
          const _head_0 = _t_1["head"];
          const _rest_0 = _t_1["tail"];
          const _tail_1 = _items_0["tail"];
          return {$: "VisibilityChecking", "refs": {$: "Con", "head": _head_0, "tail": _rest_0}, "alternatives": _tail_1, "next": _next_0};
        }
      }
    }
  }
}

function $awareness_observed_event(_event_0, _expected_0, _tail_0, _seen_0, _fuel_0, _context_0) {
  if (_event_0.$ === "VisibilityMissingEvent") {
    return {$: "VisibilityDenied"};
  } else {
    const _id_0 = _event_0["id"];
    const _owner_0 = _event_0["context"];
    const _alternatives_0 = _event_0["groups"];
    const _causes_0 = _event_0["causes"];
    return $Bool_pick($$Bool_and($$String_eq(_id_0, _expected_0), $$String_eq(_owner_0, _context_0)), $$awareness_groups(_alternatives_0, {$: "VisibilityWalk", "todo": $$List_append($$collections_unseen_fold(_causes_0, {$: "Con", "head": _id_0, "tail": _seen_0}, {$: "Nil"}), _tail_0), "seen": {$: "Con", "head": _id_0, "tail": _seen_0}, "fuel": ((_fuel_0 - 1) >>> 0)}), {$: "VisibilityDenied"});
  }
}

function $awareness_walk_event(_todo_0, _seen_0, _fuel_0, _event_0, _context_0) {
  if (_todo_0.$ === "Nil") {
    return {$: "VisibilityDenied"};
  } else {
    const _head_0 = _todo_0["head"];
    const _tail_0 = _todo_0["tail"];
    return $Bool_pick((_fuel_0 === 0), {$: "VisibilityDenied"}, $$awareness_observed_event(_event_0, _head_0, _tail_0, _seen_0, _fuel_0, _context_0));
  }
}

function $awareness_visibility_event(_state_0, _event_0, _context_0) {
  if (_state_0.$ === "VisibilityWalking") {
    const _t_0 = _state_0["walk"];
    const _todo_0 = _t_0["todo"];
    const _seen_0 = _t_0["seen"];
    const _fuel_0 = _t_0["fuel"];
    return $awareness_walk_event(_todo_0, _seen_0, _fuel_0, _event_0, _context_0);
  } else {
    return {$: "VisibilityDenied"};
  }
}

function $awareness_checked_ref(_refs_0, _alternatives_0, _next_0, _visible_0) {
  if (_refs_0.$ === "Nil") {
    return {$: "VisibilityDenied"};
  } else {
    const _tail_0 = _refs_0["tail"];
    if (_visible_0) {
      return {$: "VisibilityChecking", "refs": _tail_0, "alternatives": _alternatives_0, "next": _next_0};
    } else {
      return $awareness_groups(_alternatives_0, _next_0);
    }
  }
}

function $awareness_visibility_ref(_state_0, _visible_0) {
  if (_state_0.$ === "VisibilityChecking") {
    const _refs_0 = _state_0["refs"];
    const _alternatives_0 = _state_0["alternatives"];
    const _next_0 = _state_0["next"];
    return $awareness_checked_ref(_refs_0, _alternatives_0, _next_0, _visible_0);
  } else {
    return {$: "VisibilityDenied"};
  }
}

function $guidance_components_fold($0, $1, $2) {
  for (;;) {
    {
      const _root_0 = $0;
      const _path_0 = $1;
      const _accepted_0 = $2;
      if (_root_0.$ === "Nil") {
        return _accepted_0;
      } else {
        const _head_0 = _root_0["head"];
        const _tail_0 = _root_0["tail"];
        if (_path_0.$ === "Nil") {
          return false;
        } else {
          const _other_0 = _path_0["head"];
          const _rest_0 = _path_0["tail"];
          $0 = _tail_0;
          $1 = _rest_0;
          $2 = $$Bool_and(_accepted_0, $$String_eq(_head_0, _other_0));
          continue;
        }
      }
    }
  }
}

function $guidance_components(_root_0, _path_0) {
  return $guidance_components_fold(_root_0, _path_0, true);
}

function $guidance_path(_root_host_0, _root_0, _path_host_0, _selected_0) {
  return $Bool_and($$String_eq(_root_host_0, _path_host_0), $$guidance_components(_root_0, _selected_0));
}

function $guidance_registration(_normalized_0, _present_0, _count_0, _same_0) {
  return $Bool_pick(_normalized_0, $$Bool_pick(_present_0, $$Bool_pick(_same_0, {$: "GuidanceSameSource"}, {$: "GuidanceChangedSource"}), $$Bool_pick((_count_0 >= 256), {$: "GuidanceRegistryFull"}, {$: "GuidanceNewSource"})), {$: "GuidanceInvalidPaths"});
}

function $guidance_refresh(_active_0, _storage_0) {
  return $Bool_pick(_active_0, $$Bool_pick(_storage_0, {$: "GuidanceObserve"}, {$: "GuidanceNoStorage"}), {$: "GuidanceWithdrawn"});
}

function $guidance_retained(_count_0, _maximum_count_0, _total_0, _extra_0, _maximum_bytes_0) {
  return $Bool_and($$Bool_not($$accounting_le(_maximum_count_0, _count_0)), $$accounting_fits($$accounting_add(_total_0, _extra_0), _maximum_bytes_0));
}

function $guidance_observation_error(_code_0, _domain_0) {
  return $Bool_pick($$Bool_and(_domain_0, $$Bool_not($$collections_contains({$: "Con", "head": "FORBIDDEN", "tail": {$: "Con", "head": "LIMIT_EXCEEDED", "tail": {$: "Con", "head": "IDENTITY_CONFLICT", "tail": {$: "Con", "head": "INVALID_ARGUMENT", "tail": {$: "Nil"}}}}}, _code_0))), {$: "GuidanceRethrow"}, $$Bool_pick($$String_eq(_code_0, "ENOENT"), {$: "GuidanceMissing"}, $$Bool_pick($$collections_contains({$: "Con", "head": "EACCES", "tail": {$: "Con", "head": "EPERM", "tail": {$: "Con", "head": "FORBIDDEN", "tail": {$: "Nil"}}}}, _code_0), {$: "GuidanceDenied"}, $$Bool_pick($$String_eq(_code_0, "LIMIT_EXCEEDED"), {$: "GuidanceTooLarge"}, $$Bool_pick($$String_eq(_code_0, "IDENTITY_CONFLICT"), {$: "GuidanceChanged"}, {$: "GuidanceUnsupported"})))));
}

function $guidance_some_fold($0, $1) {
  for (;;) {
    {
      const _values_0 = $0;
      const _accepted_0 = $1;
      if (_values_0.$ === "Nil") {
        return _accepted_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        $0 = _tail_0;
        $1 = (_accepted_0 || _head_0);
        continue;
      }
    }
  }
}

function $guidance_selected(_explicit_0, _active_0, _located_0, _matches_0) {
  const _x_0 = $$Bool_not(_located_0);
  const _x_1 = $$guidance_some_fold(_matches_0, false);
  return $Bool_and((_explicit_0 || _active_0), (_x_0 || _x_1));
}

function $guidance_review_size(_count_0) {
  return $Bool_pick((_count_0 === 0), {$: "GuidanceNoSources"}, $$Bool_pick((32 < _count_0), {$: "GuidanceSourceBound"}, {$: "GuidanceSourcesReady"}));
}

function $guidance_review_source(_active_0, _observation_0) {
  return $Bool_and(_active_0, $$String_eq(_observation_0, "ready"));
}

function $guidance_evidence_fold($0, $1) {
  for (;;) {
    {
      const _values_0 = $0;
      const _total_0 = $1;
      if (_values_0.$ === "Nil") {
        return _total_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        $0 = _tail_0;
        $1 = $$accounting_accumulate(_total_0, _head_0);
        continue;
      }
    }
  }
}

function $guidance_review_bytes(_values_0) {
  return $accounting_fits($$guidance_evidence_fold(_values_0, {$: "BudgetFinite", "count": $$accounting_zero()}), {$: "BudgetCount", "high": 0, "low": 131072});
}

function $guidance_current(_present_0, _active_0, _definition_0, _captured_definition_0, _observation_0, _latest_0, _capture_0) {
  return $Bool_and(_present_0, $$Bool_and(_active_0, $$Bool_and($$String_eq(_definition_0, _captured_definition_0), $$Bool_and($$String_eq(_observation_0, "ready"), $$String_eq(_latest_0, _capture_0)))));
}

function $guidance_basis(_present_0, _actual_0, _expected_0) {
  return $Bool_pick(_present_0, $$Bool_pick($$String_eq(_actual_0, _expected_0), {$: "GuidanceBasisCurrent"}, {$: "GuidanceBasisChanged"}), {$: "GuidanceBasisUnavailable"});
}

function $guidance_policy(_current_ref_0, _expected_ref_0, _current_digest_0, _expected_digest_0) {
  return $Bool_and($$String_eq(_current_ref_0, _expected_ref_0), $$String_eq(_current_digest_0, _expected_digest_0));
}

function $guidance_profile(_actual_0, _expected_0) {
  const _a_0 = _actual_0["provider"];
  const _b_0 = _actual_0["name"];
  const _c_0 = _actual_0["version"];
  const _d_0 = _actual_0["input"];
  const _e_0 = _actual_0["output"];
  const _f_0 = _actual_0["isolation"];
  const _g_0 = _actual_0["reconciliation"];
  const _h_0 = _actual_0["features"];
  const _u_0 = _expected_0["provider"];
  const _v_0 = _expected_0["name"];
  const _w_0 = _expected_0["version"];
  const _x_0 = _expected_0["input"];
  const _y_0 = _expected_0["output"];
  const _z_0 = _expected_0["isolation"];
  const _r_0 = _expected_0["reconciliation"];
  const _s_0 = _expected_0["features"];
  return $Bool_and($$String_eq(_a_0, _u_0), $$Bool_and($$String_eq(_b_0, _v_0), $$Bool_and($$String_eq(_c_0, _w_0), $$Bool_and($$String_eq(_d_0, _x_0), $$Bool_and($$String_eq(_e_0, _y_0), $$Bool_and($$String_eq(_f_0, _z_0), $$Bool_and($$String_eq(_g_0, _r_0), $$String_eq(_h_0, _s_0))))))));
}

function $guidance_profile_available(_compatible_0, _readable_0, _expired_0) {
  return $Bool_and(_compatible_0, $$Bool_and(_readable_0, $$Bool_not(_expired_0)));
}

function $guidance_grant(_principal_0, _candidate_principal_0, _actions_0, _resources_0, _capability_0, _operator_0, _candidate_0, _bound_0) {
  const _x_0 = $$String_eq(_candidate_0, _bound_0);
  return $Bool_and($$String_eq(_principal_0, _candidate_principal_0), $$Bool_and($$collections_contains(_actions_0, "local.moment.guidance"), $$Bool_and($$collections_contains(_actions_0, "guidance.review"), $$Bool_and($$collections_contains(_resources_0, _capability_0), (_operator_0 || _x_0)))));
}

function $guidance_candidate(_state_0, _blocked_0, _settlement_0) {
  if (_state_0.$ === "RunQueued") {
    return $Bool_not(_blocked_0);
  } else if (_state_0.$ === "RunUncertain") {
    return $Bool_not(_blocked_0);
  } else if (_state_0.$ === "RunSucceeded") {
    return $Bool_and($$Bool_not(_blocked_0), _settlement_0);
  } else if (_state_0.$ === "RunFailed") {
    return $Bool_and($$Bool_not(_blocked_0), _settlement_0);
  } else if (_state_0.$ === "RunCancelled") {
    return $Bool_and($$Bool_not(_blocked_0), _settlement_0);
  } else {
    return false;
  }
}

function $guidance_uncertain(_state_0) {
  if (_state_0.$ === "RunUncertain") {
    return true;
  } else {
    return false;
  }
}

function $guidance_candidate_compare(_left_0, _left_key_0, _right_0, _right_key_0) {
  const _a_0 = $$guidance_uncertain(_left_0);
  const _b_0 = $$guidance_uncertain(_right_0);
  return $Bool_pick($$Bool_and(_a_0, $$Bool_not(_b_0)), {$: "LT"}, $$Bool_pick($$Bool_and(_b_0, $$Bool_not(_a_0)), {$: "GT"}, $$String_order(_left_key_0, _right_key_0)));
}

function $guidance_result(_kind_0, _failure_0, _raw_0) {
  const _x_0 = $$String_eq(_kind_0, "failed");
  return $Bool_pick($$String_eq(_kind_0, "not_started"), {$: "GuidanceNotStarted"}, $$Bool_pick($$String_eq(_kind_0, "cancelled"), {$: "GuidanceCancelled"}, $$Bool_pick((_x_0 || _failure_0), {$: "GuidanceFailed"}, $$Bool_pick(_raw_0, {$: "GuidanceProject"}, {$: "GuidanceUnknownOutput"}))));
}

function $guidance_quote(_matches_0, _editorial_0) {
  return $Bool_pick((_matches_0 === 0), {$: "GuidanceQuoteUnanchored"}, $$Bool_pick((_matches_0 === 1), $$Bool_pick(_editorial_0, {$: "GuidanceQuoteEditorial"}, {$: "GuidanceQuoteExact"}), {$: "GuidanceQuoteAmbiguous"}));
}

function $guidance_editorial(_present_0, _matches_0, _ascii_initial_0) {
  return $Bool_and(_present_0, $$Bool_and((_matches_0 === 0), _ascii_initial_0));
}

function $guidance_capture_room(_count_0) {
  return (_count_0 < 2048);
}

function $guidance_settlement(_state_0, _blocked_0) {
  return $Bool_and($$Bool_not(_blocked_0), $$execution_terminal(_state_0));
}

function $execution_step_1(_state_0, _action_0) {
  return $execution_step(_state_0, _action_0);
}

function $execution_terminal_1(_state_0) {
  return $execution_terminal(_state_0);
}

function $topology_check_1(_exclusive_0, _size_0, _edges_0, _degree_0, _next_0, _parent_0, _rank_0) {
  return $topology_check(_exclusive_0, _size_0, _edges_0, _degree_0, _next_0, _parent_0, _rank_0);
}

function $topology_certify_1(_edges_0, _rank_0) {
  return $topology_certify(_edges_0, _rank_0, true);
}

function $resource_add(_left_0, _right_0) {
  return $accounting_add(_left_0, _right_0);
}

function $resource_subtract(_left_0, _right_0) {
  return $accounting_subtract(_left_0, _right_0);
}

function $resource_le(_left_0, _right_0) {
  return $accounting_le(_left_0, _right_0);
}

function $resource_totals(_entries_0) {
  return $accounting_total(_entries_0);
}

function $resource_capacity(_balance_0, _requested_0, _ceiling_0) {
  return $accounting_capacity(_balance_0, _requested_0, _ceiling_0);
}

function $resource_usage(_previous_0, _usage_0, _ceiling_0, _observed_0) {
  return $accounting_usage_allowed(_previous_0, _usage_0, _ceiling_0, _observed_0);
}

function $resource_envelope(_requests_0, _ceiling_0) {
  return $accounting_envelope(_requests_0, _ceiling_0);
}

function $resource_available(_envelopes_0) {
  return $accounting_available(_envelopes_0);
}

function $truth_not(_value_0) {
  if (_value_0.$ === "Yes") {
    return {$: "No"};
  } else if (_value_0.$ === "No") {
    return {$: "Yes"};
  } else {
    return {$: "Unknown"};
  }
}

function $truth_and(_left_0, _right_0) {
  if (_left_0.$ === "No") {
    return {$: "No"};
  } else if (_left_0.$ === "Yes") {
    return _right_0;
  } else {
    if (_right_0.$ === "No") {
      return {$: "No"};
    } else if (_right_0.$ === "Yes") {
      return {$: "Unknown"};
    } else {
      return {$: "Unknown"};
    }
  }
}

function $truth_or(_left_0, _right_0) {
  if (_left_0.$ === "Yes") {
    return {$: "Yes"};
  } else if (_left_0.$ === "No") {
    return _right_0;
  } else {
    if (_right_0.$ === "Yes") {
      return {$: "Yes"};
    } else if (_right_0.$ === "No") {
      return {$: "Unknown"};
    } else {
      return {$: "Unknown"};
    }
  }
}

function $truth_all(_values_0) {
  if (_values_0.$ === "Nil") {
    return {$: "Yes"};
  } else {
    const _head_0 = _values_0["head"];
    const _tail_0 = _values_0["tail"];
    return $truth_and(_head_0, $$truth_all(_tail_0));
  }
}

function $truth_any(_values_0) {
  if (_values_0.$ === "Nil") {
    return {$: "No"};
  } else {
    const _head_0 = _values_0["head"];
    const _tail_0 = _values_0["tail"];
    return $truth_or(_head_0, $$truth_any(_tail_0));
  }
}

function $policy_combine(_denies_0, _permits_0) {
  if (_denies_0.$ === "Yes") {
    return {$: "Deny"};
  } else if (_denies_0.$ === "Unknown") {
    return {$: "Indeterminate"};
  } else {
    if (_permits_0.$ === "Yes") {
      return {$: "Permit"};
    } else if (_permits_0.$ === "No") {
      return {$: "Deny"};
    } else {
      return {$: "Indeterminate"};
    }
  }
}

function $policy(_denies_0, _permits_0) {
  return $policy_combine($$truth_any(_denies_0), $$truth_any(_permits_0));
}

function $same_text(_left_0, _right_0) {
  return $String_eq(_left_0, _right_0);
}

function $same_scope(_asys_0, _actx_0, _bsys_0, _bctx_0) {
  return $Bool_and($$String_eq(_asys_0, _bsys_0), $$String_eq(_actx_0, _bctx_0));
}

function $same_ref(_asys_0, _actx_0, _aid_0, _bsys_0, _bctx_0, _bid_0) {
  return $Bool_and($$same_scope(_asys_0, _actx_0, _bsys_0, _bctx_0), $$String_eq(_aid_0, _bid_0));
}

function $text_contains(_values_0, _needle_0) {
  return $collections_contains(_values_0, _needle_0);
}

function $text_subset(_child_0, _parent_0) {
  return $collections_subset(_child_0, _parent_0);
}

function $incident_scope(_parent_all_0, _child_all_0, _child_0, _parent_0) {
  if (_parent_all_0) {
    return true;
  } else {
    if (_child_all_0) {
      return false;
    } else {
      return $text_subset(_child_0, _parent_0);
    }
  }
}

function $ordered_le(_left_high_0, _left_low_0, _right_high_0, _right_low_0) {
  const _x_0 = (_left_high_0 < _right_high_0);
  const _x_1 = $$Bool_and((_left_high_0 === _right_high_0), (_left_low_0 <= _right_low_0));
  return (_x_0 || _x_1);
}

function $rank_le(_left_0, _right_0) {
  const _ah_0 = _left_0["high"];
  const _al_0 = _left_0["low"];
  const _bh_0 = _right_0["high"];
  const _bl_0 = _right_0["low"];
  return $ordered_le(_ah_0, _al_0, _bh_0, _bl_0);
}

function $deadline(_parent_present_0, _child_present_0, _child_0, _parent_0) {
  if (!_parent_present_0) {
    return true;
  } else {
    return $Bool_and(_child_present_0, $$rank_le(_child_0, _parent_0));
  }
}

function $within(_visited_0, _depth_0, _nodes_0, _maximum_depth_0) {
  return $Bool_and($$Nat_is_le(_visited_0, _nodes_0), $$Nat_is_le(_depth_0, _maximum_depth_0));
}

function $fits(_child_0, _parent_0) {
  if (_child_0.$ === "Nil") {
    if (_parent_0.$ === "Nil") {
      return true;
    } else {
      return false;
    }
  } else {
    const _head_1 = _child_0["head"];
    const _tail_1 = _child_0["tail"];
    if (_parent_0.$ === "Nil") {
      return false;
    } else {
      const _limit_0 = _parent_0["head"];
      const _rest_0 = _parent_0["tail"];
      return $Bool_and($$rank_le(_head_1, _limit_0), $$fits(_tail_1, _rest_0));
    }
  }
}

function $record_edit(_exists_0, _same_digest_0) {
  if (!_exists_0) {
    return {$: "Insert"};
  } else {
    if (_same_digest_0) {
      return {$: "Keep"};
    } else {
      return {$: "Conflict"};
    }
  }
}

function $assertion_edit(_local_record_0, _same_digest_0, _support_0) {
  if (!_local_record_0) {
    return {$: "Missing"};
  } else {
    if (_support_0.$ === "Absent") {
      return {$: "Insert"};
    } else if (_support_0.$ === "Withdrawn") {
      return {$: "Conflict"};
    } else {
      return $record_edit(true, _same_digest_0);
    }
  }
}

function $assertion_withdraw(_support_0) {
  if (_support_0.$ === "Absent") {
    return {$: "Missing"};
  } else if (_support_0.$ === "Asserted") {
    return {$: "Withdraw"};
  } else {
    return {$: "Keep"};
  }
}

function $graph_phase(_changes_0, _records_0) {
  if (_changes_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _changes_0["head"];
    const _index_0 = _t_0["index"];
    const _record_0 = _t_0["record"];
    const _tail_0 = _changes_0["tail"];
    const _rest_0 = $$graph_phase(_tail_0, _records_0);
    return $List_filter_put(_index_0, _rest_0, $$Bool_not((_record_0 !== _records_0)));
  }
}

function $graph_order(_changes_0) {
  return $List_append($$graph_phase(_changes_0, true), $$graph_phase(_changes_0, false));
}

function $grant_available(_present_0, _revoked_0, _expiry_present_0, _expiry_0, _now_0) {
  return $Bool_and(_present_0, $$Bool_and($$Bool_not(_revoked_0), $$Bool_not($$Bool_and(_expiry_present_0, $$rank_le(_expiry_0, _now_0)))));
}

function $grant_link(_system_0, _context_0, _ref_system_0, _ref_context_0, _ref_id_0, _seen_0, _present_0, _revoked_0, _expiry_present_0, _expiry_0, _now_0, _bound_principal_0, _grant_principal_0) {
  const _valid_scope_0 = $$same_scope(_system_0, _context_0, _ref_system_0, _ref_context_0);
  const _repeated_0 = $$text_contains(_seen_0, _ref_id_0);
  const _x_0 = $$List_length(_seen_0);
  const _depth_ok_0 = (_x_0 < 32);
  const _x_1 = $$Bool_not($$List_is_empty(_seen_0));
  const _x_2 = $$String_eq(_bound_principal_0, _grant_principal_0);
  return $Bool_pick($$Bool_and(_valid_scope_0, $$Bool_and($$Bool_not(_repeated_0), _depth_ok_0)), $$Bool_pick($$grant_available(_present_0, _revoked_0, _expiry_present_0, _expiry_0, _now_0), $$Bool_pick((_x_1 || _x_2), {$: "GrantLink"}, {$: "WrongPrincipal"}), {$: "UnavailableGrant"}), {$: "InvalidChain"});
}

function $grant_end(_seen_0) {
  if (_seen_0.$ === "Nil") {
    return {$: "EmptyChain"};
  } else {
    return {$: "GrantLink"};
  }
}

function $limits_bound(_child_currency_0, _parent_currency_0, _child_0, _parent_0, _parent_deadline_0, _child_deadline_0, _child_at_0, _parent_at_0) {
  return $Bool_pick($$String_eq(_child_currency_0, _parent_currency_0), $$Bool_pick($$fits(_child_0, _parent_0), $$Bool_pick($$deadline(_parent_deadline_0, _child_deadline_0, _child_at_0, _parent_at_0), {$: "Bounded"}, {$: "DeadlineExceeded"}), {$: "BudgetExceeded"}), {$: "CurrencyMismatch"});
}

function $delegation_bound(_child_actions_0, _parent_actions_0, _parent_all_0, _child_all_0, _child_incidents_0, _parent_incidents_0, _child_resources_0, _parent_resources_0, _parent_expiry_0, _child_expiry_0, _child_at_0, _parent_at_0, _delegable_0) {
  return $Bool_pick($$text_subset(_child_actions_0, _parent_actions_0), $$Bool_pick($$incident_scope(_parent_all_0, _child_all_0, _child_incidents_0, _parent_incidents_0), $$Bool_pick($$text_subset(_child_resources_0, _parent_resources_0), $$Bool_pick($$deadline(_parent_expiry_0, _child_expiry_0, _child_at_0, _parent_at_0), $$Bool_pick(_delegable_0, {$: "Bounded"}, {$: "NotDelegable"}), {$: "LifetimeWidened"}), {$: "ResourcesWidened"}), {$: "IncidentsWidened"}), {$: "ActionsWidened"});
}

function $rule_contains(_rules_0, _identity_0) {
  if (_rules_0.$ === "Nil") {
    return false;
  } else {
    const _t_0 = _rules_0["head"];
    const _key_0 = _t_0["identity"];
    const _tail_0 = _rules_0["tail"];
    const _x_0 = $$String_eq(_key_0, _identity_0);
    const _x_1 = $$rule_contains(_tail_0, _identity_0);
    return (_x_0 || _x_1);
  }
}

function $denies_preserved(_current_0, _candidate_0) {
  if (_current_0.$ === "Nil") {
    return true;
  } else {
    const _t_0 = _current_0["head"];
    const _permit_0 = _t_0["permit"];
    const _identity_0 = _t_0["identity"];
    const _tail_0 = _current_0["tail"];
    const _x_0 = $$rule_contains(_candidate_0, _identity_0);
    return $Bool_and((_permit_0 || _x_0), $$denies_preserved(_tail_0, _candidate_0));
  }
}

function $permit_narrowed(_current_0, _condition_0, _actions_0) {
  if (_current_0.$ === "Nil") {
    return false;
  } else {
    const _t_0 = _current_0["head"];
    const _permit_0 = _t_0["permit"];
    const _when_0 = _t_0["condition"];
    const _old_actions_0 = _t_0["actions"];
    const _tail_0 = _current_0["tail"];
    const _x_0 = $$Bool_and(_permit_0, $$Bool_and($$String_eq(_when_0, _condition_0), $$text_subset(_actions_0, _old_actions_0)));
    const _x_1 = $$permit_narrowed(_tail_0, _condition_0, _actions_0);
    return (_x_0 || _x_1);
  }
}

function $policy_issuers(_child_0, _parent_0) {
  return $Bool_pick($$Bool_and($$text_subset(_child_0, _parent_0), $$text_subset(_parent_0, _child_0)), {$: "PolicyBounded"}, {$: "IssuersChanged"});
}

function $permits_bounded(_candidate_0, _current_0, _grant_0) {
  if (_candidate_0.$ === "Nil") {
    return {$: "PolicyBounded"};
  } else {
    const _t_0 = _candidate_0["head"];
    const _permit_0 = _t_0["permit"];
    const _condition_0 = _t_0["condition"];
    const _actions_0 = _t_0["actions"];
    const _tail_0 = _candidate_0["tail"];
    const _bounded_actions_0 = _actions_0;
    const _next_0 = $$permits_bounded(_tail_0, _current_0, _grant_0);
    return $Bool_pick(_permit_0, $$Bool_pick($$text_subset(_bounded_actions_0, _grant_0), $$Bool_pick($$permit_narrowed(_current_0, _condition_0, _bounded_actions_0), _next_0, {$: "PermitWidened"}), {$: "GrantExceeded"}), _next_0);
  }
}

function $policy_rules(_candidate_0, _current_0, _grant_0) {
  return $Bool_pick($$denies_preserved(_current_0, _candidate_0), $$permits_bounded(_candidate_0, _current_0, _grant_0), {$: "DenyRemoved"});
}

function $topology_record(_kind_0, _schema_0, _supports_0, _context_0, _perspective_0, _framed_0, _frame_0, _child_0, _parent_0, _earlier_0, _later_0) {
  return $topology_project($$Bool_and($$String_eq(_kind_0, "relation"), $$text_contains(_supports_0, "asserted")), $$String_eq(_schema_0, "moment.within"), $$String_eq(_schema_0, "moment.precedes"), _context_0, _perspective_0, _framed_0, _frame_0, _child_0, _parent_0, _earlier_0, _later_0);
}

function $topology_combine_1(_results_0) {
  return $topology_combine(_results_0);
}

function $scope_allows(_mode_0, _scope_0, _key_0) {
  if (_mode_0.$ === "AccessAction") {
    const _actions_0 = _scope_0["actions"];
    return $text_contains(_actions_0, _key_0);
  } else if (_mode_0.$ === "AccessResource") {
    const _resources_1 = _scope_0["resources"];
    return $text_contains(_resources_1, _key_0);
  } else if (_mode_0.$ === "AccessIncident") {
    const _all_incidents_2 = _scope_0["all_incidents"];
    const _incidents_2 = _scope_0["incidents"];
    const _x_0 = $$text_contains(_incidents_2, _key_0);
    return (_all_incidents_2 || _x_0);
  } else {
    const _all_incidents_3 = _scope_0["all_incidents"];
    const _resources_3 = _scope_0["resources"];
    return $Bool_and(_all_incidents_3, $$text_contains(_resources_3, _key_0));
  }
}

function $scopes_fold($0, $1, $2, $3) {
  for (;;) {
    {
      const _scopes_0 = $0;
      const _mode_0 = $1;
      const _key_0 = $2;
      const _accepted_0 = $3;
      if (_scopes_0.$ === "Nil") {
        return _accepted_0;
      } else {
        const _head_0 = _scopes_0["head"];
        const _tail_0 = _scopes_0["tail"];
        $0 = _tail_0;
        $1 = _mode_0;
        $2 = _key_0;
        $3 = $$Bool_and(_accepted_0, $$scope_allows(_mode_0, _head_0, _key_0));
        continue;
      }
    }
  }
}

function $scopes_allow(_scopes_0, _mode_0, _key_0) {
  if (_scopes_0.$ === "Nil") {
    return false;
  } else {
    const _head_0 = _scopes_0["head"];
    const _tail_0 = _scopes_0["tail"];
    return $scopes_fold(_tail_0, _mode_0, _key_0, $$scope_allows(_mode_0, _head_0, _key_0));
  }
}

function $access_operator(_principal_0, _owner_0, _context_owner_0, _bound_0) {
  return $Bool_and($$String_eq(_principal_0, _owner_0), $$Bool_and($$String_eq(_principal_0, _context_owner_0), $$Bool_not(_bound_0)));
}

function $access_resource(_operator_0, _scopes_0, _key_0) {
  const _x_0 = $$scopes_allow(_scopes_0, {$: "AccessResource"}, _key_0);
  return (_operator_0 || _x_0);
}

function $access_incident(_operator_0, _scopes_0, _key_0) {
  const _x_0 = $$scopes_allow(_scopes_0, {$: "AccessIncident"}, _key_0);
  return (_operator_0 || _x_0);
}

function $method_context(_method_0, _scopes_0, _context_0) {
  const _x_0 = $$String_eq(_method_0, "context.close");
  const _x_1 = $$String_eq(_method_0, "policy.activate");
  const _wide_0 = (_x_0 || _x_1);
  return $Bool_pick($$Bool_and(_wide_0, $$Bool_not($$scopes_allow(_scopes_0, {$: "AccessContext"}, _context_0))), {$: "MethodContextWide"}, {$: "MethodAllowed"});
}

function $method_delegate(_method_0, _scopes_0, _context_0) {
  return $Bool_pick($$String_eq(_method_0, "schema.publish"), {$: "MethodSchemaOperator"}, $$Bool_pick($$String_eq(_method_0, "context.limits"), {$: "MethodLimitsOperator"}, $$method_context(_method_0, _scopes_0, _context_0)));
}

function $access_method(_operator_0, _scopes_0, _method_0, _context_0) {
  return $Bool_pick(_operator_0, {$: "MethodAllowed"}, $$Bool_pick($$scopes_allow(_scopes_0, {$: "AccessAction"}, _method_0), $$method_delegate(_method_0, _scopes_0, _context_0), {$: "MethodOutsideGrant"}));
}

function $mutation_basis(_current_0, _expected_0, _state_0, _method_0) {
  const _x_0 = $$String_eq(_state_0, "open");
  const _x_1 = $$text_contains({$: "Con", "head": "context.close", "tail": {$: "Con", "head": "execution.finish", "tail": {$: "Con", "head": "execution.reconcile", "tail": {$: "Con", "head": "execution.cancel", "tail": {$: "Nil"}}}}}, _method_0);
  return $Bool_pick($$String_eq(_current_0, _expected_0), $$Bool_pick((_x_0 || _x_1), {$: "MutationAllowed"}, {$: "MutationClosed"}), {$: "MutationStale"});
}

function $incident_terminal(_state_0) {
  if (_state_0.$ === "IncidentCompleted") {
    return true;
  } else if (_state_0.$ === "IncidentCancelled") {
    return true;
  } else {
    return false;
  }
}

function $incident_revisable(_old_0, _current_0) {
  const _x_0 = $$Bool_not($$incident_terminal(_old_0));
  const _x_1 = $$incident_terminal(_current_0);
  return (_x_0 || _x_1);
}

function $incident_sources(_sources_0) {
  if (_sources_0.$ === "Nil") {
    return {$: "IncidentCompletionMissing"};
  } else {
    return {$: "IncidentEvidenceAllowed"};
  }
}

function $incident_evidence(_state_0, _present_0, _sources_0) {
  if (_state_0.$ === "IncidentOpen") {
    return {$: "IncidentEvidenceAllowed"};
  } else if (_state_0.$ === "IncidentCompleted") {
    return $Bool_pick(_present_0, $$incident_sources(_sources_0), {$: "IncidentEvidenceMissing"});
  } else {
    return $Bool_pick(_present_0, {$: "IncidentEvidenceAllowed"}, {$: "IncidentEvidenceMissing"});
  }
}

function $query_match(_id_0, _schema_0, _support_0, _ids_present_0, _ids_0, _schemas_present_0, _schemas_0, _status_0, _related_present_0, _related_0) {
  const _x_0 = $$Bool_not(_ids_present_0);
  const _x_1 = $$text_contains(_ids_0, _id_0);
  const _x_2 = $$Bool_not(_schemas_present_0);
  const _x_3 = $$text_contains(_schemas_0, _schema_0);
  const _x_4 = $$String_eq(_status_0, "any");
  const _x_5 = $$text_contains(_support_0, _status_0);
  const _x_6 = $$Bool_not(_related_present_0);
  const _x_7 = $$text_contains(_related_0, _id_0);
  return $Bool_and((_x_0 || _x_1), $$Bool_and((_x_2 || _x_3), $$Bool_and((_x_4 || _x_5), (_x_6 || _x_7))));
}

function $role_connects($0, $1, $2, $3, $4) {
  for (;;) {
    {
      const _roles_0 = $0;
      const _role_present_0 = $1;
      const _role_0 = $2;
      const _target_0 = $3;
      const _hit_0 = $4;
      if (_roles_0.$ === "Nil") {
        return _hit_0;
      } else {
        const _t_0 = _roles_0["head"];
        const _name_0 = _t_0["name"];
        const _members_0 = _t_0["members"];
        const _tail_0 = _roles_0["tail"];
        const _x_0 = $$Bool_not(_role_present_0);
        const _x_1 = $$String_eq(_name_0, _role_0);
        const _x_2 = $$Bool_and((_x_0 || _x_1), $$text_contains(_members_0, _target_0));
        $0 = _tail_0;
        $1 = _role_present_0;
        $2 = _role_0;
        $3 = _target_0;
        $4 = (_hit_0 || _x_2);
        continue;
      }
    }
  }
}

function $query_related(_kind_0, _roles_0, _role_present_0, _role_0, _target_0) {
  return $Bool_and($$String_eq(_kind_0, "relation"), $$role_connects(_roles_0, _role_present_0, _role_0, _target_0, false));
}

function $fence_equal(_left_0, _right_0) {
  return $accounting_equal(_left_0, _right_0);
}

function $fence_next(_current_0) {
  return $accounting_add(_current_0, $$accounting_one());
}

function $count_minimum($0, $1) {
  for (;;) {
    {
      const _values_0 = $0;
      const _minimum_0 = $1;
      if (_values_0.$ === "Nil") {
        return _minimum_0;
      } else {
        const _head_0 = _values_0["head"];
        const _tail_0 = _values_0["tail"];
        const _value_0 = _head_0;
        $0 = _tail_0;
        $1 = $$Bool_pick($$accounting_le(_value_0, _minimum_0), _value_0, _minimum_0);
        continue;
      }
    }
  }
}

function $lease_duration(_value_0, _deadline_0) {
  if (_value_0.$ === "BudgetOverflow") {
    return {$: "ClockUnrepresentable"};
  } else {
    const _count_0 = _value_0["count"];
    return {$: "ClockWindow", "deadline": _deadline_0, "duration": _count_0};
  }
}

function $lease_positive(_expired_0, _now_0, _deadline_0) {
  return $Bool_pick(_expired_0, {$: "ClockExpired"}, $$lease_duration($$accounting_subtract(_deadline_0, _now_0), _deadline_0));
}

function $lease_requested(_value_0, _now_0, _bounds_0) {
  if (_value_0.$ === "BudgetOverflow") {
    return {$: "ClockUnrepresentable"};
  } else {
    const _count_0 = _value_0["count"];
    const _deadline_0 = $$count_minimum(_bounds_0, _count_0);
    return $lease_positive($$accounting_le(_deadline_0, _now_0), _now_0, _deadline_0);
  }
}

function $lease_window(_now_0, _millis_0, _bounds_0) {
  return $lease_requested($$accounting_add(_now_0, _millis_0), _now_0, _bounds_0);
}

function $calendar_bound(_sum_0, _maximum_0) {
  return $Bool_pick($$accounting_fits(_sum_0, _maximum_0), _sum_0, {$: "BudgetOverflow"});
}

function $calendar_after(_anchor_0, _duration_0, _maximum_0) {
  return $calendar_bound($$accounting_add(_anchor_0, _duration_0), _maximum_0);
}

function $lease_frame(_meta_present_0, _source_boot_0, _current_boot_0) {
  return $Bool_and(_meta_present_0, $$String_eq(_source_boot_0, _current_boot_0));
}

function $lease_expired(_present_0, _meta_present_0, _source_boot_0, _current_boot_0, _wall_0, _wall_deadline_0, _monotonic_0, _monotonic_deadline_0) {
  const _x_0 = $$rank_le(_wall_deadline_0, _wall_0);
  const _x_1 = $$rank_le(_monotonic_deadline_0, _monotonic_0);
  const _x_2 = $$Bool_not($$lease_frame(_meta_present_0, _source_boot_0, _current_boot_0));
  const _x_3 = (_x_0 || _x_1);
  return $Bool_and(_present_0, (_x_2 || _x_3));
}

function $lease_valid(_present_0, _holder_0, _principal_0, _lease_id_0, _submitted_id_0, _fence_0, _submitted_fence_0, _expired_0) {
  return $Bool_and(_present_0, $$Bool_and($$String_eq(_holder_0, _principal_0), $$Bool_and($$String_eq(_lease_id_0, _submitted_id_0), $$Bool_and($$accounting_equal(_fence_0, _submitted_fence_0), $$Bool_not(_expired_0)))));
}

function $retry_admission(_cancelled_0, _basis_0, _provider_0) {
  return $Bool_pick(_cancelled_0, {$: "RetryCancelled"}, $$Bool_pick($$Bool_and($$String_eq(_basis_0, "idempotent"), $$Bool_not($$String_eq(_provider_0, "idempotent"))), {$: "RetryUnsupported"}, {$: "RetryAllowed"}));
}

function $expiry_fold($0, $1, $2) {
  for (;;) {
    {
      const _expiries_0 = $0;
      const _now_0 = $1;
      const _hit_0 = $2;
      if (_expiries_0.$ === "Nil") {
        return _hit_0;
      } else {
        const _head_0 = _expiries_0["head"];
        const _tail_0 = _expiries_0["tail"];
        const _x_0 = $$rank_le(_head_0, _now_0);
        $0 = _tail_0;
        $1 = _now_0;
        $2 = (_hit_0 || _x_0);
        continue;
      }
    }
  }
}

function $queued_maintenance(_state_0, _capability_expired_0, _grant_expired_0) {
  if (_state_0.$ === "RunQueued") {
    return $Bool_pick((_capability_expired_0 || _grant_expired_0), {$: "ClockCancelAuthority"}, {$: "ClockKeep"});
  } else {
    return {$: "ClockKeep"};
  }
}

function $execution_maintenance(_state_0, _expired_0, _deadline_present_0, _deadline_0, _now_0, _capability_expiry_0, _grant_expiries_0) {
  return $Bool_pick($$execution_terminal(_state_0), {$: "ClockKeep"}, $$Bool_pick(_expired_0, {$: "ClockLost"}, $$Bool_pick($$Bool_and(_deadline_present_0, $$rank_le(_deadline_0, _now_0)), {$: "ClockCancelDeadline"}, $$queued_maintenance(_state_0, $$rank_le(_capability_expiry_0, _now_0), $$expiry_fold(_grant_expiries_0, _now_0, false)))));
}

function $marker_present(_values_0) {
  if (_values_0.$ === "Nil") {
    return false;
  } else {
    return true;
  }
}

function $overrun_fold($0, $1) {
  for (;;) {
    {
      const _markers_0 = $0;
      const _hit_0 = $1;
      if (_markers_0.$ === "Nil") {
        return _hit_0;
      } else {
        const _head_0 = _markers_0["head"];
        const _tail_0 = _markers_0["tail"];
        const _x_0 = $$marker_present(_head_0);
        $0 = _tail_0;
        $1 = (_hit_0 || _x_0);
        continue;
      }
    }
  }
}

function $resource_blocked(_markers_0) {
  return $overrun_fold(_markers_0, false);
}

function $resource_single_slot(_value_0) {
  return $accounting_equal(_value_0, $$accounting_one());
}

function $execution_queued(_state_0) {
  if (_state_0.$ === "RunQueued") {
    return true;
  } else {
    return false;
  }
}

function $execution_waits_deadline(_state_0, _cancelled_0) {
  return $Bool_and($$Bool_not($$execution_terminal(_state_0)), $$Bool_not(_cancelled_0));
}

function $delay_finish(_candidate_0, _zero_0) {
  const _index_0 = _candidate_0["index"];
  const _value_0 = _candidate_0["value"];
  return $Bool_pick($$rank_le(_value_0, _zero_0), {$: "ClockImmediate"}, {$: "ClockSelected", "index": _index_0});
}

function $delay_fold($0, $1, $2) {
  for (;;) {
    {
      const _values_0 = $0;
      const _minimum_0 = $1;
      const _zero_0 = $2;
      if (_values_0.$ === "Nil") {
        return $delay_finish(_minimum_0, _zero_0);
      } else {
        const _t_0 = _values_0["head"];
        const _index_0 = _t_0["index"];
        const _value_0 = _t_0["value"];
        const _tail_0 = _values_0["tail"];
        const _old_index_0 = _minimum_0["index"];
        const _old_value_0 = _minimum_0["value"];
        $0 = _tail_0;
        $1 = $$Bool_pick($$rank_le(_value_0, _old_value_0), {$: "ClockCandidate", "index": _index_0, "value": _value_0}, {$: "ClockCandidate", "index": _old_index_0, "value": _old_value_0});
        $2 = _zero_0;
        continue;
      }
    }
  }
}

function $clock_delay(_values_0, _zero_0) {
  if (_values_0.$ === "Nil") {
    return {$: "ClockIdle"};
  } else {
    const _head_0 = _values_0["head"];
    const _tail_0 = _values_0["tail"];
    return $delay_fold(_tail_0, _head_0, _zero_0);
  }
}

function $schedule_room(_count_0) {
  return $scheduler_room(_count_0);
}

function $schedule_visible(_present_0, _incident_0, _operator_0, _readable_0, _creator_0, _principal_0, _grant_0, _chain_0) {
  return $scheduler_visible(_present_0, _incident_0, _operator_0, _readable_0, _creator_0, _principal_0, _grant_0, _chain_0);
}

function $schedule_needs_events(_wake_0) {
  return $scheduler_needs_events(_wake_0);
}

function $schedule_baseline(_wake_0, _edge_0) {
  return $scheduler_baseline(_wake_0, _edge_0);
}

function $schedule_wake_admission(_wake_0, _once_0, _resource_0) {
  return $scheduler_wake_admission(_wake_0, _once_0, _resource_0);
}

function $schedule_scan(_facts_0, _context_0, _ended_0, _activity_0) {
  return $scheduler_scan(_facts_0, _context_0, _ended_0, _activity_0);
}

function $schedule_mode(_wake_0, _facts_0, _activity_0, _present_0, _due_0, _now_0) {
  return $scheduler_mode(_wake_0, _facts_0, _activity_0, _present_0, _due_0, _now_0);
}

function $schedule_selection(_has_ids_0, _ids_0, _event_present_0, _subjects_0) {
  return $scheduler_selection(_has_ids_0, _ids_0, _event_present_0, _subjects_0);
}

function $schedule_event_gate(_previous_0, _sequence_0, _activity_0, _kind_0, _types_0) {
  return $scheduler_event_gate(_previous_0, _sequence_0, _activity_0, _kind_0, _types_0);
}

function $schedule_observation(_each_0, _edge_0, _selected_0) {
  return $scheduler_observation(_each_0, _edge_0, _selected_0);
}

function $schedule_queue(_pending_0, _coalesce_0, _previous_0, _incoming_0) {
  return $scheduler_queue(_pending_0, _coalesce_0, _previous_0, _incoming_0);
}

function $schedule_order(_sequence_0, _emitted_0) {
  return $scheduler_occurrence_order(_sequence_0, _emitted_0);
}

function $schedule_advance(_previous_0, _sequence_0, _activity_0, _old_edge_0, _next_edge_0, _fired_0, _enqueued_0, _pending_0, _once_0) {
  return $scheduler_advance(_previous_0, _sequence_0, _activity_0, _old_edge_0, _next_edge_0, _fired_0, _enqueued_0, _pending_0, _once_0);
}

function $schedule_capacity_edge(_old_0, _available_0, _accepted_0) {
  return $scheduler_capacity_edge(_old_0, _available_0, _accepted_0);
}

function $schedule_matches(_life_0, _present_0, _expected_0, _current_0) {
  return $scheduler_matches(_life_0, _present_0, _expected_0, _current_0);
}

function $schedule_completed(_once_0) {
  return $scheduler_completed(_once_0);
}

function $schedule_cancellable(_life_0) {
  return $scheduler_cancellable(_life_0);
}

function $schedule_retry_fault(_code_0) {
  return $scheduler_retry_fault(_code_0);
}

function $schedule_watch(_facts_0, _activity_0, _present_0) {
  return $scheduler_watch(_facts_0, _activity_0, _present_0);
}

function $schedule_ready(_facts_0, _activity_0, _coalesce_0, _last_sources_0) {
  return $scheduler_ready(_facts_0, _activity_0, _coalesce_0, _last_sources_0);
}

function $schedule_choose(_has_last_0, _last_0, _candidates_0, _activity_0) {
  return $scheduler_choose(_has_last_0, _last_0, _candidates_0, _activity_0);
}

function $schedule_causality(_root_0) {
  return $scheduler_causality(_root_0);
}

function $schedule_causal_demand(_state_0) {
  return $scheduler_demand(_state_0);
}

function $schedule_causal_step(_state_0, _event_0, _context_0, _schedule_0) {
  return $scheduler_step(_state_0, _event_0, _context_0, _schedule_0);
}

function $capability_basis_1(_advertisement_0, _requirement_0, _scopes_0, _expiry_0, _now_0, _incident_present_0) {
  return $capability_basis(_advertisement_0, _requirement_0, _scopes_0, $$rank_le(_expiry_0, _now_0), _incident_present_0);
}

function $capability_finish_1(_assessment_0, _policy_0) {
  return $capability_finish(_assessment_0, _policy_0);
}

function $capability_compare_1(_left_0, _left_count_0, _left_id_0, _right_0, _right_count_0, _right_id_0) {
  return $capability_compare(_left_0, _left_count_0, _left_id_0, _right_0, _right_count_0, _right_id_0);
}

function $capability_publish_1(_advertisement_0, _principal_0, _methods_0, _count_0, _expiry_0, _now_0) {
  return $capability_publish(_advertisement_0, _principal_0, _methods_0, _count_0, $$rank_le(_expiry_0, _now_0));
}

function $execution_room(_count_0) {
  return $capability_room(_count_0);
}

function $execution_admission(_expiry_0, _now_0, _context_0, _incident_present_0, _incident_0) {
  return $capability_execution_admission($$rank_le(_expiry_0, _now_0), _context_0, _incident_present_0, $$incident_terminal(_incident_0));
}

function $execution_deadline(_present_0, _expiry_0, _now_0) {
  const _x_0 = $$Bool_not(_present_0);
  const _x_1 = $$Bool_not($$rank_le(_expiry_0, _now_0));
  return (_x_0 || _x_1);
}

function $execution_prepare(_incident_0, _capability_0, _operator_0, _actor_0, _requester_0, _submitted_0, _bound_0, _readable_0) {
  return $capability_prepare(_incident_0, _capability_0, _operator_0, _actor_0, _requester_0, _submitted_0, _bound_0, _readable_0);
}

function $execution_visible(_present_0, _origin_present_0, _incident_0, _operator_0, _principal_0, _requester_0, _provider_0, _first_grant_0, _chain_0, _capability_0, _readable_0) {
  return $capability_visible(_present_0, _origin_present_0, _incident_0, _operator_0, _principal_0, _requester_0, _provider_0, _first_grant_0, _chain_0, _capability_0, _readable_0);
}

function $execution_reconcile(_principal_0, _provider_0, _operator_0, _readable_0) {
  return $capability_reconcile(_principal_0, _provider_0, _operator_0, _readable_0);
}

function $execution_evidence(_required_0, _sources_0) {
  return $capability_evidence(_required_0, _sources_0);
}

function $capability_selected_1(_advertised_0, _requested_0, _readable_0) {
  return $capability_selected(_advertised_0, _requested_0, _readable_0);
}

function $policy_query_initial_1(_records_0, _assertions_0) {
  return $policy_query_initial(_records_0, _assertions_0);
}

function $policy_query_available_1(_budget_0) {
  return $policy_query_available(_budget_0);
}

function $policy_query_charges_1(_costs_0, _budget_0) {
  return $policy_query_charges(_costs_0, _budget_0);
}

function $policy_query_projection(_assertions_0, _system_0, _context_0, _issuers_0, _budget_0) {
  return $policy_query_project(_assertions_0, _system_0, _context_0, _issuers_0, _budget_0);
}

function $policy_query_supported_1(_status_0, _sources_0) {
  return $policy_query_supported(_status_0, _sources_0);
}

function $policy_query_selected_1(_kind_0, _schema_0, _names_0, _readable_0, _asserted_0) {
  return $policy_query_selected(_kind_0, _schema_0, _names_0, _readable_0, _asserted_0);
}

function $policy_query_observed_1(_found_0, _operator_0) {
  return $policy_query_observed(_found_0, _operator_0);
}

function $policy_query_plan_1(_headers_0, _budget_0) {
  return $policy_query_plan(_headers_0, _budget_0);
}

function $policy_query_related_1(_edges_0, _start_0, _destination_0, _hops_0, _operator_0, _budget_0) {
  return $policy_query_related(_edges_0, _start_0, _destination_0, _hops_0, _operator_0, _budget_0);
}

function $policy_query_exists_budget(_budget_0, _records_0, _assertions_0, _provenance_0, _roles_0) {
  return $policy_query_charges(_roles_0, $$policy_query_charges(_roles_0, $$policy_query_charge($$policy_query_charge($$policy_query_charge($$policy_query_charge(_budget_0, _records_0), _assertions_0), _provenance_0), 1)));
}

function $control_projection_1(_count_0, _paths_0, _schema_0) {
  return $control_projection(_count_0, _paths_0, _schema_0);
}

function $control_proposal_1(_id_0, _basis_0, _expected_0, _policy_0, _current_0, _changes_0, _executions_0) {
  return $control_proposal(_id_0, _basis_0, _expected_0, _policy_0, _current_0, _changes_0, _executions_0);
}

function $control_commit_1(_state_0, _recorded_0, _current_0, _policy_0, _selected_0) {
  return $control_commit(_state_0, _recorded_0, _current_0, _policy_0, _selected_0);
}

function $control_plan_1(_id_0, _incident_0, _changes_0, _items_0) {
  return $control_plan(_id_0, _incident_0, _changes_0, _items_0);
}

function $control_visible_1(_present_0, _incident_0, _operator_0, _origin_0, _principal_0, _grant_0, _chain_0, _readable_0) {
  return $control_visible(_present_0, _incident_0, _operator_0, _origin_0, _principal_0, _grant_0, _chain_0, _readable_0);
}

function $control_namespace_1(_names_0) {
  return $control_namespace(_names_0);
}

function $control_revoke_1(_operator_0, _target_0, _bound_0, _issuer_0, _principal_0, _chain_0) {
  return $control_revoke(_operator_0, _target_0, _bound_0, _issuer_0, _principal_0, _chain_0);
}

function $control_actions_1(_requested_0, _installed_0, _capabilities_0) {
  return $control_actions(_requested_0, _installed_0, _capabilities_0);
}

function $control_schema_1(_name_0, _installed_0, _submitted_0, _actual_0, _present_0, _previous_0) {
  return $control_schema(_name_0, _installed_0, _submitted_0, _actual_0, _present_0, _previous_0);
}

function $control_bindings(_names_0) {
  return $control_binding_names(_names_0);
}

function $control_bound(_operator_0, _submitted_present_0, _bound_present_0, _submitted_0, _bound_0) {
  const _x_0 = $$Bool_and($$Bool_and(_submitted_present_0, _bound_present_0), $$String_eq(_submitted_0, _bound_0));
  return (_operator_0 || _x_0);
}

function $control_projection_room_1(_count_0) {
  return $control_projection_room(_count_0);
}

function $reaction_source(_present_0, _revision_0, _current_0) {
  return $Bool_pick($$Bool_and(_present_0, $$accounting_le(_revision_0, _current_0)), {$: "ReactionNeedsVisibility"}, {$: "ReactionSourceMissing"});
}

function $reaction_event(_visible_0, _kind_0, _types_0) {
  const _x_0 = $$List_is_empty(_types_0);
  const _x_1 = $$collections_contains(_types_0, _kind_0);
  return $Bool_pick(_visible_0, $$Bool_pick((_x_0 || _x_1), {$: "ReactionEventUse"}, {$: "ReactionEventSkip"}), {$: "ReactionEventHidden"});
}

function $reaction_mode(_events_0, _requested_0, _types_0) {
  return $Bool_pick($$Bool_not((_events_0 === 0)), {$: "ReactionEvents"}, $$Bool_pick($$Bool_and((_requested_0 === 0), (_types_0 === 0)), {$: "ReactionOnce"}, {$: "ReactionNone"}));
}

function $reaction_begin() {
  return {$: "ReactionPending", "unresolved": false};
}

function $reaction_observe(_progress_0, _value_0) {
  if (_progress_0.$ === "ReactionMatched") {
    return {$: "ReactionMatched"};
  } else {
    const _unresolved_0 = _progress_0["unresolved"];
    if (_value_0.$ === "Yes") {
      return {$: "ReactionMatched"};
    } else if (_value_0.$ === "No") {
      return {$: "ReactionPending", "unresolved": _unresolved_0};
    } else {
      return {$: "ReactionPending", "unresolved": true};
    }
  }
}

function $reaction_finish(_progress_0) {
  if (_progress_0.$ === "ReactionMatched") {
    return {$: "ReactionEligible"};
  } else {
    const _unresolved_0 = _progress_0["unresolved"];
    return $Bool_pick(_unresolved_0, {$: "ReactionIndeterminate"}, {$: "ReactionIneligible"});
  }
}

function $resource_compare(_left_0, _right_0) {
  return $Bool_pick($$accounting_equal(_left_0, _right_0), {$: "EQ"}, $$Bool_pick($$accounting_le(_left_0, _right_0), {$: "LT"}, {$: "GT"}));
}

function $awareness_detail_1(_message_0, _kind_0, _roles_0, _incident_0, _scope_0, _dependencies_0) {
  return $awareness_detail(_message_0, _kind_0, _roles_0, _incident_0, _scope_0, _dependencies_0);
}

function $awareness_message_visible_1(_present_0, _recipient_0, _principal_0, _incident_0) {
  return $awareness_message_visible(_present_0, _recipient_0, _principal_0, _incident_0);
}

function $awareness_message_1(_count_0, _bytes_0, _incident_0, _scope_0, _live_0) {
  return $awareness_message(_count_0, _bytes_0, _incident_0, _scope_0, _live_0);
}

function $awareness_reply_1(_kind_0, _incident_0, _principal_0, _recipient_0, _parent_0) {
  return $awareness_reply(_kind_0, _incident_0, _principal_0, _recipient_0, _parent_0);
}

function $awareness_recipient_mode_1(_principal_0, _owner_0) {
  return $awareness_recipient_mode(_principal_0, _owner_0);
}

function $awareness_recipients_1(_grants_0, _principal_0) {
  return $awareness_recipients(_grants_0, _principal_0);
}

function $awareness_selected_1(_include_acknowledged_0, _acknowledged_0) {
  return $awareness_selected(_include_acknowledged_0, _acknowledged_0);
}

function $awareness_message_compare_1(_left_0, _left_id_0, _right_0, _right_id_0) {
  return $awareness_message_compare(_left_0, _left_id_0, _right_0, _right_id_0);
}

function $awareness_template_1(_kind_0, _schema_0, _expected_0, _selected_0, _current_0) {
  return $awareness_template(_kind_0, _schema_0, _expected_0, _selected_0, _current_0);
}

function $awareness_supported_1(_items_0, _record_0, _issuers_0) {
  return $awareness_supported(_items_0, _record_0, _issuers_0);
}

function $awareness_slots_1(_count_0, _expected_0, _declared_0, _optional_0, _markers_0, _malformed_0) {
  return $awareness_slots(_count_0, _expected_0, _declared_0, _optional_0, _markers_0, _malformed_0);
}

function $awareness_prompt_candidates_1(_declared_0, _optional_0) {
  return $awareness_prompt_candidates(_declared_0, _optional_0);
}

function $awareness_prompt_step_1(_candidates_0, _used_0, _ceiling_0) {
  return $awareness_prompt_step(_candidates_0, _used_0, _ceiling_0);
}

function $awareness_ref_route_1(_local_0, _message_0, _readable_0, _incident_0, _execution_0, _schedule_0) {
  return $awareness_ref_route(_local_0, _message_0, _readable_0, _incident_0, _execution_0, _schedule_0);
}

function $awareness_scan_request_1(_items_0, _ceiling_0, _scanned_0) {
  return $awareness_scan_request(_items_0, _ceiling_0, _scanned_0);
}

function $visibility_start(_operator_0, _root_0) {
  return $awareness_visibility_start(_operator_0, _root_0);
}

function $visibility_demand(_state_0) {
  return $awareness_visibility_demand(_state_0);
}

function $visibility_event(_state_0, _event_0, _context_0) {
  return $awareness_visibility_event(_state_0, _event_0, _context_0);
}

function $visibility_ref(_state_0, _visible_0) {
  return $awareness_visibility_ref(_state_0, _visible_0);
}

function $guidance_path_1(_root_host_0, _root_0, _path_host_0, _selected_0) {
  return $guidance_path(_root_host_0, _root_0, _path_host_0, _selected_0);
}

function $guidance_registration_1(_normalized_0, _present_0, _count_0, _same_0) {
  return $guidance_registration(_normalized_0, _present_0, _count_0, _same_0);
}

function $guidance_refresh_1(_active_0, _storage_0) {
  return $guidance_refresh(_active_0, _storage_0);
}

function $guidance_retained_1(_count_0, _maximum_count_0, _total_0, _extra_0, _maximum_bytes_0) {
  return $guidance_retained(_count_0, _maximum_count_0, _total_0, _extra_0, _maximum_bytes_0);
}

function $guidance_observation_error_1(_code_0, _domain_0) {
  return $guidance_observation_error(_code_0, _domain_0);
}

function $guidance_selected_1(_explicit_0, _active_0, _located_0, _matches_0) {
  return $guidance_selected(_explicit_0, _active_0, _located_0, _matches_0);
}

function $guidance_review_size_1(_count_0) {
  return $guidance_review_size(_count_0);
}

function $guidance_review_source_1(_active_0, _observation_0) {
  return $guidance_review_source(_active_0, _observation_0);
}

function $guidance_review_bytes_1(_values_0) {
  return $guidance_review_bytes(_values_0);
}

function $guidance_current_1(_present_0, _active_0, _definition_0, _captured_definition_0, _observation_0, _latest_0, _capture_0) {
  return $guidance_current(_present_0, _active_0, _definition_0, _captured_definition_0, _observation_0, _latest_0, _capture_0);
}

function $guidance_basis_1(_present_0, _actual_0, _expected_0) {
  return $guidance_basis(_present_0, _actual_0, _expected_0);
}

function $guidance_policy_1(_current_ref_0, _expected_ref_0, _current_digest_0, _expected_digest_0) {
  return $guidance_policy(_current_ref_0, _expected_ref_0, _current_digest_0, _expected_digest_0);
}

function $guidance_profile_1(_actual_0, _expected_0) {
  return $guidance_profile(_actual_0, _expected_0);
}

function $guidance_profile_available_1(_compatible_0, _readable_0, _expiry_0, _now_0) {
  return $guidance_profile_available(_compatible_0, _readable_0, $$rank_le(_expiry_0, _now_0));
}

function $guidance_grant_1(_principal_0, _candidate_principal_0, _actions_0, _resources_0, _capability_0, _operator_0, _candidate_0, _bound_0) {
  return $guidance_grant(_principal_0, _candidate_principal_0, _actions_0, _resources_0, _capability_0, _operator_0, _candidate_0, _bound_0);
}

function $guidance_candidate_1(_state_0, _blocked_0, _settlement_0) {
  return $guidance_candidate(_state_0, _blocked_0, _settlement_0);
}

function $guidance_candidate_compare_1(_left_0, _left_key_0, _right_0, _right_key_0) {
  return $guidance_candidate_compare(_left_0, _left_key_0, _right_0, _right_key_0);
}

function $guidance_result_1(_kind_0, _failure_0, _raw_0) {
  return $guidance_result(_kind_0, _failure_0, _raw_0);
}

function $guidance_quote_1(_matches_0, _editorial_0) {
  return $guidance_quote(_matches_0, _editorial_0);
}

function $guidance_editorial_1(_present_0, _matches_0, _ascii_initial_0) {
  return $guidance_editorial(_present_0, _matches_0, _ascii_initial_0);
}

function $guidance_capture_room_1(_count_0) {
  return $guidance_capture_room(_count_0);
}

function $guidance_settlement_1(_state_0, _blocked_0) {
  return $guidance_settlement(_state_0, _blocked_0);
}

function $Bool_not(_b_0) {
  if (!_b_0) {
    return true;
  } else {
    return false;
  }
}

function $Bool_pick(_c_0, _a_0, _b_0) {
  if (!_c_0) {
    return _b_0;
  } else {
    return _a_0;
  }
}

function $Bool_and(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
  }
}

function $String_eq(_a_0, _b_0) {
  return $Cmp_is_eq($$String_order(_a_0, _b_0));
}

function $List_reverse(_xs_0) {
  return $List_reverse_go(_xs_0, {$: "Nil"});
}

function $List_append(_xs_0, _ys_0) {
  if (_xs_0.$ === "Nil") {
    return _ys_0;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return {$: "Con", "head": _h_0, "tail": $$List_append(_t_0, _ys_0)};
  }
}

function $String_starts_with(_s_0, _p_0) {
  return $String_starts_with_go(_p_0, _s_0);
}

function $Nat_is_le(_a_0, _b_0) {
  return $Cmp_is_le(cmp_new(_a_0, _b_0));
}

function $List_length(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return 0;
  } else {
    const _t_0 = _xs_0["tail"];
    return nat_chk($$List_length(_t_0) + 1);
  }
}

function $String_is_lt(_a_0, _b_0) {
  return $Cmp_is_lt($$String_order(_a_0, _b_0));
}

function $List_is_empty(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return true;
  } else {
    return false;
  }
}

function $String_order(_a_0, _b_0) {
  return $String_order_go(_a_0, _b_0, {$: "EQ"});
}

function $U32_min(_a_0, _b_0) {
  return $Bool_pick((_a_0 < _b_0), _a_0, _b_0);
}

function $List_filter_put(_h_0, _r_0, _keep_0) {
  if (!_keep_0) {
    return _r_0;
  } else {
    return {$: "Con", "head": _h_0, "tail": _r_0};
  }
}

function $Cmp_is_eq(_c_0) {
  if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

function $List_reverse_go($0, $1) {
  for (;;) {
    {
      const _xs_0 = $0;
      const _acc_0 = $1;
      if (_xs_0.$ === "Nil") {
        return _acc_0;
      } else {
        const _h_0 = _xs_0["head"];
        const _t_0 = _xs_0["tail"];
        $0 = _t_0;
        $1 = {$: "Con", "head": _h_0, "tail": _acc_0};
        continue;
      }
    }
  }
}

function $String_starts_with_go($0, $1, $2) {
  let $pc = 0;
  for (;;) switch ($pc) {
    case 0: {
      const _p_0 = $0;
      const _s_0 = $1;
      if (_p_0 === "") {
        return true;
      } else {
        const _y_0 = _p_0.slice(0, char_len(_p_0));
        const _yt_0 = _p_0.slice(char_len(_p_0));
        if (_s_0 === "") {
          return false;
        } else {
          const _x_0 = _s_0.slice(0, char_len(_s_0));
          const _xt_0 = _s_0.slice(char_len(_s_0));
          $0 = _yt_0;
          $1 = _xt_0;
          $2 = $$Char_is_eq(_x_0, _y_0);
          $pc = 1; continue;
        }
      }
    }
    case 1: {
      const _pt_0 = $0;
      const _t_0 = $1;
      const _same_0 = $2;
      if (!_same_0) {
        return false;
      } else {
        $0 = _pt_0;
        $1 = _t_0;
        $pc = 0; continue;
      }
    }
  }
}

function $Cmp_is_le(_c_0) {
  if (_c_0.$ === "GT") {
    return false;
  } else {
    return true;
  }
}

function $Cmp_is_lt(_c_0) {
  if (_c_0.$ === "LT") {
    return true;
  } else {
    return false;
  }
}

function $String_order_go($0, $1, $2) {
  for (;;) {
    {
      const _a_0 = $0;
      const _b_0 = $1;
      const _c_0 = $2;
      if (_a_0 === "") {
        if (_b_0 !== "") {
          if (_c_0.$ === "EQ") {
            return {$: "LT"};
          } else {
            return _c_0;
          }
        } else {
          return _c_0;
        }
      } else {
        const _t_1 = _a_0.slice(0, char_len(_a_0));
        const _x_0 = char_code(_t_1);
        const _t_2 = _a_0.slice(char_len(_a_0));
        if (_b_0 === "") {
          if (_c_0.$ === "EQ") {
            return {$: "GT"};
          } else {
            return _c_0;
          }
        } else {
          const _t_3 = _b_0.slice(0, char_len(_b_0));
          const _y_0 = char_code(_t_3);
          const _t2_0 = _b_0.slice(char_len(_b_0));
          if (_c_0.$ === "EQ") {
            $0 = _t_2;
            $1 = _t2_0;
            $2 = cmp_new(_x_0, _y_0);
            continue;
          } else {
            return _c_0;
          }
        }
      }
    }
  }
}

function $String_starts_with_go_if($0, $1, $2) {
  let $pc = 1;
  for (;;) switch ($pc) {
    case 0: {
      const _p_0 = $0;
      const _s_0 = $1;
      if (_p_0 === "") {
        return true;
      } else {
        const _y_0 = _p_0.slice(0, char_len(_p_0));
        const _yt_0 = _p_0.slice(char_len(_p_0));
        if (_s_0 === "") {
          return false;
        } else {
          const _x_0 = _s_0.slice(0, char_len(_s_0));
          const _xt_0 = _s_0.slice(char_len(_s_0));
          $0 = _yt_0;
          $1 = _xt_0;
          $2 = $$Char_is_eq(_x_0, _y_0);
          $pc = 1; continue;
        }
      }
    }
    case 1: {
      const _pt_0 = $0;
      const _t_0 = $1;
      const _same_0 = $2;
      if (!_same_0) {
        return false;
      } else {
        $0 = _pt_0;
        $1 = _t_0;
        $pc = 0; continue;
      }
    }
  }
}

function $Char_is_eq(_a_0, _b_0) {
  const _x_0 = char_code(_a_0);
  const _y_0 = char_code(_b_0);
  return (_x_0 === _y_0);
}

const $$execution_result = $execution_result;
const $$Bool_not = $Bool_not;
const $$topology_parent_allows = $topology_parent_allows;
const $$Bool_and = $Bool_and;
const $$topology_add = (a0,a1,a2,a3) => run_loop($topology_add(a0,a1,a2,a3));
const $$topology_enqueue = $topology_enqueue;
const $$topology_release_one = $topology_release_one;
const $$topology_release = (a0,a1,a2) => run_loop($topology_release(a0,a1,a2));
const $$topology_zeros = (a0,a1,a2,a3) => run_loop($topology_zeros(a0,a1,a2,a3));
const $$topology_walk = (a0,a1,a2,a3,a4,a5) => run_loop($topology_walk(a0,a1,a2,a3,a4,a5));
const $$topology_prepare = $topology_prepare;
const $$Bool_pick = $Bool_pick;
const $$topology_combine_child = $topology_combine_child;
const $$accounting_le = $accounting_le;
const $$accounting_zero = $accounting_zero;
const $$accounting_accumulate = $accounting_accumulate;
const $$accounting_fits = $accounting_fits;
const $$accounting_include = $accounting_include;
const $$accounting_quantities_le = $accounting_quantities_le;
const $$accounting_maximum = $accounting_maximum;
const $$accounting_cumulative = $accounting_cumulative;
const $$accounting_one = $accounting_one;
const $$execution_terminal = $execution_terminal;
const $$accounting_charge = $accounting_charge;
const $$accounting_empty = $accounting_empty;
const $$accounting_requests_fold = $accounting_requests_fold;
const $$accounting_subtract = $accounting_subtract;
const $$accounting_remaining = $accounting_remaining;
const $$String_eq = $String_eq;
const $$collections_contains = $collections_contains;
const $$List_append = $List_append;
const $$accounting_equal = $accounting_equal;
const $$scheduler_active = $scheduler_active;
const $$scheduler_unblocked = $scheduler_unblocked;
const $$scheduler_resource_known = $scheduler_resource_known;
const $$String_starts_with = $String_starts_with;
const $$List_length = $List_length;
const $$Nat_is_le = $Nat_is_le;
const $$collections_union = $collections_union;
const $$scheduler_merged = $scheduler_merged;
const $$accounting_add = $accounting_add;
const $$scheduler_runnable = $scheduler_runnable;
const $$scheduler_candidate_order = $scheduler_candidate_order;
const $$scheduler_candidate_eligible = $scheduler_candidate_eligible;
const $$scheduler_prefer = $scheduler_prefer;
const $$String_is_lt = $String_is_lt;
const $$scheduler_candidate_incident = $scheduler_candidate_incident;
const $$scheduler_lower_key = $scheduler_lower_key;
const $$scheduler_first_key = $scheduler_first_key;
const $$scheduler_fallback = $scheduler_fallback;
const $$scheduler_choose_key = $scheduler_choose_key;
const $$scheduler_oldest = $scheduler_oldest;
const $$collections_intersection = $collections_intersection;
const $$collections_unseen_fold = $collections_unseen_fold;
const $$scheduler_step_event = $scheduler_step_event;
const $$capability_schema_equal = $capability_schema_equal;
const $$collections_subset = $collections_subset;
const $$List_is_empty = $List_is_empty;
const $$capability_grant_fold = $capability_grant_fold;
const $$capability_reason = $capability_reason;
const $$capability_compatibility = $capability_compatibility;
const $$capability_incident_fold = $capability_incident_fold;
const $$String_order = $String_order;
const $$capability_eligibility_rank = $capability_eligibility_rank;
const $$capability_room = $capability_room;
const $$policy_query_charge = $policy_query_charge;
const $$policy_query_project_step = $policy_query_project_step;
const $$List_reverse = $List_reverse;
const $$policy_query_project_fold = $policy_query_project_fold;
const $$policy_query_readable_fold = $policy_query_readable_fold;
const $$policy_query_edge_charge = $policy_query_edge_charge;
const $$policy_query_available = $policy_query_available;
const $$policy_query_plan_step = $policy_query_plan_step;
const $$policy_query_plan_fold = $policy_query_plan_fold;
const $$policy_query_target_step = $policy_query_target_step;
const $$policy_query_count_budget = $policy_query_count_budget;
const $$policy_query_role_budget = $policy_query_role_budget;
const $$policy_query_edge_step = $policy_query_edge_step;
const $$policy_query_source_step = $policy_query_source_step;
const $$policy_query_observed = $policy_query_observed;
const $$policy_query_sources_fold = $policy_query_sources_fold;
const $$policy_query_layer = $policy_query_layer;
const $$policy_query_layers = $policy_query_layers;
const $$control_schema_name = $control_schema_name;
const $$control_schema_tail = $control_schema_tail;
const $$control_field = $control_field;
const $$control_fields = $control_fields;
const $$control_schema_path = $control_schema_path;
const $$control_schema_visible = $control_schema_visible;
const $$control_projection_room = $control_projection_room;
const $$control_aliases = $control_aliases;
const $$control_declared = $control_declared;
const $$control_executions = $control_executions;
const $$control_namespace = $control_namespace;
const $$awareness_all = $awareness_all;
const $$awareness_recipient_step = $awareness_recipient_step;
const $$awareness_recipient_fold = $awareness_recipient_fold;
const $$awareness_prompt_large = $awareness_prompt_large;
const $$U32_min = $U32_min;
const $$awareness_groups = $awareness_groups;
const $$awareness_observed_event = $awareness_observed_event;
const $$guidance_components = $guidance_components;
const $$guidance_some_fold = $guidance_some_fold;
const $$guidance_evidence_fold = $guidance_evidence_fold;
const $$guidance_uncertain = $guidance_uncertain;
const $$truth_all = $truth_all;
const $$truth_any = $truth_any;
const $$same_scope = $same_scope;
const $$rank_le = $rank_le;
const $$fits = $fits;
const $$graph_phase = $graph_phase;
const $$text_contains = $text_contains;
const $$grant_available = $grant_available;
const $$deadline = $deadline;
const $$text_subset = $text_subset;
const $$incident_scope = $incident_scope;
const $$rule_contains = $rule_contains;
const $$denies_preserved = $denies_preserved;
const $$permit_narrowed = $permit_narrowed;
const $$permits_bounded = $permits_bounded;
const $$scope_allows = $scope_allows;
const $$scopes_allow = $scopes_allow;
const $$method_context = $method_context;
const $$method_delegate = $method_delegate;
const $$incident_terminal = $incident_terminal;
const $$incident_sources = $incident_sources;
const $$role_connects = $role_connects;
const $$lease_duration = $lease_duration;
const $$count_minimum = $count_minimum;
const $$lease_frame = $lease_frame;
const $$expiry_fold = $expiry_fold;
const $$queued_maintenance = $queued_maintenance;
const $$marker_present = $marker_present;
const $$policy_query_charges = $policy_query_charges;
const $$Char_is_eq = $Char_is_eq;export default {
  "execution:terminal": run_lib((a0) => run_loop($execution_terminal(a0)), 1),
  "execution:result": run_lib((a0) => run_loop($execution_result(a0)), 1),
  "execution:finish_leased": run_lib((a0) => run_loop($execution_finish_leased(a0)), 1),
  "execution:step": run_lib((a0,a1) => run_loop($execution_step(a0,a1)), 2),
  "topology:unpack": run_lib((a0,a1) => run_loop($topology_unpack(a0,a1)), 2),
  "topology:parent_allows": run_lib((a0,a1,a2) => run_loop($topology_parent_allows(a0,a1,a2)), 3),
  "topology:enqueue": run_lib((a0,a1,a2) => run_loop($topology_enqueue(a0,a1,a2)), 3),
  "topology:add_checked": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($topology_add_checked(a0,a1,a2,a3,a4,a5,a6)), 7),
  "topology:add_indexed": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($topology_add_indexed(a0,a1,a2,a3,a4,a5,a6)), 7),
  "topology:add": run_lib((a0,a1,a2,a3) => run_loop($topology_add(a0,a1,a2,a3)), 4),
  "topology:prepare": run_lib((a0,a1,a2,a3) => run_loop($topology_prepare(a0,a1,a2,a3)), 4),
  "topology:zeros": run_lib((a0,a1,a2,a3) => run_loop($topology_zeros(nat_in(a0),a1,a2,a3)), 4),
  "topology:release_one": run_lib((a0,a1,a2) => run_loop($topology_release_one(a0,a1,a2)), 3),
  "topology:release": run_lib((a0,a1,a2) => run_loop($topology_release(a0,a1,a2)), 3),
  "topology:walk": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($topology_walk(nat_in(a0),a1,a2,a3,a4,a5)), 6),
  "topology:certify": run_lib((a0,a1,a2) => run_loop($topology_certify(a0,a1,a2)), 3),
  "topology:finish_count": run_lib((a0,a1,a2) => run_loop($topology_finish_count(a0,a1,a2)), 3),
  "topology:finish": run_lib((a0,a1,a2) => run_loop($topology_finish(a0,a1,a2)), 3),
  "topology:start": run_lib((a0,a1,a2,a3) => run_loop($topology_start(a0,a1,a2,a3)), 4),
  "topology:check": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($topology_check(a0,a1,a2,a3,a4,a5,a6)), 7),
  "topology:project": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10) => run_loop($topology_project(a0,a1,a2,str_in(a3),str_in(a4),a5,str_in(a6),str_in(a7),str_in(a8),str_in(a9),str_in(a10))), 11),
  "topology:combine_child": run_lib((a0,a1) => run_loop($topology_combine_child(a0,a1)), 2),
  "topology:combine_fold": run_lib((a0,a1) => run_loop($topology_combine_fold(a0,a1)), 2),
  "topology:combine": run_lib((a0) => run_loop($topology_combine(a0)), 1),
  "accounting:zero": run_lib(() => run_loop($accounting_zero()), 0),
  "accounting:one": run_lib(() => run_loop($accounting_one()), 0),
  "accounting:le": run_lib((a0,a1) => run_loop($accounting_le(a0,a1)), 2),
  "accounting:maximum": run_lib((a0,a1) => run_loop($accounting_maximum(a0,a1)), 2),
  "accounting:added": run_lib((a0,a1) => run_loop($accounting_added(a0,a1)), 2),
  "accounting:add": run_lib((a0,a1) => run_loop($accounting_add(a0,a1)), 2),
  "accounting:subtract_checked": run_lib((a0,a1,a2) => run_loop($accounting_subtract_checked(a0,a1,a2)), 3),
  "accounting:subtract": run_lib((a0,a1) => run_loop($accounting_subtract(a0,a1)), 2),
  "accounting:equal": run_lib((a0,a1) => run_loop($accounting_equal(a0,a1)), 2),
  "accounting:accumulate": run_lib((a0,a1) => run_loop($accounting_accumulate(a0,a1)), 2),
  "accounting:fits": run_lib((a0,a1) => run_loop($accounting_fits(a0,a1)), 2),
  "accounting:empty": run_lib(() => run_loop($accounting_empty()), 0),
  "accounting:include": run_lib((a0,a1) => run_loop($accounting_include(a0,a1)), 2),
  "accounting:within": run_lib((a0,a1) => run_loop($accounting_within(a0,a1)), 2),
  "accounting:capacity": run_lib((a0,a1,a2) => run_loop($accounting_capacity(a0,a1,a2)), 3),
  "accounting:quantities_le": run_lib((a0,a1) => run_loop($accounting_quantities_le(a0,a1)), 2),
  "accounting:usage_allowed": run_lib((a0,a1,a2,a3) => run_loop($accounting_usage_allowed(a0,a1,a2,a3)), 4),
  "accounting:cumulative": run_lib((a0,a1,a2,a3) => run_loop($accounting_cumulative(a0,a1,a2,a3)), 4),
  "accounting:charges": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($accounting_charges(a0,a1,a2,a3,a4,a5,a6)), 7),
  "accounting:charge": run_lib((a0) => run_loop($accounting_charge(a0)), 1),
  "accounting:total_fold": run_lib((a0,a1) => run_loop($accounting_total_fold(a0,a1)), 2),
  "accounting:total": run_lib((a0) => run_loop($accounting_total(a0)), 1),
  "accounting:requests_fold": run_lib((a0,a1) => run_loop($accounting_requests_fold(a0,a1)), 2),
  "accounting:envelope": run_lib((a0,a1) => run_loop($accounting_envelope(a0,a1)), 2),
  "accounting:remaining_result": run_lib((a0) => run_loop($accounting_remaining_result(a0)), 1),
  "accounting:remaining": run_lib((a0) => run_loop($accounting_remaining(a0)), 1),
  "accounting:available_fold": run_lib((a0,a1) => run_loop($accounting_available_fold(a0,a1)), 2),
  "accounting:available": run_lib((a0) => run_loop($accounting_available(a0)), 1),
  "collections:contains_fold": run_lib((a0,a1,a2) => run_loop($collections_contains_fold(a0,str_in(a1),a2)), 3),
  "collections:contains": run_lib((a0,a1) => run_loop($collections_contains(a0,str_in(a1))), 2),
  "collections:subset_fold": run_lib((a0,a1,a2) => run_loop($collections_subset_fold(a0,a1,a2)), 3),
  "collections:subset": run_lib((a0,a1) => run_loop($collections_subset(a0,a1)), 2),
  "collections:unique_fold": run_lib((a0,a1,a2) => run_loop($collections_unique_fold(a0,a1,a2)), 3),
  "collections:union": run_lib((a0,a1) => run_loop($collections_union(a0,a1)), 2),
  "collections:intersection_fold": run_lib((a0,a1,a2) => run_loop($collections_intersection_fold(a0,a1,a2)), 3),
  "collections:intersection": run_lib((a0,a1) => run_loop($collections_intersection(a0,a1)), 2),
  "collections:unseen_fold": run_lib((a0,a1,a2) => run_loop($collections_unseen_fold(a0,a1,a2)), 3),
  "scheduler:active": run_lib((a0) => run_loop($scheduler_active(a0)), 1),
  "scheduler:cancellable": run_lib((a0) => run_loop($scheduler_cancellable(a0)), 1),
  "scheduler:unblocked": run_lib((a0,a1) => run_loop($scheduler_unblocked(a0,a1)), 2),
  "scheduler:runnable": run_lib((a0,a1) => run_loop($scheduler_runnable(a0,a1)), 2),
  "scheduler:ready": run_lib((a0,a1,a2,a3) => run_loop($scheduler_ready(a0,a1,a2,a3)), 4),
  "scheduler:scan": run_lib((a0,a1,a2,a3) => run_loop($scheduler_scan(a0,str_in(a1),a2,a3)), 4),
  "scheduler:needs_events": run_lib((a0) => run_loop($scheduler_needs_events(a0)), 1),
  "scheduler:timer": run_lib((a0) => run_loop($scheduler_timer(a0)), 1),
  "scheduler:baseline": run_lib((a0,a1) => run_loop($scheduler_baseline(a0,a1)), 2),
  "scheduler:resource_known": run_lib((a0) => run_loop($scheduler_resource_known(str_in(a0))), 1),
  "scheduler:wake_admission": run_lib((a0,a1,a2) => run_loop($scheduler_wake_admission(a0,a1,str_in(a2))), 3),
  "scheduler:room": run_lib((a0) => run_loop($scheduler_room(a0)), 1),
  "scheduler:visible": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($scheduler_visible(a0,a1,a2,a3,str_in(a4),str_in(a5),str_in(a6),a7)), 8),
  "scheduler:mode_fields": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($scheduler_mode_fields(a0,a1,a2,a3,a4,a5,a6)), 7),
  "scheduler:mode": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($scheduler_mode(a0,a1,a2,a3,a4,a5)), 6),
  "scheduler:event_gate": run_lib((a0,a1,a2,a3,a4) => run_loop($scheduler_event_gate(a0,a1,a2,str_in(a3),a4)), 5),
  "scheduler:observation": run_lib((a0,a1,a2) => run_loop($scheduler_observation(a0,a1,a2)), 3),
  "scheduler:merged": run_lib((a0) => run_loop($scheduler_merged(a0)), 1),
  "scheduler:queue": run_lib((a0,a1,a2,a3) => run_loop($scheduler_queue(a0,a1,a2,a3)), 4),
  "scheduler:order_result": run_lib((a0) => run_loop($scheduler_order_result(a0)), 1),
  "scheduler:occurrence_order": run_lib((a0,a1) => run_loop($scheduler_occurrence_order(a0,a1)), 2),
  "scheduler:advance": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8) => run_loop($scheduler_advance(a0,a1,a2,a3,a4,a5,a6,a7,a8)), 9),
  "scheduler:capacity_edge": run_lib((a0,a1,a2) => run_loop($scheduler_capacity_edge(a0,a1,a2)), 3),
  "scheduler:matches": run_lib((a0,a1,a2,a3) => run_loop($scheduler_matches(a0,a1,str_in(a2),str_in(a3))), 4),
  "scheduler:completed": run_lib((a0) => run_loop($scheduler_completed(a0)), 1),
  "scheduler:retry_fault": run_lib((a0) => run_loop($scheduler_retry_fault(str_in(a0))), 1),
  "scheduler:watch": run_lib((a0,a1,a2) => run_loop($scheduler_watch(a0,a1,a2)), 3),
  "scheduler:candidate_order": run_lib((a0) => run_loop($scheduler_candidate_order(a0)), 1),
  "scheduler:candidate_incident": run_lib((a0) => str_out(run_loop($scheduler_candidate_incident(a0))), 1),
  "scheduler:candidate_eligible": run_lib((a0,a1,a2,a3) => run_loop($scheduler_candidate_eligible(a0,a1,a2,str_in(a3))), 4),
  "scheduler:prefer": run_lib((a0,a1) => run_loop($scheduler_prefer(a0,a1)), 2),
  "scheduler:oldest": run_lib((a0,a1,a2,a3,a4) => run_loop($scheduler_oldest(a0,a1,a2,str_in(a3),a4)), 5),
  "scheduler:lower_key": run_lib((a0,a1) => run_loop($scheduler_lower_key(str_in(a0),a1)), 2),
  "scheduler:first_key": run_lib((a0,a1,a2,a3,a4) => run_loop($scheduler_first_key(a0,a1,a2,str_in(a3),a4)), 5),
  "scheduler:fallback": run_lib((a0,a1,a2) => run_loop($scheduler_fallback(a0,a1,a2)), 3),
  "scheduler:choose_key": run_lib((a0,a1,a2) => run_loop($scheduler_choose_key(a0,a1,a2)), 3),
  "scheduler:choose": run_lib((a0,a1,a2,a3) => run_loop($scheduler_choose(a0,str_in(a1),a2,a3)), 4),
  "scheduler:selection": run_lib((a0,a1,a2,a3) => run_loop($scheduler_selection(a0,a1,a2,a3)), 4),
  "scheduler:causality": run_lib((a0) => run_loop($scheduler_causality(str_in(a0))), 1),
  "scheduler:demand_todo": run_lib((a0,a1,a2) => run_loop($scheduler_demand_todo(a0,a1,a2)), 3),
  "scheduler:demand": run_lib((a0) => run_loop($scheduler_demand(a0)), 1),
  "scheduler:step_event": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($scheduler_step_event(a0,str_in(a1),a2,a3,a4,str_in(a5),str_in(a6))), 7),
  "scheduler:step_todo": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($scheduler_step_todo(a0,a1,a2,a3,str_in(a4),str_in(a5))), 6),
  "scheduler:step": run_lib((a0,a1,a2,a3) => run_loop($scheduler_step(a0,a1,str_in(a2),str_in(a3))), 4),
  "capability:schema_equal": run_lib((a0,a1) => run_loop($capability_schema_equal(a0,a1)), 2),
  "capability:grant_fold": run_lib((a0,a1,a2,a3) => run_loop($capability_grant_fold(a0,str_in(a1),str_in(a2),a3)), 4),
  "capability:incident_fold": run_lib((a0,a1) => run_loop($capability_incident_fold(a0,a1)), 2),
  "capability:reason": run_lib((a0,a1,a2) => run_loop($capability_reason(a0,str_in(a1),a2)), 3),
  "capability:compatibility": run_lib((a0,a1,a2,a3) => run_loop($capability_compatibility(a0,a1,a2,a3)), 4),
  "capability:basis_result": run_lib((a0,a1) => run_loop($capability_basis_result(a0,a1)), 2),
  "capability:basis": run_lib((a0,a1,a2,a3,a4) => run_loop($capability_basis(a0,a1,a2,a3,a4)), 5),
  "capability:policy_result": run_lib((a0) => run_loop($capability_policy_result(a0)), 1),
  "capability:finish": run_lib((a0,a1) => run_loop($capability_finish(a0,a1)), 2),
  "capability:eligibility_rank": run_lib((a0) => run_loop($capability_eligibility_rank(a0)), 1),
  "capability:compare_fields": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($capability_compare_fields(a0,a1,a2,a3,str_in(a4),str_in(a5))), 6),
  "capability:compare": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($capability_compare(a0,a1,str_in(a2),a3,a4,str_in(a5))), 6),
  "capability:room": run_lib((a0) => run_loop($capability_room(a0)), 1),
  "capability:publish": run_lib((a0,a1,a2,a3,a4) => run_loop($capability_publish(a0,str_in(a1),a2,a3,a4)), 5),
  "capability:execution_admission": run_lib((a0,a1,a2,a3) => run_loop($capability_execution_admission(a0,str_in(a1),a2,a3)), 4),
  "capability:prepare": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($capability_prepare(a0,a1,a2,str_in(a3),str_in(a4),str_in(a5),str_in(a6),a7)), 8),
  "capability:visible": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10) => run_loop($capability_visible(a0,a1,a2,a3,str_in(a4),str_in(a5),str_in(a6),str_in(a7),a8,a9,a10)), 11),
  "capability:reconcile": run_lib((a0,a1,a2,a3) => run_loop($capability_reconcile(str_in(a0),str_in(a1),a2,a3)), 4),
  "capability:evidence": run_lib((a0,a1) => run_loop($capability_evidence(a0,a1)), 2),
  "capability:selected": run_lib((a0,a1,a2) => run_loop($capability_selected(str_in(a0),str_in(a1),a2)), 3),
  "policy-query:initial": run_lib((a0,a1) => run_loop($policy_query_initial(a0,a1)), 2),
  "policy-query:charge": run_lib((a0,a1) => run_loop($policy_query_charge(a0,a1)), 2),
  "policy-query:available": run_lib((a0) => run_loop($policy_query_available(a0)), 1),
  "policy-query:edge_charge": run_lib((a0,a1,a2) => run_loop($policy_query_edge_charge(a0,a1,a2)), 3),
  "policy-query:charges": run_lib((a0,a1) => run_loop($policy_query_charges(a0,a1)), 2),
  "policy-query:projected": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_projected(a0,a1,str_in(a2),a3,a4)), 5),
  "policy-query:project_step": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_project_step(a0,str_in(a1),str_in(a2),a3,a4)), 5),
  "policy-query:project_fold": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_project_fold(a0,str_in(a1),str_in(a2),a3,a4)), 5),
  "policy-query:project_finish": run_lib((a0) => run_loop($policy_query_project_finish(a0)), 1),
  "policy-query:project": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_project(a0,str_in(a1),str_in(a2),a3,a4)), 5),
  "policy-query:readable_fold": run_lib((a0,a1) => run_loop($policy_query_readable_fold(a0,a1)), 2),
  "policy-query:supported": run_lib((a0,a1) => run_loop($policy_query_supported(str_in(a0),a1)), 2),
  "policy-query:selected": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_selected(str_in(a0),str_in(a1),a2,a3,a4)), 5),
  "policy-query:observed": run_lib((a0,a1) => run_loop($policy_query_observed(a0,a1)), 2),
  "policy-query:plan_step": run_lib((a0,a1) => run_loop($policy_query_plan_step(a0,a1)), 2),
  "policy-query:plan_fold": run_lib((a0,a1) => run_loop($policy_query_plan_fold(a0,a1)), 2),
  "policy-query:plan_finish": run_lib((a0) => run_loop($policy_query_plan_finish(a0)), 1),
  "policy-query:plan": run_lib((a0,a1) => run_loop($policy_query_plan(a0,a1)), 2),
  "policy-query:target_fields": run_lib((a0,a1,a2,a3) => run_loop($policy_query_target_fields(a0,str_in(a1),a2,str_in(a3))), 4),
  "policy-query:target_step": run_lib((a0,a1,a2) => run_loop($policy_query_target_step(a0,str_in(a1),a2)), 3),
  "policy-query:targets_fold": run_lib((a0,a1,a2) => run_loop($policy_query_targets_fold(a0,str_in(a1),a2)), 3),
  "policy-query:edge_targets": run_lib((a0,a1,a2,a3) => run_loop($policy_query_edge_targets(a0,a1,str_in(a2),a3)), 4),
  "policy-query:edge_ready": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($policy_query_edge_ready(a0,a1,a2,str_in(a3),str_in(a4),a5,a6,a7)), 8),
  "policy-query:count_budget": run_lib((a0,a1) => run_loop($policy_query_count_budget(a0,a1)), 2),
  "policy-query:role_budget": run_lib((a0,a1,a2) => run_loop($policy_query_role_budget(a0,a1,a2)), 3),
  "policy-query:edge_body": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($policy_query_edge_body(a0,str_in(a1),str_in(a2),a3,a4,a5,a6)), 7),
  "policy-query:edge_step": run_lib((a0,a1,a2,a3) => run_loop($policy_query_edge_step(a0,str_in(a1),str_in(a2),a3)), 4),
  "policy-query:edges_fold": run_lib((a0,a1,a2,a3) => run_loop($policy_query_edges_fold(a0,str_in(a1),str_in(a2),a3)), 4),
  "policy-query:source_step": run_lib((a0,a1,a2,a3) => run_loop($policy_query_source_step(str_in(a0),a1,str_in(a2),a3)), 4),
  "policy-query:sources_fold": run_lib((a0,a1,a2,a3) => run_loop($policy_query_sources_fold(a0,a1,str_in(a2),a3)), 4),
  "policy-query:layer_result": run_lib((a0,a1) => run_loop($policy_query_layer_result(a0,a1)), 2),
  "policy-query:layer": run_lib((a0,a1,a2,a3) => run_loop($policy_query_layer(a0,a1,str_in(a2),a3)), 4),
  "policy-query:layers": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_layers(nat_in(a0),a1,str_in(a2),a3,a4)), 5),
  "policy-query:search_finish": run_lib((a0,a1) => run_loop($policy_query_search_finish(a0,a1)), 2),
  "policy-query:related_budget": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($policy_query_related_budget(a0,a1,str_in(a2),str_in(a3),nat_in(a4),a5)), 6),
  "policy-query:related": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($policy_query_related(a0,str_in(a1),str_in(a2),nat_in(a3),a4,a5)), 6),
  "control:field": run_lib((a0) => run_loop($control_field(a0)), 1),
  "control:schema_name": run_lib((a0) => run_loop($control_schema_name(a0)), 1),
  "control:schema_tail": run_lib((a0) => run_loop($control_schema_tail(a0)), 1),
  "control:schema_path": run_lib((a0) => run_loop($control_schema_path(a0)), 1),
  "control:fields": run_lib((a0) => run_loop($control_fields(a0)), 1),
  "control:schema_visible": run_lib((a0) => run_loop($control_schema_visible(a0)), 1),
  "control:projection_room": run_lib((a0) => run_loop($control_projection_room(a0)), 1),
  "control:projection": run_lib((a0,a1,a2) => run_loop($control_projection(a0,a1,a2)), 3),
  "control:aliases": run_lib((a0,a1) => run_loop($control_aliases(a0,str_in(a1))), 2),
  "control:proposal": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($control_proposal(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4),a5,a6)), 7),
  "control:commit": run_lib((a0,a1,a2,a3,a4) => run_loop($control_commit(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4))), 5),
  "control:declared": run_lib((a0) => run_loop($control_declared(a0)), 1),
  "control:executions": run_lib((a0,a1,a2) => run_loop($control_executions(a0,str_in(a1),a2)), 3),
  "control:plan": run_lib((a0,a1,a2,a3) => run_loop($control_plan(str_in(a0),str_in(a1),a2,a3)), 4),
  "control:visible": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($control_visible(a0,a1,a2,str_in(a3),str_in(a4),str_in(a5),a6,a7)), 8),
  "control:namespace": run_lib((a0) => run_loop($control_namespace(a0)), 1),
  "control:revoke": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($control_revoke(a0,str_in(a1),str_in(a2),str_in(a3),str_in(a4),a5)), 6),
  "control:actions": run_lib((a0,a1,a2) => run_loop($control_actions(a0,a1,a2)), 3),
  "control:schema": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($control_schema(str_in(a0),a1,str_in(a2),str_in(a3),a4,str_in(a5))), 6),
  "control:binding_names": run_lib((a0) => run_loop($control_binding_names(a0)), 1),
  "awareness:all_fold": run_lib((a0,a1) => run_loop($awareness_all_fold(a0,a1)), 2),
  "awareness:all": run_lib((a0) => run_loop($awareness_all(a0)), 1),
  "awareness:detail": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($awareness_detail(a0,str_in(a1),a2,a3,a4,a5)), 6),
  "awareness:message_visible": run_lib((a0,a1,a2,a3) => run_loop($awareness_message_visible(a0,str_in(a1),str_in(a2),a3)), 4),
  "awareness:message": run_lib((a0,a1,a2,a3,a4) => run_loop($awareness_message(a0,a1,a2,a3,a4)), 5),
  "awareness:reply": run_lib((a0,a1,a2,a3,a4) => run_loop($awareness_reply(str_in(a0),str_in(a1),str_in(a2),str_in(a3),a4)), 5),
  "awareness:recipient_step": run_lib((a0,a1,a2) => run_loop($awareness_recipient_step(str_in(a0),a1,a2)), 3),
  "awareness:recipient_fold": run_lib((a0,a1,a2) => run_loop($awareness_recipient_fold(a0,str_in(a1),a2)), 3),
  "awareness:recipient_mode": run_lib((a0,a1) => run_loop($awareness_recipient_mode(str_in(a0),str_in(a1))), 2),
  "awareness:recipient_result": run_lib((a0) => run_loop($awareness_recipient_result(a0)), 1),
  "awareness:recipients": run_lib((a0,a1) => run_loop($awareness_recipients(a0,str_in(a1))), 2),
  "awareness:selected": run_lib((a0,a1) => run_loop($awareness_selected(a0,a1)), 2),
  "awareness:message_compare": run_lib((a0,a1,a2,a3) => run_loop($awareness_message_compare(a0,str_in(a1),a2,str_in(a3))), 4),
  "awareness:template": run_lib((a0,a1,a2,a3,a4) => run_loop($awareness_template(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4))), 5),
  "awareness:supported_fold": run_lib((a0,a1,a2,a3) => run_loop($awareness_supported_fold(a0,a1,str_in(a2),a3)), 4),
  "awareness:supported": run_lib((a0,a1,a2) => run_loop($awareness_supported(a0,str_in(a1),a2)), 3),
  "awareness:slots": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($awareness_slots(a0,a1,a2,a3,a4,a5)), 6),
  "awareness:prompt_candidates": run_lib((a0,a1) => run_loop($awareness_prompt_candidates(a0,a1)), 2),
  "awareness:prompt_large": run_lib((a0) => run_loop($awareness_prompt_large(a0)), 1),
  "awareness:prompt_step": run_lib((a0,a1,a2) => run_loop($awareness_prompt_step(a0,a1,a2)), 3),
  "awareness:ref_route": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($awareness_ref_route(a0,a1,a2,a3,a4,a5)), 6),
  "awareness:scan_request": run_lib((a0,a1,a2) => run_loop($awareness_scan_request(a0,a1,a2)), 3),
  "awareness:visibility_start": run_lib((a0,a1) => run_loop($awareness_visibility_start(a0,str_in(a1))), 2),
  "awareness:walk_demand": run_lib((a0,a1,a2) => run_loop($awareness_walk_demand(a0,a1,a2)), 3),
  "awareness:check_demand": run_lib((a0,a1,a2) => run_loop($awareness_check_demand(a0,a1,a2)), 3),
  "awareness:visibility_demand": run_lib((a0) => run_loop($awareness_visibility_demand(a0)), 1),
  "awareness:groups": run_lib((a0,a1) => run_loop($awareness_groups(a0,a1)), 2),
  "awareness:observed_event": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($awareness_observed_event(a0,str_in(a1),a2,a3,a4,str_in(a5))), 6),
  "awareness:walk_event": run_lib((a0,a1,a2,a3,a4) => run_loop($awareness_walk_event(a0,a1,a2,a3,str_in(a4))), 5),
  "awareness:visibility_event": run_lib((a0,a1,a2) => run_loop($awareness_visibility_event(a0,a1,str_in(a2))), 3),
  "awareness:checked_ref": run_lib((a0,a1,a2,a3) => run_loop($awareness_checked_ref(a0,a1,a2,a3)), 4),
  "awareness:visibility_ref": run_lib((a0,a1) => run_loop($awareness_visibility_ref(a0,a1)), 2),
  "guidance:components_fold": run_lib((a0,a1,a2) => run_loop($guidance_components_fold(a0,a1,a2)), 3),
  "guidance:components": run_lib((a0,a1) => run_loop($guidance_components(a0,a1)), 2),
  "guidance:path": run_lib((a0,a1,a2,a3) => run_loop($guidance_path(str_in(a0),a1,str_in(a2),a3)), 4),
  "guidance:registration": run_lib((a0,a1,a2,a3) => run_loop($guidance_registration(a0,a1,a2,a3)), 4),
  "guidance:refresh": run_lib((a0,a1) => run_loop($guidance_refresh(a0,a1)), 2),
  "guidance:retained": run_lib((a0,a1,a2,a3,a4) => run_loop($guidance_retained(a0,a1,a2,a3,a4)), 5),
  "guidance:observation_error": run_lib((a0,a1) => run_loop($guidance_observation_error(str_in(a0),a1)), 2),
  "guidance:some_fold": run_lib((a0,a1) => run_loop($guidance_some_fold(a0,a1)), 2),
  "guidance:selected": run_lib((a0,a1,a2,a3) => run_loop($guidance_selected(a0,a1,a2,a3)), 4),
  "guidance:review_size": run_lib((a0) => run_loop($guidance_review_size(a0)), 1),
  "guidance:review_source": run_lib((a0,a1) => run_loop($guidance_review_source(a0,str_in(a1))), 2),
  "guidance:evidence_fold": run_lib((a0,a1) => run_loop($guidance_evidence_fold(a0,a1)), 2),
  "guidance:review_bytes": run_lib((a0) => run_loop($guidance_review_bytes(a0)), 1),
  "guidance:current": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($guidance_current(a0,a1,str_in(a2),str_in(a3),str_in(a4),str_in(a5),str_in(a6))), 7),
  "guidance:basis": run_lib((a0,a1,a2) => run_loop($guidance_basis(a0,str_in(a1),str_in(a2))), 3),
  "guidance:policy": run_lib((a0,a1,a2,a3) => run_loop($guidance_policy(str_in(a0),str_in(a1),str_in(a2),str_in(a3))), 4),
  "guidance:profile": run_lib((a0,a1) => run_loop($guidance_profile(a0,a1)), 2),
  "guidance:profile_available": run_lib((a0,a1,a2) => run_loop($guidance_profile_available(a0,a1,a2)), 3),
  "guidance:grant": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($guidance_grant(str_in(a0),str_in(a1),a2,a3,str_in(a4),a5,str_in(a6),str_in(a7))), 8),
  "guidance:candidate": run_lib((a0,a1,a2) => run_loop($guidance_candidate(a0,a1,a2)), 3),
  "guidance:uncertain": run_lib((a0) => run_loop($guidance_uncertain(a0)), 1),
  "guidance:candidate_compare": run_lib((a0,a1,a2,a3) => run_loop($guidance_candidate_compare(a0,str_in(a1),a2,str_in(a3))), 4),
  "guidance:result": run_lib((a0,a1,a2) => run_loop($guidance_result(str_in(a0),a1,a2)), 3),
  "guidance:quote": run_lib((a0,a1) => run_loop($guidance_quote(a0,a1)), 2),
  "guidance:editorial": run_lib((a0,a1,a2) => run_loop($guidance_editorial(a0,a1,a2)), 3),
  "guidance:capture_room": run_lib((a0) => run_loop($guidance_capture_room(a0)), 1),
  "guidance:settlement": run_lib((a0,a1) => run_loop($guidance_settlement(a0,a1)), 2),
  "execution_step": run_lib((a0,a1) => run_loop($execution_step_1(a0,a1)), 2),
  "execution_terminal": run_lib((a0) => run_loop($execution_terminal_1(a0)), 1),
  "topology_check": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($topology_check_1(a0,a1,a2,a3,a4,a5,a6)), 7),
  "topology_certify": run_lib((a0,a1) => run_loop($topology_certify_1(a0,a1)), 2),
  "resource_add": run_lib((a0,a1) => run_loop($resource_add(a0,a1)), 2),
  "resource_subtract": run_lib((a0,a1) => run_loop($resource_subtract(a0,a1)), 2),
  "resource_le": run_lib((a0,a1) => run_loop($resource_le(a0,a1)), 2),
  "resource_totals": run_lib((a0) => run_loop($resource_totals(a0)), 1),
  "resource_capacity": run_lib((a0,a1,a2) => run_loop($resource_capacity(a0,a1,a2)), 3),
  "resource_usage": run_lib((a0,a1,a2,a3) => run_loop($resource_usage(a0,a1,a2,a3)), 4),
  "resource_envelope": run_lib((a0,a1) => run_loop($resource_envelope(a0,a1)), 2),
  "resource_available": run_lib((a0) => run_loop($resource_available(a0)), 1),
  "truth.not": run_lib((a0) => run_loop($truth_not(a0)), 1),
  "truth.and": run_lib((a0,a1) => run_loop($truth_and(a0,a1)), 2),
  "truth.or": run_lib((a0,a1) => run_loop($truth_or(a0,a1)), 2),
  "truth.all": run_lib((a0) => run_loop($truth_all(a0)), 1),
  "truth.any": run_lib((a0) => run_loop($truth_any(a0)), 1),
  "policy.combine": run_lib((a0,a1) => run_loop($policy_combine(a0,a1)), 2),
  "policy": run_lib((a0,a1) => run_loop($policy(a0,a1)), 2),
  "same_text": run_lib((a0,a1) => run_loop($same_text(str_in(a0),str_in(a1))), 2),
  "same_scope": run_lib((a0,a1,a2,a3) => run_loop($same_scope(str_in(a0),str_in(a1),str_in(a2),str_in(a3))), 4),
  "same_ref": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($same_ref(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4),str_in(a5))), 6),
  "text_contains": run_lib((a0,a1) => run_loop($text_contains(a0,str_in(a1))), 2),
  "text_subset": run_lib((a0,a1) => run_loop($text_subset(a0,a1)), 2),
  "incident_scope": run_lib((a0,a1,a2,a3) => run_loop($incident_scope(a0,a1,a2,a3)), 4),
  "ordered_le": run_lib((a0,a1,a2,a3) => run_loop($ordered_le(a0,a1,a2,a3)), 4),
  "rank_le": run_lib((a0,a1) => run_loop($rank_le(a0,a1)), 2),
  "deadline": run_lib((a0,a1,a2,a3) => run_loop($deadline(a0,a1,a2,a3)), 4),
  "within": run_lib((a0,a1,a2,a3) => run_loop($within(nat_in(a0),nat_in(a1),nat_in(a2),nat_in(a3))), 4),
  "fits": run_lib((a0,a1) => run_loop($fits(a0,a1)), 2),
  "record_edit": run_lib((a0,a1) => run_loop($record_edit(a0,a1)), 2),
  "assertion_edit": run_lib((a0,a1,a2) => run_loop($assertion_edit(a0,a1,a2)), 3),
  "assertion_withdraw": run_lib((a0) => run_loop($assertion_withdraw(a0)), 1),
  "graph_phase": run_lib((a0,a1) => run_loop($graph_phase(a0,a1)), 2),
  "graph_order": run_lib((a0) => run_loop($graph_order(a0)), 1),
  "grant_available": run_lib((a0,a1,a2,a3,a4) => run_loop($grant_available(a0,a1,a2,a3,a4)), 5),
  "grant_link": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10,a11,a12) => run_loop($grant_link(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4),a5,a6,a7,a8,a9,a10,str_in(a11),str_in(a12))), 13),
  "grant_end": run_lib((a0) => run_loop($grant_end(a0)), 1),
  "limits_bound": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($limits_bound(str_in(a0),str_in(a1),a2,a3,a4,a5,a6,a7)), 8),
  "delegation_bound": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10,a11,a12) => run_loop($delegation_bound(a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10,a11,a12)), 13),
  "rule_contains": run_lib((a0,a1) => run_loop($rule_contains(a0,str_in(a1))), 2),
  "denies_preserved": run_lib((a0,a1) => run_loop($denies_preserved(a0,a1)), 2),
  "permit_narrowed": run_lib((a0,a1,a2) => run_loop($permit_narrowed(a0,str_in(a1),a2)), 3),
  "policy_issuers": run_lib((a0,a1) => run_loop($policy_issuers(a0,a1)), 2),
  "permits_bounded": run_lib((a0,a1,a2) => run_loop($permits_bounded(a0,a1,a2)), 3),
  "policy_rules": run_lib((a0,a1,a2) => run_loop($policy_rules(a0,a1,a2)), 3),
  "topology_record": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10) => run_loop($topology_record(str_in(a0),str_in(a1),a2,str_in(a3),str_in(a4),a5,str_in(a6),str_in(a7),str_in(a8),str_in(a9),str_in(a10))), 11),
  "topology_combine": run_lib((a0) => run_loop($topology_combine_1(a0)), 1),
  "scope_allows": run_lib((a0,a1,a2) => run_loop($scope_allows(a0,a1,str_in(a2))), 3),
  "scopes_fold": run_lib((a0,a1,a2,a3) => run_loop($scopes_fold(a0,a1,str_in(a2),a3)), 4),
  "scopes_allow": run_lib((a0,a1,a2) => run_loop($scopes_allow(a0,a1,str_in(a2))), 3),
  "access_operator": run_lib((a0,a1,a2,a3) => run_loop($access_operator(str_in(a0),str_in(a1),str_in(a2),a3)), 4),
  "access_resource": run_lib((a0,a1,a2) => run_loop($access_resource(a0,a1,str_in(a2))), 3),
  "access_incident": run_lib((a0,a1,a2) => run_loop($access_incident(a0,a1,str_in(a2))), 3),
  "method_context": run_lib((a0,a1,a2) => run_loop($method_context(str_in(a0),a1,str_in(a2))), 3),
  "method_delegate": run_lib((a0,a1,a2) => run_loop($method_delegate(str_in(a0),a1,str_in(a2))), 3),
  "access_method": run_lib((a0,a1,a2,a3) => run_loop($access_method(a0,a1,str_in(a2),str_in(a3))), 4),
  "mutation_basis": run_lib((a0,a1,a2,a3) => run_loop($mutation_basis(str_in(a0),str_in(a1),str_in(a2),str_in(a3))), 4),
  "incident_terminal": run_lib((a0) => run_loop($incident_terminal(a0)), 1),
  "incident_revisable": run_lib((a0,a1) => run_loop($incident_revisable(a0,a1)), 2),
  "incident_sources": run_lib((a0) => run_loop($incident_sources(a0)), 1),
  "incident_evidence": run_lib((a0,a1,a2) => run_loop($incident_evidence(a0,a1,a2)), 3),
  "query_match": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8,a9) => run_loop($query_match(str_in(a0),str_in(a1),a2,a3,a4,a5,a6,str_in(a7),a8,a9)), 10),
  "role_connects": run_lib((a0,a1,a2,a3,a4) => run_loop($role_connects(a0,a1,str_in(a2),str_in(a3),a4)), 5),
  "query_related": run_lib((a0,a1,a2,a3,a4) => run_loop($query_related(str_in(a0),a1,a2,str_in(a3),str_in(a4))), 5),
  "fence_equal": run_lib((a0,a1) => run_loop($fence_equal(a0,a1)), 2),
  "fence_next": run_lib((a0) => run_loop($fence_next(a0)), 1),
  "count_minimum": run_lib((a0,a1) => run_loop($count_minimum(a0,a1)), 2),
  "lease_duration": run_lib((a0,a1) => run_loop($lease_duration(a0,a1)), 2),
  "lease_positive": run_lib((a0,a1,a2) => run_loop($lease_positive(a0,a1,a2)), 3),
  "lease_requested": run_lib((a0,a1,a2) => run_loop($lease_requested(a0,a1,a2)), 3),
  "lease_window": run_lib((a0,a1,a2) => run_loop($lease_window(a0,a1,a2)), 3),
  "calendar_bound": run_lib((a0,a1) => run_loop($calendar_bound(a0,a1)), 2),
  "calendar_after": run_lib((a0,a1,a2) => run_loop($calendar_after(a0,a1,a2)), 3),
  "lease_frame": run_lib((a0,a1,a2) => run_loop($lease_frame(a0,str_in(a1),str_in(a2))), 3),
  "lease_expired": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($lease_expired(a0,a1,str_in(a2),str_in(a3),a4,a5,a6,a7)), 8),
  "lease_valid": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($lease_valid(a0,str_in(a1),str_in(a2),str_in(a3),str_in(a4),a5,a6,a7)), 8),
  "retry_admission": run_lib((a0,a1,a2) => run_loop($retry_admission(a0,str_in(a1),str_in(a2))), 3),
  "expiry_fold": run_lib((a0,a1,a2) => run_loop($expiry_fold(a0,a1,a2)), 3),
  "queued_maintenance": run_lib((a0,a1,a2) => run_loop($queued_maintenance(a0,a1,a2)), 3),
  "execution_maintenance": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($execution_maintenance(a0,a1,a2,a3,a4,a5,a6)), 7),
  "marker_present": run_lib((a0) => run_loop($marker_present(a0)), 1),
  "overrun_fold": run_lib((a0,a1) => run_loop($overrun_fold(a0,a1)), 2),
  "resource_blocked": run_lib((a0) => run_loop($resource_blocked(a0)), 1),
  "resource_single_slot": run_lib((a0) => run_loop($resource_single_slot(a0)), 1),
  "execution_queued": run_lib((a0) => run_loop($execution_queued(a0)), 1),
  "execution_waits_deadline": run_lib((a0,a1) => run_loop($execution_waits_deadline(a0,a1)), 2),
  "delay_finish": run_lib((a0,a1) => run_loop($delay_finish(a0,a1)), 2),
  "delay_fold": run_lib((a0,a1,a2) => run_loop($delay_fold(a0,a1,a2)), 3),
  "clock_delay": run_lib((a0,a1) => run_loop($clock_delay(a0,a1)), 2),
  "schedule_room": run_lib((a0) => run_loop($schedule_room(a0)), 1),
  "schedule_visible": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($schedule_visible(a0,a1,a2,a3,str_in(a4),str_in(a5),str_in(a6),a7)), 8),
  "schedule_needs_events": run_lib((a0) => run_loop($schedule_needs_events(a0)), 1),
  "schedule_baseline": run_lib((a0,a1) => run_loop($schedule_baseline(a0,a1)), 2),
  "schedule_wake_admission": run_lib((a0,a1,a2) => run_loop($schedule_wake_admission(a0,a1,str_in(a2))), 3),
  "schedule_scan": run_lib((a0,a1,a2,a3) => run_loop($schedule_scan(a0,str_in(a1),a2,a3)), 4),
  "schedule_mode": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($schedule_mode(a0,a1,a2,a3,a4,a5)), 6),
  "schedule_selection": run_lib((a0,a1,a2,a3) => run_loop($schedule_selection(a0,a1,a2,a3)), 4),
  "schedule_event_gate": run_lib((a0,a1,a2,a3,a4) => run_loop($schedule_event_gate(a0,a1,a2,str_in(a3),a4)), 5),
  "schedule_observation": run_lib((a0,a1,a2) => run_loop($schedule_observation(a0,a1,a2)), 3),
  "schedule_queue": run_lib((a0,a1,a2,a3) => run_loop($schedule_queue(a0,a1,a2,a3)), 4),
  "schedule_order": run_lib((a0,a1) => run_loop($schedule_order(a0,a1)), 2),
  "schedule_advance": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8) => run_loop($schedule_advance(a0,a1,a2,a3,a4,a5,a6,a7,a8)), 9),
  "schedule_capacity_edge": run_lib((a0,a1,a2) => run_loop($schedule_capacity_edge(a0,a1,a2)), 3),
  "schedule_matches": run_lib((a0,a1,a2,a3) => run_loop($schedule_matches(a0,a1,str_in(a2),str_in(a3))), 4),
  "schedule_completed": run_lib((a0) => run_loop($schedule_completed(a0)), 1),
  "schedule_cancellable": run_lib((a0) => run_loop($schedule_cancellable(a0)), 1),
  "schedule_retry_fault": run_lib((a0) => run_loop($schedule_retry_fault(str_in(a0))), 1),
  "schedule_watch": run_lib((a0,a1,a2) => run_loop($schedule_watch(a0,a1,a2)), 3),
  "schedule_ready": run_lib((a0,a1,a2,a3) => run_loop($schedule_ready(a0,a1,a2,a3)), 4),
  "schedule_choose": run_lib((a0,a1,a2,a3) => run_loop($schedule_choose(a0,str_in(a1),a2,a3)), 4),
  "schedule_causality": run_lib((a0) => run_loop($schedule_causality(str_in(a0))), 1),
  "schedule_causal_demand": run_lib((a0) => run_loop($schedule_causal_demand(a0)), 1),
  "schedule_causal_step": run_lib((a0,a1,a2,a3) => run_loop($schedule_causal_step(a0,a1,str_in(a2),str_in(a3))), 4),
  "capability_basis": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($capability_basis_1(a0,a1,a2,a3,a4,a5)), 6),
  "capability_finish": run_lib((a0,a1) => run_loop($capability_finish_1(a0,a1)), 2),
  "capability_compare": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($capability_compare_1(a0,a1,str_in(a2),a3,a4,str_in(a5))), 6),
  "capability_publish": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($capability_publish_1(a0,str_in(a1),a2,a3,a4,a5)), 6),
  "execution_room": run_lib((a0) => run_loop($execution_room(a0)), 1),
  "execution_admission": run_lib((a0,a1,a2,a3,a4) => run_loop($execution_admission(a0,a1,str_in(a2),a3,a4)), 5),
  "execution_deadline": run_lib((a0,a1,a2) => run_loop($execution_deadline(a0,a1,a2)), 3),
  "execution_prepare": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($execution_prepare(a0,a1,a2,str_in(a3),str_in(a4),str_in(a5),str_in(a6),a7)), 8),
  "execution_visible": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10) => run_loop($execution_visible(a0,a1,a2,a3,str_in(a4),str_in(a5),str_in(a6),str_in(a7),a8,a9,a10)), 11),
  "execution_reconcile": run_lib((a0,a1,a2,a3) => run_loop($execution_reconcile(str_in(a0),str_in(a1),a2,a3)), 4),
  "execution_evidence": run_lib((a0,a1) => run_loop($execution_evidence(a0,a1)), 2),
  "capability_selected": run_lib((a0,a1,a2) => run_loop($capability_selected_1(str_in(a0),str_in(a1),a2)), 3),
  "policy_query_initial": run_lib((a0,a1) => run_loop($policy_query_initial_1(a0,a1)), 2),
  "policy_query_available": run_lib((a0) => run_loop($policy_query_available_1(a0)), 1),
  "policy_query_charges": run_lib((a0,a1) => run_loop($policy_query_charges_1(a0,a1)), 2),
  "policy_query_projection": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_projection(a0,str_in(a1),str_in(a2),a3,a4)), 5),
  "policy_query_supported": run_lib((a0,a1) => run_loop($policy_query_supported_1(str_in(a0),a1)), 2),
  "policy_query_selected": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_selected_1(str_in(a0),str_in(a1),a2,a3,a4)), 5),
  "policy_query_observed": run_lib((a0,a1) => run_loop($policy_query_observed_1(a0,a1)), 2),
  "policy_query_plan": run_lib((a0,a1) => run_loop($policy_query_plan_1(a0,a1)), 2),
  "policy_query_related": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($policy_query_related_1(a0,str_in(a1),str_in(a2),nat_in(a3),a4,a5)), 6),
  "policy_query_exists_budget": run_lib((a0,a1,a2,a3,a4) => run_loop($policy_query_exists_budget(a0,a1,a2,a3,a4)), 5),
  "control_projection": run_lib((a0,a1,a2) => run_loop($control_projection_1(a0,a1,a2)), 3),
  "control_proposal": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($control_proposal_1(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4),a5,a6)), 7),
  "control_commit": run_lib((a0,a1,a2,a3,a4) => run_loop($control_commit_1(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4))), 5),
  "control_plan": run_lib((a0,a1,a2,a3) => run_loop($control_plan_1(str_in(a0),str_in(a1),a2,a3)), 4),
  "control_visible": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($control_visible_1(a0,a1,a2,str_in(a3),str_in(a4),str_in(a5),a6,a7)), 8),
  "control_namespace": run_lib((a0) => run_loop($control_namespace_1(a0)), 1),
  "control_revoke": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($control_revoke_1(a0,str_in(a1),str_in(a2),str_in(a3),str_in(a4),a5)), 6),
  "control_actions": run_lib((a0,a1,a2) => run_loop($control_actions_1(a0,a1,a2)), 3),
  "control_schema": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($control_schema_1(str_in(a0),a1,str_in(a2),str_in(a3),a4,str_in(a5))), 6),
  "control_bindings": run_lib((a0) => run_loop($control_bindings(a0)), 1),
  "control_bound": run_lib((a0,a1,a2,a3,a4) => run_loop($control_bound(a0,a1,a2,str_in(a3),str_in(a4))), 5),
  "control_projection_room": run_lib((a0) => run_loop($control_projection_room_1(a0)), 1),
  "reaction_source": run_lib((a0,a1,a2) => run_loop($reaction_source(a0,a1,a2)), 3),
  "reaction_event": run_lib((a0,a1,a2) => run_loop($reaction_event(a0,str_in(a1),a2)), 3),
  "reaction_mode": run_lib((a0,a1,a2) => run_loop($reaction_mode(a0,a1,a2)), 3),
  "reaction_begin": run_lib(() => run_loop($reaction_begin()), 0),
  "reaction_observe": run_lib((a0,a1) => run_loop($reaction_observe(a0,a1)), 2),
  "reaction_finish": run_lib((a0) => run_loop($reaction_finish(a0)), 1),
  "resource_compare": run_lib((a0,a1) => run_loop($resource_compare(a0,a1)), 2),
  "awareness_detail": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($awareness_detail_1(a0,str_in(a1),a2,a3,a4,a5)), 6),
  "awareness_message_visible": run_lib((a0,a1,a2,a3) => run_loop($awareness_message_visible_1(a0,str_in(a1),str_in(a2),a3)), 4),
  "awareness_message": run_lib((a0,a1,a2,a3,a4) => run_loop($awareness_message_1(a0,a1,a2,a3,a4)), 5),
  "awareness_reply": run_lib((a0,a1,a2,a3,a4) => run_loop($awareness_reply_1(str_in(a0),str_in(a1),str_in(a2),str_in(a3),a4)), 5),
  "awareness_recipient_mode": run_lib((a0,a1) => run_loop($awareness_recipient_mode_1(str_in(a0),str_in(a1))), 2),
  "awareness_recipients": run_lib((a0,a1) => run_loop($awareness_recipients_1(a0,str_in(a1))), 2),
  "awareness_selected": run_lib((a0,a1) => run_loop($awareness_selected_1(a0,a1)), 2),
  "awareness_message_compare": run_lib((a0,a1,a2,a3) => run_loop($awareness_message_compare_1(a0,str_in(a1),a2,str_in(a3))), 4),
  "awareness_template": run_lib((a0,a1,a2,a3,a4) => run_loop($awareness_template_1(str_in(a0),str_in(a1),str_in(a2),str_in(a3),str_in(a4))), 5),
  "awareness_supported": run_lib((a0,a1,a2) => run_loop($awareness_supported_1(a0,str_in(a1),a2)), 3),
  "awareness_slots": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($awareness_slots_1(a0,a1,a2,a3,a4,a5)), 6),
  "awareness_prompt_candidates": run_lib((a0,a1) => run_loop($awareness_prompt_candidates_1(a0,a1)), 2),
  "awareness_prompt_step": run_lib((a0,a1,a2) => run_loop($awareness_prompt_step_1(a0,a1,a2)), 3),
  "awareness_ref_route": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($awareness_ref_route_1(a0,a1,a2,a3,a4,a5)), 6),
  "awareness_scan_request": run_lib((a0,a1,a2) => run_loop($awareness_scan_request_1(a0,a1,a2)), 3),
  "visibility_start": run_lib((a0,a1) => run_loop($visibility_start(a0,str_in(a1))), 2),
  "visibility_demand": run_lib((a0) => run_loop($visibility_demand(a0)), 1),
  "visibility_event": run_lib((a0,a1,a2) => run_loop($visibility_event(a0,a1,str_in(a2))), 3),
  "visibility_ref": run_lib((a0,a1) => run_loop($visibility_ref(a0,a1)), 2),
  "guidance_path": run_lib((a0,a1,a2,a3) => run_loop($guidance_path_1(str_in(a0),a1,str_in(a2),a3)), 4),
  "guidance_registration": run_lib((a0,a1,a2,a3) => run_loop($guidance_registration_1(a0,a1,a2,a3)), 4),
  "guidance_refresh": run_lib((a0,a1) => run_loop($guidance_refresh_1(a0,a1)), 2),
  "guidance_retained": run_lib((a0,a1,a2,a3,a4) => run_loop($guidance_retained_1(a0,a1,a2,a3,a4)), 5),
  "guidance_observation_error": run_lib((a0,a1) => run_loop($guidance_observation_error_1(str_in(a0),a1)), 2),
  "guidance_selected": run_lib((a0,a1,a2,a3) => run_loop($guidance_selected_1(a0,a1,a2,a3)), 4),
  "guidance_review_size": run_lib((a0) => run_loop($guidance_review_size_1(a0)), 1),
  "guidance_review_source": run_lib((a0,a1) => run_loop($guidance_review_source_1(a0,str_in(a1))), 2),
  "guidance_review_bytes": run_lib((a0) => run_loop($guidance_review_bytes_1(a0)), 1),
  "guidance_current": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($guidance_current_1(a0,a1,str_in(a2),str_in(a3),str_in(a4),str_in(a5),str_in(a6))), 7),
  "guidance_basis": run_lib((a0,a1,a2) => run_loop($guidance_basis_1(a0,str_in(a1),str_in(a2))), 3),
  "guidance_policy": run_lib((a0,a1,a2,a3) => run_loop($guidance_policy_1(str_in(a0),str_in(a1),str_in(a2),str_in(a3))), 4),
  "guidance_profile": run_lib((a0,a1) => run_loop($guidance_profile_1(a0,a1)), 2),
  "guidance_profile_available": run_lib((a0,a1,a2,a3) => run_loop($guidance_profile_available_1(a0,a1,a2,a3)), 4),
  "guidance_grant": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($guidance_grant_1(str_in(a0),str_in(a1),a2,a3,str_in(a4),a5,str_in(a6),str_in(a7))), 8),
  "guidance_candidate": run_lib((a0,a1,a2) => run_loop($guidance_candidate_1(a0,a1,a2)), 3),
  "guidance_candidate_compare": run_lib((a0,a1,a2,a3) => run_loop($guidance_candidate_compare_1(a0,str_in(a1),a2,str_in(a3))), 4),
  "guidance_result": run_lib((a0,a1,a2) => run_loop($guidance_result_1(str_in(a0),a1,a2)), 3),
  "guidance_quote": run_lib((a0,a1) => run_loop($guidance_quote_1(a0,a1)), 2),
  "guidance_editorial": run_lib((a0,a1,a2) => run_loop($guidance_editorial_1(a0,a1,a2)), 3),
  "guidance_capture_room": run_lib((a0) => run_loop($guidance_capture_room_1(a0)), 1),
  "guidance_settlement": run_lib((a0,a1) => run_loop($guidance_settlement_1(a0,a1)), 2),
};
