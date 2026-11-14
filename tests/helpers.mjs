import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph, readArgdown, modelNodes, KINDS, updateMeta, sha256 } from '../src/graph.mjs';
import { draftHandoff } from '../src/render.mjs';
import { REVIEW_AXES } from '../src/review.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The directory Claude Code installs: runtime files and the committed bundles.
export const PLUGIN = path.join(ROOT, 'plugins', 'requirements-discovery');
export const discoveryFixture = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'discovery.argdown'), 'utf8');
// Outside the repository, so project discovery never walks up into this checkout.
export function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-discovery-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export function seed(t, text = discoveryFixture) {
  const dir = temporary(t);
  fs.mkdirSync(path.join(dir, '.requirements'));
  fs.writeFileSync(path.join(dir, '.requirements', 'current.argdown'), text);
  return dir;
}
export function editNode(text, id, patch, newText) {
  const lines = text.split('\n');
  const index = lines.findIndex(line => line.startsWith(`[${id}]:`) || line.startsWith(`<${id}>:`));
  if (index < 0) throw new Error(`Missing fixture node ${id}`);
  const brace = lines[index].indexOf('{');
  const node = modelNodes(readArgdown(text)).get(id), data = node.data;
  const prefix = newText ? lines[index].slice(0, lines[index].indexOf(':') + 1) + ` ${newText} #${node.tags.find(tag => Object.hasOwn(KINDS,tag))} ` : lines[index].slice(0, brace);
  lines[index] = prefix + JSON.stringify({ ...data, ...patch });
  return lines.join('\n');
}
export function revise(text, patch = {}) {
  const graph = parseGraph(text);
  return updateMeta(graph, { revision: graph.meta.revision + 1, updated_at: '2026-10-05T01:00:00Z', status: 'active', ...patch });
}
// The fixture's only branch that was not chosen: the workspace-hierarchy navigation option.
export const FIXTURE_CONCLUSIONS = [{ issue: 'I-010', covers: ['P-010A'], text: 'Fictional fixture only: a workspace hierarchy did not fit cross-workspace work.' }];
// Explicit conclusions keep the expected branches independent of the classifier under test: a
// strict render fails if they do not match. The receipt exercises publication integrity, not semantic judgment.
export function draft(graph, conclusions = FIXTURE_CONCLUSIONS) {
  const input = { conclusions: structuredClone(conclusions) }, { body, sources } = draftHandoff(graph, input);
  return { ...input, review: { graph_sha256: graph.hash, body_sha256: sha256(body),
    checks: REVIEW_AXES.map(check => ({ check, result: 'pass', note: 'Synthetic fixture: publication mechanics only; no claim of a model review.' })),
    sources: sources.map(source => ({ source, result: 'not-needed', note: 'Fictional source pointer in an isolated runtime test.' })) } };
}
// Changes the rendered body through one conclusion and rebinds the main review to it.
export function revised(graph, input, note = 'A separately reviewed conclusion.', index = 0) {
  if (!input.conclusions?.[index]) throw new Error(`revised() needs conclusion ${index + 1} to change.`);
  const next = structuredClone(input);
  next.conclusions[index].text += ` ${note}`;
  next.review.body_sha256 = sha256(draftHandoff(graph, next).body);
  return next;
}
