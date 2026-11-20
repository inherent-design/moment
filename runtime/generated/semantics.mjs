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

function $text_contains_fold($0, $1, $2) {
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

function $text_contains(_values_0, _needle_0) {
  return $text_contains_fold(_values_0, _needle_0, false);
}

function $text_subset(_child_0, _parent_0) {
  if (_child_0.$ === "Nil") {
    return true;
  } else {
    const _head_0 = _child_0["head"];
    const _tail_0 = _child_0["tail"];
    return $Bool_and($$text_contains(_parent_0, _head_0), $$text_subset(_tail_0, _parent_0));
  }
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

function $Nat_is_le(_a_0, _b_0) {
  return $Cmp_is_le(cmp_new(_a_0, _b_0));
}

function $List_filter_put(_h_0, _r_0, _keep_0) {
  if (!_keep_0) {
    return _r_0;
  } else {
    return {$: "Con", "head": _h_0, "tail": _r_0};
  }
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

function $List_length(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return 0;
  } else {
    const _t_0 = _xs_0["tail"];
    return nat_chk($$List_length(_t_0) + 1);
  }
}

function $List_is_empty(_xs_0) {
  if (_xs_0.$ === "Nil") {
    return true;
  } else {
    return false;
  }
}

function $Cmp_is_eq(_c_0) {
  if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

function $String_order(_a_0, _b_0) {
  return $String_order_go(_a_0, _b_0, {$: "EQ"});
}

function $Cmp_is_le(_c_0) {
  if (_c_0.$ === "GT") {
    return false;
  } else {
    return true;
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
const $$truth_all = $truth_all;
const $$truth_any = $truth_any;
const $$String_eq = $String_eq;
const $$same_scope = $same_scope;
const $$text_contains = $text_contains;
const $$text_subset = $text_subset;
const $$rank_le = $rank_le;
const $$Nat_is_le = $Nat_is_le;
const $$fits = $fits;
const $$graph_phase = $graph_phase;
const $$List_length = $List_length;
const $$grant_available = $grant_available;
const $$List_is_empty = $List_is_empty;
const $$deadline = $deadline;
const $$incident_scope = $incident_scope;
const $$rule_contains = $rule_contains;
const $$denies_preserved = $denies_preserved;
const $$permit_narrowed = $permit_narrowed;
const $$permits_bounded = $permits_bounded;
const $$String_order = $String_order;
const $$List_append = $List_append;export default {
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
  "execution_step": run_lib((a0,a1) => run_loop($execution_step_1(a0,a1)), 2),
  "execution_terminal": run_lib((a0) => run_loop($execution_terminal_1(a0)), 1),
  "topology_check": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($topology_check_1(a0,a1,a2,a3,a4,a5,a6)), 7),
  "topology_certify": run_lib((a0,a1) => run_loop($topology_certify_1(a0,a1)), 2),
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
  "text_contains.fold": run_lib((a0,a1,a2) => run_loop($text_contains_fold(a0,str_in(a1),a2)), 3),
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
};
