import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGraph, projectGraph, validateTransition, updateMeta, viewGraph, DiscoveryError, MAX_GRAPH_BYTES } from '../src/graph.mjs';
import { discoveryFixture, editNode, revise } from './helpers.mjs';

test('official parser reads metadata, native arguments and support directions', () => {
  const g = parseGraph(discoveryFixture);
  assert.equal(g.nodes.size, 11);
  assert.equal(g.nodes.get('A-004').format, 'argument');
  assert.ok(g.relations.some(r => r.from === 'E-021' && r.to === 'P-010B' && r.type === 'support'));
  assert.equal(projectGraph(g).readiness, 'ready');
});

test('block YAML metadata and CRLF remain ordinary Argdown', () => {
  const text = discoveryFixture.replace('{ "status": "open", "parent": null }', '{\nstatus: open\nparent: null\n}').replaceAll('\n', '\r\n');
  assert.equal(parseGraph(text).nodes.get('I-001').data.status, 'open');
});

test('undefined causal references are rejected', () => {
  assert.throws(() => parseGraph(editNode(discoveryFixture, 'Q-001', { based_on: ['E-missing'] })), e => e.code === 'SCHEMA');
});

test('structural parent cycles and cross-format duplicate IDs are rejected', () => {
  assert.throws(() => parseGraph(editNode(discoveryFixture, 'I-010', { parent: 'I-014' })), /inconsistent/);
  assert.throws(() => parseGraph(discoveryFixture + '\n<D-006>: Different node. #argument {issue: I-010, status: active}\n'), e => e.code === 'SCHEMA');
});

test('two definitions cannot silently merge into a different statement', () => {
  assert.throws(() => parseGraph(discoveryFixture + '\n[C-008]: A different scale. #constraint {status: agreed}\n'), e => e.details.some(x => x.includes('exactly once')));
});

test('issue topology is not misrepresented as proposition support', () => {
  assert.throws(() => parseGraph(discoveryFixture + '\n[I-001]\n    + [P-010B]\n'), e => e.details.some(x => x.includes('issue topology')));
});

test('frontmatter cannot override parser interpretation', () => {
  const g = parseGraph(updateMeta(parseGraph(discoveryFixture), {}).replace('"discovery": {', '"model": {"mode":"strict"},\n  "discovery": {'));
  assert.ok(g.relations.every(r => r.type === 'support'));
});

test('tentative evidence and rejected options do not become settled behavior', () => {
  const g = parseGraph(discoveryFixture + '\n[E-002]: Global search may support the workflow. #evidence {status: tentative}\n');
  const p = projectGraph(g);
  assert.ok(!p.settled.some(n => n.id === 'E-002'));
  assert.ok(!p.required_coverage.includes('P-010A'));
  assert.ok(p.rationale_context.some(n => n.id === 'P-010A'));
});

test('an unresolved issue is blocking by default, including when deferred', () => {
  let text = editNode(discoveryFixture, 'I-014', { blocking: true });
  assert.ok(projectGraph(parseGraph(text)).blockers.some(b => b.id === 'I-014'));
  text += '\n[I-020]: What is the permission boundary? #issue {status: open, parent: I-001}\n';
  assert.ok(projectGraph(parseGraph(text)).blockers.some(b => b.id === 'I-020'));
});

test('nonblocking classification needs a reason and cannot hide a current constraint', () => {
  assert.throws(() => parseGraph(editNode(discoveryFixture, 'I-014', { nonblocking_reason: '' })), /inconsistent/);
  const p = projectGraph(parseGraph(editNode(discoveryFixture, 'C-008', { handoff: 'omit' })));
  assert.ok(p.required_coverage.includes('C-008'));
});

test('challenging a decision blocks its material consequences transitively', () => {
  let text = editNode(discoveryFixture, 'I-010', { status: 'open', resolved_by: null });
  text = editNode(text, 'D-006', { status: 'challenged', challenged_by: ['I-014'] });
  text = editNode(text, 'P-010B', { status: 'proposed' });
  const p = projectGraph(parseGraph(text));
  assert.equal(p.readiness, 'blocked');
  assert.ok(p.blockers.some(b => b.id === 'D-006'));
  assert.ok(p.blockers.some(b => b.id === 'Q-001'));
  assert.ok(!p.settled.some(n => n.id === 'D-006'));
});

test('stale evidence behind an argument blocks the dependent commitment', () => {
  const text = editNode(discoveryFixture, 'E-021', { status: 'stale', handoff: 'omit' });
  const p = projectGraph(parseGraph(text));
  assert.ok(p.blockers.some(b => b.id === 'D-006'));
});

test('unverified assumptions are explicit and block by default', () => {
  const extra = '\n[H-001]: Queue size stays below a thousand. #assumption {status: unverified, validation: "Measure production queue sizes"}\n';
  const p = projectGraph(parseGraph(discoveryFixture + extra));
  assert.ok(p.blockers.some(b => b.id === 'H-001'));
  assert.ok(p.assumptions.some(n => n.id === 'H-001'));
});

test('source pointers behind a decision are available to the handoff reviewer', () => {
  const text = editNode(discoveryFixture, 'E-021', { handoff: 'omit', sources: [{kind:'doc',ref:'ops.md',authority:'observed'}] });
  assert.ok(projectGraph(parseGraph(text)).sources.some(s => s.ref === 'ops.md'));
});

test('accepted decisions and resolved issues must agree', () => {
  assert.throws(() => parseGraph(editNode(discoveryFixture, 'I-010', { status: 'open', resolved_by: null })), /inconsistent/);
  assert.throws(() => parseGraph(editNode(discoveryFixture, 'D-006', { status: 'challenged', challenged_by: ['I-014'] })), /inconsistent/);
});

test('a changed resolution cannot rewrite historical rationale', () => {
  const old = parseGraph(discoveryFixture);
  const next = parseGraph(revise(editNode(discoveryFixture, 'D-006', { rationale: 'Another explanation.' })));
  assert.throws(() => validateTransition(old, next), e => e.code === 'HISTORY');
});

test('reaffirmation needs fresh preserved review reasoning', () => {
  let challenged = editNode(discoveryFixture, 'I-010', { status: 'open', resolved_by: null });
  challenged = editNode(challenged, 'D-006', { status: 'challenged', challenged_by: ['I-014'] });
  challenged = editNode(challenged, 'P-010B', { status: 'proposed' });
  const previous = parseGraph(challenged);
  let accepted = editNode(challenged, 'I-010', { status: 'resolved', resolved_by: 'D-006' });
  accepted = editNode(accepted, 'P-010B', { status: 'accepted' });
  accepted = revise(editNode(accepted, 'D-006', { status: 'accepted' }));
  assert.throws(() => validateTransition(previous, parseGraph(accepted)), e => e.code === 'HISTORY');
  accepted = editNode(accepted, 'D-006', { reaffirmed_by: ['V-005'] }) + '\n[V-005]: The queue does not dictate navigation hierarchy. #review {status: confirmed, decision: D-006, based_on: [], rationale: "The same user choice is still appropriate for the reviewed scope."}\n';
  assert.doesNotThrow(() => validateTransition(previous, parseGraph(accepted)));
});

test('malformed schema values return structured errors rather than TypeErrors', () => {
  for (const patch of [{sources: {}}, {based_on: 'E-021'}, {alternatives: 123}, {resolves: []}, {challenged_by: {}}, {status:'unknown'}]) {
    assert.throws(() => parseGraph(editNode(discoveryFixture, 'D-006', patch)), e => e instanceof DiscoveryError, JSON.stringify(patch));
  }
  assert.throws(() => parseGraph(discoveryFixture.replace('"schema": 2', '"schema": 999')), e => e.code === 'SCHEMA');
});

test('invalid YAML and excessive inputs are rejected', () => {
  assert.throws(() => parseGraph(discoveryFixture.replace('"status": "agreed"', '"status": [}')), e => e.code === 'ARGDOWN');
  assert.throws(() => parseGraph('x'.repeat(MAX_GRAPH_BYTES + 1)), e => e.code === 'SIZE');
});

test('reaffirmation evidence participates in current dependency and source review', () => {
  const review = '\n[V-005]: A fresh finding revalidates navigation. #review {status: confirmed, decision: D-006, based_on: ["E-022"], rationale: "Review navigation against the changed queue contract."}\n\n[E-022]: Queue behavior has changed. #evidence {status: stale, sources: [{kind: spec, ref: "queue.md", authority: normative}]}\n';
  const p = projectGraph(parseGraph(editNode(discoveryFixture,'D-006',{reaffirmed_by:['V-005']}) + review));
  assert.ok(p.blockers.some(b => b.id === 'V-005'));
  assert.ok(p.sources.some(s => s.ref === 'queue.md'));
});

test('an accepted decision cannot accept a merely proposed position', () => {
  assert.throws(() => parseGraph(editNode(discoveryFixture,'P-010B',{status:'proposed'})), e => e.code === 'SCHEMA');
});

test('supersession preserves rationale while retiring derived target behavior', () => {
  const old = parseGraph(discoveryFixture);
  let text = editNode(discoveryFixture,'D-006',{status:'superseded',superseded_by:'D-007'});
  text = editNode(text,'P-010B',{status:'rejected'});
  text = editNode(text,'P-010A',{status:'accepted'});
  text = editNode(text,'Q-001',{status:'superseded'});
  text = editNode(text,'I-010',{resolved_by:'D-007',resolution_history:['D-006','D-007']});
  text += '\n[D-007]: Locations define navigation for the revised single-location scope. #decision {status: accepted, resolves: [I-010], basis: user, selected: [P-010A], based_on: [], rationale: "The user narrowed the initial release to a single-location user.", sources: [{kind: user, ref: "Revised release scope agreement", authority: intent}]}\n';
  const next = parseGraph(revise(text));
  assert.doesNotThrow(() => validateTransition(old,next));
  const p = projectGraph(next);
  assert.ok(p.settled.some(n => n.id === 'D-007'));
  assert.ok(!p.settled.some(n => ['D-006','Q-001'].includes(n.id)));
  assert.equal(next.nodes.get('D-006').data.rationale,old.nodes.get('D-006').data.rationale);
});

// Each case breaks exactly one rule and expects that rule's own message, so removing
// any single check fails here instead of hiding behind another SCHEMA error.
test('each integrity rule reports its own violation', async t => {
  const append = (...lines) => `${discoveryFixture}\n${lines.join('\n\n')}\n`;
  const user = '"basis":"user","based_on":[],"sources":[{"kind":"user","ref":"Fixture","authority":"intent"}]';
  const cases = [
    ['selected Position belongs to a resolved Issue', editNode(append('[P-014A]: A visual badge. #position {"status":"proposed","issue":"I-014"}'), 'D-006', { selected: ['P-010B', 'P-014A'] }), /selected position belongs to an unrelated issue/],
    ['assumption names its validation', append('[S-001]: Users accept a badge. #assumption {"status":"unverified","blocking":false,"nonblocking_reason":"Styling only."}'), /an assumption needs a way to validate it/],
    ['authority basis cites a normative source', editNode(discoveryFixture, 'D-006', { basis: 'authority' }), /an authority judgment needs a normative source/],
    ['supersedes matches the successor pointer', append('[E-901]: A newer finding. #evidence {"status":"tentative","supersedes":"E-021"}'), /supersedes must match/],
    ['dropped Issue gives a reason', editNode(discoveryFixture, 'I-014', { status: 'dropped' }), /a dropped issue needs a reason/],
    ['reaffirmed_by holds reviews of this Decision', append('[V-001]: Still holds. #review {"status":"confirmed","decision":"D-006","based_on":[],"rationale":"Unchanged."}',
      `[D-007]: An earlier styling choice. #decision {"status":"withdrawn","resolves":["I-014"],"rationale":"Withdrawn.","reaffirmed_by":["V-001"],${user}}`), /reaffirmed_by must contain reviews of this decision/],
    ['successor covers every Issue of its predecessor', append(`[D-007]: Old styling. #decision {"status":"superseded","superseded_by":"D-008","resolves":["I-014"],"rationale":"Old.",${user}}`,
      `[D-008]: New styling. #decision {"status":"withdrawn","resolves":["I-010"],"rationale":"New.",${user}}`), /successor must account for every issue/],
    ['source sha256 is 64 lowercase hex', editNode(discoveryFixture, 'E-021', { sources: [{ kind: 'user', ref: 'Fixture', authority: 'intent', sha256: 'abc' }] }), /sha256 must contain 64 lowercase hexadecimal/],
    ['handoff hint is a known category', editNode(discoveryFixture, 'Q-001', { handoff: 'bogus' }), /unknown handoff category/],
    ['focus references an Issue', discoveryFixture.replace('"focus": "I-014"', '"focus": "E-021"'), /discovery\.focus must reference an issue/],
    ['frontmatter fits in 64 KiB', discoveryFixture.replace('"title": "Resource workflow"', `"title": "${'x'.repeat(70000)}"`), /Frontmatter exceeds 64 KiB/],
  ];
  for (const [name, text, expected] of cases) await t.test(name, () => {
    assert.notEqual(text, discoveryFixture);
    assert.throws(() => parseGraph(text), e => e.code === 'SCHEMA' && e.details.some(detail => expected.test(detail)));
  });
  await t.test('an invalid based_on is reported once', () => {
    assert.throws(() => parseGraph(editNode(discoveryFixture, 'D-006', { based_on: 'E-021' })),
      e => e.details.filter(detail => detail.includes('based_on must be')).length === 1);
  });
  await t.test('superseded nodes stay historical', () => {
    const superseded = parseGraph(editNode(discoveryFixture, 'E-021', { status: 'superseded' }));
    assert.throws(() => validateTransition(superseded, parseGraph(revise(discoveryFixture))), e => e.details.some(d => d.includes('superseded nodes remain historical')));
  });
});

test('view returns the exact neighborhood and reports truncation', () => {
  const g = parseGraph(discoveryFixture), ids = view => view.nodes.map(n => n.id).sort();
  assert.deepEqual(ids(viewGraph(g, ['I-010'], 0)), ['I-010']);
  assert.deepEqual(ids(viewGraph(g, ['I-010'], 1)), ['A-004', 'C-012', 'D-006', 'E-021', 'I-001', 'I-010', 'I-014', 'P-010A', 'P-010B']);
  let text = discoveryFixture;
  for (let i = 0; i < 90; i++) text += `\n[E-W${i}]: Finding ${i}. #evidence {"status":"tentative","issue":"I-010"}\n`;
  const wide = viewGraph(parseGraph(text), ['I-010'], 1);
  assert.equal(wide.nodes.length, 80);
  assert.equal(wide.truncated, true);
  assert.equal(wide.omitted_count, 99 - 80);
});
