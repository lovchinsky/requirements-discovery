import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscoveryError, parseGraph, sha256, canonical } from './graph.mjs';
import { assertReal, locations, readFile } from './io.mjs';
export { findProject, locations, ensureDirectory, readFile, readBytes, decodeText, readHeader, frontMatterHeader, stdinText } from './io.mjs';
import { REVIEW_AXES } from './review.mjs';
import { assessAudit } from './audit.mjs';

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

function readPublicationMetadata(project) {
  return JSON.parse(readFile(locations(project).handoffJson, 4 * 1024 * 1024));
}

export function readAuditState(project, graph, bodyHash) {
  if (!fs.existsSync(locations(project).handoffJson)) return { requested: false };
  try {
    const data = readPublicationMetadata(project), { metadata_sha256, ...metadata } = data;
    // A request remains part of this discovery even after a reasoning revision
    // makes the old publication stale. A damaged, unsealed or foreign publication
    // cannot prove that no audit was requested, so it keeps the gate closed; only
    // an explicit audit_requested:false cancels it.
    if (data.schema !== 2 || data.discovery_id !== graph.meta.id || metadata_sha256 !== sha256(canonical(metadata))) return { requested: true };
    const requested = data.audit_requested === true || data.review?.independent_audit !== undefined || data.review?.audit_responses !== undefined;
    const report = data.review?.independent_audit;
    if (report?.graph_sha256 === graph.hash && report?.body_sha256 === bodyHash) return { requested, report, responses: data.review.audit_responses };
    return { requested };
  } catch { return { requested: true }; }
}

export function readHandoff(project, graph) {
  const p = locations(project);
  if (!fs.existsSync(p.handoff) && !fs.existsSync(p.handoffJson)) return { exists: false, fresh: false };
  try {
    const data = readPublicationMetadata(project), body = readFile(p.handoff, 4 * 1024 * 1024);
    const { metadata_sha256, ...metadata } = data;
    const fresh = data.schema === 2 && metadata_sha256 === sha256(canonical(metadata)) && data.discovery_id === graph.meta.id && data.graph_sha256 === graph.hash && data.body_sha256 === sha256(body);
    if (data.audit_requested !== undefined && typeof data.audit_requested !== 'boolean') throw new DiscoveryError('AUDIT', 'Invalid audit request flag.');
    const audit = assessAudit({ graph, graphHash: data.reviewed_graph_sha256, bodyHash: data.review?.body_sha256,
      report: data.review?.independent_audit, responses: data.review?.audit_responses, requested: data.audit_requested === true });
    const reviewed = Boolean(data.review && data.review.graph_sha256 === data.reviewed_graph_sha256 && (data.status !== 'ready' || data.review.body_sha256 === data.body_sha256) && Array.isArray(data.review.checks) && data.review.checks.length === REVIEW_AXES.length && REVIEW_AXES.every(axis => data.review.checks.some(x => x?.check === axis && x.result === 'pass')) && Array.isArray(data.review.sources) && data.review.sources.every(x => ['checked', 'not-needed'].includes(x?.result)) && (!audit.requested || audit.audited));
    return { exists: true, fresh, status: data.status, reviewed, audit_requested: audit.requested, audited: audit.audited, independent_audit: audit.status, graph_sha256: data.graph_sha256, reason: fresh ? undefined : 'The graph, handoff body or publication metadata changed since publication.' };
  } catch (error) {
    return { exists: true, fresh: false, reason: error instanceof DiscoveryError ? error.message : 'Handoff files are missing or unreadable.' };
  }
}
