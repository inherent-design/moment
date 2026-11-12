import { canonical, fail } from './json.mjs';
export const sameRef=(a,b)=>a && b && a.systemId===b.systemId && a.contextId===b.contextId && a.id===b.id;
export const includesRef=(refs,ref)=>refs.some(item=>sameRef(item,ref));
export function boundLimits(child,parent) {
  if (child.currency!==parent.currency) fail('FORBIDDEN','Budget currencies differ');
  for (const key of ['concurrentExecutions','cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits']) if (child[key]>parent[key]) fail('FORBIDDEN','Requested budget exceeds its envelope');
  if (parent.deadline && (!child.deadline || Date.parse(child.deadline)>Date.parse(parent.deadline))) fail('FORBIDDEN','Requested deadline exceeds its envelope');
}
export function attenuates(child,parent) {
  boundLimits(child.limits,parent.limits);
  if (child.actions.some(action=>!parent.actions.includes(action))) fail('FORBIDDEN','Delegation widens actions');
  if (parent.incidentIds!=='all' && (child.incidentIds==='all' || child.incidentIds.some(id=>!parent.incidentIds.includes(id)))) fail('FORBIDDEN','Delegation widens incidents');
  if (child.resourceRefs.some(ref=>!includesRef(parent.resourceRefs,ref))) fail('FORBIDDEN','Delegation widens resources');
  if (parent.expiresAt && (!child.expiresAt || Date.parse(child.expiresAt)>Date.parse(parent.expiresAt))) fail('FORBIDDEN','Delegation widens lifetime');
  if (!parent.delegable) fail('FORBIDDEN','Parent grant cannot delegate');
}
export function grantChain(snapshot,ref,principalId,now=Date.now()) {
  const chain=[],seen=new Set();let cursor=ref;
  while (cursor) {
    if (cursor.systemId!==snapshot.context.systemId || cursor.contextId!==snapshot.context.id || seen.has(cursor.id) || seen.size>=32) fail('FORBIDDEN','Invalid or excessive grant chain');
    seen.add(cursor.id);
    const stored=snapshot.controlState.grants?.[cursor.id];
    if (!stored || snapshot.controlState.revokedGrants?.[cursor.id] || (stored.value.expiresAt && Date.parse(stored.value.expiresAt)<=now)) fail('FORBIDDEN','Grant is unavailable');
    if (!chain.length && stored.value.principalId!==principalId) fail('FORBIDDEN','Grant belongs to another principal');
    chain.push(stored.value);cursor=stored.value.parentGrant;
  }
  if (!chain.length) fail('FORBIDDEN','A bound grant is required');
  return chain;
}
export function limitedPolicy(candidate,current,grant,defaultIssuers=[]) {
  if (canonical([...new Set(candidate.authorityIssuers ?? defaultIssuers)].sort())!==canonical([...new Set(current.authorityIssuers ?? defaultIssuers)].sort())) fail('FORBIDDEN','Delegated activation cannot change authorization issuers');
  boundLimits(candidate.limits,grant.limits);
  boundLimits(candidate.limits,current.limits);
  // Bounded syntactic implication: preserve denies and only narrow existing permits.
  for (const rule of current.rules.filter(rule=>rule.effect==='deny')) if (!candidate.rules.some(other=>canonical(other)===canonical(rule))) fail('FORBIDDEN','Delegated policy cannot remove a deny');
  for (const rule of candidate.rules.filter(rule=>rule.effect==='permit')) {
    if (rule.actions.some(action=>!grant.actions.includes(action))) fail('FORBIDDEN','Policy exceeds activation grant');
    if (!current.rules.some(old=>old.effect==='permit' && canonical(old.when)===canonical(rule.when) && rule.actions.every(action=>old.actions.includes(action)))) fail('FORBIDDEN','Delegated policy cannot introduce a broader permit');
  }
}
