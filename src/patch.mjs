import { DiscoveryError, isObject, ID, KINDS, serializeGraph } from './graph.mjs';
import { currentSelections, reconcilePositions } from './positions.mjs';

function keys(object, allowed, name) {
  if (!isObject(object) || Object.keys(object).some(k => !allowed.includes(k))) throw new DiscoveryError('INPUT', `${name} has invalid or unknown fields.`);
}
export function patchCandidate(current, input, timestamp) {
  keys(input, ['meta', 'add', 'update', 'relations'], 'patch');
  const graph = { ...current, meta: { ...current.meta }, nodes: new Map([...current.nodes].map(([id, n]) => [id, structuredClone(n)])), relations: structuredClone(current.relations) };
  if (input.meta !== undefined) {
    keys(input.meta, ['focus', 'title', 'intent', 'scope', 'status'], 'meta');
    Object.assign(graph.meta, input.meta);
  }
  const touched = new Set();
  for (const field of ['add', 'update']) {
    if (input[field] !== undefined && !Array.isArray(input[field])) throw new DiscoveryError('INPUT', `${field} must be an array.`);
    for (const change of input[field] ?? []) {
      keys(change, field === 'add' ? ['id', 'kind', 'text', 'data', 'tags'] : ['id', 'text', 'data', 'unset'], field);
      if (!ID.test(change.id ?? '') || touched.has(change.id)) throw new DiscoveryError('INPUT', 'Each patch ID must be valid and occur only once.');
      touched.add(change.id);
      if (field === 'add') {
        if (graph.nodes.has(change.id) || !Object.hasOwn(KINDS, change.kind) || typeof change.text !== 'string' || !isObject(change.data) || (change.tags !== undefined && (!Array.isArray(change.tags) || change.tags.some(t => typeof t !== 'string')))) throw new DiscoveryError('INPUT', `${change.id}: add expects a new ID, kind, text and metadata object.`);
        graph.nodes.set(change.id, { ...change, tags: change.tags ?? [], format: change.kind === 'argument' ? 'argument' : 'statement' });
      } else {
        const node = graph.nodes.get(change.id);
        if (!node || (change.text !== undefined && typeof change.text !== 'string') || (change.data !== undefined && !isObject(change.data)) || (change.unset !== undefined && (!Array.isArray(change.unset) || change.unset.some(k => typeof k !== 'string')))) throw new DiscoveryError('INPUT', `${change.id}: invalid update.`);
        if (change.text !== undefined) node.text = change.text;
        Object.assign(node.data, change.data ?? {});
        for (const key of change.unset ?? []) delete node.data[key];
      }
    }
  }
  if (input.relations !== undefined) {
    keys(input.relations, ['add'], 'relations');
    if (!Array.isArray(input.relations.add)) throw new DiscoveryError('INPUT', 'relations.add must be an array. Existing reasoning relations are preserved.');
    for (const relation of input.relations.add) {
      keys(relation, ['from', 'to', 'type'], 'relation');
      if (!graph.nodes.has(relation.from) || !graph.nodes.has(relation.to) || !['support', 'attack', 'undercut', 'contradictory'].includes(relation.type)) throw new DiscoveryError('INPUT', 'Relation must reference existing/new nodes and a supported type.');
      if (!graph.relations.some(r => r.from === relation.from && r.to === relation.to && r.type === relation.type)) graph.relations.push(relation);
    }
  }
  for (const n of graph.nodes.values()) if (n.kind === 'issue' && n.data.resolved_by) {
    const history = n.data.resolution_history ?? [];
    if (!Array.isArray(history)) throw new DiscoveryError('INPUT', `${n.id}: resolution_history must be an array.`);
    if (!history.includes(n.data.resolved_by)) n.data.resolution_history = [...history, n.data.resolved_by];
  }
  const selected = currentSelections(graph);
  for (const change of input.update ?? []) {
    const position = graph.nodes.get(change.id);
    if (position.kind !== 'position') continue;
    if (change.unset?.includes('status')) throw new DiscoveryError('INPUT', `${position.id}: Position status cannot be unset; it records the current selection state.`);
    if (change.data?.status === undefined) continue;
    if ((selected.has(position.id) && position.data.status !== 'accepted') || (!selected.has(position.id) && position.data.status === 'accepted')) throw new DiscoveryError('INPUT', `${position.id}: explicit Position status conflicts with the current Decision selection. Change the Decision lifecycle in the same patch or omit Position status for automatic reconciliation.`);
  }
  for (const change of input.add ?? []) if (change.kind === 'position') {
    if (!selected.has(change.id) && change.data.status === 'accepted') throw new DiscoveryError('INPUT', `${change.id}: an explicitly accepted Position needs a current Decision that selects it.`);
    if (selected.has(change.id) && !['proposed', 'accepted'].includes(change.data.status)) throw new DiscoveryError('INPUT', `${change.id}: a newly selected Position cannot be explicitly rejected or withdrawn.`);
  }
  const positionChanges = reconcilePositions(graph);
  graph.meta.revision++; graph.meta.updated_at = timestamp;
  return { graph: serializeGraph(graph), positionChanges };
}
