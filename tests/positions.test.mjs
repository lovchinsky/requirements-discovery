import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseGraph, sha256, projectGraph, updateMeta } from '../src/graph.mjs';
import { patchGraph, applyGraph, reconcilePositionState, repairGraph, publishHandoff } from '../src/operations.mjs';
import { readGraph, readHandoff, locations } from '../src/storage.mjs';
import { seed, discoveryFixture, editNode, draft } from './helpers.mjs';

function supersession(selected = ['P-010A']) {
  return { update: [
    { id: 'D-006', data: { status: 'superseded', superseded_by: 'D-017' } },
    { id: 'I-010', data: { resolved_by: 'D-017' } },
    { id: 'Q-001', data: { status: 'superseded' } }
  ], add: [{ id: 'D-017', kind: 'decision', text: 'Use the revised navigation for the changed release scope.',
    data: { status: 'accepted', resolves: ['I-010'], selected, based_on: [], basis: 'user', rationale: 'The recorded release scope now supports the revised selection.', sources: [{ kind: 'user', ref: 'Explicit revised scope agreement', authority: 'intent' }] } }] };
}

test('supersession atomically updates current Positions and preserves the former choice and rationale', t => {
  const dir = seed(t), old = readGraph(dir), result = patchGraph(dir, old.hash, supersession()), next = readGraph(dir);
  assert.equal(next.nodes.get('P-010A').data.status, 'accepted');
  assert.equal(next.nodes.get('P-010B').data.status, 'proposed');
  assert.deepEqual(result.position_changes, [
    { id: 'P-010A', from: 'rejected', to: 'accepted', selected_by: 'D-017' }, { id: 'P-010B', from: 'accepted', to: 'proposed' }
  ]);
  assert.deepEqual(next.nodes.get('D-006').data.selected, ['P-010B']);
  assert.equal(next.nodes.get('D-006').data.rationale, old.nodes.get('D-006').data.rationale);
  assert.deepEqual(next.nodes.get('I-010').data.resolution_history, ['D-006', 'D-017']);
  assert.equal(next.meta.revision, old.meta.revision + 1);
  assert.equal(projectGraph(next).readiness, 'ready');
});

test('keeping a selected Position through supersession does not demote it', t => {
  const dir = seed(t), g = readGraph(dir), result = patchGraph(dir, g.hash, supersession(['P-010B']));
  assert.deepEqual(result.position_changes, []);
  assert.equal(readGraph(dir).nodes.get('P-010B').data.status, 'accepted');
});

test('a new proposed Position is automatically accepted when its new Decision selects it', t => {
  const dir = seed(t), graph = readGraph(dir), input = supersession(['P-NEW']);
  input.add.push({ id: 'P-NEW', kind: 'position', text: 'Use navigation suited to the revised scope.', data: { status: 'proposed', issue: 'I-010' } });
  patchGraph(dir, graph.hash, input);
  assert.equal(readGraph(dir).nodes.get('P-NEW').data.status, 'accepted');
});

test('a new orphan acceptance and an explicit status deletion fail without silently changing the input', t => {
  const dir = seed(t), graph = readGraph(dir);
  assert.throws(() => patchGraph(dir, graph.hash, { add: [{ id: 'P-ORPHAN', kind: 'position', text: 'An unsupported choice.', data: { status: 'accepted', issue: 'I-010' } }] }), e => e.code === 'INPUT');
  assert.throws(() => patchGraph(dir, graph.hash, { update: [{ id: 'P-010B', unset: ['status'] }] }), e => e.code === 'INPUT');
  assert.equal(readGraph(dir).text, graph.text);
});

test('challenging and reaffirming a Decision reconciles its Positions without new rejection claims', t => {
  const dir = seed(t), g = readGraph(dir);
  patchGraph(dir, g.hash, { update: [{ id: 'D-006', data: { status: 'challenged', challenged_by: ['I-014'] } }, { id: 'I-010', data: { status: 'open' }, unset: ['resolved_by'] }] });
  const challenged = readGraph(dir);
  assert.equal(challenged.nodes.get('P-010B').data.status, 'proposed');
  assert.equal(challenged.nodes.get('P-010A').data.status, 'rejected');
  patchGraph(dir, challenged.hash, { add: [{ id: 'V-NEW', kind: 'review', text: 'The unchanged selection fits the reviewed scope.', data: { status: 'confirmed', decision: 'D-006', based_on: ['C-008', 'C-012'], rationale: 'The current scope and authorization constraints continue to support this choice.' } }],
    update: [{ id: 'D-006', data: { status: 'accepted', reaffirmed_by: ['V-NEW'] } }, { id: 'I-010', data: { status: 'resolved', resolved_by: 'D-006' } }] });
  assert.equal(readGraph(dir).nodes.get('P-010B').data.status, 'accepted');
});

test('withdrawn decisions no longer imply current acceptance', t => {
  const dir = seed(t), g = readGraph(dir);
  patchGraph(dir, g.hash, { update: [{ id: 'D-006', data: { status: 'withdrawn' } }, { id: 'I-010', data: { status: 'open' }, unset: ['resolved_by'] }, { id: 'Q-001', data: { status: 'superseded' } }] });
  assert.equal(readGraph(dir).nodes.get('P-010B').data.status, 'proposed');
  assert.deepEqual(readGraph(dir).nodes.get('D-006').data.selected, ['P-010B']);
});

test('an explicit rejection remains a rejection when retiring the former selection', t => {
  const dir = seed(t), g = readGraph(dir), input = supersession();
  input.update.push({ id: 'P-010B', data: { status: 'rejected' } });
  patchGraph(dir, g.hash, input);
  assert.equal(readGraph(dir).nodes.get('P-010B').data.status, 'rejected');
});

test('explicit Position status cannot contradict a current Decision, and failures leave bytes intact', t => {
  const dir = seed(t), g = readGraph(dir);
  for (const update of [{ id: 'P-010A', data: { status: 'accepted' } }, { id: 'P-010B', data: { status: 'proposed' } }, { id: 'P-010B', data: { status: 'withdrawn' } }]) {
    assert.throws(() => patchGraph(dir, g.hash, { update: [update] }), e => e.code === 'INPUT');
    assert.equal(readGraph(dir).text, g.text);
  }
});

test('a compatible combination for one Issue is legal, but explicit contradictory selections are rejected', t => {
  let text = editNode(discoveryFixture, 'D-006', { selected: ['P-010B', 'P-COMBINED'] });
  text += '\n[P-COMBINED]: Show the current location in the selected operational view. #position {status: accepted, issue: I-010}\n';
  const dir = seed(t, text), g = readGraph(dir);
  assert.equal(projectGraph(g).readiness, 'ready');
  assert.throws(() => patchGraph(dir, g.hash, { relations: { add: [{ from: 'P-010B', to: 'P-COMBINED', type: 'contradictory' }] } }), e => e.code === 'SCHEMA' && e.details.some(x => x.includes('contradictory positions')));
  assert.equal(readGraph(dir).text, g.text);
});

test('one multi-Issue successor keeps an unchanged choice and retires only the changed choice', t => {
  let text = editNode(discoveryFixture, 'D-006', { resolves: ['I-010', 'I-020'], selected: ['P-010B', 'P-020'] });
  text += '\n[I-020]: What context remains visible? #issue {status: resolved, parent: I-001, resolved_by: D-006, resolution_history: [D-006]}\n\n[P-020]: Display the active location. #position {status: accepted, issue: I-020}\n';
  const dir = seed(t, text), g = readGraph(dir), input = supersession(['P-010A', 'P-020']);
  input.add[0].data.resolves.push('I-020'); input.update.push({ id: 'I-020', data: { resolved_by: 'D-017' } });
  patchGraph(dir, g.hash, input);
  const next = readGraph(dir);
  assert.equal(next.nodes.get('P-020').data.status, 'accepted');
  assert.equal(next.nodes.get('P-010B').data.status, 'proposed');
});

test('full graph apply rejects orphan acceptance instead of silently changing the submitted graph', t => {
  const dir = seed(t), g = readGraph(dir), candidate = updateMeta(g, { revision: g.meta.revision + 1 });
  assert.throws(() => applyGraph(dir, g.hash, editNode(candidate, 'P-010A', { status: 'accepted' })), e => e.code === 'SCHEMA');
  assert.equal(readGraph(dir).text, g.text);
});

test('inconsistent Position state is reconciled with exact backup and no guessed selection', t => {
  const original = editNode(discoveryFixture, 'P-010A', { status: 'accepted' }), dir = seed(t, original);
  fs.writeFileSync(locations(dir).handoff, 'Previous handoff bytes.');
  fs.writeFileSync(locations(dir).handoffJson, '{"status":"blocked"}\n');
  const result = reconcilePositionState(dir, sha256(original)), next = readGraph(dir);
  assert.equal(next.nodes.get('P-010A').data.status, 'proposed');
  assert.equal(next.nodes.get('P-010B').data.status, 'accepted');
  assert.deepEqual(next.nodes.get('D-006').data.selected, ['P-010B']);
  assert.equal(fs.readFileSync(path.join(result.preserved_original, 'current.argdown'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(result.preserved_original, 'handoff.md'), 'utf8'), 'Previous handoff bytes.');
  assert.equal(fs.readFileSync(path.join(result.preserved_original, 'handoff.json'), 'utf8'), '{"status":"blocked"}\n');
  assert.equal(reconcilePositionState(dir, next.hash).revision, next.meta.revision);
});

test('Position reconciliation repairs a missing accepted status and preserves stale handoff detection', t => {
  const dir = seed(t), g = readGraph(dir); publishHandoff(dir, g.hash, draft(projectGraph(g)));
  const published = readGraph(dir), damaged = editNode(published.text, 'P-010B', { status: 'proposed' });
  fs.writeFileSync(locations(dir).graph, damaged);
  reconcilePositionState(dir, sha256(damaged));
  const next = readGraph(dir);
  assert.equal(next.nodes.get('P-010B').data.status, 'accepted');
  assert.equal(next.meta.status, 'active');
  assert.equal(readHandoff(dir, next).fresh, false);
});

test('reconciliation rejects bad provenance, unknown schema and CAS conflicts; generic repair cannot bypass it', t => {
  const original = editNode(discoveryFixture, 'P-010A', { status: 'accepted' }), dir = seed(t, original);
  assert.throws(() => reconcilePositionState(dir, '0'.repeat(64)), e => e.code === 'CONFLICT');
  assert.throws(() => repairGraph(dir, sha256(original), discoveryFixture), e => e.code === 'REPAIR' && /positions-reconcile/.test(e.message));
  const bad = editNode(original, 'D-006', { sources: [] }); fs.writeFileSync(locations(dir).graph, bad);
  assert.throws(() => reconcilePositionState(dir, sha256(bad)), e => e.code === 'SCHEMA');
  const unknown = original.replace('"schema": 2', '"schema": 3'); fs.writeFileSync(locations(dir).graph, unknown);
  assert.throws(() => reconcilePositionState(dir, sha256(unknown)), e => e.code === 'SCHEMA');
  assert.equal(fs.existsSync(path.join(locations(dir).state, 'archive')), false);
});
