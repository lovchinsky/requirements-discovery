import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscoveryError, parseGraph, sha256, canonical, isObject } from './graph.mjs';
import { assertReal, locations, readFile, readBytes } from './io.mjs';
export { findProject, locations, ensureDirectory, readFile, readBytes, decodeText, readHeader, frontMatterHeader, stdinText } from './io.mjs';
import { REVIEW_AXES } from './review.mjs';
import { assessAudit } from './audit.mjs';
import { draftHandoff, blockedBanner, RENDERER } from './render.mjs';

export function readGraph(project) {
  return parseGraph(readFile(locations(project).graph));
}

export function withLock(project, operation) {
  const p = locations(project);
  if (!fs.statSync(p.root).isDirectory()) throw new DiscoveryError('PATH', 'Project root must be an existing directory.');
  assertReal(p.state, true);
  fs.mkdirSync(p.state, { recursive: true });
  try { fs.mkdirSync(p.lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new DiscoveryError('BUSY', 'Another writer holds .requirements/.write-lock. Retry after it finishes; inspect a leftover lock before removing it.');
    throw error;
  }
  try {
    fs.writeFileSync(path.join(p.lock, 'owner.json'), JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }), { flag: 'wx' });
    return operation(p);
  } finally { fs.rmSync(p.lock, { recursive: true }); }
}

export function expectGraph(project, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new DiscoveryError('EXPECT', 'Supply the graph_sha256 returned by status/project as --expect.');
  const current = readGraph(project);
  if (current.hash !== expected) throw new DiscoveryError('CONFLICT', 'The graph changed after it was read. Re-read and integrate the new state; do not overwrite it.', [{ expected, actual: current.hash }]);
  return current;
}

export function atomicWrite(file, text) {
  assertReal(path.dirname(file), true);
  assertReal(file);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}

// Every consumer reads the publication once, through its state: absent (no metadata),
// unreadable, unsealed (not schema 2/3 or a broken seal), foreign (another discovery) or sealed.
// Schema 3 bodies are rendered from the graph with recorded render inputs; schema 2 bodies are prose without them.
export function readPublication(project, graph) {
  const p = locations(project), markdown = fs.existsSync(p.handoff);
  if (!fs.existsSync(p.handoffJson)) return { state: 'absent', markdown };
  let data;
  try { data = JSON.parse(readFile(p.handoffJson, 4 * 1024 * 1024)); }
  catch (error) {
    if (!(error instanceof DiscoveryError || error instanceof SyntaxError || error.code)) throw error;
    return { state: 'unreadable', markdown, reason: error instanceof DiscoveryError ? error.message : 'Handoff metadata is not readable JSON.' };
  }
  const { metadata_sha256, ...metadata } = isObject(data) ? data : {};
  if (!isObject(data) || ![2, 3].includes(data.schema) || metadata_sha256 !== sha256(canonical(metadata))) return { state: 'unsealed', markdown, data };
  if (data.discovery_id !== graph.meta.id) return { state: 'foreign', markdown, data };
  let body;
  try { body = markdown ? readBytes(p.handoff, 4 * 1024 * 1024) : undefined; }
  catch (error) { if (!(error instanceof DiscoveryError || error.code)) throw error; }
  return { state: 'sealed', markdown, data, body };
}

export function readAuditState(project, graph, bodyHash) {
  const publication = readPublication(project, graph);
  if (publication.state === 'absent') return { requested: false };
  // A request remains part of this discovery even after a reasoning revision
  // makes the old publication stale. A damaged, unsealed or foreign publication
  // cannot prove that no audit was requested, so it keeps the gate closed; only
  // an explicit audit_requested:false cancels it.
  if (publication.state !== 'sealed') return { requested: true };
  const { data } = publication, report = data.review?.independent_audit;
  const requested = data.audit_requested === true || report !== undefined || data.review?.audit_responses !== undefined;
  if (report?.graph_sha256 === graph.hash && report?.body_sha256 === bodyHash) return { requested, report, responses: data.review.audit_responses };
  return { requested };
}

// The render inputs of the last sealed rendered publication of this discovery, offered for reuse.
export function readPreviousInputs(project, graph) {
  const publication = readPublication(project, graph);
  if (publication.state !== 'sealed' || publication.data.schema !== 3) return undefined;
  return { language: publication.data.language, conclusions: publication.data.conclusions };
}

// Whether the graph and the recorded render inputs still produce the published Markdown bytes.
function reproduction(graph, { data, body }) {
  if (data.schema === 2) return { reproduction: 'legacy-prose' };
  if (body === undefined) return { reproduction: 'unreadable' };
  let draft;
  try { draft = draftHandoff(graph, { language: data.language, conclusions: data.conclusions }); }
  catch (error) {
    if (!(error instanceof DiscoveryError && ['INPUT', 'CONCLUSION', 'COVERAGE'].includes(error.code))) throw error;
    return { reproduction: 'not-renderable', reproduction_detail: error.message };
  }
  const expected = data.status === 'ready' ? draft.body : blockedBanner(draft.language) + draft.body;
  const reproduction = sha256(expected) === sha256(body) ? 'reproducible' : data.renderer !== RENDERER ? 'renderer-changed' : 'differs';
  return { reproduction, draft };
}

export function readPublicationState(project, graph) {
  const publication = readPublication(project, graph);
  if (publication.state === 'absent') return { summary: publication.markdown ? { exists: true, fresh: false, reason: 'Handoff metadata is missing.' } : { exists: false, fresh: false } };
  if (publication.state === 'unreadable') return { summary: { exists: true, fresh: false, reason: publication.reason } };
  const { data, body } = publication, sealed = publication.state === 'sealed';
  const fresh = sealed && body !== undefined && data.graph_sha256 === graph.hash && data.body_sha256 === sha256(body);
  const reason = fresh ? undefined : !sealed ? `The publication metadata is ${publication.state}.` : body === undefined ? 'The handoff Markdown is missing or unreadable.' : 'The graph, handoff body or publication metadata changed since publication.';
  let audit;
  try {
    if (data.audit_requested !== undefined && typeof data.audit_requested !== 'boolean') throw new DiscoveryError('AUDIT', 'Invalid audit request flag.');
    audit = assessAudit({ graph, graphHash: data.reviewed_graph_sha256, bodyHash: data.review?.body_sha256, report: data.review?.independent_audit, responses: data.review?.audit_responses, requested: data.audit_requested === true });
  } catch (error) {
    if (!(error instanceof DiscoveryError)) throw error;
    return { summary: { exists: true, fresh: false, schema: data.schema, reason: error.message } };
  }
  const reviewed = Boolean(data.review && data.review.graph_sha256 === data.reviewed_graph_sha256 && (data.status !== 'ready' || data.review.body_sha256 === data.body_sha256) && Array.isArray(data.review.checks) && data.review.checks.length === REVIEW_AXES.length && REVIEW_AXES.every(axis => data.review.checks.some(x => x?.check === axis && x.result === 'pass')) && Array.isArray(data.review.sources) && data.review.sources.every(x => ['checked', 'not-needed'].includes(x?.result)) && (!audit.requested || audit.audited));
  const { draft, ...replay } = sealed ? reproduction(graph, publication) : { reproduction: 'unsealed' };
  return { draft, summary: { exists: true, fresh, schema: data.schema, status: data.status, reviewed, audit_requested: audit.requested, audited: audit.audited, independent_audit: audit.status,
    graph_sha256: data.graph_sha256, reproducible: replay.reproduction === 'reproducible', ...replay, reason } };
}

export function readHandoff(project, graph) {
  return readPublicationState(project, graph).summary;
}
