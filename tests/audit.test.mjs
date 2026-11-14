import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sha256, projectGraph } from '../src/graph.mjs';
import { AUDITOR, auditTemplate } from '../src/audit.mjs';
import { prepareAudit, previewHandoff, publishHandoff, patchGraph } from '../src/operations.mjs';
import { readGraph, readHandoff, locations } from '../src/storage.mjs';
import { seed, draft, revised, editNode, discoveryFixture } from './helpers.mjs';
import { draftHandoff } from '../src/render.mjs';

function auditedInput(graph) {
  const input = { ...draft(graph), audit_requested: true };
  input.review.independent_audit = auditTemplate(graph, input.review.body_sha256);
  Object.assign(input.review.independent_audit, { result: 'pass', checks: input.review.checks.map(c => ({ ...c, note: 'Synthetic independent assessment: tests integrity, not model reasoning.' })),
    limits: ['Fictional fixture; supplied hash bindings and synthetic assessment, no model invocation.'] });
  return input;
}
function finding(input, { check = 'consistency', id = 'AUD-1' } = {}) {
  const report = input.review.independent_audit;
  report.result = 'blocked';
  report.checks.find(c => c.check === check).result = 'blocked';
  report.findings.push({ id, check, severity: 'blocking', nodes: ['D-006', 'C-012'], source: 'Synthetic access.md, boundary',
    note: 'The synthetic draft claims navigation overrides assignments.', correction: 'Compare the actual authorization scope and remove unsupported claims.' });
}

test('explicit requested audit without report is blocked, and an ordinary reviewed handoff needs no audit', t => {
  const dir = seed(t), graph = readGraph(dir), input = draft(graph);
  input.audit_requested = true;
  const result = publishHandoff(dir, graph.hash, input);
  assert.equal(result.status, 'blocked'); assert.equal(result.independent_audit, 'missing');
  assert.equal(readGraph(dir).text, graph.text);
  assert.equal(readHandoff(dir, graph).reviewed, false);
  const ordinaryDir = seed(t), ordinaryGraph = readGraph(ordinaryDir);
  assert.equal(publishHandoff(ordinaryDir, ordinaryGraph.hash, draft(ordinaryGraph)).status, 'ready');
  assert.equal(readHandoff(ordinaryDir, readGraph(ordinaryDir)).independent_audit, 'not-requested');
});

test('a recorded audit request survives omitted flags, new bodies and later graph revisions', t => {
  const dir = seed(t), graph = readGraph(dir), input = { ...draft(graph), audit_requested: true };
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  delete input.audit_requested;
  assert.equal(previewHandoff(dir, input).audit_requested, true);
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  Object.assign(input, revised(graph, input, 'Revised draft.'));
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  patchGraph(dir, graph.hash, { meta: { focus: 'I-014' } }); const next = readGraph(dir);
  input.review.graph_sha256 = next.hash;
  assert.equal(previewHandoff(dir, input).audit_requested, true);
  assert.equal(publishHandoff(dir, next.hash, input).status, 'blocked');
});

test('only an explicit mode change cancels a pending audit, while current findings still cannot be hidden', t => {
  const dir = seed(t), graph = readGraph(dir), input = { ...draft(graph), audit_requested: true };
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  input.audit_requested = false;
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'ready');
  const other = seed(t), original = readGraph(other), reported = auditedInput(original); finding(reported);
  assert.equal(publishHandoff(other, original.hash, reported).status, 'blocked');
  delete reported.review.independent_audit; reported.audit_requested = false;
  const result = publishHandoff(other, original.hash, reported);
  assert.equal(result.status, 'blocked'); assert.ok(result.blockers.some(b => b.reason.includes('AUD-1')));
  assert.ok(fs.readFileSync(locations(other).handoffJson, 'utf8').includes('AUD-1'));
});

test('a manual body edit does not erase the audit request preserved in sealed metadata', t => {
  const dir = seed(t), graph = readGraph(dir), input = { ...draft(graph), audit_requested: true };
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  fs.appendFileSync(locations(dir).handoff, '\nA manual body edit.\n');
  delete input.audit_requested;
  assert.equal(readHandoff(dir, graph).fresh, false);
  assert.equal(previewHandoff(dir, input).audit_requested, true);
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
});

test('sealed JSON retains a pending audit when the Markdown file is missing', t => {
  const dir = seed(t), graph = readGraph(dir), input = { ...draft(graph), audit_requested: true };
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  fs.unlinkSync(locations(dir).handoff);
  delete input.audit_requested;
  assert.equal(previewHandoff(dir, input).audit_requested, true);
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  assert.equal(readHandoff(dir, graph).fresh, true);
});

test('responses to a carried current report remain explicit and never transfer to a new report', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph); finding(input);
  const response = { finding: 'AUD-1', result: 'rejected', note: 'The actual draft preserves the assignment boundary.', source: 'Synthetic draft, scope paragraph' };
  input.review.audit_responses = [response]; input.review.checks[0].result = 'blocked'; input.review.checks[0].note = 'A separate main-review issue remains.';
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  const currentReport = structuredClone(input.review.independent_audit);
  delete input.review.independent_audit; delete input.review.audit_responses;
  input.review.checks[0].result = 'pass';
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'ready');
  const other = seed(t), otherGraph = readGraph(other), first = auditedInput(otherGraph); finding(first); first.review.audit_responses = [response]; first.review.checks[0].result = 'blocked';
  assert.equal(publishHandoff(other, otherGraph.hash, first).status, 'blocked');
  first.review.independent_audit = currentReport; first.review.checks[0].result = 'pass'; delete first.review.audit_responses;
  assert.equal(publishHandoff(other, otherGraph.hash, first).status, 'blocked');
});

test('requested preview supplies unfilled audit, and preparation snapshots actual normalized draft without changing state', t => {
  const dir = seed(t), graph = readGraph(dir), input = { ...draft(graph), audit_requested: true };
  const preview = previewHandoff(dir, input);
  assert.equal(preview.review.independent_audit.result, 'unchecked');
  assert.equal(preview.review.independent_audit.auditor, AUDITOR);
  assert.throws(() => prepareAudit(dir, '0'.repeat(64), input), e => e.code === 'CONFLICT');
  const prepared = prepareAudit(dir, graph.hash, { conclusions: input.conclusions, audit_requested: true }), body = draftHandoff(graph, input).body;
  assert.equal(fs.readFileSync(prepared.graph, 'utf8'), graph.text);
  assert.equal(fs.readFileSync(prepared.draft, 'utf8'), body);
  const manifest = JSON.parse(fs.readFileSync(prepared.manifest, 'utf8'));
  assert.equal(manifest.graph_sha256, graph.hash); assert.equal(manifest.body_sha256, sha256(body)); assert.equal(manifest.body_sha256, input.review.body_sha256);
  assert.deepEqual(manifest.conclusions, input.conclusions);
  assert.deepEqual(manifest.sources, projectGraph(graph).sources);
  assert.equal(manifest.audit_template.context, 'fresh');
  assert.equal(readGraph(dir).text, graph.text); assert.equal(fs.existsSync(locations(dir).handoff), false);
  assert.equal(fs.existsSync(locations(dir).lock), false);
});

test('audit preparation checks coverage before creating task directories', t => {
  const dir = seed(t), graph = readGraph(dir), before = fs.readdirSync(locations(dir).state);
  assert.throws(() => prepareAudit(dir, graph.hash, {}), e => e.code === 'COVERAGE');
  assert.throws(() => prepareAudit(dir, graph.hash, { body: 'A hand-written draft', covers: [] }), e => e.code === 'INPUT');
  assert.deepEqual(fs.readdirSync(locations(dir).state), before);
});

test('audit input flag must be boolean', t => {
  const dir = seed(t), input = draft(readGraph(dir));
  assert.throws(() => previewHandoff(dir, { ...input, audit_requested: 'false' }), e => e.code === 'INPUT');
});

test('independent pass is sealed against the reviewed graph, not the later publication lifecycle hash', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph);
  const result = publishHandoff(dir, graph.hash, input), next = readGraph(dir), state = readHandoff(dir, next);
  assert.equal(result.status, 'ready'); assert.notEqual(next.hash, graph.hash);
  assert.equal(state.fresh, true); assert.equal(state.reviewed, true); assert.equal(state.audited, true);
  assert.equal(state.audit_requested, true); assert.equal(state.independent_audit, 'pass');
  const document = fs.readFileSync(locations(dir).handoffJson, 'utf8');
  assert.ok(document.includes(`"reviewed_graph_sha256": "${graph.hash}"`));
  assert.ok(document.includes(`"graph_sha256": "${next.hash}"`));
});

test('a changed body requires a new independent auditor even after the main review is updated', t => {
  const dir = seed(t), graph = readGraph(dir), input = revised(graph, auditedInput(graph), 'A revised scoped conclusion.');
  assert.throws(() => publishHandoff(dir, graph.hash, input), e => e.code === 'AUDIT');
  assert.equal(fs.existsSync(locations(dir).handoff), false); assert.equal(readGraph(dir).text, graph.text);
});

test('a changed graph requires a new independent audit and cannot be cleared by changing only main review hash', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph);
  patchGraph(dir, graph.hash, { meta: { focus: 'I-014' } }); const next = readGraph(dir);
  input.review.graph_sha256 = next.hash;
  assert.throws(() => publishHandoff(dir, next.hash, input), e => e.code === 'AUDIT');
  assert.equal(readGraph(dir).text, next.text);
});

test('known independent blocking findings cannot be hidden by switching off audit_requested', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph); finding(input); input.audit_requested = false;
  const result = publishHandoff(dir, graph.hash, input);
  assert.equal(result.status, 'blocked'); assert.equal(result.independent_audit, 'blocked');
  assert.ok(result.blockers.some(b => b.reason.includes('AUD-1')));
  assert.equal(readHandoff(dir, graph).audit_requested, true);
});

test('an independent pass cannot conceal a blocking finding or failed axis', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph); finding(input);
  input.review.independent_audit.result = 'pass';
  assert.throws(() => publishHandoff(dir, graph.hash, input), e => e.code === 'AUDIT');
});

test('nonblocking independent suggestions remain recorded without requiring ritual changes', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph);
  input.review.independent_audit.findings.push({ id: 'AUD-STYLE', check: 'coverage', severity: 'nonblocking', nodes: ['I-014'], source: 'Synthetic deferred styling scope',
    note: 'A later interaction-design document could illustrate the location indicator.', correction: 'Consider an illustration during the separate styling task.' });
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'ready');
  assert.ok(fs.readFileSync(locations(dir).handoffJson, 'utf8').includes('AUD-STYLE'));
});

test('a false positive needs an explicit evidence-backed response and the original report remains preserved', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph); finding(input);
  input.review.audit_responses = [{ finding: 'AUD-1', result: 'open', note: 'Still investigating the alleged contradiction.', source: 'Synthetic access.md, navigation section' }];
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  input.review.audit_responses[0] = { finding: 'AUD-1', result: 'rejected', note: 'The actual draft keeps assignments authoritative; navigation changes no authorization contract.', source: 'Synthetic access.md, explicit assignment boundary; draft authorization paragraph' };
  const result = publishHandoff(dir, graph.hash, input);
  assert.equal(result.status, 'ready'); assert.equal(result.independent_audit, 'cleared-with-responses');
  assert.equal(readHandoff(dir, readGraph(dir)).audited, true);
  const document = fs.readFileSync(locations(dir).handoffJson, 'utf8');
  assert.ok(document.includes('"result": "blocked"')); assert.ok(document.includes('"result": "rejected"'));
});

test('responses cannot reject unknown/duplicate findings or omit the evidence pointer', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph); finding(input);
  const valid = { finding: 'AUD-1', result: 'rejected', note: 'The cited contract is outside the recorded scope.', source: 'Synthetic scope.md, scope boundary' };
  for (const responses of [[{ ...valid, finding: 'missing' }], [valid, valid], [{ ...valid, source: '' }]]) {
    input.review.audit_responses = responses;
    assert.throws(() => publishHandoff(dir, graph.hash, input), e => e.code === 'AUDIT');
  }
});

test('unavailable observations and unaccounted blocked checks remain blocked despite rejecting a separate finding', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph); finding(input);
  input.review.audit_responses = [{ finding: 'AUD-1', result: 'rejected', note: 'The alleged authorization claim is absent.', source: 'Synthetic actual draft, authorization paragraph' }];
  const report = input.review.independent_audit, source = report.checks.find(c => c.check === 'source_authority');
  source.result = 'unavailable'; source.note = 'A material primary source cannot be inspected with available read-only tools.';
  assert.equal(publishHandoff(dir, graph.hash, input).independent_audit, 'unavailable');
  source.result = 'blocked'; source.note = 'A separate source conflict remains unexplained.';
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
});

test('unavailable auditor cannot be replaced by a passing main review', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph);
  input.review.independent_audit.result = 'unavailable'; input.review.independent_audit.limits = ['The host cannot run a fresh restricted custom agent.'];
  const result = publishHandoff(dir, graph.hash, input);
  assert.equal(result.status, 'blocked'); assert.equal(result.independent_audit, 'unavailable');
});

test('independent reports must use the fresh bundled agent and known IDs, and malformed inputs are structured errors', t => {
  const dir = seed(t), graph = readGraph(dir);
  const bad = [
    report => { report.context = 'fork'; }, report => { report.auditor = 'generic-reviewer'; },
    report => { report.checks[0] = null; }, report => { report.checks[0].note = ''; },
    report => { report.findings = [null]; }, report => { report.limits = [null]; },
    report => { report.result = 'blocked'; }
  ];
  for (const mutate of bad) {
    const input = auditedInput(graph); mutate(input.review.independent_audit);
    assert.throws(() => publishHandoff(dir, graph.hash, input), e => e.code === 'AUDIT');
  }
  const input = auditedInput(graph); finding(input); input.review.independent_audit.findings[0].nodes = ['D-missing'];
  assert.throws(() => publishHandoff(dir, graph.hash, input), e => e.code === 'AUDIT');
  assert.equal(readGraph(dir).text, graph.text);
});

test('independent pass cannot override a main semantic blocker or known unresolved graph issue', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph);
  input.review.checks[0].result = 'blocked'; input.review.checks[0].note = 'The main review identified a separate unsupported assertion.';
  assert.equal(publishHandoff(dir, graph.hash, input).status, 'blocked');
  const blockedDir = seed(t, editNode(discoveryFixture, 'I-014', { blocking: true })), blocked = readGraph(blockedDir);
  assert.equal(publishHandoff(blockedDir, blocked.hash, auditedInput(blocked)).status, 'blocked');
});

test('editing a preserved independent assessment invalidates sealed publication metadata', t => {
  const dir = seed(t), graph = readGraph(dir), input = auditedInput(graph); publishHandoff(dir, graph.hash, input);
  const file = locations(dir).handoffJson; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('supplied hash bindings and synthetic assessment', 'altered independent assessment'));
  assert.equal(readHandoff(dir, readGraph(dir)).fresh, false);
});
