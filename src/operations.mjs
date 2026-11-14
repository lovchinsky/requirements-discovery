import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscoveryError, parseGraph, serializeGraph, projectGraph, graphSummary, updateMeta, validateTransition, validateMetadataTransition, sha256, isObject, canonical, argdownJson } from './graph.mjs';
import { reconcilePositions } from './positions.mjs';
import { patchCandidate } from './patch.mjs';
import { reviewTemplate, reviewBlockers, sourceSnapshotBlockers, newSnapshotErrors } from './review.mjs';
import { draftHandoff, blockedBanner } from './render.mjs';
import { auditRequested, auditTemplate, assessAudit } from './audit.mjs';
import { locations, readGraph, readHandoff, readAuditState, readPreviousInputs, readPublicationState, expectGraph, withLock, atomicWrite, readBytes, decodeText, ensureDirectory, frontMatterHeader } from './storage.mjs';

const now = () => new Date().toISOString();
const textValue = (v, field) => {
  if (typeof v !== 'string' || !v.trim()) throw new DiscoveryError('INPUT', `${field} must be a nonempty string.`);
  return v.trim();
};

export function initDiscovery(project, input) {
  if (!isObject(input)) throw new DiscoveryError('INPUT', 'init expects a JSON object on stdin.');
  const time = now();
  const meta = { schema: 2, id: `RD-${randomUUID()}`, title: textValue(input.title, 'title'), intent: textValue(input.intent, 'intent'),
    status: 'active', root: 'I-001', focus: 'I-001', revision: 1, created_at: time, updated_at: time,
    ...(input.scope ? { scope: input.scope } : {}) };
  const text = `===\n${argdownJson({ discovery: meta }, 2)}\n===\n\n# Requirements discovery\n\n[I-001]: What target behavior satisfies the stated intent? #issue { "status": "open", "parent": null }\n`;
  const graph = parseGraph(text);
  return withLock(project, p => {
    if (fs.existsSync(p.graph) || fs.existsSync(p.handoff) || fs.existsSync(p.handoffJson)) throw new DiscoveryError('EXISTS', 'A discovery or handoff already exists. Resume it, or explicitly archive it before starting another.');
    atomicWrite(p.graph, text);
    return graphSummary(graph);
  });
}

export function applyGraph(project, expected, text) {
  const next = parseGraph(text);
  return withLock(project, p => {
    const previous = expectGraph(project, expected);
    validateTransition(previous, next);
    if (next.meta.status === 'handed-off') throw new DiscoveryError('LIFECYCLE', 'Commit reasoning changes with status active or paused. Only handoff publication may set handed-off.');
    assertNewSnapshots(project, previous, next);
    atomicWrite(p.graph, text);
    return graphSummary(next);
  });
}

export function setLifecycle(project, expected, state) {
  if (!['active', 'paused'].includes(state)) throw new DiscoveryError('INPUT', 'Use active or paused; handed-off is set by handoff publication.');
  return withLock(project, p => {
    const current = expectGraph(project, expected);
    // Explicit resume creates a new revision even if already active, invalidating an old handoff.
    const next = parseGraph(updateMeta(current, { status: state, revision: current.meta.revision + 1, updated_at: now() }));
    atomicWrite(p.graph, next.text);
    return graphSummary(next);
  });
}

export function patchGraph(project, expected, input) {
  return withLock(project, p => {
    const current = expectGraph(project, expected);
    const { graph: next, positionChanges } = patchCandidate(current, input, now());
    validateTransition(current, next);
    if (next.meta.status === 'handed-off') throw new DiscoveryError('LIFECYCLE', 'Only handoff publication may set handed-off.');
    assertNewSnapshots(project, current, next);
    atomicWrite(p.graph, next.text);
    return { ...graphSummary(next), position_changes: positionChanges };
  });
}

function assertNewSnapshots(project, previous, next) {
  const errors = newSnapshotErrors(project, previous, next);
  if (errors.length) throw new DiscoveryError('SOURCE', 'A new snapshot source does not match the file it names.', errors);
}

// Recovery commands work on the exact bytes reported by `hash`, even when they are not valid UTF-8.
function expectRawGraph(p, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new DiscoveryError('EXPECT', 'Supply the graph_sha256 returned by hash as --expect.');
  const bytes = readBytes(p.graph);
  if (sha256(bytes) !== expected) throw new DiscoveryError('CONFLICT', 'The graph changed after it was read.');
  return bytes;
}

// A handed-off discovery is inactive; publishing again would overwrite its ready handoff.
function assertHandoffAllowed(graph) {
  if (graph.meta.status === 'handed-off') throw new DiscoveryError('LIFECYCLE', 'The discovery is handed-off. Resume it with lifecycle --status active, on the user\'s request, before preparing another handoff.');
}

export function reconcilePositionState(project, expected) {
  return withLock(project, p => {
    const original = expectRawGraph(p, expected);
    // Relax only the redundant Position statuses, never references, provenance,
    // schema, Decision/Issue agreement or known contradictory selections.
    const previous = parseGraph(decodeText(original, p.graph), { allowPositionMismatch: true });
    const candidate = { ...previous, meta: { ...previous.meta }, nodes: new Map([...previous.nodes].map(([id, n]) => [id, structuredClone(n)])) };
    const positionChanges = reconcilePositions(candidate);
    if (!positionChanges.length) return { ...graphSummary(previous), position_changes: [] };
    Object.assign(candidate.meta, { status: previous.meta.status === 'handed-off' ? 'active' : previous.meta.status, revision: previous.meta.revision + 1, updated_at: now() });
    const next = serializeGraph(candidate);
    validateTransition(previous, next);
    const base = path.join(p.state, 'archive'); ensureDirectory(base);
    const backup = path.join(base, `pre-positions-${randomUUID()}`); fs.mkdirSync(backup);
    try {
      atomicWrite(path.join(backup, 'current.argdown'), original);
      for (const file of [p.handoff, p.handoffJson]) {
        if (fs.existsSync(file)) atomicWrite(path.join(backup, path.basename(file)), readBytes(file, 4 * 1024 * 1024));
      }
    } catch (error) { fs.rmSync(backup, { recursive: true }); throw error; }
    atomicWrite(p.graph, next.text);
    return { ...graphSummary(next), position_changes: positionChanges, preserved_original: backup };
  });
}

export function status(project) {
  const paths = locations(project);
  let graph;
  try { graph = readGraph(project); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!fs.statSync(paths.root).isDirectory()) throw new DiscoveryError('PATH', 'Project root must be an existing directory.');
    return { exists: false, handoff: { exists: fs.existsSync(paths.handoff) || fs.existsSync(paths.handoffJson), fresh: false }, paths };
  }
  return { exists: true, ...graphSummary(graph), handoff: readHandoff(project, graph), paths };
}

export function archiveDiscovery(project, expected) {
  return withLock(project, p => {
    const graph = expectGraph(project, expected);
    const base = path.join(p.state, 'archive');
    ensureDirectory(base);
    const destination = path.join(base, `${graph.meta.id}-r${graph.meta.revision}-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(destination);
    // Preserve all artifacts before removing any current file.
    try {
      fs.copyFileSync(p.graph, path.join(destination, 'current.argdown'), fs.constants.COPYFILE_EXCL);
      for (const file of [p.handoff, p.handoffJson]) {
        if (!fs.existsSync(file)) continue;
        readBytes(file, 4 * 1024 * 1024);
        fs.copyFileSync(file, path.join(destination, path.basename(file)), fs.constants.COPYFILE_EXCL);
      }
    } catch (error) {
      fs.rmSync(destination, { recursive: true });
      throw error;
    }
    // Remove the graph last: an interrupted archive leaves a graph that can be archived again.
    for (const file of [p.handoff, p.handoffJson]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.unlinkSync(p.graph);
    return { archived: destination, discovery_id: graph.meta.id };
  });
}

export function repairGraph(project, expected, text) {
  const next = parseGraph(text);
  return withLock(project, p => {
    const original = expectRawGraph(p, expected);
    let header; try { header = frontMatterHeader(original.toString('utf8')); } catch { throw new DiscoveryError('REPAIR', 'Repair requires a readable schema 2 header. Preserve malformed/unknown headers and recover from a known backup; do not guess the format.'); }
    if (header?.discovery?.schema !== 2) throw new DiscoveryError('REPAIR', 'Repair requires schema 2. Preserve unsupported formats and recover from a known backup.');
    // Valid graphs must use apply, with history checks. Repair cannot bypass them.
    try { parseGraph(decodeText(original, p.graph)); }
    catch (error) {
      if (!(error instanceof DiscoveryError)) throw error;
      let positionOnly = false;
      try { parseGraph(decodeText(original, p.graph), { allowPositionMismatch: true }); positionOnly = true; } catch { /* Other body damage still uses explicit repair. */ }
      if (positionOnly) throw new DiscoveryError('REPAIR', 'Only Position state is inconsistent. Use positions-reconcile, which preserves assertions, selections and resolution history.');
      validateMetadataTransition(header.discovery, next.meta);
      if (next.meta.status === 'handed-off') throw new DiscoveryError('LIFECYCLE', 'Repair with status active or paused. Only handoff publication may set handed-off.');
      const base = path.join(p.state, 'archive');
      ensureDirectory(base);
      const backup = path.join(base, `damaged-${randomUUID()}.argdown`);
      atomicWrite(backup, original);
      atomicWrite(p.graph, text);
      return { ...graphSummary(next), preserved_damaged_graph: backup };
    }
    throw new DiscoveryError('REPAIR', 'The current graph is valid. Use apply, which preserves decision history.');
  });
}

// Read-only: the handoff Markdown for these conclusions, marking branches still without one.
// With the preview's graph hash it refuses a graph that changed, so the reviewed text is the hashed one.
export function renderDraft(project, expected, input) {
  const graph = readGraph(project);
  if (expected !== undefined && graph.hash !== expected) throw new DiscoveryError('CONFLICT', 'The graph changed after the preview. Run handoff-preview again and review the new draft.', [{ expected, actual: graph.hash }]);
  return draftHandoff(graph, input, { strict: false }).body;
}

export function previewHandoff(project, input) {
  const current = readGraph(project), projection = projectGraph(current);
  assertHandoffAllowed(current);
  const draft = draftHandoff(current, input, { strict: false }), body = draft.body;
  const bodyHash = sha256(body), previousAudit = readAuditState(project, current, bodyHash);
  const requested = auditRequested(input, previousAudit.requested) || previousAudit.report !== undefined, review = reviewTemplate(current, draft.sources, body);
  if (requested) review.independent_audit = auditTemplate(current, bodyHash);
  const previous = readPreviousInputs(project, current);
  return { graph_sha256: current.hash, mechanical_readiness: projection.readiness, blockers: [...projection.blockers, ...sourceSnapshotBlockers(project, current.meta.root, draft.sources)],
    body_sha256: bodyHash, concluded: !draft.uncovered.length, language: draft.language, renderer: draft.renderer,
    branches: { unconcluded: draft.uncovered, fold_candidates: draft.fold_candidates }, ...(previous ? { previous } : {}),
    audit_requested: requested, review };
}

export function prepareAudit(project, expected, input) {
  return withLock(project, p => {
    const current = expectGraph(project, expected);
    assertHandoffAllowed(current);
    const { body, language, conclusions, sources } = draftHandoff(current, input);
    const directory = path.join(p.state, `.audit-${randomUUID()}`);
    fs.mkdirSync(directory, { mode: 0o700 });
    const manifest = { schema: 1, created_at: now(), project: p.root,
      graph_sha256: current.hash, body_sha256: sha256(body), graph_file: 'graph.argdown', draft_file: 'draft.md', language, conclusions,
      scope: current.meta.scope ?? [], sources, audit_template: auditTemplate(current, sha256(body)) };
    try {
      atomicWrite(path.join(directory, 'graph.argdown'), current.text);
      atomicWrite(path.join(directory, 'draft.md'), body);
      atomicWrite(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    } catch (error) { fs.rmSync(directory, { recursive: true }); throw error; }
    return { directory, graph: path.join(directory, 'graph.argdown'), draft: path.join(directory, 'draft.md'), manifest: path.join(directory, 'manifest.json'), audit_requested: true, ...manifest };
  });
}

export function publishHandoff(project, expected, input) {
  return withLock(project, p => {
    const current = expectGraph(project, expected);
    assertHandoffAllowed(current);
    const projection = projectGraph(current), { body, language, conclusions, sources, renderer } = draftHandoff(current, input);
    const bodyHash = sha256(body), previousAudit = readAuditState(project, current, bodyHash);
    let review = input.review;
    if (previousAudit.report !== undefined && review?.independent_audit === undefined) {
      if (!isObject(review)) throw new DiscoveryError('REVIEW', 'A current independent report already exists; supply a main review for these same graph/draft bindings.');
      review = { ...review, independent_audit: previousAudit.report,
        ...(review.audit_responses === undefined && previousAudit.responses !== undefined ? { audit_responses: previousAudit.responses } : {}) };
    }
    const requested = auditRequested({ ...input, review }, previousAudit.requested);
    const audit = assessAudit({ graph: current, bodyHash, report: review?.independent_audit, responses: review?.audit_responses, requested });
    const blockers = [...projection.blockers, ...sourceSnapshotBlockers(project, current.meta.root, sources), ...reviewBlockers(current, sources, body, review), ...audit.blockers];
    const ready = blockers.length === 0;
    const next = ready
      ? parseGraph(updateMeta(current, { status: 'handed-off', revision: current.meta.revision + 1, updated_at: now() }))
      : current;
    const content = ready ? body : blockedBanner(language) + body;
    // Schema 3: the body is rendered from the graph, so the render inputs and renderer version are kept to reproduce it.
    const header = { schema: 3, renderer, discovery_id: next.meta.id, graph_sha256: next.hash, revision: next.meta.revision,
      status: ready ? 'ready' : 'blocked', generated_at: now(), body_sha256: sha256(content),
      reviewed_graph_sha256: current.hash, language, conclusions, blockers, audit_requested: audit.requested, review: review ?? null };
    header.metadata_sha256 = sha256(canonical(header));
    const metadata = JSON.stringify(header, null, 2) + '\n';
    if ([content, metadata].some(text => Buffer.byteLength(text) > 4 * 1024 * 1024)) throw new DiscoveryError('SIZE', 'Generated handoff files must each fit within 4 MiB.');
    // Publish prose, then its sealed metadata, then the next graph. Hash bindings
    // prevent an incomplete publication from certifying mismatched files.
    atomicWrite(p.handoff, content);
    atomicWrite(p.handoffJson, metadata);
    if (ready) atomicWrite(p.graph, next.text);
    return { file: p.handoff, metadata_file: p.handoffJson, status: header.status, graph_sha256: next.hash, blockers, independent_audit: audit.status,
      discovery_status: next.meta.status };
  });
}

// Readiness of the published handoff: current files, review, mechanical state and the
// recorded local snapshots of every source the published draft shows.
export function handoffStatus(project) {
  const graph = readGraph(project), projection = projectGraph(graph), { summary, draft } = readPublicationState(project, graph);
  const source_blockers = sourceSnapshotBlockers(project, graph.meta.root, draft?.sources ?? projection.sources);
  const ready = Boolean(summary.fresh && summary.reviewed && summary.status === 'ready' && graph.meta.status === 'handed-off' && projection.readiness === 'ready' && !source_blockers.length);
  return { ...summary, source_blockers, ready };
}
