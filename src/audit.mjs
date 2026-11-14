import { DiscoveryError, isObject, nonempty } from './graph.mjs';
import { REVIEW_AXES } from './review.mjs';

export const AUDITOR = 'requirements-discovery:handoff-auditor';
export const auditRequested = (input, previousRequested = false) => input.audit_requested === true || (input.audit_requested === undefined && previousRequested) || input.review?.independent_audit !== undefined || input.review?.audit_responses !== undefined;

export function auditTemplate(graph, bodyHash) {
  return { auditor: AUDITOR, context: 'fresh', graph_sha256: graph.hash, body_sha256: bodyHash,
    result: 'unchecked', checks: REVIEW_AXES.map(check => ({ check, result: 'unchecked', note: '' })), findings: [], limits: [] };
}

// This validates an artifact-bound assessment, not the identity of a model or
// whether the host actually launched it with a fresh context and restricted tools.
export function assessAudit({ graph, graphHash = graph.hash, bodyHash, report, responses, requested = false }) {
  requested ||= report !== undefined || responses !== undefined;
  const block = reason => ({ id: graph.meta.root, reason: `Independent audit: ${reason}` });
  const outcome = (status, blockers = []) => ({ requested, audited: ['pass', 'cleared-with-responses'].includes(status), status, blockers });
  if (!requested) return outcome('not-requested');
  if (report === undefined) return outcome('missing', [block('requested but no fresh-context report has been recorded.')]);
  if (!isObject(report) || report.auditor !== AUDITOR || report.context !== 'fresh' || report.graph_sha256 !== graphHash || report.body_sha256 !== bodyHash) throw new DiscoveryError('AUDIT', 'Independent audit must identify the bundled fresh-context auditor and refer to the exact reviewed graph and rendered draft. Re-run a new auditor after either changes.');
  if (!['pass', 'blocked', 'unavailable'].includes(report.result) || !Array.isArray(report.checks) || report.checks.length !== REVIEW_AXES.length || new Set(report.checks.map(x => x?.check)).size !== REVIEW_AXES.length ||
    REVIEW_AXES.some(axis => !report.checks.some(x => x?.check === axis)) || report.checks.some(x => !isObject(x) || !['pass', 'blocked', 'unavailable'].includes(x.result) || !nonempty(x.note)) ||
    !Array.isArray(report.findings) || !Array.isArray(report.limits) || report.limits.some(x => !nonempty(x))) throw new DiscoveryError('AUDIT', 'Record an independent result, all five checks with concrete notes, findings and explicit scope limits.');
  const findings = new Map();
  for (const finding of report.findings) {
    if (!isObject(finding) || !nonempty(finding.id) || findings.has(finding.id) || !REVIEW_AXES.includes(finding.check) || !['blocking', 'nonblocking'].includes(finding.severity) ||
      !Array.isArray(finding.nodes) || !finding.nodes.length || new Set(finding.nodes).size !== finding.nodes.length || finding.nodes.some(id => !graph.nodes.has(id)) ||
      !nonempty(finding.source) || !nonempty(finding.note) || !nonempty(finding.correction)) throw new DiscoveryError('AUDIT', 'Each independent finding needs a unique ID, check, severity, known node IDs, source pointer, explanation and suggested correction.');
    findings.set(finding.id, finding);
  }
  const blocking = report.findings.filter(f => f.severity === 'blocking');
  const failedChecks = report.checks.filter(c => c.result !== 'pass');
  if (report.result === 'pass' && (blocking.length || failedChecks.length)) throw new DiscoveryError('AUDIT', 'An independent pass cannot conceal blocking findings or failed/unavailable checks.');
  if (report.result === 'blocked' && !blocking.length && !failedChecks.length) throw new DiscoveryError('AUDIT', 'An independent blocked result must explain a blocking finding or failed check.');
  const rejected = new Set();
  if (responses !== undefined) {
    if (!Array.isArray(responses)) throw new DiscoveryError('AUDIT', 'audit_responses must be an array of explicit main-agent responses.');
    const seen = new Set();
    for (const response of responses) {
      const finding = findings.get(response?.finding);
      if (!isObject(response) || !finding || finding.severity !== 'blocking' || seen.has(response.finding) || !['open', 'rejected'].includes(response.result) || !nonempty(response.note) || !nonempty(response.source)) throw new DiscoveryError('AUDIT', 'Respond only to a known blocking finding, once, with open/rejected, a substantive explanation and an exact evidence pointer.');
      seen.add(response.finding);
      if (response.result === 'rejected') rejected.add(response.finding);
    }
  }
  const blockers = blocking.filter(f => !rejected.has(f.id)).map(f => block(`${f.id} (${f.nodes.join(', ')}): ${f.note}`));
  for (const check of failedChecks) {
    const supporting = blocking.filter(f => f.check === check.check);
    // Unavailable observations cannot be cleared by rejecting a different claim.
    if (check.result === 'unavailable' || !supporting.length || supporting.some(f => !rejected.has(f.id))) blockers.push(block(`${check.check} (${check.result}): ${check.note}`));
  }
  if (report.result === 'unavailable') blockers.push(block(`auditor unavailable${report.limits.length ? `: ${report.limits.join('; ')}` : '.'}`));
  if (blockers.length) return outcome(report.result === 'unavailable' || failedChecks.some(c => c.result === 'unavailable') ? 'unavailable' : 'blocked', blockers);
  return outcome(rejected.size ? 'cleared-with-responses' : 'pass');
}
