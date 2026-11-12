import { readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContract } from './schema-compiler.mjs';
import { inputSchemas, defs } from '../runtime/input-schemas.mjs';
import { kernelMethods, managedMethods, serviceMethods } from '../runtime/operations.mjs';
import { canonical, bytesDigest, digest } from '../runtime/json.mjs';
import { instructions } from '../runtime/directives.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const outputPath = join(root, 'runtime/generated/bindings.json');
const source = path => ({ path, digest: bytesDigest(readFileSync(join(root, path))) });
const summaries = {
  'system.describe': 'Inspect protocol, implemented methods and service identity.',
  'context.create': 'Create a governed context with an owner-local bootstrap policy.',
  'context.get': 'Read the selected context and its current revision.',
  'context.close': 'Close a context and stop admission of new work.',
  'incident.create': 'Retain a meaningful purpose, completion criteria and continuation.',
  'incident.get': 'Read one admitted incident at a selected revision.',
  'incident.list': 'List admitted incidents, filtering before pagination.',
  'incident.update': 'Revise purpose, state or continuation with attributable evidence.',
  'graph.query': 'Retrieve selected records with their independent support.',
  'graph.transact': 'Commit records or support changes at one observed revision.',
  'transition.propose': 'Retain a checked proposal without applying its changes.',
  'transition.commit': 'Apply an admitted proposal after checking its current basis.',
  'messages.send': 'Send an attributed summary to an admitted recipient.',
  'messages.read': 'Read the selected principal’s currently accessible messages.',
  'messages.ack': 'Acknowledge receipt; acknowledgment is not task acceptance.',
  'events.read': 'Read admitted events, optionally waiting for relevant changes.',
  'prompt.compose': 'Compose bounded instructions and quoted evidence under current authority.',
  'bindings.discover': 'Discover installed operations, exact schemas and recovery guidance.',
  'workspace.attach': 'Select central work without creating work or granting authority.',
  'workspace.read': 'Retrieve bounded authorized purpose, evidence and continuation.',
  'service.stop': 'Request graceful retirement of the exact current service instance.',
};

export function generateBindings() {
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
  const paths = ['contracts/index.ts', 'package.json', 'pnpm-lock.yaml', 'scripts/schema-compiler.mjs', 'scripts/generate-bindings.mjs'];
  const walk = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'generated') walk(path);
      else if (entry.isFile() && /\.(mjs|mts)$/.test(path)) paths.push(path);
    }
  };
  walk('runtime');
  const sources = [...new Set(paths)].sort().map(source);
  const directive = { id: 'moment.continuity', version: '1', digest: bytesDigest(instructions), source: source('runtime/directives.mjs') };
  const names = new Set();
  const operations = [...methods].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([id, schemas]) => {
    const name = `moment_${id.replaceAll('.', '_')}`;
    if (names.has(name)) throw new Error(`Tool name collision: ${name}`);names.add(name);
    const implemented = registered.has(id), mutation = schemas.input.required?.includes('expectedRevision');
    const mode = id === 'context.create' ? 'bootstrap' : id === 'service.stop' ? 'control' : mutation ? 'write' : 'read';
    const owner=managedMethods.includes(id)?(id==='bindings.discover'?'runtime/bindings.mjs':'runtime/managed.mjs'):serviceMethods.includes(id)?'runtime/server.mjs':'runtime/kernel.mjs';
    const domain={execution:'runtime/executions.mjs',capability:'runtime/executions.mjs',schedule:'runtime/scheduler.mjs',events:'runtime/events.mjs',messages:'runtime/awareness.mjs',prompt:'runtime/awareness.mjs',graph:'runtime/graph.mjs'}[id.split('.')[0]];
    const operationSources=[...new Set(['contracts/index.ts','runtime/operations.mjs','runtime/input-schemas.mjs','runtime/validation.mjs','runtime/directives.mjs',owner,...(domain?[domain]:[])])].sort().map(source);
    // The checked TS shape and the existing admitted refinements both apply.
    // Keep their local-reference namespaces separate in a self-contained document.
    const input = implemented ? { ...schemas.input, allOf: [{ $ref: '#/$defs/admitted' }], $defs: { ...schemas.input.$defs, admitted: inputSchemas[id], ...defs } } : schemas.input;
    const named = (kind, document) => ({ ref: { name: `moment.${id}.${kind}`, version: '1', digest: digest(document) }, document });
    return {
      id, version: '1', availability: implemented ? 'implemented' : 'declared', mode,
      inputSchema: named('input', input), outputSchema: named('output', schemas.output),
      effects: mode === 'control' ? ['service-control'] : mode === 'read' ? ['read-store'] : ['write-store', ...(id === 'execution.request' || id === 'transition.commit' ? ['queue-effect'] : []), ...(id === 'execution.cancel' ? ['request-cancel'] : [])],
      retryIdentity: mode === 'control' ? 'service-instance' : mode === 'bootstrap' ? 'bootstrap-key' : mutation ? 'context-revision-key' : 'none',
      summary: summaries[id] ?? `${id}: ${mode === 'read' ? 'read selected admitted state' : 'apply a governed change'} using the exact typed input.`,
      preconditions: implemented ? ['Authenticate with the selected credential; availability grants no authority.', ...(mutation ? ['Use the observed context revision and retain the same key and input on exact retry.'] : [])] : ['Declared only; no installed handler.'],
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
    console.log('Checked deterministic bindings, schemas and installed handler coverage.');
  } else { writeFileSync(outputPath, bytes);console.log(`Generated ${relative(root, outputPath)}`); }
}
