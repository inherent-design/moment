import { digest, fail } from './json.mjs';

/** Register record declarations together, then apply support commands in order. */
export function applyGraph(snapshot,changes,wrap,{systemId,contextId,revision}) {
  const ordered=[...changes.filter(change=>change.kind==='record.put'),...changes.filter(change=>change.kind!=='record.put')];
  for (const change of ordered) {
    if (change.kind === 'record.put') {
      const existing = snapshot.records.find(record => record.value.id === change.record.id);
      if (existing && existing.digest !== digest(change.record)) fail('IDENTITY_CONFLICT', 'Record identity has different content');
      if (!existing) snapshot.records.push(wrap(change.record));
    } else if (change.kind === 'assertion.put') {
      const value = change.assertion;
      if (value.record.systemId !== systemId || value.record.contextId !== contextId || !snapshot.records.some(record => record.value.id === value.record.id)) fail('NOT_FOUND', 'Assertion requires an existing local record');
      const existing = snapshot.assertions.find(item => item.assertion.value.id === value.id);
      if (existing && existing.assertion.digest !== digest(value)) fail('IDENTITY_CONFLICT', 'Assertion identity has different content');
      if (existing?.status === 'withdrawn') fail('IDENTITY_CONFLICT', 'Withdrawn assertion cannot be restored under the same ID');
      if (!existing) snapshot.assertions.push({ assertion: wrap(value), status: 'asserted' });
    } else if (change.kind === 'assertion.withdraw') {
      const item = snapshot.assertions.find(item => item.assertion.value.id === change.assertionId);
      if (!item) fail('NOT_FOUND', 'Assertion not found');
      if (item.status !== 'withdrawn') { item.status = 'withdrawn'; item.withdrawnAtRevision = revision; }
    } else fail('INVALID_ARGUMENT', 'Unknown graph change');
  }
}
