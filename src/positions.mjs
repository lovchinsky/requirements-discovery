// Position status is current state. Immutable Decision.selected preserves the
// historical choice even when the corresponding Decision ceases to operate.
export function currentSelections(graph) {
  const selected = new Map();
  for (const decision of graph.nodes.values()) {
    if (decision.kind !== 'decision' || decision.data.status !== 'accepted') continue;
    for (const id of Array.isArray(decision.data.selected) ? decision.data.selected : []) {
      const position = graph.nodes.get(id);
      if (position?.kind === 'position' && Array.isArray(decision.data.resolves) && decision.data.resolves.includes(position.data.issue)) selected.set(id, decision.id);
    }
  }
  return selected;
}

export function reconcilePositions(graph) {
  const selected = currentSelections(graph), changes = [];
  for (const position of graph.nodes.values()) {
    if (position.kind !== 'position') continue;
    const from = position.data.status;
    const to = selected.has(position.id) ? 'accepted' : from === 'accepted' ? 'proposed' : from;
    if (from === to) continue;
    position.data.status = to;
    changes.push({ id: position.id, from, to, ...(selected.has(position.id) ? { selected_by: selected.get(position.id) } : {}) });
  }
  return changes;
}
