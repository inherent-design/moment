import { readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContract, pruneSchema } from './schema-compiler.mjs';
import { inputSchemas, defs } from '../runtime/input-schemas.mjs';
import { kernelMethods, managedMethods, serviceMethods } from '../runtime/operations.mjs';
import { canonical, bytesDigest, digest } from '../runtime/json.mjs';
import { instructions, continuityDirectiveVersion } from '../runtime/directives.mjs';
import { verifySemanticBuild } from '../runtime/semantic-manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const outputPath = join(root, 'runtime/generated/bindings.json');
export const lockCopyPath = join(root, 'runtime/generated/source-lock.yaml');
const source = path => ({ path, digest: bytesDigest(readFileSync(join(root, path))) });
const summaries = {
  'captures.read': 'Read the registered incident capture disposition and selected payload availability under current incident/record authority. Inspect this before relying on legacy paths. Declared sharing/packing/retirement is distinct from current presence and hash verification. Reading neither prunes nor invokes a model; owner-local capture publication/maintenance commands have separate permissions.',
  'system.describe': 'Inspect protocol, implemented methods and service identity.',
  'context.create': 'Create an owner-local governed context when work needs a new policy/resource boundary; preserve existing project conventions.',
  'context.get': 'Read the selected context and its current revision.',
  'context.limits': 'Local operator: revise a context resource ceiling with evidence while preserving usage and reservations. Existing policy and grants remain separately bounded.',
  'context.close': 'Close a context and stop admission of new work.',
  'incident.create': 'Retain purpose and continuation in its actual initial state, including historical or deferred work. Non-open creation requires evidence and current create plus update authority; completed requires accessible source evidence. Admission does not activate a native goal or replay past work.',
  'incident.get': 'Read one admitted incident at a selected revision.',
  'incident.list': 'List admitted incidents, filtering before pagination.',
  'incident.update': 'Revise purpose, state or continuation references with evidence; coordinate updates to a shared continuation with its current writer. Replace superseded checkpoint pointers with the current basis while retaining original scope and historical evidence.',
  'guidance.register': 'Register, revise or withdraw a source association as the local operator. Metadata grants no host access or instruction authority. Canonical content remains with its owner.',
  'guidance.refresh': 'Explicitly capture a registered canonical source through configured read access, retaining whole/selected identities and unavailable states. This write invokes no model.',
  'guidance.review': 'Queue one bounded Luna candidate assessment from ready registered captures for the stated task/location. Requires current execution/profile/grant authority and resource capacity. Native agents retain goal writing, adoption and activation.',
  'guidance.read': 'Read registered candidates, captures or an assessment with current authority, exact quotation ranges, freshness qualifications and explicit omissions. Reading never refreshes sources, invokes a model or adopts instructions. Use location for discovery, then selected IDs/ranges for detail.',
  'graph.query': 'Retrieve selected records with their independent support.',
  'graph.transact': 'Commit schema-valid immutable records or attributable support changes at an observed revision. Changed record content requires a new ID.',
  'transition.propose': 'Retain a checked proposal without applying its changes.',
  'transition.commit': 'Apply an admitted proposal after checking its current basis.',
  'messages.send': 'Persist a durable mailbox summary and detail references for an admitted principal. Prefer native agent communication for brief live coordination; delivery does not wake or create an agent.',
  'messages.read': 'Read the authenticated principal’s accessible durable mailbox. Native agent labels sharing one credential share its mailbox.',
  'messages.ack': 'Acknowledge durable message receipt; acknowledgment does not accept work, activate a goal or grant authority.',
  'events.read': 'Read admitted events, optionally waiting for relevant changes. Event delivery does not dispatch native agents or invoke a model.',
  'prompt.compose': 'Render an existing admitted template with authorized evidence into a bounded prompt. Rendering neither invokes a model nor creates a workflow.',
  'bindings.discover': 'Inspect metadata for a selected operation using operationId. MCP already supplies callable tool schemas; unfiltered discovery returns the full catalog for integration work.',
  'workspace.attach': 'Find existing central work from a project location or explicit selectors. For needs_selection, choose a returned candidate and call workspace.attach again with its contextId and incidentId. An attached result supplies the routing IDs for workspace.read. Attachment creates no work or authority; preserve active goals.',
  'workspace.read': 'Retrieve bounded purpose, evidence and continuation. Build target with only systemId, contextId and optional projectId/incidentId from an attached result; keep principalId, grant and catalog outside target. Complete workspace.attach selection first when only candidates are available. includeMessages is optional and additionally requires messages.read authority. Request selected references instead of whole histories. Explicit details retain caller order, then continuation follows writer order. Whole items fit alongside known omission references; partial results remain recoverable.',
  'service.stop': 'Request graceful retirement of the exact current service instance.',
  'memory.read': 'Read source-attributed session memory, selected working set and processing coverage. Work/guidance bindings are served under current authority with historical/unavailable qualification; they contain references rather than copied source bodies. Reading invokes no checker. Optional metadata/body omissions remain recoverable; latest-session processing is distinct from active retention.',
  'memory.assessments.read': 'Inspect bounded session-local assessment evidence, including incoming source IDs when omitted from the cache. Page summaries, or select an assessment and its exact basis/profile/outcome. Explicit component ranges recover larger evidence with independent digests. Legacy or retired detail stays qualified. Reading invokes no model and does not select focus or change enrollment.',
  'memory.focus': 'At a clear user redirect or canonical goal/handoff change, select or reuse purposeful working memory; preserve a compact return point for the previous purpose. Ordinary asides normally keep current focus. Read memory.read with includeWorkingSets first; bind original redirecting source IDs when intake already targeted the older set. Select, update or release session-local working memory using expectedFocusRevision and an exact retry key. Reuse purposeKey and a compact return point. Optionally bind an existing work target and inspected guidance source/capture selections with exact digests, applicability and material omissions. Binding validates current access/bytes; it proves no inspection, adoption or new authority. A new set starts empty unless explicitly seeded. This changes no enrollment or native goal, invokes no model and cannot retarget a late assessment.',
  'memory.configure': 'Opt this actual native session into or out of automatic memory without project adoption. Requires the local owner credential. Use the subscription revision, independently of cache revision. Configuration invokes no checker; memory.read reports current intake/provider coverage and host-observation state. A reusable trusted host integration is required.',
  'memory.observe': 'Owner-local hook intake: retain exact submitted evidence and queue one bounded checker input. Not a model tool.',
  'memory.rebuild': 'Owner-local bounded reconstruction from explicit source IDs or selected history captures, preserving original session identity and exchange attribution. Not a model tool.',
  'memory.cancel': 'Owner-local cancellation of a selected queued input; possible dispatch remains uncertain until observed.',
  'memory.reconcile': 'Owner-local reconciliation of a retained uncertain checker dispatch using explicit evidence or observed output.',
};

export function generateBindings() {
  const semanticBuild=verifySemanticBuild(root);
  const methods = compileContract(join(root, 'contracts/index.ts'));
  const registered = new Set([...kernelMethods, ...managedMethods, ...serviceMethods]);
  if (registered.size !== kernelMethods.length + managedMethods.length + serviceMethods.length) throw new Error('Duplicate handler registration');
  for (const id of registered) if (!methods.has(id) || !inputSchemas[id]) throw new Error(`Missing contract/refinement for handler ${id}`);
  const kernel = readFileSync(join(root, 'runtime/kernel.mjs'), 'utf8');
  const dispatch = new Set([...kernel.matchAll(/case '([a-z]+\.[a-z]+)'/g)].map(m => m[1]));
  for (const id of ['system.describe', 'context.create']) {
    if (!kernel.includes(`method === '${id}'`)) throw new Error(`Missing bootstrap handler ${id}`);
    dispatch.add(id);
  }
  if (canonical([...dispatch].sort()) !== canonical([...kernelMethods].sort())) throw new Error('Kernel dispatch/registration mismatch');
  const server = readFileSync(join(root,'runtime/server.mjs'),'utf8');
  for (const id of serviceMethods) if (!server.includes(`request.method==='${id}'`)) throw new Error(`Missing service handler ${id}`);
  const adapter = readFileSync(join(root,'runtime/managed.mjs'),'utf8');
  for (const id of managedMethods) if (!adapter.includes(`operation==='${id}'`)) throw new Error(`Missing managed handler ${id}`);
  const paths = ['contracts/index.ts', 'contracts/captures.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'mise.toml', 'tsconfig.json', 'scripts/schema-compiler.mjs', 'scripts/generate-bindings.mjs'];
  const walk = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'generated') walk(path);
      else if (entry.isFile() && /\.(mjs|mts|py)$/.test(path)) paths.push(path);
    }
  };
  walk('runtime');
  paths.push(...semanticBuild.sources.map(source=>source.path),'runtime/generated/semantics.mjs','runtime/generated/semantics.json');
  const sources = [...new Set(paths)].sort().map(source);
  const directive = { id: 'moment.continuity', version: continuityDirectiveVersion, digest: bytesDigest(instructions), source: source('runtime/directives.mjs') };
  const names = new Set();
  const operations = [...methods].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([id, schemas]) => {
    const name = `moment_${id.replaceAll('.', '_')}`;
    if (names.has(name)) throw new Error(`Tool name collision: ${name}`);names.add(name);
    const implemented = registered.has(id), memoryWrite=id.startsWith('memory.') && !id.endsWith('.read'), mutation = schemas.input.required?.includes('expectedRevision');
    const mode = id === 'context.create' ? 'bootstrap' : id === 'service.stop' ? 'control' : mutation || memoryWrite ? 'write' : 'read';
    const owner=managedMethods.includes(id)?(id==='bindings.discover'?'runtime/bindings.mjs':'runtime/managed.mjs'):serviceMethods.includes(id)?'runtime/server.mjs':'runtime/kernel.mjs';
    const domain={execution:'runtime/executions.mjs',capability:'runtime/executions.mjs',schedule:'runtime/scheduler.mjs',events:'runtime/events.mjs',messages:'runtime/awareness.mjs',prompt:'runtime/awareness.mjs',graph:'runtime/graph.mjs',captures:'runtime/captures.mjs',memory:'runtime/session-memory.mjs',guidance:'runtime/guidance.mjs'}[id.split('.')[0]];
    // Installed operations share the source-checked semantic boundary, even
    // when a selected handler only reads metadata from that installed build.
    const semanticSources=implemented?['core/semantics.bend','core/execution.bend','runtime/semantic-core.mjs','runtime/semantic-manifest.mjs','runtime/generated/semantics.mjs','runtime/generated/semantics.json']:[];
    const operationSources=[...new Set(['contracts/index.ts',...(id==='captures.read'?['contracts/captures.ts']:[]),'runtime/operations.mjs','runtime/input-schemas.mjs','runtime/validation.mjs','runtime/directives.mjs',owner,...(domain?[domain]:[]),...semanticSources])].sort().map(source);
    // The checked TS shape and the existing admitted refinements both apply.
    // Keep their local-reference namespaces separate in a self-contained document.
    const input = pruneSchema(implemented ? { ...schemas.input, type: 'object', allOf: [{ $ref: '#/$defs/admitted' }], $defs: { ...schemas.input.$defs, admitted: inputSchemas[id], ...defs } } : schemas.input);
    const named = (kind, document) => ({ ref: { name: `moment.${id}.${kind}`, version: '1', digest: digest(document) }, document });
    return {
      id, version: '1', availability: implemented ? 'implemented' : 'declared', mode,
      inputSchema: named('input', input), outputSchema: named('output', schemas.output),
      effects: mode === 'control' ? ['service-control'] : mode === 'read' ? ['read-store'] : ['write-store', ...(id==='guidance.refresh'?['read-host-source']:[]), ...(['execution.request','transition.commit','memory.observe','memory.rebuild','guidance.review','execution.reconcile'].includes(id) ? ['queue-effect'] : []), ...(['execution.cancel','memory.cancel'].includes(id) ? ['request-cancel'] : [])],
      retryIdentity: mode === 'control' ? 'service-instance' : mode === 'bootstrap' ? 'bootstrap-key' : ['memory.configure','memory.focus'].includes(id)?'session-revision-key':['memory.observe','memory.rebuild'].includes(id) ? 'session-delivery-key' : mutation ? 'context-revision-key' : 'none',
      summary: summaries[id] ?? `${id}: ${mode === 'read' ? 'read selected admitted state' : 'apply a governed change'} using the exact typed input.`,
      preconditions: implemented ? ['Authenticate with the selected credential; availability grants no authority.', ...(id.startsWith('memory.') ? ['Owner-local session memory; native session IDs grant no access. Retain original source attribution and pending coverage.'] : []), ...(id==='memory.focus'?['Use the observed expectedFocusRevision, independently of subscription, set and cache-content revisions. Preserve exact uncertain requests; replay returns the original receipt without restoring old focus.']:id==='memory.configure'?['Use the observed subscription revision and retain the exact session, key and input on retry. Session locators grant no authority.']:['memory.observe','memory.rebuild'].includes(id) ? ['Retain the exact delivery identity and input on retry; identical text in a distinct submission remains distinct evidence.'] : mutation ? ['Use the observed context revision and retain the same key and input on exact retry.'] : [])] : ['Declared only; no installed handler.'],
      directives: [directive], sources:operationSources,
      // Internal projection data is stripped from public OperationBinding records.
      mcpName: name, envelopeSchema: { ...schemas.envelope, properties: { ...schemas.envelope.properties, operation: { const: id } } },
    };
  });
  const identity = { formatVersion: 1, implementationVersion: JSON.parse(readFileSync(join(root, 'package.json'))).version, sourceDigest: digest(sources), contractDigest: source('contracts/index.ts').digest };
  const content = { identity, instructions, sources, operations, surfaceSchemas: methods.surfaces };
  return { ...content, identity: { ...identity, digest: digest(content) } };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = canonical(generateBindings()) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(outputPath, 'utf8') !== bytes) throw new Error('Bindings are stale; run pnpm generate:bindings');
    if (!readFileSync(lockCopyPath).equals(readFileSync(join(root,'pnpm-lock.yaml')))) throw new Error('Distribution lock copy is stale; run pnpm generate:bindings');
    console.log('Checked deterministic bindings, schemas and installed handler coverage.');
  } else { writeFileSync(lockCopyPath,readFileSync(join(root,'pnpm-lock.yaml')));writeFileSync(outputPath, bytes);console.log(`Generated ${relative(root, outputPath)} and distribution lock copy`); }
}
