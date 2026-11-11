import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { retainedPackages, collectNotices, licenseFooter, licenseInventory } from './bundled-licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// Claude Code copies exactly this directory into each user's plugin cache.
const plugin = 'plugins/requirements-discovery';
const readPlugin = file => read(`${plugin}/${file}`);
// Only runtime files: a package.json with a lockfile here would trigger Claude Code's
// automatic dependency install, which the bundled helpers do not need.
assert.deepEqual(fs.readdirSync(path.join(root, plugin)).sort(), ['.claude-plugin', 'LICENSE', 'README.md', 'agents', 'dist', 'hooks', 'references', 'skills']);
assert.equal(readPlugin('LICENSE'), read('LICENSE'));
const manifest = JSON.parse(readPlugin('.claude-plugin/plugin.json'));
const pkg = JSON.parse(read('package.json'));
assert.equal(manifest.name, pkg.name);
assert.equal(manifest.version, pkg.version);
// Default hooks are auto-discovered. Explicitly adding the same path duplicates them.
assert.equal(manifest.hooks, undefined);
const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
assert.deepEqual(fs.readdirSync(path.join(root, '.claude-plugin')), ['marketplace.json']);
assert.equal(marketplace.plugins[0].source, `./${plugin}`);
assert.equal(marketplace.plugins[0].name, manifest.name);
const hooks = JSON.parse(readPlugin('hooks/hooks.json'));
assert.deepEqual(Object.keys(hooks.hooks), ['SessionStart']);
for (const group of hooks.hooks.SessionStart) for (const hook of group.hooks) {
  assert.equal(hook.type, 'command');
  assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/dist/hook.cjs"');
  assert.ok(hook.timeout <= 10);
  assert.equal(hook.async, undefined);
}
for (const name of ['discover', 'handoff']) {
  const skill = readPlugin(`skills/${name}/SKILL.md`);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.ok(match, `${name}: frontmatter at start`);
  const data = load(match[1]);
  assert.equal(data.name, name);
  assert.equal(data['disable-model-invocation'], true);
  assert.equal(data.context, undefined);
  assert.equal(data['allowed-tools'], undefined);
  assert.equal(data.hooks, undefined, `${name}: no session-long hooks in skill frontmatter`);
  assert.ok(data.description.length < 1024);
  assert.ok(skill.split('\n').length < 500);
  assert.ok(skill.includes('$ARGUMENTS'));
  for (const match of skill.matchAll(/`\$\{CLAUDE_PLUGIN_ROOT\}\/([^`]+)`/g)) {
    assert.ok(fs.existsSync(path.join(root, plugin, match[1])), `${name}: missing bundled reference ${match[1]}`);
  }
}
const auditor = readPlugin('agents/handoff-auditor.md');
const auditorMeta = load(/^---\n([\s\S]*?)\n---\n/.exec(auditor)[1]);
assert.equal(auditorMeta.name, 'handoff-auditor');
assert.deepEqual(auditorMeta.tools.split(',').map(x => x.trim()).sort(), ['Glob','Grep','Read']);
assert.equal(auditorMeta.hooks, undefined);
for (const name of ['discovery', 'hook']) {
  const bundle = readPlugin(`dist/${name}.cjs`);
  assert.ok(!bundle.includes('wasm-graphviz'));
  assert.ok(!bundle.includes(root));
  const retained = JSON.parse(read(`build/${name}.metafile.json`)).retained_inputs;
  const packages = retainedPackages(root, retained).map(pkg => collectNotices(root, pkg));
  const inventory = JSON.parse(read('build/dependencies.json'))[name];
  assert.deepEqual(inventory.packages, licenseInventory(packages));
  assert.ok(bundle.endsWith(licenseFooter(packages)), `${name}: full upstream notices must be embedded.`);
  assert.ok(retained.length > 0);
  if (name === 'hook') {
    assert.ok(Buffer.byteLength(bundle) < 60000, 'SessionStart must remain a small header reader.');
    assert.ok(retained.every(input => input.startsWith('node_modules/js-yaml/')), 'SessionStart must not load the graph parser or reasoning runtime.');
  } else assert.ok(retained.some(input => input.startsWith('node_modules/@argdown/core/')), 'CLI must retain the official Argdown parser.');
}
console.log('Package checks passed: main-conversation skills, explicit read-only auditor, official Argdown, offline bundles, retained-module inventory and licenses.');
