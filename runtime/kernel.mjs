import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { canonical, digest, fail, DomainError, resultError } from './json.mjs';
import { validateInput, compileDocument } from './validation.mjs';
import { evaluatePolicy } from './conditions.mjs';

const methods = ['system.describe', 'context.create', 'context.get', 'context.close', 'control.get', 'schema.publish', 'schema.get', 'incident.create', 'incident.get', 'incident.update', 'graph.transact', 'graph.query'];
const bootstrapActions = [...methods, 'policy.publish', 'policy.activate', 'grant.issue', 'grant.revoke', 'rule.publish', 'reaction.evaluate', 'transition.propose', 'transition.commit', 'transition.get'];
const equal = (a,b) => canonical(a) === canonical(b);
const ok = value => ({ ok: true, value });

/** In-process API. principalId must come from an authenticated transport binding. */
export class Kernel {
  constructor(store, { ownerId, cursorKey }) {
    if (!ownerId || !cursorKey || Buffer.byteLength(cursorKey) < 32) throw new Error('An operator identity and cursor signing key are required');
    this.store = store;
    this.ownerId = ownerId;
    this.cursorKey = cursorKey;
  }
  ref(contextId, id) { return { systemId: this.store.systemId, contextId, id }; }
  stored(contextId, value, revision, principalId) {
    return { value, ref: this.ref(contextId, value.id), digest: digest(value), revision, recordedAt: new Date().toISOString(), recordedBy: principalId };
  }
  local(ref, contextId) {
    if (ref.systemId !== this.store.systemId || ref.contextId !== contextId) fail('NOT_FOUND', 'Reference is not in this context');
  }
  lookup(snapshot, ref) {
    this.local(ref, snapshot.context.id);
    const values = Object.values(snapshot.controlState).flatMap(namespace => namespace && typeof namespace === 'object' ? Object.values(namespace) : []);
    const found = snapshot.records.find(item => item.value.id === ref.id) ?? values.find(item => item?.ref?.id === ref.id);
    if (!found) fail('NOT_FOUND', 'Referenced object not found');
    return found;
  }
  authorize(snapshot, method, principalId, input) {
    // Delegated sessions remain closed until grant-chain admission is implemented.
    if (principalId !== this.ownerId || snapshot.controlState.owners?.principalId !== principalId) fail('FORBIDDEN', 'No admitted context authority');
    const policy = this.lookup(snapshot, snapshot.context.policy).value;
    const decision = evaluatePolicy(policy, method, { bindings: { principalId, incidentId: input.incidentId ?? null, action: method, resourceRefs: [], contextRevision: snapshot.context.revision, now: new Date().toISOString() } });
    if (decision !== 'permit') fail(decision === 'indeterminate' ? 'POLICY_INDETERMINATE' : 'FORBIDDEN', 'Current policy does not admit this operation');
  }
  call(method, input, principalId) {
    try {
      if (!principalId) fail('UNAUTHENTICATED', 'Authenticated principal required');
      if (!methods.includes(method)) fail('INVALID_ARGUMENT', 'Method is not implemented');
      validateInput(method, input);
      if (method === 'system.describe') return ok({ systemId: this.store.systemId, protocolVersion: '0.1', methods: [...methods], implementationVersion: '0.1.0' });
      if (method === 'context.create') return this.create(input, principalId);
      const current = this.store.read(input.contextId);
      this.authorize(current, method, principalId, input);
      const snapshot = input.atRevision === undefined ? current : this.store.read(input.contextId, input.atRevision);
      const mutation = Object.hasOwn(input, 'expectedRevision');
      if (mutation) {
        const receipt = this.store.receipt(principalId, input.contextId, method, input.idempotencyKey, digest(input));
        if (receipt) return ok(receipt.response.kind === 'commit-receipt' ? receipt.commit : receipt.response);
        if (current.context.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Context changed since observation', 'refresh');
        if (current.context.state !== 'open' && method !== 'context.close') fail('FORBIDDEN', 'Context is closed');
      }
      const batch = { mutation: input, principalId, requestDigest: digest(input), changes: [], controlChanges: [], events: [], outbox: [], response: { kind: 'commit-receipt' } };
      const revision = current.context.revision + 1;
      const control = (namespace, key, value) => batch.controlChanges.push({ namespace, key, value });
      switch (method) {
        case 'context.get': return ok(snapshot.context);
        case 'context.close': control('contextMetadata', 'state', 'closed'); break;
        case 'control.get': {
          const item = this.lookup(snapshot, input.ref);
          if (!['policies', 'grants', 'rules', 'capabilities', 'schedules', 'views'].some(namespace => snapshot.controlState[namespace]?.[input.ref.id])) fail('NOT_FOUND', 'Control object not found');
          return ok(item);
        }
        case 'schema.publish': {
          if (input.schema.name.startsWith('moment.')) fail('FORBIDDEN', 'The moment schema namespace is reserved for installed definitions');
          if (digest(input.document) !== input.schema.digest) fail('INVALID_ARGUMENT', 'Schema digest does not match document');
          compileDocument(input.document);
          const key = canonical([input.schema.name, input.schema.version]);
          const old = current.controlState.schemas?.[key];
          if (old && old.value.schema.digest !== input.schema.digest) fail('IDENTITY_CONFLICT', 'Schema version already has different content');
          const value = { schema: input.schema, document: input.document };
          const stored = { value, ref: this.ref(input.contextId, randomUUID()), digest: digest(value), revision, recordedAt: new Date().toISOString(), recordedBy: principalId };
          control('schemas', key, old ?? stored); batch.response = old ?? stored; break;
        }
        case 'schema.get': return ok(this.schema(snapshot, input.schema).value.document);
        case 'incident.create':
          if (input.incident.status !== 'open') fail('INVALID_ARGUMENT', 'An incident must start open');
          if (current.controlState.incidents?.[input.id]) fail('IDENTITY_CONFLICT', 'Incident already exists');
          if (current.records.some(item => item.ref.id === input.id) || Object.values(current.controlState).some(namespace => namespace && typeof namespace === 'object' && Object.values(namespace).some(item => item?.ref?.id === input.id))) fail('IDENTITY_CONFLICT', 'Object identity already used');
          const stored = this.stored(input.contextId, { id: input.id, ...input.incident }, revision, principalId);
          stored.value = { ...input.incident }; stored.digest = digest(stored.value);
          control('incidents', input.id, stored); batch.response = stored; break;
        case 'incident.get': {
          const item = snapshot.controlState.incidents?.[input.incidentId];
          if (!item) fail('NOT_FOUND', 'Incident not found');
          return ok(item);
        }
        case 'incident.update': {
          const item = current.controlState.incidents?.[input.incidentId];
          if (!item) fail('NOT_FOUND', 'Incident not found');
          if (['completed', 'cancelled'].includes(item.value.status) && !['completed', 'cancelled'].includes(input.incident.status)) fail('FORBIDDEN', 'Reopening requires a separately admitted operation');
          if (input.incident.status === 'completed') {
            if (!input.evidence.sources.length) fail('INVALID_ARGUMENT', 'Completion requires attributable evidence');
            for (const ref of input.evidence.sources) this.lookup(current, ref);
          }
          const stored = this.stored(input.contextId, { id: input.incidentId, ...input.incident }, revision, principalId);
          stored.value = { ...input.incident };
          stored.digest = digest(stored.value);
          control('incidents', input.incidentId, stored); batch.response = stored; break;
        }
        case 'graph.transact': this.validateChanges(current, input.changes); batch.changes = input.changes; break;
        case 'graph.query': return ok(this.query(snapshot, input, principalId));
        default: fail('INVALID_ARGUMENT', 'Method is not implemented');
      }
      batch.events.push({ id: randomUUID(), contextId: input.contextId, type: `${method}.committed`, subjectRefs: [], causeIds: [], payload: null });
      const committed = this.store.commit(batch, method);
      if (!committed.ok) return committed;
      return ok(batch.response.kind === 'commit-receipt' ? committed.value : batch.response);
    } catch (error) {
      if (error instanceof DomainError) return resultError(error);
      throw error;
    }
  }
  create(input, principalId) {
    if (principalId !== this.ownerId) fail('FORBIDDEN', 'Context bootstrap requires operator authority');
    if (input.bootstrapProfile !== 'owner-local') fail('INVALID_ARGUMENT', 'Unknown installed bootstrap profile');
    const policyId = randomUUID();
    const policy = { id: policyId, rules: [{ id: 'owner-local', effect: 'permit', actions: bootstrapActions.filter(method => method !== 'context.create'), when: { kind: 'equal', left: { kind: 'binding', name: 'principalId' }, right: { kind: 'literal', value: principalId } } }], limits: input.limits, evidence: { sources: [], method: 'installed-owner-local-profile', artifactDigests: [] } };
    const controlState = { owners: { principalId }, policies: { [policyId]: this.stored(input.id, policy, 1, principalId) } };
    const context = { id: input.id, label: input.label, policy: this.ref(input.id, policyId), limits: input.limits, imports: [] };
    return this.store.create(context, principalId, input.idempotencyKey, digest(input), controlState);
  }
  schema(snapshot, ref) {
    const schema = snapshot.controlState.schemas?.[canonical([ref.name, ref.version])];
    if (!schema || !equal(schema.value.schema, ref)) fail('NOT_FOUND', 'Exact schema reference not found');
    return schema;
  }
  validateChanges(snapshot, changes) {
    const records = changes.filter(change => change.kind === 'record.put').map(change => change.record);
    for (const record of records) {
      if (Object.values(snapshot.controlState).some(namespace => namespace && typeof namespace === 'object' && Object.values(namespace).some(item => item?.ref?.id === record.id))) fail('IDENTITY_CONFLICT', 'Record ID already names a control object');
      const schema = this.schema(snapshot, record.schema);
      if (!compileDocument(schema.value.document)(record.kind === 'atom' ? record.value : record.roles)) fail('INVALID_ARGUMENT', 'Record does not satisfy its admitted schema');
      if (record.kind === 'relation') for (const refs of Object.values(record.roles)) for (const ref of refs) {
        this.local(ref, snapshot.context.id);
        if (!records.some(item => item.id === ref.id)) this.lookup(snapshot, ref);
      }
    }
    for (const change of changes) if (change.kind === 'assertion.put') {
      if (change.assertion.validDuring) fail('INVALID_ARGUMENT', 'Temporal assertion applicability is not implemented');
      for (const ref of change.assertion.evidence.sources) {
        this.local(ref, snapshot.context.id);
        if (!records.some(item => item.id === ref.id)) this.lookup(snapshot, ref);
      }
    }
  }
  query(snapshot, input, principalId) {
    let offset = 0;
    const selection = digest(input.selector);
    if (input.cursor) {
      const parts = input.cursor.split('.');
      if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[1])) fail('INVALID_ARGUMENT', 'Invalid cursor');
      const [encoded, signature] = parts;
      const expected = createHmac('sha256', this.cursorKey).update(encoded).digest('hex');
      if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) fail('INVALID_ARGUMENT', 'Invalid cursor');
      let cursor;
      try { cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString()); } catch { fail('INVALID_ARGUMENT', 'Invalid cursor'); }
      if (cursor.principalId !== principalId || cursor.contextId !== input.contextId || cursor.selection !== selection || (input.atRevision !== undefined && input.atRevision !== cursor.revision)) fail('INVALID_ARGUMENT', 'Cursor does not match query');
      snapshot = this.store.read(input.contextId, cursor.revision); offset = cursor.offset;
    }
    const selected = snapshot.records.filter(item => {
      const s = input.selector;
      if (s.ids && !s.ids.includes(item.value.id)) return false;
      if (s.schemaNames && !s.schemaNames.includes(item.value.schema.name)) return false;
      const support = snapshot.assertions.filter(a => a.assertion.value.record.id === item.value.id);
      if (s.assertionStatus !== 'any' && !support.some(a => a.status === s.assertionStatus)) return false;
      if (s.relatedTo) {
        this.local(s.relatedTo, snapshot.context.id);
        if (!snapshot.records.some(relation => relation.value.kind === 'relation' && Object.entries(relation.value.roles).some(([role, refs]) => (!s.relationRole || role === s.relationRole) && refs.some(ref => ref.id === s.relatedTo.id)) && Object.values(relation.value.roles).flat().some(ref => ref.id === item.value.id))) return false;
      }
      return true;
    });
    const items = selected.slice(offset, offset + input.limit).map(record => ({ record, support: snapshot.assertions.filter(a => a.assertion.value.record.id === record.value.id) }));
    const page = { items, snapshotRevision: snapshot.context.revision };
    if (offset + input.limit < selected.length) {
      const encoded = Buffer.from(canonical({ principalId, contextId: input.contextId, revision: snapshot.context.revision, selection, offset: offset + input.limit })).toString('base64url');
      page.nextCursor = `${encoded}.${createHmac('sha256', this.cursorKey).update(encoded).digest('hex')}`;
    }
    return page;
  }
}
