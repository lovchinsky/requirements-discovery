import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { ROOT, PLUGIN, temporary } from './helpers.mjs';
import { collectNotices, licenseFooter, retainedPackages } from '../scripts/bundled-licenses.mjs';

test('notice comments cannot execute text containing comment terminators or Unicode line separators', t => {
  const text='*/ globalThis.injected=true;\u2028globalThis.injected=true;\r\nglobalThis.injected=true;';
  const dir=temporary(t);
  fs.writeFileSync(path.join(dir,'LICENSE'),text);
  const footer=licenseFooter([collectNotices(ROOT,{dir,pkg:{name:'fixture',version:'1',license:'MIT\u2028globalThis.injected=true;'}})]);
  const context=vm.createContext({injected:false});
  new vm.Script('globalThis.ran=true;\n'+footer).runInContext(context);
  assert.equal(context.ran,true);
  assert.equal(context.injected,false);
});

test('license and NOTICE text are retained; a newly unlicensed dependency fails the build', t => {
  const dir=temporary(t);
  fs.writeFileSync(path.join(dir,'LICENSE'),'Copyright Example\nPermission text.\n');
  fs.writeFileSync(path.join(dir,'NOTICE'),'Required attribution.\n');
  const pkg={name:'fixture',version:'1',license:'MIT'};
  const notices=collectNotices(ROOT,{dir,pkg});
  assert.ok(licenseFooter([notices]).includes('// Required attribution.'));
  assert.equal(notices.notices.find(n=>n.file==='LICENSE').text,fs.readFileSync(path.join(dir,'LICENSE'),'utf8'));
  fs.unlinkSync(path.join(dir,'LICENSE'));
  assert.throws(()=>collectNotices(ROOT,{dir,pkg}),/Missing bundled license/);
});

test('a supplemented upstream license applies only to the exact published version', () => {
  const dir = path.join(ROOT, 'node_modules', 'string-pixel-width'), pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const { notices } = collectNotices(ROOT, { dir, pkg: { ...pkg, version: '1.11.0' } });
  assert.match(notices.at(-1).file, /^https:\/\/github\.com\/adambisek\/string-pixel-width\/blob\/[0-9a-f]{40}\/LICENSE\.md$/);
  assert.match(notices.at(-1).text, /^MIT License\n\nCopyright \(c\) 2023 Adam Ernst Bisek\n/);
  assert.throws(() => collectNotices(ROOT, { dir, pkg: { ...pkg, version: '1.12.0' } }), /Missing bundled license/);
});

test('bundled inputs that belong to no package fail the license inventory', () => {
  assert.equal(retainedPackages(ROOT, ['src/graph.mjs']).length, 0);
  assert.throws(() => retainedPackages(ROOT, ['vendor/unknown.js']), /Cannot attribute bundled input/);
});

// Rebuilding in a scratch copy must reproduce the committed outputs byte for byte, so a
// stale bundle fails `npm test` locally, not only the CI diff.
test('a fresh build reproduces the committed bundles and build inventory', t => {
  const root = path.join(temporary(t), 'build');
  fs.mkdirSync(root);
  for (const name of ['src', 'scripts', 'licenses']) fs.cpSync(path.join(ROOT, name), path.join(root, name), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const dist = path.relative(ROOT, path.join(PLUGIN, 'dist'));
  for (const file of [`${dist}/discovery.cjs`, `${dist}/hook.cjs`, 'build/dependencies.json', 'build/discovery.metafile.json', 'build/hook.metafile.json']) {
    assert.ok(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(ROOT, file))), `${file} is stale: run npm run build`);
  }
});
