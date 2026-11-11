import { DiscoveryError, isObject, nonempty, sha256, canonical, MAX_GRAPH_BYTES } from './graph.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const REVIEW_AXES = ['consistency', 'source_authority', 'coverage', 'decision_quality', 'readiness'];
export function handoffBody(input) {
  if (!isObject(input) || !nonempty(input.body) || !Array.isArray(input.covers) || input.covers.some(x => typeof x !== 'string')) throw new DiscoveryError('INPUT', 'handoff expects {body: "Markdown", covers: ["node IDs"], review?: {...}} on stdin.');
  if (input.audit_requested !== undefined && typeof input.audit_requested !== 'boolean') throw new DiscoveryError('INPUT', 'audit_requested must be boolean.');
  const body = input.body.trim() + '\n';
  if (Buffer.byteLength(body) > MAX_GRAPH_BYTES) throw new DiscoveryError('SIZE', 'Handoff body exceeds 2 MiB.');
  return body;
}
export function checkCoverage(graph, projection, input, body) {
  const missing = projection.required_coverage.filter(id => !input.covers.includes(id) || !body.includes(`[${id}]`));
  const unknown = input.covers.filter(id => !graph.nodes.has(id));
  if (missing.length || unknown.length) throw new DiscoveryError('COVERAGE', 'Handoff must cover current commitments and unresolved points with visible [ID] references.', [{ missing, unknown }]);
}
export function reviewTemplate(graph, projection, body) {
  return { graph_sha256: graph.hash, body_sha256: sha256(body),
    checks: REVIEW_AXES.map(check => ({ check, result: 'unchecked', note: '' })),
    sources: projection.sources.map(source => ({ source, result: 'unchecked', note: '' })) };
}
export function reviewBlockers(graph, projection, body, review) {
  if (review === undefined) return [{ id: graph.meta.root, reason: 'A semantic handoff review has not been recorded; mechanical readiness alone is insufficient.' }];
  if (!isObject(review) || review.graph_sha256 !== graph.hash || review.body_sha256 !== sha256(body)) throw new DiscoveryError('REVIEW', 'Review must refer to the exact current graph and normalized draft body. Run handoff-preview after changing either.');
  if (!Array.isArray(review.checks) || review.checks.length !== REVIEW_AXES.length || new Set(review.checks.map(x => x?.check)).size !== REVIEW_AXES.length ||
    REVIEW_AXES.some(axis => !review.checks.some(x => x?.check === axis)) || review.checks.some(x => !isObject(x) || !['pass', 'blocked'].includes(x.result) || !nonempty(x.note))) throw new DiscoveryError('REVIEW', 'Record pass/blocked and a concrete note for each of the five semantic review axes.');
  const sources = projection.sources.map(canonical);
  if (!Array.isArray(review.sources) || review.sources.length !== sources.length || new Set(review.sources.map(x => canonical(x?.source))).size !== sources.length ||
    review.sources.some(x => !isObject(x) || !sources.includes(canonical(x.source)) || !['checked', 'not-needed', 'unavailable'].includes(x.result) || !nonempty(x.note))) throw new DiscoveryError('REVIEW', 'Account for each current source: checked, not-needed with a reason, or unavailable.');
  return [...review.checks.filter(x => x.result === 'blocked').map(x => ({ id: graph.meta.root, reason: `Semantic review (${x.check}): ${x.note}` })),
    ...review.sources.filter(x => x.result === 'unavailable').map(x => ({ id: graph.meta.root, reason: `Source unavailable (${x.source.ref}): ${x.note}` }))];
}

// A local file source with a recorded sha256 is a snapshot of that file's exact bytes.
const isSnapshot = source => Boolean(source?.sha256) && source.kind !== 'user' && !/^https?:/i.test(source.ref);

// Returns why a snapshot source no longer matches its file, or null when it matches.
function snapshotMismatch(project, source) {
  try {
    const file = path.resolve(project, source.ref);
    if (!fs.statSync(file).isFile()) throw new Error('not a regular file');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
    let actual;
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('not a regular file within 16 MiB'); actual = sha256(fs.readFileSync(fd)); }
    finally { fs.closeSync(fd); }
    return actual === source.sha256 ? null : 'changed';
  } catch (error) { return `unavailable (${error.code ?? error.message})`; }
}

export function sourceSnapshotBlockers(project, projection) {
  return projection.sources.filter(isSnapshot).flatMap(source => {
    const mismatch = snapshotMismatch(project, source);
    if (!mismatch) return [];
    const reason = mismatch === 'changed'
      ? `Recorded source snapshot changed: ${source.ref}. Reassess and version the finding before publication.`
      : `Recorded source snapshot is ${mismatch}: ${source.ref}.`;
    return [{ id: projection.discovery.root, reason }];
  });
}

// Sources are immutable once recorded, so a wrong path or hash must fail when it is written.
export function newSnapshotErrors(project, previous, next) {
  const errors = [];
  for (const node of next.nodes.values()) {
    if (previous.nodes.has(node.id)) continue;
    for (const source of (Array.isArray(node.data.sources) ? node.data.sources : []).filter(isSnapshot)) {
      const mismatch = snapshotMismatch(project, source);
      if (mismatch) errors.push(`${node.id}: snapshot ${source.ref} is ${mismatch}; record the sha256 of the file's current bytes, with ref as a path relative to the project root and any line or anchor in locator.`);
    }
  }
  return errors;
}
