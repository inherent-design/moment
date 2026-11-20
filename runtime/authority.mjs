import { fail } from './json.mjs';
import * as core from './semantic-core.mjs';
export const sameRef=(a,b)=>a && b && core.sameReference(a,b);
export function boundLimits(child,parent) {
  const decision=core.limitsBound(child,parent),reason={CurrencyMismatch:'Budget currencies differ',BudgetExceeded:'Requested budget exceeds its envelope',DeadlineExceeded:'Requested deadline exceeds its envelope'}[decision];
  if(reason)fail('FORBIDDEN',reason);
  if(decision!=='Bounded')fail('INTERNAL','Invalid core budget decision');
}
export function attenuates(child,parent) {
  boundLimits(child.limits,parent.limits);
  const decision=core.delegationBound(child,parent),reason={ActionsWidened:'Delegation widens actions',IncidentsWidened:'Delegation widens incidents',ResourcesWidened:'Delegation widens resources',LifetimeWidened:'Delegation widens lifetime',NotDelegable:'Parent grant cannot delegate'}[decision];
  if(reason)fail('FORBIDDEN',reason);
  if(decision!=='Bounded')fail('INTERNAL','Invalid core delegation decision');
}
export function grantChain(snapshot,ref,principalId,now=Date.now()) {
  const chain=[],seen=[];let cursor=ref;
  while (cursor) {
    const stored=snapshot.controlState.grants?.[cursor.id];
    const decision=core.grantLink(snapshot.context,cursor,seen,stored,snapshot.controlState.revokedGrants?.[cursor.id],principalId,now);
    const reason={InvalidChain:'Invalid or excessive grant chain',UnavailableGrant:'Grant is unavailable',WrongPrincipal:'Grant belongs to another principal'}[decision];
    if(reason)fail('FORBIDDEN',reason);
    if(decision!=='GrantLink')fail('INTERNAL','Invalid core grant-chain decision');
    seen.push(cursor.id);
    chain.push(stored.value);cursor=stored.value.parentGrant;
  }
  if (core.grantEnd(seen)==='EmptyChain') fail('FORBIDDEN','A bound grant is required');
  return chain;
}
export function limitedPolicy(candidate,current,grant,defaultIssuers=[]) {
  if (core.policyIssuers(candidate.authorityIssuers ?? defaultIssuers,current.authorityIssuers ?? defaultIssuers)==='IssuersChanged') fail('FORBIDDEN','Delegated activation cannot change authorization issuers');
  boundLimits(candidate.limits,grant.limits);
  boundLimits(candidate.limits,current.limits);
  const decision=core.policyRules(candidate.rules,current.rules,grant.actions),reason={DenyRemoved:'Delegated policy cannot remove a deny',GrantExceeded:'Policy exceeds activation grant',PermitWidened:'Delegated policy cannot introduce a broader permit'}[decision];
  if(reason)fail('FORBIDDEN',reason);
  if(decision!=='PolicyBounded')fail('INTERNAL','Invalid core policy-narrowing decision');
}
