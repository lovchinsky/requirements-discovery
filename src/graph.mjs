import { createHash } from 'node:crypto';
import { ArgdownApplication, ParserPlugin, DataPlugin, ModelPlugin } from '@argdown/core';
import { currentSelections } from './positions.mjs';
import { DiscoveryError, MAX_GRAPH_BYTES, MAX_HEADER_BYTES } from './errors.mjs';
export { DiscoveryError, MAX_GRAPH_BYTES } from './errors.mjs';

export const SCHEMA = 2;
export const STATES = ['active', 'paused', 'handed-off'];
export const KINDS = {
  issue: ['open', 'deferred', 'resolved', 'dropped'],
  position: ['proposed', 'accepted', 'rejected', 'withdrawn'],
  argument: ['active', 'retired'],
  evidence: ['tentative', 'verified', 'contested', 'stale', 'superseded'],
  constraint: ['proposed', 'agreed', 'verified', 'challenged', 'superseded'],
  assumption: ['unverified', 'validated', 'invalidated'],
  decision: ['accepted', 'challenged', 'superseded', 'withdrawn'],
  review: ['confirmed', 'challenged'],
  consequence: ['current', 'challenged', 'superseded']
};
// What each status means for the current state: a settled commitment or answer, a
// point that is still unsettled, or a retired record that only history retains.
export const LIFECYCLE = {
  issue: { open: 'unsettled', deferred: 'unsettled', resolved: 'settled', dropped: 'retired' },
  position: { proposed: 'unsettled', accepted: 'settled', rejected: 'retired', withdrawn: 'retired' },
  argument: { active: 'settled', retired: 'retired' },
  evidence: { tentative: 'unsettled', verified: 'settled', contested: 'unsettled', stale: 'retired', superseded: 'retired' },
  constraint: { proposed: 'unsettled', agreed: 'settled', verified: 'settled', challenged: 'unsettled', superseded: 'retired' },
  assumption: { unverified: 'unsettled', validated: 'settled', invalidated: 'retired' },
  decision: { accepted: 'settled', challenged: 'unsettled', superseded: 'retired', withdrawn: 'retired' },
  review: { confirmed: 'settled', challenged: 'unsettled' },
  consequence: { current: 'settled', challenged: 'unsettled', superseded: 'retired' },
};
export const lifecycle = n => LIFECYCLE[n?.kind]?.[n?.data.status];
export const ID = /^[A-Z][A-Z0-9]*-[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const ids = x => Array.isArray(x) ? x : [];
export const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(sortObject(value));
// Argdown's lexer is not JSON-aware: inside a string, `}` followed by whitespace ends
// a metadata block and `===` ends the frontmatter. Unicode escapes keep both inside
// their JSON strings without changing the parsed value.
export const argdownJson = (value, space) => JSON.stringify(value, null, space).replace(/"(?:[^"\\]|\\.)*"/g,
  string => string.replaceAll('}', '\\u007d').replace(/={3,}/g, run => '\\u003d'.repeat(run.length)));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortObject(value[k])]));
  return value;
}
const parser = new ArgdownApplication({ setLevel() {}, log() {} });
parser.addPlugin(new ParserPlugin(), 'parse');
parser.addPlugin(new DataPlugin({ frontMatterSettingsMode: 'ignore' }), 'model');
parser.addPlugin(new ModelPlugin({ mode: 'loose', removeTagsFromText: true }), 'model');

// The official parser supplies syntax, metadata and native relations.
export function readArgdown(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_GRAPH_BYTES) throw new DiscoveryError('SIZE', 'Reasoning graph exceeds the 2 MiB limit.');
  let response;
  try {
    response = parser.run({ input: text.replaceAll('\r\n', '\n'), process: ['parse', 'model'], throwExceptions: true, logLevel: 'silent' });
  } catch (error) {
    throw new DiscoveryError('ARGDOWN', 'Argdown or its YAML metadata could not be parsed.', [String(error.message).slice(0, 600)]);
  }
  const syntax = [...(response.lexerErrors ?? []), ...(response.parserErrors ?? [])];
  if (syntax.length) throw new DiscoveryError('ARGDOWN', 'Invalid Argdown syntax.', syntax.slice(0, 8).map(e => String(e.message).slice(0, 500)));
  return response;
}
export function modelNodes(response) {
  const nodes = new Map(), errors = [];
  for (const [format, collection] of [['statement', response.statements], ['argument', response.arguments]]) {
    for (const [id, entry] of Object.entries(collection ?? {})) {
      const definitions = entry.members.filter(m => !m.isReference && nonempty(m.text));
      if (!ID.test(id)) errors.push(`${id}: use a stable ID such as I-001 or D-006.`);
      if (nodes.has(id)) errors.push(`${id}: statement and argument IDs must be globally unique.`);
      if (definitions.length !== 1) errors.push(`${id}: define the node exactly once; use references elsewhere.`);
      if (entry.members.some(m => m.isReference && m.data !== undefined)) errors.push(`${id}: metadata belongs on the definition.`);
      if (format === 'argument' && entry.pcs?.length) errors.push(`${id}: this profile uses argument descriptions, not reconstructed PCS.`);
      if (!isObject(entry.data)) errors.push(`${id}: add a YAML/JSON metadata object.`);
      nodes.set(id, { id, format, text: definitions[0]?.text?.trim() ?? '', tags: entry.tags ?? [], data: isObject(entry.data) ? entry.data : {} });
    }
  }
  if (errors.length) throw new DiscoveryError('SCHEMA', 'Invalid node definitions.', errors);
  return nodes;
}
export const modelRelations = response => (response.relations ?? []).map(r => ({ from: r.from?.title, to: r.to?.title, type: r.relationType }));

export function parseGraph(text, { allowPositionMismatch = false } = {}) {
  const response = readArgdown(text), nodes = modelNodes(response), errors = [];
  for (const n of nodes.values()) {
    const kinds = n.tags.filter(tag => Object.hasOwn(KINDS, tag));
    if (kinds.length !== 1) errors.push(`${n.id}: add exactly one semantic discovery tag.`);
    n.kind = kinds[0];
    if ((n.format === 'argument') !== (n.kind === 'argument')) errors.push(`${n.id}: only #argument uses angle brackets.`);
  }
  const graph = { text, hash: sha256(text), frontMatter: response.frontMatter, meta: response.frontMatter?.discovery ?? {}, nodes, relations: modelRelations(response) };
  errors.push(...validateGraph(graph, { allowPositionMismatch }));
  if (errors.length) throw new DiscoveryError('SCHEMA', 'The discovery graph is inconsistent.', errors);
  return graph;
}

// Functional links (parent, successor) are validated in linear time, without recursion.
function linkCycles(nodes, field) {
  const done = new Set(), cycles = [];
  for (const start of nodes.keys()) {
    if (done.has(start)) continue;
    const trail = new Set(); let cursor = start;
    while (nodes.has(cursor) && !done.has(cursor)) {
      if (trail.has(cursor)) { cycles.push(`${cursor}: ${field} creates a cycle.`); break; }
      trail.add(cursor); cursor = nodes.get(cursor).data[field];
    }
    for (const id of trail) done.add(id);
  }
  return cycles;
}
export function validateGraph(graph, { allowPositionMismatch = false } = {}) {
  const { meta: m, nodes } = graph, errors = [];
  const complain = (id, msg) => errors.push(`${id}: ${msg}`);
  if (m.schema !== SCHEMA) errors.push('Unsupported discovery.schema; expected 2. Preserve unsupported formats; do not guess their meaning.');
  const header = /^(?:\uFEFF)?===[ \t]*\r?\n[\s\S]*?\r?\n===[ \t]*(?:\r?\n|$)/.exec(graph.text);
  if (!header) errors.push('Put === frontmatter delimiters on separate lines at the beginning.');
  else if (Buffer.byteLength(header[0]) > MAX_HEADER_BYTES) errors.push('Frontmatter exceeds 64 KiB; keep durable assertions in nodes.');
  if (!/^RD-[A-Za-z0-9_-]+$/.test(m.id ?? '')) errors.push('discovery.id must be a stable RD- identifier.');
  if (!STATES.includes(m.status)) errors.push('discovery.status must be active, paused or handed-off.');
  for (const field of ['title', 'intent', 'created_at', 'updated_at']) if (!nonempty(m[field])) errors.push(`discovery.${field} must be a nonempty string.`);
  if (!Number.isSafeInteger(m.revision) || m.revision < 1) errors.push('discovery.revision must be a positive integer.');
  if (nodes.get(m.root)?.kind !== 'issue') errors.push('discovery.root must reference an issue.');
  if (m.focus !== null && nodes.get(m.focus)?.kind !== 'issue') errors.push('discovery.focus must reference an issue, or be null.');
  if (m.scope !== undefined && (!Array.isArray(m.scope) || m.scope.some(x => !nonempty(x)))) errors.push('discovery.scope must be a string array.');
  const ref = (id, field, target, kind) => {
    if (typeof target !== 'string' || !nodes.has(target)) complain(id, `${field} references a missing node ${String(target)}.`);
    else if (kind && nodes.get(target).kind !== kind) complain(id, `${field} must reference a ${kind}.`);
  };
  const refs = (id, field, values, kind, required = false) => {
    if (!Array.isArray(values) || values.some(x => typeof x !== 'string') || (required && !values.length)) complain(id, `${field} must be ${required ? 'a nonempty' : 'an'} ID array.`);
    else {
      if (new Set(values).size !== values.length) complain(id, `${field} contains duplicate IDs.`);
      values.forEach(x => ref(id, field, x, kind));
    }
  };
  const accepted = new Map();
  for (const n of nodes.values()) {
    const d = n.data;
    if (!KINDS[n.kind]?.includes(d.status)) complain(n.id, `invalid ${n.kind} status ${String(d.status)}.`);
    if (d.blocking !== undefined && typeof d.blocking !== 'boolean') complain(n.id, 'blocking must be boolean.');
    if (d.blocking === false && n.id !== m.root && ['issue', 'assumption'].includes(n.kind) && !nonempty(d.nonblocking_reason)) complain(n.id, 'record nonblocking_reason for a nonblocking unresolved point.');
    for (const field of ['depends_on', 'alternatives', 'challenged_by', 'related']) if (d[field] !== undefined) refs(n.id, field, d[field]);
    if (d.based_on !== undefined || ['decision', 'review'].includes(n.kind)) refs(n.id, 'based_on', d.based_on);
    if (d.reaffirmed_by !== undefined) refs(n.id, 'reaffirmed_by', d.reaffirmed_by, 'review');
    if (d.derives_from !== undefined) ref(n.id, 'derives_from', d.derives_from, 'decision');
    if (d.issue !== undefined) ref(n.id, 'issue', d.issue, 'issue');
    if (d.sources !== undefined) {
      if (!Array.isArray(d.sources)) complain(n.id, 'sources must be an array.');
      else for (const s of d.sources) {
        if (!isObject(s) || !['code', 'spec', 'doc', 'research', 'user'].includes(s.kind) || !nonempty(s.ref) || !['normative', 'observed', 'reference', 'intent'].includes(s.authority)) complain(n.id, 'each source needs kind, ref and authority (normative/observed/reference/intent).');
        if (s?.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(s.sha256)) complain(n.id, 'source sha256 must contain 64 lowercase hexadecimal characters.');
      }
    }
    if (n.kind === 'issue') {
      if (n.id === m.root) { if (d.parent !== undefined && d.parent !== null) complain(n.id, 'the root must not have a parent.'); }
      else ref(n.id, 'parent', d.parent, 'issue');
      if (d.status === 'dropped' && !nonempty(d.reason)) complain(n.id, 'a dropped issue needs a reason.');
      if (d.resolution_history !== undefined) refs(n.id, 'resolution_history', d.resolution_history);
      if (d.status === 'resolved') {
        ref(n.id, 'resolved_by', d.resolved_by);
        const resolver = nodes.get(d.resolved_by);
        if (!['decision', 'evidence', 'constraint'].includes(resolver?.kind)) complain(n.id, 'resolved_by must reference a decision, verified evidence or a verified constraint.');
        if (resolver?.kind === 'decision' && (resolver.data.status !== 'accepted' || !ids(resolver.data.resolves).includes(n.id))) complain(n.id, 'the resolving decision must be accepted and include this issue.');
        if (resolver && resolver.kind !== 'decision' && resolver.data.status !== 'verified') complain(n.id, 'a factual resolver must be verified with source provenance.');
        if (!Array.isArray(d.resolution_history) || !d.resolution_history.includes(d.resolved_by)) complain(n.id, 'preserve the resolver in resolution_history.');
      } else if (d.resolved_by !== undefined && d.resolved_by !== null) complain(n.id, 'clear resolved_by when reopening or dropping an issue; preserve resolution_history.');
    }
    if (['position', 'argument'].includes(n.kind)) ref(n.id, 'issue', d.issue, 'issue');
    if (['evidence', 'constraint'].includes(n.kind) && d.status === 'verified' && !d.sources?.length) complain(n.id, 'verified findings need source provenance.');
    if (n.kind === 'consequence') ref(n.id, 'derives_from', d.derives_from, 'decision');
    if (n.kind === 'assumption' && !nonempty(d.validation)) complain(n.id, 'an assumption needs a way to validate it.');
    if (d.handoff !== undefined && !['existing', 'target', 'change', 'invariant', 'edge', 'scope', 'omit'].includes(d.handoff)) complain(n.id, 'unknown handoff category.');
    if (d.superseded_by !== undefined) {
      ref(n.id, 'superseded_by', d.superseded_by, n.kind);
      if (n.id === d.superseded_by) complain(n.id, 'a node cannot supersede itself.');
    }
    if (d.supersedes !== undefined) {
      ref(n.id, 'supersedes', d.supersedes, n.kind);
      if (nodes.get(d.supersedes)?.data.superseded_by !== n.id) complain(n.id, 'supersedes must match the original node\'s superseded_by.');
    }
    if (n.kind === 'review') {
      ref(n.id, 'decision', d.decision, 'decision');
      if (!nonempty(d.rationale)) complain(n.id, 'a review needs substantive rationale and the complete current basis.');
    }
    if (n.kind === 'decision') {
      refs(n.id, 'resolves', d.resolves, 'issue', true);
      if (!['user', 'authority'].includes(d.basis)) complain(n.id, 'decisions need basis user or authority. Factual answers use issue.resolved_by.');
      if (!nonempty(d.rationale)) complain(n.id, 'a decision needs substantive rationale.');
      if (d.basis === 'user' && !(Array.isArray(d.sources) && d.sources.some(s => s?.kind === 'user' && s?.authority === 'intent'))) complain(n.id, 'a user judgment needs a user/intent source.');
      if (d.basis === 'authority' && !(Array.isArray(d.sources) && d.sources.some(s => s?.authority === 'normative'))) complain(n.id, 'an authority judgment needs a normative source.');
      if (d.selected !== undefined) refs(n.id, 'selected', d.selected, 'position');
      for (const id of Array.isArray(d.selected) ? d.selected : []) {
        const position = nodes.get(id);
        if (!Array.isArray(d.resolves) || !d.resolves.includes(position?.data.issue)) complain(n.id, 'selected position belongs to an unrelated issue.');
        if (!allowPositionMismatch && d.status === 'accepted' && position?.data.status !== 'accepted') complain(n.id, 'an accepted decision must select accepted positions.');
      }
      for (const id of Array.isArray(d.alternatives) ? d.alternatives : []) {
        if (nodes.get(id)?.kind !== 'position' || !ids(d.resolves).includes(nodes.get(id)?.data.issue)) complain(n.id, 'alternatives must be positions from resolved issues.');
        if (ids(d.selected).includes(id)) complain(n.id, 'a selected position cannot also be an alternative.');
      }
      if (d.status === 'superseded') {
        ref(n.id, 'superseded_by', d.superseded_by, 'decision');
        const successor = nodes.get(d.superseded_by);
        if (Array.isArray(d.resolves) && !d.resolves.every(id => ids(successor?.data.resolves).includes(id))) complain(n.id, 'successor must account for every issue resolved by the original decision.');
      }
      if (d.status === 'challenged' && !(Array.isArray(d.challenged_by) && d.challenged_by.length)) complain(n.id, 'a challenged decision needs a challenge reference.');
      for (const id of Array.isArray(d.reaffirmed_by) ? d.reaffirmed_by : []) if (nodes.get(id)?.data.decision !== n.id) complain(n.id, 'reaffirmed_by must contain reviews of this decision.');
      if (d.status === 'accepted') {
        const latest = ids(d.reaffirmed_by).at(-1);
        if (latest && nodes.get(latest)?.data.status !== 'confirmed') complain(n.id, 'the latest operative review must be confirmed.');
      }
      for (const id of Array.isArray(d.resolves) ? d.resolves : []) {
        const issue = nodes.get(id);
        if (d.status === 'accepted') {
          if (accepted.has(id)) complain(n.id, `another accepted decision (${accepted.get(id)}) already resolves ${id}.`);
          accepted.set(id, n.id);
          if (issue?.data.status !== 'resolved' || issue?.data.resolved_by !== n.id) complain(n.id, `accepted decision must be the current resolved_by of ${id}.`);
        }
        if (d.status === 'challenged' && issue?.data.status === 'resolved') complain(n.id, `reopen ${id} when challenging its decision.`);
      }
    }
  }
  const selectedPositions = currentSelections(graph);
  if (!allowPositionMismatch) for (const n of nodes.values()) {
    if (n.kind === 'position' && n.data.status === 'accepted' && !selectedPositions.has(n.id)) complain(n.id, 'an accepted position must be explicitly selected by the current accepted decision for its issue. Use positions-reconcile for an older graph with inconsistent Position state.');
  }
  errors.push(...linkCycles(nodes, 'parent'), ...linkCycles(nodes, 'superseded_by'));
  for (const r of graph.relations) {
    if (!nodes.has(r.from) || !nodes.has(r.to)) errors.push('Relation contains an undefined node.');
    if (!['support', 'attack', 'undercut', 'contradictory'].includes(r.type)) errors.push(`Unsupported relation ${r.type}; use support, attack, undercut or contradictory in this profile.`);
    if (nodes.get(r.from)?.kind === 'issue' || nodes.get(r.to)?.kind === 'issue') errors.push(`${r.from} → ${r.to}: use parent/issue/depends_on for issue topology, not support/attack.`);
    if (r.type === 'contradictory' && selectedPositions.has(r.from) && selectedPositions.has(r.to)) errors.push(`${r.from} ↔ ${r.to}: current decisions cannot select explicitly contradictory positions together.`);
  }
  return errors;
}

// Assertions, provenance and their original causal links are durable even before
// a decision. Operational state may change, substantive corrections get new IDs.
const MUTABLE = new Set(['status', 'superseded_by', 'challenged_by', 'reaffirmed_by', 'handoff', 'blocking', 'nonblocking_reason']);
const ISSUE_MUTABLE = new Set(['parent', 'resolved_by', 'resolution_history', 'reason', 'defer_reason', 'related']);
const normalText = text => text.replace(/\s+/g, ' ').trim();
const identity = n => ({ kind: n.kind, text: normalText(n.text), tags: n.tags.filter(t => !Object.hasOwn(KINDS, t)).sort(),
  data: Object.fromEntries(Object.entries(n.data).filter(([k]) => !MUTABLE.has(k) && !(n.kind === 'issue' && ISSUE_MUTABLE.has(k)))) });
const prefix = (old, next) => Array.isArray(next) && old.every((id, i) => next[i] === id);
export function validateMetadataTransition(previous, next) {
  const errors = [];
  if (previous.id !== next.id || previous.root !== next.root) errors.push('Preserve discovery.id and root; archive before a different discovery.');
  if (!Number.isSafeInteger(previous.revision) || previous.revision < 1 || next.revision !== previous.revision + 1) errors.push('Increment revision exactly once per committed update from a valid positive revision.');
  if (previous.created_at !== next.created_at) errors.push('Preserve created_at.');
  if (errors.length) throw new DiscoveryError('HISTORY', 'The update would change discovery identity or revision.', errors);
}
export function validateTransition(previous, next) {
  validateMetadataTransition(previous.meta, next.meta);
  const errors = [];
  for (const old of previous.nodes.values()) {
    const fresh = next.nodes.get(old.id);
    if (!fresh) { errors.push(`${old.id}: preserve recorded assertions and rationale; retire them instead of deleting.`); continue; }
    if (canonical(identity(old)) !== canonical(identity(fresh))) errors.push(`${old.id}: preserve the original assertion, sources and rationale; record a new version under a new ID.`);
    if (old.data.status === 'superseded' && fresh.data.status !== 'superseded') errors.push(`${old.id}: superseded nodes remain historical.`);
    if (old.data.superseded_by && fresh.data.superseded_by !== old.data.superseded_by) errors.push(`${old.id}: preserve the original successor; extend the chain from that successor.`);
    for (const field of ['challenged_by', 'reaffirmed_by', 'resolution_history']) {
      if (old.data[field] && !prefix(old.data[field], fresh.data[field])) errors.push(`${old.id}: ${field} history is append-only and ordered.`);
    }
    if (old.kind === 'decision' && old.data.status === 'challenged' && fresh.data.status === 'accepted') {
      const latest = fresh.data.reaffirmed_by?.at(-1);
      if (!latest || (old.data.reaffirmed_by ?? []).includes(latest) || previous.nodes.has(latest)) errors.push(`${old.id}: reaffirm with a newly recorded review containing the complete operative basis.`);
    }
  }
  const relations = new Set(next.relations.map(canonical));
  for (const relation of previous.relations) if (!relations.has(canonical(relation))) errors.push(`${relation.from} → ${relation.to}: preserve recorded reasoning relations; version or contest their propositions instead.`);
  if (errors.length) throw new DiscoveryError('HISTORY', 'The update would lose reasoning history.', errors);
}
export function updateMeta(graph, patch) {
  const frontMatter = { ...graph.frontMatter, discovery: { ...graph.meta, ...patch } };
  const match = /^(?:\uFEFF)?===[ \t]*\r?\n[\s\S]*?\r?\n===[ \t]*(?:\r?\n|$)/.exec(graph.text);
  if (!match) throw new DiscoveryError('FRONTMATTER', 'Use === delimiters on separate lines at the start.');
  return `===\n${argdownJson(frontMatter, 2)}\n===\n\n${graph.text.slice(match[0].length).replace(/^[ \t\r\n]*/, '')}`;
}
export function dependencies(n) {
  if (n.kind === 'decision' && n.data.reaffirmed_by?.length) return [n.data.reaffirmed_by.at(-1)];
  const basis = n.data.based_on ?? [];
  return [...new Set([...basis, ...(n.data.depends_on ?? []), ...(n.data.derives_from ? [n.data.derives_from] : []),
    ...(n.kind === 'decision' ? (n.data.selected ?? []) : []), ...(n.kind === 'issue' && n.data.status === 'resolved' ? [n.data.resolved_by] : [])])];
}
export function historicalRefs(n) {
  return [...new Set([...dependencies(n), ...(n.data.based_on ?? []), ...(n.data.reaffirmed_by ?? []), ...(n.data.alternatives ?? []), ...(n.data.challenged_by ?? []), ...(n.data.resolution_history ?? [])])];
}
// Commitments of the target state: settled boundaries, choices and implications, and every recorded assumption.
export const committed = n => ['constraint', 'decision', 'consequence'].includes(n.kind) ? lifecycle(n) === 'settled' : n.kind === 'assumption' && lifecycle(n) !== 'retired';
const badReason = n => n.kind === 'issue' && lifecycle(n) === 'unsettled' ? `${n.id} is unresolved.` :
  n.kind === 'assumption' && n.data.status === 'unverified' ? (n.data.blocking !== false ? `${n.id} is unverified.` : null) :
  lifecycle(n) !== 'settled' ? `${n.id} is ${n.data.status}.` : null;

const materialEvidence = n => n.kind === 'evidence' && ['existing', 'edge'].includes(n.data.handoff) && n.data.status !== 'superseded';
// The operative state: commitments, material evidence and resolved questions, with everything
// they causally depend on. Readiness and the handoff both build on this one closure.
// No enumeration of dependency paths: the reachable graph is built once. O(V + E), stack safe.
export function operativeClosure(graph) {
  const roots = [...graph.nodes.values()].filter(n => committed(n) || materialEvidence(n) || (n.kind === 'issue' && n.data.status === 'resolved')).map(n => n.id);
  const reachable = new Set(), edges = new Map(), reverse = new Map(), stack = [...roots];
  while (stack.length) {
    const id = stack.pop(); if (reachable.has(id)) continue;
    reachable.add(id); const ids = dependencies(graph.nodes.get(id)); edges.set(id, ids);
    for (const dep of ids) { if (!reverse.has(dep)) reverse.set(dep, []); reverse.get(dep).push(id); stack.push(dep); }
  }
  return { reachable, edges, reverse };
}

export function projectGraph(graph) {
  const blockers = [], blockerIDs = new Set(), required = new Set([graph.meta.root]), selected = [], open = [];
  const add = (id, reason) => { required.add(id); if (!blockerIDs.has(id)) { blockerIDs.add(id); blockers.push({ id, reason }); } };
  for (const n of graph.nodes.values()) {
    if (n.kind === 'issue' && ['open', 'deferred'].includes(n.data.status) && n.id !== graph.meta.root) {
      open.push(n); required.add(n.id); if (n.data.blocking !== false) add(n.id, 'Unresolved blocking issue; deferral retains the blocker.');
    }
    if (['decision', 'constraint', 'consequence'].includes(n.kind) && n.data.status === 'challenged') add(n.id, 'Challenged target state has not been resolved.');
    if (n.kind === 'assumption' && n.data.status === 'unverified' && n.data.blocking !== false) add(n.id, 'Unverified blocking assumption.');
    if (committed(n) || materialEvidence(n)) { selected.push(n); required.add(n.id); }
  }
  // Failure propagates once per node over the closure's reverse edges.
  const { reachable, edges, reverse } = operativeClosure(graph);
  const failed = new Map(), queue = [];
  const fail = (id, reason) => { if (!failed.has(id)) { failed.set(id, reason); queue.push(id); } };
  for (const id of reachable) { const reason = badReason(graph.nodes.get(id)); if (reason) fail(id, reason); }
  // Kahn's algorithm on dependency counts detects circular justification; the
  // remaining nodes include the cycle and its dependents, all mechanically blocked.
  const counts = new Map([...edges].map(([id, deps]) => [id, deps.length]));
  const leaves = [...counts].filter(([, count]) => count === 0).map(([id]) => id);
  for (let i = 0; i < leaves.length; i++) for (const parent of reverse.get(leaves[i]) ?? []) { counts.set(parent, counts.get(parent) - 1); if (counts.get(parent) === 0) leaves.push(parent); }
  for (const [id, count] of counts) if (count > 0) fail(id, 'Circular operative justification, or dependency on a circular justification.');
  for (let i = 0; i < queue.length; i++) for (const parent of reverse.get(queue[i]) ?? []) fail(parent, `Depends on ${queue[i]}: ${failed.get(queue[i]).slice(0, 350)}`);
  for (const [id, reason] of failed) add(id, reason);
  if (!selected.some(n => n.kind === 'decision')) add(graph.meta.root, 'No accepted product judgment establishes target behavior; factual answers alone are insufficient.');
  const contextIDs = new Set(reachable);
  // Outcome and rejected-option text provides rationale context. The latest
  // complete review defines current source dependencies; view retains all bases.
  for (const n of selected) for (const id of [...(n.data.selected ?? []), ...(n.data.alternatives ?? [])]) contextIDs.add(id);
  const selectedIDs = new Set(selected.map(n => n.id));
  const context = [...contextIDs].map(id => graph.nodes.get(id));
  return { discovery: graph.meta, graph_sha256: graph.hash, readiness: blockers.length ? 'blocked' : 'ready',
    readiness_kind: 'mechanical', blockers, required_coverage: [...required].sort(),
    settled: selected.filter(n => n.kind !== 'assumption'),
    assumptions: selected.filter(n => n.kind === 'assumption'), open_issues: open,
    factual_answers: [...graph.nodes.values()].filter(n => n.kind === 'issue' && n.data.status === 'resolved' && graph.nodes.get(n.data.resolved_by).kind !== 'decision'),
    rationale_context: context.filter(n => !selectedIDs.has(n.id)), unresolved_state: [...blockerIDs].map(id => graph.nodes.get(id)),
    sources: [...new Map([...reachable].map(id => graph.nodes.get(id)).flatMap(n => n.data.sources ?? []).map(s => [canonical(s), s])).values()]
  };
}
export function graphSummary(graph) {
  const p = projectGraph(graph), ancestry = []; let n = graph.nodes.get(graph.meta.focus);
  while (n && ancestry.length < 12) { ancestry.push({ id: n.id, text: n.text.slice(0, 180), status: n.data.status }); n = graph.nodes.get(n.data.parent); }
  return { id: graph.meta.id, title: graph.meta.title, status: graph.meta.status, revision: graph.meta.revision, graph_sha256: graph.hash,
    focus: graph.meta.focus, ancestry, readiness: p.readiness, readiness_kind: p.readiness_kind, blocker_count: p.blockers.length,
    blockers: p.blockers.slice(0, 8), open_issues: p.open_issues.slice(0, 8).map(n => ({ id: n.id, text: n.text.slice(0, 180), status: n.data.status })), nodes: graph.nodes.size };
}

// Canonical serialization preserves assertions and relations for atomic patches.
// Reparse with the official parser before commit; retain meaning, tags, metadata
// and native relations, though heading layout and whitespace are normalized.
export function serializeGraph(graph) {
  const ref = id => graph.nodes.get(id)?.format === 'argument' ? `<${id}>` : `[${id}]`;
  // Escape every Argdown control character, including comment/shortcode starts.
  const escape = text => normalText(text).replace(/([\\[\]<>#{}*_`@/,.():;\-])/g, '\\$1');
  // Argdown writes a tag as #word or, for any other text without `)`, as #(tag text).
  const tag = (n, text) => {
    if (/^[a-zA-Z0-9-]+$/.test(text)) return `#${text}`;
    if (/^[^()\n]+$/.test(text)) return `#(${text})`;
    throw new DiscoveryError('SERIALIZE', `${n.id}: unsupported custom tag; use complete apply to retain this formatting.`);
  };
  const parts = ['===', argdownJson({ ...graph.frontMatter, discovery: graph.meta }, 2), '===', '', '# Requirements discovery', ''];
  for (const n of graph.nodes.values()) {
    const tags = [n.kind, ...(n.tags ?? []).filter(text => !Object.hasOwn(KINDS, text))].map(text => tag(n, text));
    parts.push(`${ref(n.id)}: ${escape(n.text)} ${tags.join(' ')} ${argdownJson(n.data)}`, '');
  }
  for (const r of graph.relations) {
    const parent = r.type === 'contradictory' ? r.from : r.to;
    const child = r.type === 'contradictory' ? r.to : r.from;
    parts.push(ref(parent), `    ${{ support: '+', attack: '-', undercut: '_', contradictory: '><' }[r.type]} ${ref(child)}`, '');
  }
  const text = parts.join('\n');
  const parsed = parseGraph(text);
  const entries = g => [...g.nodes].sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => [id, identity(n)]);
  const expected = entries(graph), actual = entries(parsed);
  const relationKeys = g => g.relations.map(canonical).sort();
  if (canonical(expected) !== canonical(actual) || canonical(relationKeys(graph)) !== canonical(relationKeys(parsed))) throw new DiscoveryError('SERIALIZE', 'Canonical serialization would change graph meaning; use complete apply.');
  return parsed;
}

export function viewGraph(graph, ids = [graph.meta.focus ?? graph.meta.root], depth = 1, limit = 80) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 3 || !Array.isArray(ids) || !ids.length || ids.some(id => !graph.nodes.has(id))) throw new DiscoveryError('INPUT', 'view expects existing IDs and a depth from 0 to 3.');
  const neighbors = new Map([...graph.nodes.keys()].map(id => [id, new Set()]));
  const connect = (a, b) => { if (neighbors.has(b)) { neighbors.get(a).add(b); neighbors.get(b).add(a); } };
  for (const n of graph.nodes.values()) for (const id of [...historicalRefs(n), ...(n.data.resolves ?? []), ...(n.data.selected ?? []), ...[n.data.issue, n.data.parent, n.data.decision, n.data.superseded_by].filter(Boolean)]) connect(n.id, id);
  for (const r of graph.relations) connect(r.from, r.to);
  const seen = new Set(ids), queue = ids.map(id => ({ id, level: 0 }));
  for (let i = 0; i < queue.length; i++) { const { id, level } = queue[i]; if (level >= depth) continue; for (const next of neighbors.get(id)) if (!seen.has(next)) { seen.add(next); queue.push({ id: next, level: level + 1 }); } }
  const included = new Set([...seen].slice(0, limit));
  return { discovery: graph.meta, graph_sha256: graph.hash, nodes: [...included].map(id => graph.nodes.get(id)), relations: graph.relations.filter(r => included.has(r.from) && included.has(r.to)),
    truncated: seen.size > limit, omitted_count: Math.max(0, seen.size - limit), omitted_ids: [...seen].slice(limit, limit + 80) };
}
