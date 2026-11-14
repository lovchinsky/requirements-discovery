import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGraph, serializeGraph, sha256, canonical, KINDS } from '../src/graph.mjs';
import { classifyGraph, draftHandoff, RENDERER } from '../src/render.mjs';
import { readGraph, readHandoff, locations } from '../src/storage.mjs';
import { publishHandoff, previewHandoff, prepareAudit, setLifecycle, patchGraph, handoffStatus } from '../src/operations.mjs';
import { ROOT, seed, discoveryFixture, editNode, draft, FIXTURE_CONCLUSIONS } from './helpers.mjs';

const fixtures = path.join(ROOT, 'tests', 'fixtures');
const rich = fs.readFileSync(path.join(fixtures, 'handoff.argdown'), 'utf8');
// The rich fixture's branches that were not chosen, concluded as an agent would.
const RICH = [
  { issue: 'I-010', covers: ['P-010A', 'A-009', 'I-030', 'E-031'], text: 'A workspace hierarchy did not fit: thirty workspace roots need scrolling on every visit; the older click-cost wording gave way to A-017.' },
  { issue: 'I-014', covers: ['P-014B'], text: 'A plain label was not distinctive enough.' },
  { issue: 'I-020', covers: ['P-020'], text: '1. Roles were only a hypothesis; assignments are the recorded fact.' },
  { issue: 'I-001', covers: ['AS-003'], text: '[x] Cross-workspace work is real, so this assumption was invalidated.' },
];
const user = '"sources":[{"kind":"user","ref":"Fixture statement","authority":"intent"}]';
const classOf = (text, id) => { const c = classifyGraph(parseGraph(text)); return c.current.has(id) ? 'current' : c.retained.has(id) ? 'retained' : c.history.has(id) ? 'history' : 'pruned'; };
const rejected = (graph, conclusions, pattern) => assert.throws(() => draftHandoff(graph, { conclusions }), e => e.code === 'CONCLUSION' && e.details.some(d => pattern.test(d)), pattern);
// The Markdown of one question, from its heading to the next heading of any question.
const section = (body, id) => { const rest = body.slice(body.search(new RegExp(`^#+ \\[${id}\\]`, 'm'))), line = rest.indexOf('\n'), next = rest.slice(line).search(/\n#{1,6} /); return next < 0 ? rest : rest.slice(0, line + next); };
const reseal = (file, change) => {
  const { metadata_sha256, ...data } = JSON.parse(fs.readFileSync(file, 'utf8')); change(data);
  fs.writeFileSync(file, JSON.stringify({ ...data, metadata_sha256: sha256(canonical(data)) }, null, 2) + '\n');
};

test('the rendered handoff matches its golden files byte for byte', () => {
  // A deliberate change of the output must update these files and bump RENDERER.
  const graph = parseGraph(rich);
  for (const language of ['en', 'uk']) assert.equal(draftHandoff(graph, { language, conclusions: RICH }).body, fs.readFileSync(path.join(fixtures, `handoff.${language}.md`), 'utf8'), language);
  assert.equal(RENDERER, 1);
});

test('rendering depends only on the graph meaning, the language and the conclusions', () => {
  const graph = parseGraph(rich), body = draftHandoff(graph, { conclusions: RICH }).body;
  assert.equal(draftHandoff(serializeGraph(graph), { conclusions: RICH }).body, body, 'a canonical reserialization renders the same bytes');
  const permuted = RICH.map(c => ({ ...c, covers: [...c.covers].reverse(), text: `  ${c.text}\n ` }));
  assert.equal(draftHandoff(graph, { conclusions: permuted }).body, body, 'cover order and whitespace do not matter');
  assert.equal(draftHandoff(graph, { language: 'uk-UA', conclusions: RICH }).body, draftHandoff(graph, { language: 'uk', conclusions: RICH }).body);
});

test('every status of every kind has one class, decided by its own lifecycle and links', () => {
  const add = text => discoveryFixture + `\n${text}\n`;
  const cases = {
    issue: s => [add(`[I-T]: A test question? #issue {"status":"${s}","parent":"I-001"${s === 'resolved' ? ',"resolved_by":"E-T","resolution_history":["E-T"]' : s === 'dropped' ? ',"reason":"Not needed."' : ''}}` +
      (s === 'resolved' ? `\n\n[E-T]: A test fact. #evidence {"status":"verified",${user}}` : '')), 'I-T', { open: 'current', deferred: 'current', resolved: 'current', dropped: 'pruned' }],
    position: s => s === 'accepted' ? [discoveryFixture, 'P-010B', { accepted: 'current' }] : [add(`[P-T]: A test option. #position {"status":"${s}","issue":"I-014"}`), 'P-T', { proposed: 'current', rejected: 'pruned', withdrawn: 'pruned' }],
    argument: s => [add(`<A-T>: A test argument. #argument {"status":"${s}","issue":"I-010"}`), 'A-T', { active: 'current', retired: 'pruned' }],
    evidence: s => [add(`[E-T]: A test fact. #evidence {"status":"${s}",${user}}`), 'E-T', { verified: 'current', tentative: 'current', contested: 'current', stale: 'pruned', superseded: 'pruned' }],
    constraint: s => [add(`[C-T]: A test boundary. #constraint {"status":"${s}",${user}}`), 'C-T', { proposed: 'current', agreed: 'current', verified: 'current', challenged: 'current', superseded: 'pruned' }],
    assumption: s => [add(`[AS-T]: A test assumption. #assumption {"status":"${s}","validation":"Ask."}`), 'AS-T', { unverified: 'current', validated: 'current', invalidated: 'pruned' }],
    consequence: s => [add(`[Q-T]: A test implication. #consequence {"status":"${s}","derives_from":"D-006"}`), 'Q-T', { current: 'current', challenged: 'current', superseded: 'history' }],
    review: s => [add(`[V-T]: A test review. #review {"status":"${s}","decision":"D-006","based_on":[],"rationale":"Checked."}`), 'V-T', { confirmed: 'current', challenged: 'current' }],
    decision: s => {
      if (s === 'accepted') return [discoveryFixture, 'D-006', { accepted: 'current' }];
      let text = editNode(discoveryFixture, 'I-010', { status: 'open' }).replace('"resolved_by":"D-006",', '');
      text = editNode(text, 'P-010B', { status: 'proposed' });
      if (s === 'challenged') return [editNode(text, 'D-006', { status: 'challenged', challenged_by: ['E-021'] }), 'D-006', { challenged: 'current' }];
      text = editNode(text, 'Q-001', { status: 'superseded' });
      if (s === 'withdrawn') return [editNode(text, 'D-006', { status: 'withdrawn' }), 'D-006', { withdrawn: 'history' }];
      text = editNode(editNode(text, 'D-006', { status: 'superseded', superseded_by: 'D-007' }), 'I-010', { status: 'resolved', resolved_by: 'D-007', resolution_history: ['D-006', 'D-007'] });
      return [`${text}\n[D-007]: A later navigation judgment. #decision {"status":"accepted","resolves":["I-010"],"basis":"user","based_on":[],"rationale":"Changed.",${user}}\n`, 'D-006', { superseded: 'history' }];
    },
  };
  for (const [kind, statuses] of Object.entries(KINDS)) for (const status of statuses) {
    const [text, id, expected] = cases[kind](status);
    assert.ok(Object.hasOwn(expected, status), `${kind}/${status} needs an expected class`);
    assert.equal(classOf(text, id), expected[status], `${kind}/${status}`);
  }
});

test('a retired node never becomes current: an open question depending on it leaves it in history', () => {
  let text = editNode(discoveryFixture, 'D-006', { status: 'superseded', superseded_by: 'D-007' });
  text = editNode(text, 'I-010', { resolved_by: 'D-007', resolution_history: ['D-006', 'D-007'] });
  text = editNode(text, 'Q-001', { status: 'superseded' }) + `\n[D-007]: A later judgment. #decision {"status":"accepted","resolves":["I-010"],"selected":["P-010B"],"basis":"user","based_on":[],"rationale":"Changed.",${user}}\n\n[I-060]: A later question. #issue {"status":"deferred","parent":"I-001","depends_on":["D-006"],"blocking":false,"nonblocking_reason":"Later."}\n`;
  const { body } = draftHandoff(parseGraph(text), { conclusions: FIXTURE_CONCLUSIONS });
  assert.ok(!body.includes('**Decision [D-006]**'));
  assert.match(section(body, 'I-010'), /\*\*Decision \[D-007\]\*\*[\s\S]*- Earlier versions: \[D-006\]/);
  assert.match(section(body, 'I-060'), /- Depends on: \[D-006\]/);
});

test('what the operative state relies on although it is retired is shown with its text and its referrers', () => {
  // A current consequence of a superseded decision keeps that decision operative: a blocker, shown in full.
  let text = editNode(discoveryFixture, 'D-006', { status: 'superseded', superseded_by: 'D-007' });
  text = editNode(text, 'I-010', { resolved_by: 'D-007', resolution_history: ['D-006', 'D-007'] }) + `\n[D-007]: A later judgment. #decision {"status":"accepted","resolves":["I-010"],"selected":["P-010B"],"basis":"user","based_on":[],"rationale":"Changed.",${user}}\n`;
  const { body } = draftHandoff(parseGraph(text), { conclusions: FIXTURE_CONCLUSIONS });
  assert.equal(classOf(text, 'D-006'), 'retained');
  assert.match(body, /## Outside the current state, still referenced\n\n\*\*Decision \[D-006\]\*\* _\(superseded · basis: user intent\)_\n\n> Use operations-first navigation[\s\S]*- Referenced by: \[Q-001\]/);
});

test('history lists earlier versions, resolutions and reviews beside their record, for every kind', () => {
  let text = editNode(discoveryFixture, 'D-006', { reaffirmed_by: ['V-001', 'V-002'] });
  text += `\n[V-001]: First review. #review {"status":"confirmed","decision":"D-006","based_on":["E-021"],"rationale":"First."}\n\n[V-000]: A corrected review text. #review {"status":"confirmed","decision":"D-006","based_on":[],"rationale":"Older.","superseded_by":"V-002"}\n\n[V-002]: Second review. #review {"status":"confirmed","decision":"D-006","based_on":["C-008"],"rationale":"Second."}\n\n[V-003]: A later objection. #review {"status":"challenged","decision":"D-006","based_on":[],"rationale":"The scale may grow."}\n\n[E-030]: Oldest scale fact. #evidence {"status":"superseded","superseded_by":"E-031",${user}}\n\n[E-031]: Older scale fact. #evidence {"status":"superseded","superseded_by":"E-032",${user}}\n\n[E-032]: Current scale fact. #evidence {"status":"verified",${user}}\n`;
  const { body } = draftHandoff(parseGraph(text), { conclusions: FIXTURE_CONCLUSIONS });
  assert.match(body, /- Reaffirmed by review \*\*\[V-002\]\*\*/);
  assert.match(body, /- Review \*\*\[V-003\]\*\* _\(challenged\)_: A later objection\.\n {2}- Rationale: The scale may grow\./, 'an objection outside the chain stays current');
  assert.match(body, /- Earlier reviews: \[V-001\]/);
  assert.match(body, /\*\*\[V-002\]\*\*[\s\S]*- Earlier versions: \[V-000\]/, 'a superseded review is a version of its successor');
  assert.match(body, /\*\*\[E-032\]\*\*[\s\S]*- Earlier versions: \[E-030\] → \[E-031\]/);
  assert.match(body, /- Initial basis \(the latest review supplies the current one\): \[E-021\], \[C-008\], \[C-012\], \[A-004\]/);
});

test('a challenged decision whose question was dropped still renders as a decision', () => {
  let text = editNode(discoveryFixture, 'I-010', { status: 'dropped', reason: 'The question was withdrawn.' }).replace('"resolved_by":"D-006",', '');
  text = editNode(editNode(text, 'P-010B', { status: 'proposed' }), 'D-006', { status: 'challenged', challenged_by: ['E-021'] });
  text = editNode(text, 'I-014', { parent: 'I-001' }) + '\n[V-080]: An earlier review. #review {"status":"confirmed","decision":"D-006","based_on":[],"rationale":"Earlier."}\n';
  // The dropped question concludes itself and its options; the challenged decision stays current under the nearest current question.
  const { body, uncovered } = draftHandoff(parseGraph(text), {});
  assert.deepEqual(uncovered, []);
  assert.match(section(body, 'I-001'), /\*\*Decision \[D-006\]\*\* _\(challenged · basis: user intent\)_[\s\S]*- Rationale: This supports cross-workspace workflows/);
  assert.match(section(body, 'I-001'), /- \*\*\[I-010\]\*\* What defines primary navigation\? _\(dropped\)_ — dropped: The question was withdrawn\.\n {2}- Branch: \[P-010A\]/);
  // Its former choice is still selected by the operative decision, so it is shown as referenced, with its text.
  assert.match(body, /## Outside the current state, still referenced\n\n- \*\*\[P-010B\]\*\* Operational areas define navigation[\s\S]*- Referenced by: \[D-006\]/);
  assert.match(section(body, 'I-001'), /\*\*Arguments\*\*\n\n- \*\*\[A-004\]\*\*/, 'an argument the decision relies on stays current');
  assert.match(body, /- Review \*\*\[V-080\]\*\*/);
});

test('a conclusion folds an abandoned exploration only when the branch is closed', () => {
  const graph = parseGraph(rich), base = RICH.slice(1);
  assert.doesNotThrow(() => draftHandoff(graph, { conclusions: RICH }));
  const with10 = covers => [{ issue: 'I-010', covers: ['P-010A', 'A-009', ...covers], text: 'Folded.' }, ...base];
  rejected(graph, with10(['E-031']), /E-031: I-030 still depends on it/);
  rejected(graph, with10(['I-030', 'E-031', 'D-007']), /D-007: a current decision \(accepted\) is a commitment/);
  rejected(graph, with10(['I-030', 'E-031', 'P-010B']), /P-010B: a current position \(accepted\)/);
  rejected(graph, with10(['I-030', 'E-031', 'P-014A']), /P-014A: a current position \(proposed\)/);
  rejected(graph, with10(['I-030', 'E-031', 'Q-001']), /Q-001: a current consequence \(current\)/);
  rejected(graph, with10(['I-030', 'E-031', 'C-008']), /C-008: a current constraint \(agreed\)/);
  rejected(graph, with10(['I-030', 'E-031', 'AS-001']), /AS-001: a current assumption \(unverified\)/);
  rejected(graph, with10(['I-030', 'E-031', 'I-014']), /I-014: a current issue \(deferred\)/);
  rejected(graph, with10(['I-030', 'E-031', 'I-020', 'E-030']), /I-020: not under I-010; a conclusion folds the questions of its own branch/, 'an unrelated fact question cannot be folded into this branch');
  rejected(graph, [{ issue: 'I-001', covers: ['AS-003', 'E-050'], text: 'Unrelated.' }, ...RICH.slice(0, 3)], /E-050: bears on A-017|E-050: not linked/);
  rejected(graph, with10(['I-030', 'E-031', 'E-021']), /E-021: a current evidence \(verified\) is a commitment/);
  rejected(graph, with10(['I-030', 'E-031', 'A-017']), /A-017: bears on P-010B, which stays current/);
  rejected(graph, with10(['I-030', 'E-031', 'E-050']), /E-050: bears on A-017, which stays current/);
  rejected(graph, with10(['I-030', 'E-031', 'D-006']), /D-006: a version record of D-007/);
  rejected(graph, [{ issue: 'I-040', covers: ['P-010A', 'A-009', 'I-030', 'E-031'], text: 'Anchored at a dropped question.' }, ...base], /I-040 is not in the current tree/);
  rejected(graph, [{ issue: 'I-030', covers: ['P-010A', 'A-009', 'I-030', 'E-031'], text: 'Anchored inside the fold.' }, ...base], /I-030 is not in the current tree/);
  rejected(graph, [{ issue: 'D-007', covers: ['P-010A'], text: 'Not an issue.' }], /D-007 is not an issue/);
  rejected(graph, [...RICH, { issue: 'I-010', covers: ['P-010A'], text: 'Twice.' }], /P-010A: covered by conclusions 1 and 5/);
  rejected(graph, [...RICH.slice(0, 3), { issue: 'I-001', covers: ['AS-003', 'I-404'], text: 'Unknown.' }], /I-404 is not a node/);
  const nested = parseGraph(rich + '\n[I-031]: A deeper question in the abandoned branch? #issue {"status":"resolved","parent":"I-030","resolved_by":"E-032","resolution_history":["E-032"]}\n\n[E-032]: A deeper fact. #evidence {"status":"verified",' + user + '}\n');
  rejected(nested, RICH, /I-031: belongs to folded I-030/);
});

test('a question settled by a current decision cannot be folded, even as a leaf the closure would let go', () => {
  let text = editNode(discoveryFixture, 'D-006', { resolves: ['I-010', 'I-050'] });
  text += '\n[I-050]: Which label does the switcher use? #issue {"status":"resolved","parent":"I-010","resolved_by":"D-006","resolution_history":["D-006"]}\n';
  rejected(parseGraph(text), [{ issue: 'I-010', covers: ['P-010A', 'I-050'], text: 'Folded.' }], /I-050: a current issue \(resolved\) is a commitment/);
});

test('folding suggestions are closed branches that the helper itself accepts', () => {
  const graph = parseGraph(rich), { fold_candidates, uncovered } = draftHandoff(graph, {}, { strict: false });
  assert.deepEqual(fold_candidates, ['E-031', 'I-030']);
  assert.deepEqual(uncovered.map(g => [g.issue, g.nodes.map(n => n.id)]), [['I-001', ['AS-003']], ['I-010', ['P-010A', 'A-009']], ['I-014', ['P-014B']], ['I-020', ['P-020']]]);
  assert.equal(uncovered[1].nodes[0].text, 'Workspaces define the root navigation hierarchy.');
  assert.doesNotThrow(() => draftHandoff(graph, { conclusions: uncovered.map(g => ({ issue: g.issue, covers: [...g.nodes.map(n => n.id), ...(g.issue === 'I-010' ? fold_candidates : [])], text: 'Suggested.' })) }));
});

test('an argument that presupposes an option that was left belongs to that branch', () => {
  const graph = parseGraph(discoveryFixture + '\n<A-099>: Under a workspace hierarchy, roots need sorting. #argument {"status":"active","issue":"I-010","based_on":["P-010A"]}\n');
  assert.deepEqual(draftHandoff(graph, {}, { strict: false }).uncovered.map(g => g.nodes.map(n => n.id)), [['P-010A', 'A-099']]);
  assert.doesNotThrow(() => draftHandoff(graph, { conclusions: [{ issue: 'I-010', covers: ['P-010A', 'A-099'], text: 'The hierarchy line did not fit.' }] }));
});

test('a dropped question concludes itself with its reason and the options and arguments attached to it', () => {
  const graph = parseGraph(discoveryFixture + '\n[I-040]: Should workspaces have their own landing pages? #issue {"status":"dropped","parent":"I-010","reason":"Operations-first navigation removes the need for workspace roots."}\n\n[P-040]: One landing page per workspace. #position {"status":"proposed","issue":"I-040"}\n\n<A-040>: Landing pages duplicate the switcher. #argument {"status":"active","issue":"I-040"}\n');
  const { body, uncovered } = draftHandoff(graph, { conclusions: FIXTURE_CONCLUSIONS });
  assert.deepEqual(uncovered, []);
  assert.match(section(body, 'I-010'), /- \*\*\[I-040\]\*\* Should workspaces have their own landing pages\? _\(dropped\)_ — dropped: Operations-first navigation removes the need for workspace roots\.\n {2}- Branch: \[P-040\], \[A-040\]/);
  assert.ok(!body.includes('One landing page per workspace.') && !body.includes('Landing pages duplicate the switcher.'));
});

test('a conclusion anchored elsewhere leaves a pointer under the question its branch belongs to', () => {
  const { body } = draftHandoff(parseGraph(discoveryFixture), { conclusions: [{ ...FIXTURE_CONCLUSIONS[0], issue: 'I-001' }] });
  assert.match(section(body, 'I-001'), /- Fictional fixture only: a workspace hierarchy did not fit cross-workspace work\.\n {2}- Branch: \[P-010A\]/);
  assert.match(section(body, 'I-010'), /- Summarized under \[I-001\]: \[P-010A\]/);
});

test('every recorded field of a current node is rendered, and notes about folded options keep only their IDs', () => {
  let text = editNode(discoveryFixture, 'C-012', { rationale: 'The contract forbids implied access.', owner: { 'E-021': 'cross-workspace work' }, revisit: true });
  text = editNode(text, 'D-006', { deferred: ['P-010A'], rejection_reasons: { 'P-010A': 'A per-option reason.' }, rejected_reason: { 'P-010A': 'Another spelling.' } });
  text += '\n[E-090]: A fact with a blocking note. #evidence #ui {"status":"verified","blocking":false,"nonblocking_reason":"It only informs styling.","issue":"I-014",' + user + '}\n';
  const { body } = draftHandoff(parseGraph(text), { conclusions: FIXTURE_CONCLUSIONS });
  assert.match(body, /\*\*\[C-012\]\*\*[\s\S]*- rationale: The contract forbids implied access\.\n {2}- owner:\n {4}- \[E-021\]: cross-workspace work\n {2}- revisit: true/);
  assert.match(body, /\*\*\[E-090\]\*\* A fact with a blocking note\. _\(verified · #ui\)_\n {2}- Question: \[I-014\]\n {2}- Not blocking: It only informs styling\./);
  assert.match(body, /- deferred: \[P-010A\]\n- rejection reasons: \[P-010A\]\n- rejected reason: \[P-010A\]/);
  assert.ok(!body.includes('A per-option reason.') && !body.includes('Another spelling.'));
});

test('the review inventory covers the sources of every node shown with its text', t => {
  const dir = seed(t), spec = path.join(dir, 'contract.txt');
  fs.writeFileSync(spec, 'The contract says X.\n');
  patchGraph(dir, readGraph(dir).hash, { add: [{ id: 'E-900', kind: 'evidence', text: 'The contract file says X.', data: { status: 'verified', sources: [{ kind: 'spec', ref: 'contract.txt', authority: 'normative', sha256: sha256(fs.readFileSync(spec)) }] } }] });
  const input = draft(readGraph(dir));
  assert.ok(previewHandoff(dir, { conclusions: FIXTURE_CONCLUSIONS }).review.sources.some(s => s.source.ref === 'contract.txt'), 'the preview template lists it');
  fs.writeFileSync(spec, 'The contract now says Y.\n');
  assert.ok(previewHandoff(dir, { conclusions: FIXTURE_CONCLUSIONS }).blockers.some(b => b.reason.includes('snapshot changed: contract.txt')));
  assert.equal(publishHandoff(dir, readGraph(dir).hash, input).status, 'blocked');
});

test('labels exist for en and uk only; any other language is refused rather than silently replaced', t => {
  const graph = parseGraph(discoveryFixture);
  for (const language of ['fr', 'ua', 'zz-Fake']) assert.throws(() => draftHandoff(graph, { language, conclusions: FIXTURE_CONCLUSIONS }), e => e.code === 'INPUT' && /supported label language: en, uk/.test(e.message), language);
  const dir = seed(t), input = { ...draft(readGraph(dir)), language: 'uk' };
  delete input.review;
  assert.equal(publishHandoff(dir, readGraph(dir).hash, input).status, 'blocked');
  assert.match(fs.readFileSync(locations(dir).handoff, 'utf8'), /^> ЗАБЛОКОВАНО — це чернетка discovery/);
  assert.equal(readHandoff(dir, readGraph(dir)).reproduction, 'reproducible');
});

test('input is validated with messages that name the problem', () => {
  const graph = parseGraph(discoveryFixture), c = { issue: 'I-010', covers: ['P-010A'], text: 'x' };
  for (const [input, message] of [[{ body: '# Draft', covers: [] }, /rendered from the graph/], [{ conclusions: [], notes: 'x' }, /Unknown handoff input fields: notes/],
    [{ conclusions: {} }, /must be an array/], [{ conclusions: [{ ...c, extra: 1 }] }, /use exactly \{issue, covers, text\}/], [{ conclusions: [{ ...c, issue: 'i10' }] }, /issue must be the ID/],
    [{ conclusions: [{ ...c, covers: [] }] }, /nonempty array of unique/], [{ conclusions: [{ ...c, covers: ['P-010A', 'P-010A'] }] }, /nonempty array of unique/],
    [{ conclusions: [{ ...c, text: ' ' }] }, /short nonempty conclusion/], [{ conclusions: [{ ...c, text: 'x'.repeat(2001) }] }, /at most 2000/], [{ audit_requested: 'yes' }, /must be boolean/]]) {
    assert.throws(() => draftHandoff(graph, input), e => e.code === 'INPUT' && message.test(e.message), message);
  }
});

test('the preview reports branches, suggestions, language and the previous render inputs of this discovery only', t => {
  const dir = seed(t), p = locations(dir);
  const first = previewHandoff(dir, { language: 'uk' });
  assert.equal(first.concluded, false); assert.equal(first.language, 'uk'); assert.equal(first.renderer, RENDERER); assert.equal(first.previous, undefined);
  assert.deepEqual(first.branches, { unconcluded: [{ issue: 'I-010', nodes: [{ id: 'P-010A', kind: 'position', status: 'rejected', text: 'Workspaces define the root navigation hierarchy.' }] }], fold_candidates: [] });
  const input = { ...draft(readGraph(dir)), language: 'uk' };
  input.review.body_sha256 = sha256(draftHandoff(readGraph(dir), input).body);
  assert.equal(publishHandoff(dir, readGraph(dir).hash, input).status, 'ready');
  setLifecycle(dir, readGraph(dir).hash, 'active');
  assert.deepEqual(previewHandoff(dir, {}).previous, { language: 'uk', conclusions: input.conclusions });
  const metadata = fs.readFileSync(p.handoffJson, 'utf8');
  fs.writeFileSync(p.handoffJson, metadata.replace('"language": "uk"', '"language": "en"'));
  assert.equal(previewHandoff(dir, {}).previous, undefined, 'a broken seal offers nothing');
  fs.writeFileSync(p.handoffJson, metadata); reseal(p.handoffJson, data => { data.discovery_id = 'RD-other'; });
  assert.equal(previewHandoff(dir, {}).previous, undefined, 'another discovery offers nothing');
});

test('handoff-status says whether the graph and recorded inputs reproduce the published bytes, and why not', t => {
  const dir = seed(t), p = locations(dir);
  assert.equal(publishHandoff(dir, readGraph(dir).hash, draft(readGraph(dir))).status, 'ready');
  const sealed = handoffStatus(dir);
  assert.equal(sealed.ready, true); assert.equal(sealed.reproduction, 'reproducible'); assert.equal(sealed.reproducible, true);
  const metadata = fs.readFileSync(p.handoffJson, 'utf8'), body = fs.readFileSync(p.handoff, 'utf8');
  reseal(p.handoffJson, data => { data.conclusions[0].text = 'A different conclusion.'; });
  assert.equal(handoffStatus(dir).reproduction, 'differs');
  reseal(p.handoffJson, data => { data.renderer = 0; });
  assert.equal(handoffStatus(dir).reproduction, 'renderer-changed');
  fs.writeFileSync(p.handoffJson, metadata); fs.appendFileSync(p.handoff, '\nManual edit.\n');
  assert.deepEqual([handoffStatus(dir).fresh, handoffStatus(dir).reproduction], [false, 'differs']);
  fs.writeFileSync(p.handoff, body);
  reseal(p.handoffJson, data => { data.schema = 2; delete data.renderer; delete data.language; delete data.conclusions; });
  assert.equal(handoffStatus(dir).reproduction, 'legacy-prose');
  fs.writeFileSync(p.handoffJson, metadata);
  setLifecycle(dir, readGraph(dir).hash, 'active');
  patchGraph(dir, readGraph(dir).hash, { add: [{ id: 'P-010C', kind: 'position', text: 'A third option.', data: { status: 'proposed', issue: 'I-010' } }] });
  assert.equal(handoffStatus(dir).reproduction, 'not-renderable');
});

test('audit snapshots are the exact bytes later published, in the requested language', t => {
  const dir = seed(t), graph = readGraph(dir), input = { language: 'uk', conclusions: [{ ...FIXTURE_CONCLUSIONS[0], text: `  ${FIXTURE_CONCLUSIONS[0].text}\n  ` }], audit_requested: true };
  const prepared = prepareAudit(dir, graph.hash, input), snapshot = fs.readFileSync(prepared.draft, 'utf8');
  assert.equal(snapshot, draftHandoff(graph, { language: 'uk', conclusions: FIXTURE_CONCLUSIONS }).body);
  assert.match(snapshot, /## Питання й рішення/);
  assert.equal(previewHandoff(dir, input).body_sha256, sha256(snapshot));
  fs.rmSync(prepared.directory, { recursive: true });
});

test('the render command reads JSON, refuses a graph changed since the preview and prints Markdown', t => {
  const dir = seed(t), cli = path.join(ROOT, 'src', 'cli-entry.mjs'), input = JSON.stringify({ conclusions: FIXTURE_CONCLUSIONS });
  const run = (args, stdin) => spawnSync(process.execPath, [cli, 'render', '--project', dir, ...args], { input: stdin, encoding: 'utf8' });
  assert.equal(run([], '{}').status, 0); assert.match(run([], '{}').stdout, /No conclusion recorded yet: \[P-010A\]/);
  assert.equal(run(['--expect', readGraph(dir).hash], input).stdout, draftHandoff(readGraph(dir), JSON.parse(input)).body);
  const stale = run(['--expect', '0'.repeat(64)], input);
  assert.equal(stale.status, 1); assert.equal(JSON.parse(stale.stderr).code, 'CONFLICT');
  assert.equal(JSON.parse(run([], '').stderr).code, 'JSON');
});
