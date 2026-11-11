import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseGraph, projectGraph, sha256, updateMeta } from '../src/graph.mjs';
import { applyGraph, patchGraph, repairGraph } from '../src/operations.mjs';
import { readGraph, locations } from '../src/storage.mjs';
import { seed, discoveryFixture, editNode, revise } from './helpers.mjs';

const formalRequirement = status => `\n[R-NEW]: A formal requirement. #requirement {status: ${status}${status === 'derived' ? ', derives_from: D-006' : ''}}\n`;

test('discovery outcomes retain the agreed behavior in Decisions', () => {
  const graph = parseGraph(discoveryFixture), projection = projectGraph(graph);
  assert.equal(projection.readiness, 'ready');
  assert.ok([...graph.nodes.values()].every(node => node.kind !== 'requirement'));
  assert.ok(projection.settled.some(node => node.id === 'D-006'));
  assert.ok(graph.nodes.get('D-006').text.includes('persistent, explicit workspace context'));
});

test('patch rejects formal Requirement nodes for every status and ID prefix without writing', t => {
  const dir = seed(t), graph = readGraph(dir);
  for (const id of ['R-NEW', 'Q-NEW']) for (const status of ['proposed', 'agreed', 'derived', 'challenged', 'superseded']) {
    assert.throws(() => patchGraph(dir, graph.hash, {add: [{id, kind: 'requirement', text: 'A formal requirement.', data: {status}}]}), error => error.code === 'INPUT');
    assert.equal(fs.readFileSync(locations(dir).graph, 'utf8'), graph.text);
  }
});

test('complete apply rejects formal Requirement nodes without changing the graph', t => {
  const dir = seed(t), graph = readGraph(dir);
  for (const status of ['proposed', 'agreed', 'derived', 'challenged', 'superseded']) {
    const candidate = updateMeta(graph, {revision: graph.meta.revision + 1}) + formalRequirement(status);
    assert.throws(() => applyGraph(dir, graph.hash, candidate), error => error.code === 'SCHEMA');
    assert.equal(fs.readFileSync(locations(dir).graph, 'utf8'), graph.text);
  }
});

test('repair rejects formal Requirement nodes and preserves damaged bytes', t => {
  const graph = parseGraph(discoveryFixture);
  const candidate = updateMeta(graph, {revision: graph.meta.revision + 1}) + formalRequirement('proposed');
  for (const damaged of [discoveryFixture.replace('"derives_from": "D-006"', '"derives_from": "D-MISSING"'), discoveryFixture + '\n[broken']) {
    const dir = seed(t, damaged);
    assert.throws(() => repairGraph(dir, sha256(damaged), candidate), error => error.code === 'SCHEMA');
    assert.equal(fs.readFileSync(locations(dir).graph, 'utf8'), damaged);
    assert.equal(fs.existsSync(locations(dir).state + '/archive'), false);
  }
});

test('assertions cannot be deleted or retyped as a different discovery outcome', t => {
  const dir = seed(t), graph = readGraph(dir);
  const retyped = editNode(discoveryFixture, 'Q-001', {status: 'proposed'}).replace('#consequence', '#constraint');
  const removed = discoveryFixture.replace(/^\[Q-001\]:.*\n/m, '');
  for (const candidate of [retyped, removed]) {
    assert.throws(() => applyGraph(dir, graph.hash, revise(candidate)), error => error.code === 'HISTORY');
    assert.equal(fs.readFileSync(locations(dir).graph, 'utf8'), graph.text);
  }
});
