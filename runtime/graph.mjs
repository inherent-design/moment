import { digest, fail } from './json.mjs';
import * as core from './semantic-core.mjs';

/** Register record declarations together, then apply support commands in order. */
export function applyGraph(snapshot,changes,wrap,{systemId,contextId,revision}) {
  for (const change of core.graphOrder(changes)) {
    if (change.kind === 'record.put') {
      const existing = snapshot.records.find(record => record.value.id === change.record.id);
      const decision=core.recordEdit(!!existing,existing?core.sameText(existing.digest,digest(change.record)):false);
      if (decision==='Conflict') fail('IDENTITY_CONFLICT', 'Record identity has different content');
      if (decision==='Insert') snapshot.records.push(wrap(change.record));
    } else if (change.kind === 'assertion.put') {
      const value = change.assertion;
      const local=core.sameScope(value.record,{systemId,contextId})&&snapshot.records.some(record => record.value.id === value.record.id);
      const existing = snapshot.assertions.find(item => item.assertion.value.id === value.id);
      const decision=core.assertionEdit(local,existing?core.sameText(existing.assertion.digest,digest(value)):false,existing?.status??'absent');
      if(decision==='Missing')fail('NOT_FOUND','Assertion requires an existing local record');
      if(decision==='Conflict')fail('IDENTITY_CONFLICT',existing?.status==='withdrawn'?'Withdrawn assertion cannot be restored under the same ID':'Assertion identity has different content');
      if(decision==='Insert')snapshot.assertions.push({assertion:wrap(value),status:'asserted'});
    } else if (change.kind === 'assertion.withdraw') {
      const item = snapshot.assertions.find(item => item.assertion.value.id === change.assertionId);
      const decision=core.withdrawEdit(item?.status??'absent');
      if (decision==='Missing') fail('NOT_FOUND', 'Assertion not found');
      if (decision==='Withdraw') { item.status = 'withdrawn'; item.withdrawnAtRevision = revision; }
    } else fail('INVALID_ARGUMENT', 'Unknown graph change');
  }
}
