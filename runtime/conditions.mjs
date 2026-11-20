import * as core from './semantic-core.mjs';

export const UNKNOWN = 'unknown';

/** Evaluates only trusted bindings and admitted query callbacks; never executes code. */
export function evaluate(condition, { bindings, exists = () => UNKNOWN, related = () => UNKNOWN, maxNodes = 256, maxDepth = 16 }) {
  let visited = 0;
  const operand = term => term.kind === 'literal' ? { found: true, value: term.value }
    : Object.hasOwn(bindings, term.name) ? { found: true, value: bindings[term.name] } : { found: false };
  function visit(node, depth) {
    if (!core.within(++visited,depth,maxNodes,maxDepth)) return UNKNOWN;
    switch (node.kind) {
      case 'all': return core.all(node.terms.map(term => visit(term, depth + 1)));
      case 'any': return core.any(node.terms.map(term => visit(term, depth + 1)));
      case 'not': return core.not(visit(node.term, depth + 1));
      case 'equal':
      case 'lessOrEqual': {
        const left = operand(node.left), right = operand(node.right);
        if (!left.found || !right.found) return UNKNOWN;
        if (node.kind === 'equal') return core.sameValue(left.value, right.value);
        return core.lessOrEqual(left.value,right.value);
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
  const applicable = policy.rules.filter(rule => core.textSubset([action],rule.actions));
  const decisions = applicable.map(rule => ({ effect: rule.effect, result: evaluate(rule.when, environment) }));
  return core.policyDecision(decisions);
}
