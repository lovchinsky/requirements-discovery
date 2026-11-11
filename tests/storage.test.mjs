import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { parseGraph, projectGraph, sha256 } from '../src/graph.mjs';
import { readGraph, readHandoff, locations, findProject } from '../src/storage.mjs';
import { initDiscovery, applyGraph, patchGraph, setLifecycle, previewHandoff, prepareAudit, publishHandoff, archiveDiscovery, repairGraph, reconcilePositionState, status } from '../src/operations.mjs';
import { ROOT, PLUGIN, seed, temporary, discoveryFixture, editNode, revise, draft } from './helpers.mjs';

test('initialization never overwrites existing discovery', t => {
  const dir = temporary(t);
  const first = initDiscovery(dir, {title:'Resource workflow',intent:'Understand the resource model.'});
  assert.equal(first.status, 'active');
  assert.equal(first.blocker_count, 1);
  assert.throws(() => initDiscovery(dir, {title:'Other',intent:'A different project.'}), e => e.code === 'EXISTS');
  assert.equal(readGraph(dir).meta.title, 'Resource workflow');
});

test('compare-and-swap preserves an update from a second writer', t => {
  const dir = seed(t);
  const old = readGraph(dir);
  const fresh = applyGraph(dir, old.hash, revise(old.text, {focus:'I-001'}));
  assert.throws(() => applyGraph(dir, old.hash, revise(old.text, {focus:'I-010'})), e => e.code === 'CONFLICT');
  assert.equal(readGraph(dir).hash, fresh.graph_sha256);
  assert.equal(readGraph(dir).meta.focus, 'I-001');
});

test('invalid candidates leave the previous graph byte-for-byte intact', t => {
  const dir = seed(t);
  const original = readGraph(dir);
  assert.throws(() => applyGraph(dir, original.hash, editNode(revise(original.text), 'Q-001', {derives_from:'D-missing'})));
  assert.equal(readGraph(dir).text, original.text);
  assert.equal(fs.existsSync(locations(dir).lock), false);
});

test('pause and resume preserve reasoning and invalidate old hashes', t => {
  const dir = seed(t);
  const old = readGraph(dir);
  const paused = setLifecycle(dir, old.hash, 'paused');
  const resumed = setLifecycle(dir, paused.graph_sha256, 'active');
  assert.equal(resumed.revision, old.meta.revision + 2);
  assert.equal(readGraph(dir).nodes.get('D-006').data.rationale, old.nodes.get('D-006').data.rationale);
  assert.throws(() => setLifecycle(dir, resumed.graph_sha256, 'handed-off'));
});

test('ready handoff seals graph and body and deactivates discovery', t => {
  const dir = seed(t);
  const old = readGraph(dir);
  const output = publishHandoff(dir, old.hash, draft(projectGraph(old)));
  const graph = readGraph(dir);
  assert.equal(output.status, 'ready');
  assert.equal(graph.meta.status, 'handed-off');
  assert.equal(graph.meta.revision, old.meta.revision + 1);
  assert.equal(readHandoff(dir, graph).fresh, true);
  assert.throws(() => applyGraph(dir, graph.hash, revise(graph.text, {status:'handed-off'})), e => e.code === 'LIFECYCLE');
});

test('handoff publishes plain Markdown and standalone sealed JSON', t => {
  const dir = seed(t), graph = readGraph(dir), input = draft(projectGraph(graph)), p = locations(dir);
  const output = publishHandoff(dir, graph.hash, input);
  const body = fs.readFileSync(p.handoff, 'utf8'), metadata = JSON.parse(fs.readFileSync(p.handoffJson, 'utf8'));
  assert.equal(body, input.body);
  assert.equal(output.file, p.handoff);
  assert.equal(output.metadata_file, p.handoffJson);
  assert.equal(metadata.status, 'ready');
  assert.equal(metadata.body_sha256, sha256(body));
  assert.equal(metadata.graph_sha256, readGraph(dir).hash);
  assert.deepEqual(metadata.review, input.review);
  assert.deepEqual(metadata.covers, [...input.covers].sort());
  assert.equal(Object.hasOwn(metadata, 'body'), false);
});

test('missing or malformed handoff files never pass freshness or CLI readiness', t => {
  for (const damage of ['missing-markdown', 'missing-json', 'malformed-json']) {
    const dir = seed(t), graph = readGraph(dir), p = locations(dir);
    publishHandoff(dir, graph.hash, draft(projectGraph(graph)));
    if (damage === 'malformed-json') fs.writeFileSync(p.handoffJson, '{');
    else fs.unlinkSync(damage === 'missing-json' ? p.handoffJson : p.handoff);
    const before = fs.readdirSync(p.state);
    assert.equal(readHandoff(dir, readGraph(dir)).exists, true);
    assert.equal(readHandoff(dir, readGraph(dir)).fresh, false);
    const result = spawnSync(process.execPath, [path.join(PLUGIN, 'dist/discovery.cjs'), 'handoff-status', '--project', dir], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).ready, false);
    assert.deepEqual(fs.readdirSync(p.state), before);
  }
});

test('Markdown and JSON from different publications cannot form a fresh pair', t => {
  const first = seed(t), second = seed(t), graph = readGraph(first), input = draft(projectGraph(graph));
  publishHandoff(first, graph.hash, input);
  const revised = draft(projectGraph(readGraph(second)));
  revised.body += '\nA separate reviewed paragraph.\n';
  revised.review.body_sha256 = sha256(revised.body);
  publishHandoff(second, readGraph(second).hash, revised);
  fs.copyFileSync(locations(second).handoffJson, locations(first).handoffJson);
  assert.equal(readHandoff(first, readGraph(first)).fresh, false);
});

test('interrupted metadata or graph writes leave a stale handoff and release the writer lock', t => {
  const rename = fs.renameSync;
  for (const target of ['handoffJson', 'graph']) {
    const dir = seed(t), p = locations(dir), original = readGraph(dir);
    publishHandoff(dir, original.hash, draft(projectGraph(original)));
    setLifecycle(dir, readGraph(dir).hash, 'active');
    const graph = readGraph(dir), input = draft(projectGraph(graph));
    input.body += '\nA newly reviewed paragraph.\n';
    input.review.body_sha256 = sha256(input.body);
    const mock = t.mock.method(fs, 'renameSync', (from, to) => {
      if (to === p[target]) throw Object.assign(new Error('Simulated write failure'), { code: 'EIO' });
      return rename(from, to);
    });
    try { assert.throws(() => publishHandoff(dir, graph.hash, input), e => e.code === 'EIO'); }
    finally { mock.mock.restore(); }
    assert.equal(readGraph(dir).hash, graph.hash);
    assert.equal(readHandoff(dir, readGraph(dir)).fresh, false);
    assert.equal(fs.existsSync(p.lock), false);
    assert.ok(fs.readdirSync(p.state).every(name => !name.endsWith('.tmp')));
  }
});

test('handoff requires meaningful review coverage markers for commitments and open issues', t => {
  const dir = seed(t);
  const graph = readGraph(dir);
  assert.throws(() => publishHandoff(dir, graph.hash, {body:'# Input\n[I-001]',covers:['I-001']}), e => e.code === 'COVERAGE');
  assert.equal(fs.existsSync(locations(dir).handoff), false);
});

test('blocked handoff remains a draft and keeps active discovery', t => {
  const dir = seed(t, editNode(discoveryFixture, 'I-014', {blocking:true}));
  const graph = readGraph(dir);
  const output = publishHandoff(dir, graph.hash, draft(projectGraph(graph)));
  assert.equal(output.status, 'blocked');
  assert.equal(readGraph(dir).meta.status, 'active');
  assert.match(fs.readFileSync(locations(dir).handoff, 'utf8'), /BLOCKED/);
  assert.equal(JSON.parse(fs.readFileSync(locations(dir).handoffJson, 'utf8')).status, 'blocked');
  assert.equal(readHandoff(dir, readGraph(dir)).fresh, true);
});

test('a manual body edit or later graph update makes handoff stale', t => {
  const dir = seed(t);
  let graph = readGraph(dir);
  publishHandoff(dir, graph.hash, draft(projectGraph(graph)));
  graph = readGraph(dir);
  fs.appendFileSync(locations(dir).handoff, 'Manual edit.\n');
  assert.equal(readHandoff(dir, graph).fresh, false);
  const other = seed(t);
  publishHandoff(other, readGraph(other).hash, draft(projectGraph(readGraph(other))));
  assert.equal(readHandoff(other, readGraph(other)).fresh, true);
  setLifecycle(other, readGraph(other).hash, 'active');
  assert.equal(readHandoff(other, readGraph(other)).fresh, false);
});

test('a handed-off discovery keeps its ready handoff until it is explicitly resumed', t => {
  const dir = seed(t), p = locations(dir);
  publishHandoff(dir, readGraph(dir).hash, draft(projectGraph(readGraph(dir))));
  const handedOff = readGraph(dir), body = fs.readFileSync(p.handoff, 'utf8'), metadata = fs.readFileSync(p.handoffJson, 'utf8');
  assert.equal(handedOff.meta.status, 'handed-off');
  const again = draft(projectGraph(handedOff));
  assert.throws(() => previewHandoff(dir, again), e => e.code === 'LIFECYCLE');
  assert.throws(() => prepareAudit(dir, handedOff.hash, again), e => e.code === 'LIFECYCLE');
  assert.throws(() => publishHandoff(dir, handedOff.hash, again), e => e.code === 'LIFECYCLE');
  assert.equal(fs.readFileSync(p.handoff, 'utf8'), body);
  assert.equal(fs.readFileSync(p.handoffJson, 'utf8'), metadata);
  assert.equal(readHandoff(dir, readGraph(dir)).fresh, true);
});

test('explicit new discovery archives complete current artifacts', t => {
  const dir = seed(t);
  let graph = readGraph(dir);
  publishHandoff(dir, graph.hash, draft(projectGraph(graph)));
  graph = readGraph(dir);
  const oldHandoff = fs.readFileSync(locations(dir).handoff, 'utf8');
  const oldMetadata = fs.readFileSync(locations(dir).handoffJson, 'utf8');
  const output = archiveDiscovery(dir, graph.hash);
  assert.equal(fs.readFileSync(path.join(output.archived, 'current.argdown'), 'utf8'), graph.text);
  assert.equal(fs.readFileSync(path.join(output.archived, 'handoff.md'), 'utf8'), oldHandoff);
  assert.equal(fs.readFileSync(path.join(output.archived, 'handoff.json'), 'utf8'), oldMetadata);
  assert.equal(fs.existsSync(locations(dir).handoff), false);
  assert.equal(fs.existsSync(locations(dir).handoffJson), false);
  const next = initDiscovery(dir, {title:'Another discovery',intent:'A distinct change.'});
  assert.notEqual(next.id, graph.meta.id);
});

test('repair preserves damaged bytes and cannot bypass history checks', t => {
  const damaged = discoveryFixture.replace('"derives_from": "D-006"', '"derives_from": "D-missing"');
  const dir = seed(t, damaged);
  const output = repairGraph(dir, sha256(damaged), revise(discoveryFixture));
  assert.equal(fs.readFileSync(output.preserved_damaged_graph, 'utf8'), damaged);
  assert.equal(readGraph(dir).meta.schema, 2);
  assert.throws(() => repairGraph(dir, readGraph(dir).hash, discoveryFixture), e => e.code === 'REPAIR');
});

test('status reports an absent graph without initializing or hiding damaged state', t => {
  const dir = temporary(t);
  const state = status(dir);
  assert.equal(state.exists, false);
  assert.deepEqual(state.handoff, {exists:false,fresh:false});
  assert.equal(fs.existsSync(locations(dir).state), false);
  const cli = path.join(PLUGIN,'dist','discovery.cjs');
  const output = spawnSync(process.execPath,[cli,'status','--project',dir],{encoding:'utf8'});
  assert.equal(output.status,0,output.stderr);
  assert.equal(JSON.parse(output.stdout).exists,false);
  assert.equal(fs.existsSync(locations(dir).state),false);
  const invalid = seed(t,discoveryFixture.replace('"derives_from": "D-006"','"derives_from": "D-missing"'));
  assert.throws(() => status(invalid), e => e.code === 'SCHEMA');
  assert.throws(() => status(path.join(dir,'missing-project')),e => e.code === 'ENOENT');
});

test('status preserves and reports an orphan handoff without claiming freshness', t => {
  const dir = temporary(t), p = locations(dir);
  fs.mkdirSync(p.state);
  fs.writeFileSync(p.handoff,'Preserve this earlier handoff.');
  assert.deepEqual(status(dir).handoff,{exists:true,fresh:false});
  assert.equal(fs.readFileSync(p.handoff,'utf8'),'Preserve this earlier handoff.');
  assert.equal(fs.existsSync(p.graph),false);
});

test('orphan JSON is reported and cannot be overwritten by initialization', t => {
  const dir = temporary(t), p = locations(dir), bytes = '{"status":"blocked"}\n';
  fs.mkdirSync(p.state);
  fs.writeFileSync(p.handoffJson, bytes);
  assert.deepEqual(status(dir).handoff, { exists: true, fresh: false });
  assert.throws(() => initDiscovery(dir, { title: 'New discovery', intent: 'Inspect scope.' }), e => e.code === 'EXISTS');
  assert.equal(fs.readFileSync(p.handoffJson, 'utf8'), bytes);
  assert.equal(fs.existsSync(p.graph), false);
  assert.equal(fs.existsSync(p.handoff), false);
});

test('archive preserves current artifacts if handoff JSON cannot be copied', t => {
  const dir = seed(t), p = locations(dir), graph = readGraph(dir);
  publishHandoff(dir, graph.hash, draft(projectGraph(graph)));
  fs.unlinkSync(p.handoffJson);
  fs.mkdirSync(p.handoffJson);
  const originals = [p.graph, p.handoff].map(file => fs.readFileSync(file, 'utf8'));
  assert.throws(() => archiveDiscovery(dir, readGraph(dir).hash), e => e.code === 'PATH');
  assert.deepEqual([p.graph, p.handoff].map(file => fs.readFileSync(file, 'utf8')), originals);
  assert.deepEqual(fs.readdirSync(path.join(p.state, 'archive')), []);
});

test('repair cannot reset discovery identity or bypass revision and lifecycle rules', t => {
  const damaged = discoveryFixture.replace('"derives_from": "D-006"','"derives_from": "D-missing"');
  const dir = seed(t,damaged), p = locations(dir);
  const candidates = [{id:'RD-replacement'},{created_at:'2026-10-04T00:00:00Z'},{revision:1},{revision:19},{status:'handed-off'}].map(metadata => revise(discoveryFixture,metadata));
  candidates.push(editNode(revise(discoveryFixture,{root:'I-ROOT'}),'I-001',{parent:'I-ROOT'}) + '\n[I-ROOT]: A different discovery root. #issue {status: open, parent: null}\n');
  for (const candidate of candidates) {
    assert.throws(() => repairGraph(dir,sha256(damaged),candidate),e => ['HISTORY','LIFECYCLE'].includes(e.code));
    assert.equal(fs.readFileSync(p.graph,'utf8'),damaged);
    assert.equal(fs.existsSync(path.join(p.state,'archive')),false);
    assert.equal(fs.existsSync(p.lock),false);
  }
  const result = repairGraph(dir,sha256(damaged),revise(discoveryFixture,{status:'paused'}));
  assert.equal(result.revision,2);
  assert.equal(result.status,'paused');
  assert.equal(result.id,parseGraph(discoveryFixture).meta.id);
  assert.equal(fs.readFileSync(result.preserved_damaged_graph,'utf8'),damaged);
});

test('repair retains an explicitly requested independent audit after body recovery', t => {
  const dir = seed(t), current = readGraph(dir), p = locations(dir);
  const input = {...draft(projectGraph(current)),audit_requested:true};
  assert.equal(publishHandoff(dir,current.hash,input).status,'blocked');
  const publication = fs.readFileSync(p.handoff,'utf8');
  const metadata = fs.readFileSync(p.handoffJson,'utf8');
  const damaged = editNode(current.text,'Q-001',{derives_from:'D-missing'});
  fs.writeFileSync(p.graph,damaged);
  repairGraph(dir,sha256(damaged),revise(discoveryFixture));
  assert.equal(fs.readFileSync(p.handoff,'utf8'),publication);
  assert.equal(fs.readFileSync(p.handoffJson,'utf8'),metadata);
  const repaired = readGraph(dir);
  const result = publishHandoff(dir,repaired.hash,draft(projectGraph(repaired)));
  assert.equal(result.status,'blocked');
  assert.equal(result.independent_audit,'missing');
});

test('a live writer lock is never stolen', t => {
  const dir = seed(t);
  fs.mkdirSync(locations(dir).lock);
  assert.throws(() => setLifecycle(dir, readGraph(dir).hash, 'paused'), e => e.code === 'BUSY');
  assert.equal(readGraph(dir).meta.status, 'active');
});

test('symlink state files are not followed or overwritten', t => {
  const dir = temporary(t);
  const target = path.join(dir, 'outside.argdown');
  fs.writeFileSync(target, discoveryFixture);
  fs.mkdirSync(path.join(dir, '.requirements'));
  fs.symlinkSync(target, locations(dir).graph);
  assert.throws(() => readGraph(dir), e => e.code === 'PATH');
  assert.equal(fs.readFileSync(target, 'utf8'), discoveryFixture);
});

test('nested repository/worktree boundaries prevent inherited discovery', t => {
  const dir = seed(t);
  const source = path.join(dir, 'src');
  const nested = path.join(source, 'nested');
  fs.mkdirSync(nested, {recursive:true});
  fs.writeFileSync(path.join(nested, '.git'), 'gitdir: somewhere');
  assert.equal(findProject(source), dir);
  assert.equal(findProject(nested), nested);
});

test('bundled CLI works offline from a path with spaces and shell characters', t => {
  const dir = temporary(t);
  const project = path.join(dir, 'repo with spaces $(never-run)');
  fs.mkdirSync(project);
  const cli = path.join(PLUGIN, 'dist', 'discovery.cjs');
  const init = JSON.parse(execFileSync(process.execPath, [cli,'init','--project',project], {input:JSON.stringify({title:'Literal $() and `text`',intent:'Preserve Unicode: документ.'}),encoding:'utf8'}));
  const result = JSON.parse(execFileSync(process.execPath, [cli,'check','--project',project], {encoding:'utf8'}));
  assert.equal(result.valid, true);
  assert.equal(readGraph(project).meta.title, 'Literal $() and `text`');
  const failed = spawnSync(process.execPath, [cli,'handoff-status','--project',project], {encoding:'utf8'});
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).exists, false);
  assert.equal(init.status, 'active');
});

test('two actual CLI processes cannot both commit against the same old version', async t => {
  const dir = seed(t);
  const expected = readGraph(dir).hash;
  const cli = path.join(PLUGIN,'dist','discovery.cjs');
  const run = state => new Promise((resolve,reject) => {
    const child = spawn(process.execPath,[cli,'lifecycle','--project',dir,'--expect',expected,'--status',state]);
    let stderr = '';
    child.stderr.on('data',x => {stderr += x;});
    child.on('error',reject);
    child.on('close',code => resolve({code,stderr}));
  });
  const results = await Promise.all([run('active'),run('paused')]);
  assert.equal(results.filter(r => r.code === 0).length,1);
  const failed = results.find(r => r.code !== 0);
  assert.ok(['CONFLICT','BUSY'].includes(JSON.parse(failed.stderr).code));
  assert.equal(readGraph(dir).meta.revision,2);
});

test('archive directory symlinks cannot redirect state preservation', t => {
  const dir = seed(t);
  const external = path.join(dir,'elsewhere');
  fs.mkdirSync(external);
  fs.symlinkSync(external,path.join(locations(dir).state,'archive'));
  assert.throws(() => archiveDiscovery(dir,readGraph(dir).hash), e => e.code === 'PATH');
  assert.equal(readGraph(dir).text,discoveryFixture);
  assert.deepEqual(fs.readdirSync(external),[]);
});
