export const executionMethods=['capability.advertise','capability.match','execution.request','execution.get','execution.claim','execution.heartbeat','execution.finish','execution.reconcile','execution.cancel'];

// Trusted installed registration, checked against the kernel dispatch at generation.
export const kernelMethods = ['system.describe', 'context.create', 'context.get', 'context.close', 'control.get', 'schema.publish', 'schema.get', 'incident.create', 'incident.get', 'incident.update', 'graph.transact', 'graph.query', 'policy.publish', 'policy.activate', 'policy.evaluate', 'grant.issue', 'grant.revoke','view.publish','view.read','rule.publish','reaction.evaluate','transition.propose','transition.commit','transition.get'];
kernelMethods.push(...executionMethods);
kernelMethods.push('events.read','schedule.put','schedule.cancel','schedule.get');
kernelMethods.push('messages.send','messages.read','messages.ack','prompt.compose');
Object.freeze(kernelMethods);

export const managedMethods = Object.freeze([]);
export const serviceMethods = Object.freeze(['service.stop']);
export const continuityProfile = Object.freeze(['bindings.discover','workspace.attach','workspace.read','context.create','incident.create','incident.update','graph.query','graph.transact','transition.propose','transition.commit','messages.send','messages.read','messages.ack','events.read','prompt.compose']);
