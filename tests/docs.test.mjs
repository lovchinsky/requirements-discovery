import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PLUGIN } from './helpers.mjs';
import { readArgdown, modelNodes, KINDS } from '../src/graph.mjs';
import { HELP, COMMANDS, OPTIONS } from '../src/cli.mjs';
import { REVIEW_AXES } from '../src/review.mjs';

// Skills, references and READMEs are the product's behavior: they must not drift from the helper.
const plugin = path.relative(ROOT, PLUGIN);
const behavior = ['skills/discover/SKILL.md', 'skills/handoff/SKILL.md', 'agents/handoff-auditor.md',
  ...fs.readdirSync(path.join(PLUGIN, 'references')).map(name => `references/${name}`)].map(file => `${plugin}/${file}`);
const documents = [...behavior, 'README.md', `${plugin}/README.md`, 'CONTRIBUTING.md'];
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const commands = new Set(Object.keys(COMMANDS));
const flags = new Set([...OPTIONS, '--help']);

test('every Argdown example in the documentation parses with the official parser', () => {
  let blocks = 0;
  for (const file of documents) for (const [, block] of read(file).matchAll(/```argdown\n([\s\S]*?)```/g)) {
    blocks++;
    // A frontmatter-only example is a fragment: give it a body so the parser has a document.
    const text = /^\[[A-Z]+-/m.test(block) ? block : `${block}\n[I-001]: Root. #issue {"status":"open","parent":null}\n`;
    let nodes;
    assert.doesNotThrow(() => { nodes = modelNodes(readArgdown(text)); }, `${file}: invalid Argdown example\n${block}`);
    for (const node of nodes.values()) {
      const kind = node.tags.find(tag => Object.hasOwn(KINDS, tag));
      assert.ok(kind && KINDS[kind].includes(node.data.status), `${file}: ${node.id} uses an unknown type or status`);
    }
  }
  assert.ok(blocks >= 4, 'the graph profile keeps its Argdown examples');
});

test('every helper command and flag named in the documentation exists in the CLI', () => {
  const named = new Set();
  for (const file of documents) for (const [, command, rest] of read(file).matchAll(/discovery\.cjs"?\s+([a-z][a-z-]*)?([^\n`]*)/g)) {
    if (command) named.add(command);
    for (const [flag] of rest.matchAll(/--[a-z]+/g)) assert.ok(flags.has(flag), `${file}: unknown helper flag ${flag}`);
  }
  // Skills and references also name commands inline, e.g. `lifecycle --status paused`.
  for (const file of behavior) for (const [, command, rest] of read(file).matchAll(/`([a-z][a-z-]*)((?: --[a-z]+[^`]*)+)`/g)) {
    named.add(command);
    for (const [flag] of rest.matchAll(/--[a-z]+/g)) assert.ok(flags.has(flag), `${file}: unknown helper flag ${flag}`);
  }
  for (const command of ['status', 'view', 'patch', 'handoff', 'handoff-status']) assert.ok(named.has(command), `the documentation names ${command}`);
  for (const command of named) assert.ok(commands.has(command), `Documentation names an unknown helper command: ${command}`);
});

test('the CLI help lists every command', () => {
  for (const command of commands) assert.match(HELP, new RegExp(`^  ${command}\\s`, 'm'), `--help omits ${command}`);
});

test('the graph profile lists exactly the node types and statuses the validator accepts', () => {
  const rows = [...read(`${plugin}/references/graph-profile.md`).matchAll(/^\| `#([a-z]+)` \| ([a-z, -]+) \|/gm)];
  assert.deepEqual(Object.fromEntries(rows.map(([, kind, statuses]) => [kind, statuses.split(', ')])), KINDS);
});

// These sentences carry the safety rules of the independent audit and the review
// receipt; rewording them must not silently drop the rule.
test('the safety rules of handoff and audit stay stated', () => {
  assert.deepEqual(REVIEW_AXES, ['consistency', 'source_authority', 'coverage', 'decision_quality', 'readiness']);
  const handoff = read(`${plugin}/skills/handoff/SKILL.md`);
  for (const axis of REVIEW_AXES) assert.ok(handoff.includes(axis), `the handoff skill names the ${axis} review axis`);
  const rules = [
    ['skills/handoff/SKILL.md', 'Only when the user explicitly requests', 'the audit runs only on explicit request'],
    ['agents/handoff-auditor.md', 'explicitly user-requested', 'the auditor serves only a requested audit'],
    ['agents/handoff-auditor.md', 'Do not continue or resume', 'each audit is a fresh context'],
    ['references/independent-audit.md', 'not attestation', 'an audit receipt is not proof of identity or isolation'],
    ['references/handoff-contract.md', 'does not prove', 'a review receipt is not proof of quality or agreement'],
  ];
  for (const [file, phrase, rule] of rules) assert.ok(read(`${plugin}/${file}`).includes(phrase), `${file}: ${rule}`);
});

test('every plugin path named in skills, agents and references exists', () => {
  for (const file of behavior) for (const [, relative] of read(file).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
    assert.ok(fs.existsSync(path.join(PLUGIN, relative)), `${file}: missing plugin file ${relative}`);
  }
});

test('the README matches the manifest version, marketplace and repository', () => {
  const manifest = JSON.parse(read(`${plugin}/.claude-plugin/plugin.json`));
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  const repository = new URL(manifest.repository).pathname.slice(1);
  const readme = read('README.md');
  assert.ok(readme.includes(`Version **${manifest.version}**`), 'README.md states the current version');
  assert.ok(readme.includes(`claude plugin marketplace add ${repository}`), 'README.md names the GitHub marketplace source');
  assert.ok(readme.includes(`claude plugin install ${manifest.name}@${marketplace.name}`), 'README.md install command uses the marketplace name');
  for (const file of ['README.md', `${plugin}/README.md`]) {
    assert.ok(read(file).includes(`/plugin install ${manifest.name} --marketplace ${repository}`), `${file}: names the one-step install`);
  }
});
