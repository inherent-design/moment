import { canonical, fail } from './json.mjs';

export const UNKNOWN = 'unknown';
const and = values => values.includes(false) ? false : values.includes(UNKNOWN) ? UNKNOWN : true;
const or = values => values.includes(true) ? true : values.includes(UNKNOWN) ? UNKNOWN : false;
const same = (a, b) => canonical(a) === canonical(b);

/** Evaluates only trusted bindings and admitted query callbacks; never executes code. */
export function evaluate(condition, { bindings, exists = () => UNKNOWN, related = () => UNKNOWN, maxNodes = 256, maxDepth = 16 }) {
  let visited = 0;
  const operand = term => term.kind === 'literal' ? { found: true, value: term.value }
    : Object.hasOwn(bindings, term.name) ? { found: true, value: bindings[term.name] } : { found: false };
  function visit(node, depth) {
    if (++visited > maxNodes || depth > maxDepth) return UNKNOWN;
    switch (node.kind) {
      case 'all': return and(node.terms.map(term => visit(term, depth + 1)));
      case 'any': return or(node.terms.map(term => visit(term, depth + 1)));
      case 'not': { const value = visit(node.term, depth + 1); return value === UNKNOWN ? UNKNOWN : !value; }
      case 'equal':
      case 'lessOrEqual': {
        const left = operand(node.left), right = operand(node.right);
        if (!left.found || !right.found) return UNKNOWN;
        if (node.kind === 'equal') return same(left.value, right.value);
        if (![left.value, right.value].every(value => typeof value === 'number' && Number.isFinite(value))) fail('INVALID_ARGUMENT', 'Numeric comparison requires finite numbers');
        return left.value <= right.value;
      }
      case 'exists': { const value = exists(node.selector); return value === true || value === false ? value : UNKNOWN; }
      case 'related': {
        const from = operand(node.from), to = operand(node.to);
        if (!from.found || !to.found) return UNKNOWN;
        const value = related(from.value, to.value, node.schemaNames, node.maxHops);
        return value === true || value === false ? value : UNKNOWN;
      }
      default: return UNKNOWN;
    }
  }
  return visit(condition, 1);
}

export function evaluatePolicy(policy, action, environment) {
  const applicable = policy.rules.filter(rule => rule.actions.includes(action));
  const decisions = applicable.map(rule => ({ effect: rule.effect, result: evaluate(rule.when, environment) }));
  if (decisions.some(item => item.effect === 'deny' && item.result === true)) return 'deny';
  if (decisions.some(item => item.effect === 'deny' && item.result === UNKNOWN)) return 'indeterminate';
  if (decisions.some(item => item.effect === 'permit' && item.result === true)) return 'permit';
  if (decisions.some(item => item.effect === 'permit' && item.result === UNKNOWN)) return 'indeterminate';
  return 'deny';
}
