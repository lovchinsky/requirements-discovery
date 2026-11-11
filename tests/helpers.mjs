import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph, readArgdown, modelNodes, KINDS, updateMeta, sha256 } from '../src/graph.mjs';
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
export function draft(projection) {
  // Synthetic receipts exercise publication integrity, not semantic judgment.
  const body = `# Synthetic test input\n\nFictional fixture only. ${projection.required_coverage.map(id => `[${id}]`).join(' ')}\n`;
  return { body, covers: projection.required_coverage, review: { graph_sha256: projection.graph_sha256, body_sha256: sha256(body),
    checks: REVIEW_AXES.map(check => ({ check, result: 'pass', note: 'Synthetic fixture: publication mechanics only; no claim of a model review.' })),
    sources: projection.sources.map(source => ({ source, result: 'not-needed', note: 'Fictional source pointer in an isolated runtime test.' })) } };
}
