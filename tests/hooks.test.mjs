import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hookOutput } from '../src/hook.mjs';
import { readGraph, locations } from '../src/storage.mjs';
import { setLifecycle, publishHandoff } from '../src/operations.mjs';
import { projectGraph } from '../src/graph.mjs';
import { ROOT, PLUGIN, seed, temporary, draft, discoveryFixture } from './helpers.mjs';

const input = (cwd, hook_event_name = 'SessionStart', extra = {}) => ({cwd,hook_event_name,...extra});
const context = out => out.hookSpecificOutput.additionalContext;
// The pointer the hook gives must be a real file of the installed plugin.
const skill = path.join(PLUGIN, 'skills', 'discover', 'SKILL.md');
// Byte budgets apply to the instruction text; the two paths grow with the install location.
const withoutPaths = (text, ...paths) => paths.reduce((rest, file) => rest.replaceAll(JSON.stringify(file), ''), text);

test('no graph means silent SessionStart and no created state', t => {
  const dir = temporary(t);
  assert.equal(hookOutput(input(dir),PLUGIN,{}), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('all session boundaries supply short behavior/state pointers without replaying reasoning', t => {
  const dir = seed(t), original = readGraph(dir).text;
  for (const source of ['startup','resume','clear','compact','fork']) {
    const out = hookOutput(input(dir,'SessionStart',{source}),PLUGIN,{});
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(context(out), /Active requirements discovery/);
    assert.ok(context(out).includes(JSON.stringify(locations(dir).graph)));
    assert.ok(context(out).includes(JSON.stringify(skill)) && fs.existsSync(skill));
    assert.match(context(out), /restore discovery behavior and current focus from graph state/);
    assert.ok(Buffer.byteLength(withoutPaths(context(out), locations(dir).graph, skill)) < 300);
    assert.doesNotMatch(context(out), /I-014|REQUIREMENTS DISCOVERY ACTIVE|nonlinear IBIS|following JSON|"blockers"|"selected"/);
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
    assert.deepEqual(Object.keys(out.hookSpecificOutput), ['hookEventName','additionalContext']);
  }
  assert.equal(readGraph(dir).text, original);
  assert.deepEqual(fs.readdirSync(locations(dir).state), ['current.argdown']);
});

test('one hundred user prompts are silent in every lifecycle and with damaged state', t => {
  const dir = seed(t);
  for (const status of ['active','paused','handed-off','damaged']) {
    const bytes = status === 'damaged' ? 'damaged bytes' : discoveryFixture.replace('"status": "active"',`"status": "${status}"`);
    fs.writeFileSync(locations(dir).graph,bytes);
    for (let i = 0; i < 100; i++) {
      assert.equal(hookOutput(input(dir,'UserPromptSubmit',{prompt:`Confirm the decision ${i}.`}),PLUGIN,{}),null);
    }
    assert.equal(fs.readFileSync(locations(dir).graph,'utf8'),bytes);
  }
  assert.deepEqual(fs.readdirSync(locations(dir).state), ['current.argdown']);
});

test('paused bootstrap stays inactive without reloading active behavior', t => {
  const dir = seed(t);
  setLifecycle(dir,readGraph(dir).hash,'paused');
  const before = fs.readFileSync(locations(dir).graph,'utf8');
  const text = context(hookOutput(input(dir),PLUGIN,{}));
  assert.match(text, /paused; facilitation is inactive/);
  assert.match(text, /Resume only on request/);
  assert.doesNotMatch(text, /Read .*SKILL\.md|Active requirements discovery/);
  assert.equal(fs.readFileSync(locations(dir).graph,'utf8'),before);
});

test('handed-off bootstrap grants no readiness and preserves graph and handoff', t => {
  const dir = seed(t), graph = readGraph(dir);
  publishHandoff(dir,graph.hash,draft(graph));
  const before = [locations(dir).graph,locations(dir).handoff,locations(dir).handoffJson].map(file=>fs.readFileSync(file,'utf8'));
  const text = context(hookOutput(input(dir),PLUGIN,{}));
  assert.match(text,/handed-off; facilitation is inactive/);
  assert.doesNotMatch(text,/ready|seals match|speckit\.specify|Read .*SKILL\.md/);
  assert.deepEqual([locations(dir).graph,locations(dir).handoff,locations(dir).handoffJson].map(file=>fs.readFileSync(file,'utf8')),before);
});

test('unreadable header supplies a recovery pointer without changing bytes', t => {
  const dir = seed(t, 'damaged bytes');
  const out = hookOutput(input(dir),PLUGIN,{});
  assert.match(context(out),/Preserve its bytes/);
  assert.ok(context(out).includes(JSON.stringify(skill)));
  assert.equal(fs.readFileSync(locations(dir).graph,'utf8'),'damaged bytes');
  assert.deepEqual(fs.readdirSync(locations(dir).state), ['current.argdown']);
});

test('unsupported headers are preserved for explicit recovery, never reset', t => {
  const dir = seed(t);
  for (const schema of [1,3]) {
    const bytes=discoveryFixture.replace('"schema": 2',`"schema": ${schema}`);
    fs.writeFileSync(locations(dir).graph,bytes);
    assert.match(context(hookOutput(input(dir),PLUGIN,{})),/state recovery/);
    assert.equal(fs.readFileSync(locations(dir).graph,'utf8'),bytes);
  }
});

test('subagents and custom-agent sessions keep their own behavior', t => {
  const dir = seed(t);
  assert.equal(hookOutput(input(dir,'SessionStart',{agent_id:'research-1'}),PLUGIN,{}),null);
  assert.equal(hookOutput(input(dir,'SessionStart',{agent_type:'requirements-discovery:handoff-auditor'}),PLUGIN,{}),null);
});

test('unsupported events and invalid cwd cannot deliver discovery context', t => {
  const dir = seed(t);
  for (const event of ['UserPromptSubmit','SubagentStart','PreCompact','Stop']) {
    assert.equal(hookOutput(input(dir,event),PLUGIN,{}),null);
  }
  assert.equal(hookOutput({hook_event_name:'SessionStart',cwd:'relative'},PLUGIN,{}),null);
  assert.equal(hookOutput(null,PLUGIN,{}),null);
});

test('bootstrap follows the project root while respecting nested repository boundaries', t => {
  const dir = seed(t), child = path.join(dir,'frontend'); fs.mkdirSync(child);
  assert.ok(context(hookOutput(input(child),PLUGIN,{})).includes(JSON.stringify(locations(dir).graph)));
  fs.mkdirSync(path.join(child,'.git'));
  assert.equal(hookOutput(input(child),PLUGIN,{}),null);
  assert.ok(context(hookOutput(input(child),PLUGIN,{CLAUDE_PROJECT_DIR:dir})).includes(JSON.stringify(locations(dir).graph)));
});

test('quoted Unicode and shell-metacharacter paths survive as intact data', t => {
  const dir=path.join(temporary(t),'Проєкт "quotes" ; $(literal)'), plugin=path.join(ROOT,'Plugin "quotes" ; $(literal)');
  fs.mkdirSync(path.join(dir,'.requirements'),{recursive:true});
  fs.writeFileSync(locations(dir).graph,discoveryFixture);
  const text=context(hookOutput(input(dir),plugin,{}));
  assert.equal(JSON.parse(text.split('\n')[1]),locations(dir).graph);
  assert.ok(text.includes(JSON.stringify(path.join(plugin,'skills','discover','SKILL.md'))));
  assert.equal(fs.existsSync(path.join(dir,'literal')),false);
});

test('bundled hook accepts SessionStart JSON and stale prompt registrations emit nothing', t => {
  const dir = seed(t), hook = path.join(PLUGIN,'dist','hook.cjs');
  const run = payload => spawnSync(process.execPath,[hook],{input:typeof payload==='string'?payload:JSON.stringify(payload),encoding:'utf8',env:{...process.env,CLAUDE_PROJECT_DIR:dir}});
  const result = run(input(dir));
  assert.equal(result.status,0);
  assert.equal(result.stderr,'');
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName,'SessionStart');
  for (const payload of [input(dir,'UserPromptSubmit',{prompt:'private user text'}),'not JSON']) {
    const silent = run(payload);
    assert.equal(silent.status,0);
    assert.equal(silent.stdout,'');
    assert.equal(silent.stderr,'');
  }
});
