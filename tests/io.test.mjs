import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DiscoveryError, MAX_HEADER_BYTES } from '../src/errors.mjs';
import { frontMatterHeader, readHeader, locations } from '../src/io.mjs';
import { hookOutput } from '../src/hook.mjs';
import { PLUGIN, seed, discoveryFixture } from './helpers.mjs';

test('header bootstrap accepts Unicode, BOM and CRLF without interpreting damaged body', t => {
  const originalHeader = discoveryFixture.slice(0,discoveryFixture.indexOf('\n===',4)+4);
  const bytes = '\uFEFF' + originalHeader.replaceAll('\n','\r\n') + '\r\n' + 'Invalid graph body '.repeat(90000);
  const dir = seed(t,bytes), p = locations(dir);
  const expected = frontMatterHeader(originalHeader).discovery;
  assert.deepEqual(readHeader(dir),expected);
  assert.equal(Buffer.byteLength(bytes) > 1500000,true);
  assert.match(hookOutput({cwd:dir,hook_event_name:'SessionStart'},PLUGIN,{}).hookSpecificOutput.additionalContext,/Active requirements discovery/);
  assert.equal(fs.readFileSync(p.graph,'utf8'),bytes);
  assert.deepEqual(fs.readdirSync(p.state),['current.argdown']);
});

test('the 64 KiB header limit counts bytes and includes delimiters', t => {
  const meta = frontMatterHeader(discoveryFixture).discovery;
  const header = padding => `===\n${JSON.stringify({discovery:meta,padding})}\n===\n`;
  const emptySize = Buffer.byteLength(header(''));
  const atLimit = header('a'.repeat(MAX_HEADER_BYTES - emptySize));
  assert.equal(Buffer.byteLength(atLimit),MAX_HEADER_BYTES);
  assert.deepEqual(frontMatterHeader(atLimit).discovery,meta);
  const dir = seed(t,atLimit + '\n[I-UNKNOWN]: Invalid body, deliberately not parsed.\n');
  assert.deepEqual(readHeader(dir),meta);
  for (const text of [header('a'.repeat(MAX_HEADER_BYTES - emptySize + 1)),header('я'.repeat(40000))]) {
    assert.throws(() => frontMatterHeader(text),e => e instanceof DiscoveryError && e.code === 'FRONTMATTER');
    fs.writeFileSync(locations(dir).graph,text);
    assert.throws(() => readHeader(dir),e => e instanceof DiscoveryError && e.code === 'FRONTMATTER');
    assert.match(hookOutput({cwd:dir,hook_event_name:'SessionStart'},PLUGIN,{}).hookSpecificOutput.additionalContext,/state recovery/);
  }
});

test('header reads retain size and no-follow protections', t => {
  const dir = seed(t), graph = locations(dir).graph;
  fs.appendFileSync(graph,'x'.repeat(2 * 1024 * 1024));
  assert.throws(() => readHeader(dir),e => e.code === 'SIZE');
  fs.unlinkSync(graph);
  const outside = graph + '.outside';
  fs.writeFileSync(outside,discoveryFixture);
  fs.symlinkSync(outside,graph);
  assert.throws(() => readHeader(dir),e => e.code === 'PATH');
  assert.equal(fs.readFileSync(outside,'utf8'),discoveryFixture);
});
