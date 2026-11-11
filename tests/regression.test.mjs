import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGraph, projectGraph, validateTransition, serializeGraph, viewGraph, sha256 } from '../src/graph.mjs';
import { readGraph, readHandoff, locations } from '../src/storage.mjs';
import { initDiscovery, applyGraph, patchGraph, publishHandoff, previewHandoff, repairGraph, reconcilePositionState, archiveDiscovery } from '../src/operations.mjs';
import { readHeader } from '../src/io.mjs';
import { hookOutput } from '../src/hook.mjs';
import { COMMANDS, main } from '../src/cli.mjs';
import { ROOT, PLUGIN, seed, temporary, discoveryFixture, editNode, revise, draft } from './helpers.mjs';

const minimal = body => `===\n${JSON.stringify({discovery: {...parseGraph(discoveryFixture).meta, root:'I-001',focus:'I-001'}})}\n===\n\n[I-001]: What should change? #issue {status: open, parent: null}\n\n${body}\n`;
const factual = minimal('[I-002]: How is access currently assigned? #issue {status: resolved, parent: I-001, resolved_by: E-001, resolution_history: [E-001]}\n\n[E-001]: Access follows explicit assignments. #evidence {status: verified, sources: [{kind: spec, ref: access.md, authority: normative}], handoff: existing}');
const decision = (id, text = 'Preserve the reviewed navigation.') => `\n[${id}]: ${text} #decision {status: accepted, resolves: [I-010], basis: user, based_on: [], rationale: "The recorded user scope supports this choice.", sources: [{kind: user, ref: "Explicit revised scope agreement", authority: intent}]}\n`;
function successor(previous, from, to) {
  let text = editNode(previous, from, {status:'superseded',superseded_by:to});
  const history = parseGraph(previous).nodes.get('I-010').data.resolution_history;
  text = editNode(text, 'I-010', {resolved_by:to,resolution_history:[...history,to]});
  if (from === 'D-006') {
    text = editNode(text,'Q-001',{status:'superseded'});
    text = editNode(text,'P-010B',{status:'proposed'});
  }
  return revise(text + decision(to));
}

test('factual closure neither invents a decision nor makes handoff ready', t => {
  const dir = seed(t, factual), g = readGraph(dir), p = projectGraph(g);
  assert.equal(p.factual_answers.length, 1); assert.equal(p.readiness, 'blocked');
  assert.equal(p.settled.some(n => n.kind === 'decision'), false);
  const result = publishHandoff(dir,g.hash,draft(p));
  assert.equal(result.status,'blocked'); assert.equal(readGraph(dir).meta.status,'active');
});

test('one choice can resolve several related issues and select their positions', () => {
  let text = editNode(discoveryFixture,'D-006',{resolves:['I-010','I-020'],selected:['P-010B','P-020']});
  text += '\n[I-020]: How do scoped views show location? #issue {status: resolved, parent: I-001, resolved_by: D-006, resolution_history: [D-006]}\n\n[P-020]: Each scoped view shows current location. #position {status: accepted, issue: I-020}\n';
  const g = parseGraph(text); assert.equal(projectGraph(g).readiness,'ready');
  assert.deepEqual(g.nodes.get('D-006').data.resolves,['I-010','I-020']);
  assert.throws(() => parseGraph(editNode(text,'P-020',{issue:'I-014'})),e => e.code === 'SCHEMA');
});

test('assertions and provenance cannot be rewritten underneath a decision', t => {
  const dir = seed(t), old = readGraph(dir);
  const changes = [{sources:[{kind:'doc',ref:'opposite.md',authority:'reference'}]},{}];
  for (const patch of changes) {
    const changed = revise(editNode(discoveryFixture,'E-021',patch,'Users never perform work across locations.'));
    assert.throws(() => applyGraph(dir,old.hash,changed),e => e.code === 'HISTORY');
    assert.equal(readGraph(dir).text,old.text);
  }
});

test('recorded rationale, including native reasoning relations, cannot disappear', () => {
  const old = parseGraph(discoveryFixture);
  const altered = revise(discoveryFixture.replace('    + [E-021]\n',''));
  assert.throws(() => validateTransition(old,parseGraph(altered)), e => e.code === 'HISTORY');
  const earlier = parseGraph(discoveryFixture + '\n[E-EXPLORING]: An unresolved factual lead matters to this exploration. #evidence {status: tentative}\n');
  assert.throws(() => validateTransition(earlier,parseGraph(revise(discoveryFixture))), e => e.code === 'HISTORY');
});

test('a complete new review replaces the operative basis while preserving obsolete evidence', t => {
  const dir = seed(t), old = readGraph(dir);
  patchGraph(dir,old.hash,{update:[{id:'E-021',data:{status:'stale'}},{id:'I-010',data:{status:'open'},unset:['resolved_by']},{id:'D-006',data:{status:'challenged',challenged_by:['E-021']}}]});
  assert.equal(projectGraph(readGraph(dir)).readiness,'blocked');
  const challenged = readGraph(dir);
  patchGraph(dir,challenged.hash,{add:[
    {id:'E-022',kind:'evidence',text:'Current users perform some cross-location workflows.',data:{status:'verified',sources:[{kind:'user',ref:'Fresh confirmed operating context',authority:'intent'}],handoff:'existing'}},
    {id:'V-001',kind:'review',text:'The same navigation still fits the updated operating context.',data:{status:'confirmed',decision:'D-006',based_on:['E-022','C-008','C-012'],rationale:'The changed frequency does not alter the agreed hierarchy or authorization boundary.'}}
  ],update:[{id:'E-021',data:{status:'superseded',superseded_by:'E-022'}},{id:'I-010',data:{status:'resolved',resolved_by:'D-006'}},{id:'D-006',data:{status:'accepted',reaffirmed_by:['V-001']}}]});
  const now = readGraph(dir), p = projectGraph(now);
  assert.equal(p.readiness,'ready'); assert.deepEqual(now.nodes.get('D-006').data.based_on,old.nodes.get('D-006').data.based_on);
  assert.equal(now.nodes.get('E-021').text,old.nodes.get('E-021').text);
  assert.ok(p.sources.some(s => s.ref === 'Fresh confirmed operating context'));
  assert.ok(!p.rationale_context.some(n => n.id === 'E-021'));
  assert.ok(p.rationale_context.some(n => n.id === 'P-010B'));
});

test('review order, original successor pointers and resolution history are append-only', () => {
  const first = parseGraph(successor(discoveryFixture,'D-006','D-007'));
  const secondText = successor(first.text,'D-007','D-008');
  validateTransition(first,parseGraph(secondText));
  const rewired = parseGraph(editNode(secondText,'D-006',{superseded_by:'D-008'}));
  assert.throws(() => validateTransition(first,rewired),e => e.details.some(d => d.includes('original successor')));
  const lost = parseGraph(editNode(secondText,'I-010',{resolution_history:['D-008']}));
  assert.throws(() => validateTransition(first,lost),e => e.code === 'HISTORY');
});

// Without memoization a shared DAG explodes exponentially; the timeout turns that into a failure.
test('a shared dependency DAG is projected once per node', { timeout: 5000 }, t => {
  let text = discoveryFixture;
  for (let i = 0; i < 120; i++) text += `\n[E-DAG${i}]: Recorded fact ${i}. #evidence ${JSON.stringify({status:'verified',depends_on:i < 2 ? [] : [`E-DAG${i-1}`,`E-DAG${i-2}`],sources:[{kind:'doc',ref:'dag.md',authority:'reference'}]})}\n`;
  text = editNode(text,'D-006',{based_on:['E-DAG119']});
  assert.equal(projectGraph(readGraph(seed(t,text))).readiness,'ready');
});

test('deep dependencies are stack safe and circular justification is blocked', () => {
  // Built in memory: far deeper than any call stack, and beyond the 2 MiB file limit.
  const graph = parseGraph(discoveryFixture), depth = 50000, sources = [{kind:'doc',ref:'chain.md',authority:'reference'}];
  for (let i = 0; i < depth; i++) graph.nodes.set(`E-DEEP${i}`, { id:`E-DEEP${i}`, format:'statement', kind:'evidence', text:`Established fact ${i}.`, tags:['evidence'],
    data:{status:'verified',depends_on:i ? [`E-DEEP${i-1}`] : [],sources} });
  graph.nodes.get('D-006').data.based_on = [`E-DEEP${depth-1}`];
  assert.equal(projectGraph(graph).readiness,'ready');
  graph.nodes.get('E-DEEP0').data.depends_on = [`E-DEEP${depth-1}`];
  const p = projectGraph(graph); assert.equal(p.readiness,'blocked'); assert.ok(p.blockers.some(b => b.id === 'D-006'));
});

test('local patches preserve Unicode, literal syntax, metadata and native relation directions', t => {
  const dir = seed(t), old = readGraph(dir), literal = 'Текст [ID] #tag {JSON} <x> \\literal *stars* `code` @mention. https://discoveryFixture.test/a?x=1 // marker .env. :smile: (x-y); /path.';
  patchGraph(dir,old.hash,{meta:{focus:'I-010'},add:[{id:'E-LITERAL',kind:'evidence',text:literal,data:{status:'tentative',note:{nested:['value']}}}]});
  const g = readGraph(dir); assert.equal(g.nodes.get('E-LITERAL').text,literal); assert.deepEqual(g.relations,old.relations);
  assert.throws(() => patchGraph(dir,old.hash,{meta:{focus:'I-001'}}),e => e.code === 'CONFLICT');
  assert.throws(() => patchGraph(dir,g.hash,{update:[{id:'E-021',text:'Changed assertion.'}]}),e => e.code === 'HISTORY');
  assert.equal(readGraph(dir).hash,g.hash);
  assert.throws(() => patchGraph(dir,g.hash,{delete:['E-021']}),e => e.code === 'INPUT');
});

test('bounded view retrieves an issue, its choices, decision and rationale', () => {
  const g = parseGraph(discoveryFixture), view = viewGraph(g,['I-010'],1);
  assert.equal(view.graph_sha256,g.hash); assert.ok(view.nodes.some(n => n.id === 'D-006')); assert.ok(view.nodes.some(n => n.id === 'P-010A'));
  assert.throws(() => viewGraph(g,['I-missing']),e => e.code === 'INPUT');
  assert.throws(() => viewGraph(g,['I-010'],99),e => e.code === 'INPUT');
  assert.equal(serializeGraph(g).nodes.size,g.nodes.size);
});

test('native attack, undercut and contradiction survive canonical patches without direction changes', t => {
  const text = discoveryFixture + '\n[P-010A]\n    - [E-021]\n\n<A-004>\n    _ [C-012]\n\n[P-010A]\n    >< [P-010B]\n';
  const dir = seed(t,text), g = readGraph(dir);
  assert.ok(g.relations.some(r => r.type === 'attack')); assert.ok(g.relations.some(r => r.type === 'undercut')); assert.ok(g.relations.some(r => r.type === 'contradictory'));
  patchGraph(dir,g.hash,{meta:{focus:'I-010'}});
  const keys = graph => graph.relations.map(r => JSON.stringify(r)).sort();
  assert.deepEqual(keys(readGraph(dir)),keys(g));
});

test('semantic publication: IDs alone produce a blocked draft and do not close discovery', t => {
  const dir = seed(t), g = readGraph(dir), input = draft(projectGraph(g)); delete input.review;
  assert.equal(projectGraph(g).readiness,'ready'); assert.equal(publishHandoff(dir,g.hash,input).status,'blocked');
  assert.equal(readGraph(dir).meta.status,'active'); assert.equal(readHandoff(dir,g).reviewed,false);
});

test('semantic review is bound to both files and exposes blocked findings and unavailable sources', t => {
  const dir = seed(t), g = readGraph(dir), input = draft(projectGraph(g));
  const preview = previewHandoff(dir,input); assert.equal(preview.review.checks[0].result,'unchecked');
  const changed = structuredClone(input); changed.body += 'Unsupported changed prose.\n';
  assert.throws(() => publishHandoff(dir,g.hash,changed),e => e.code === 'REVIEW');
  input.review.checks[0] = {check:'consistency',result:'blocked',note:'The proposed text introduces a new guarantee.'};
  assert.equal(publishHandoff(dir,g.hash,input).status,'blocked');
  input.review.checks[0].result = 'pass'; input.review.sources[0].result = 'unavailable';
  const result = publishHandoff(dir,g.hash,input); assert.equal(result.status,'blocked'); assert.ok(result.blockers.some(b => b.reason.includes('unavailable')));
});

test('a changed local source snapshot blocks publication even if the review claims pass', t => {
  const dir = seed(t), source = path.join(dir,'current-spec.md'); fs.writeFileSync(source,'Original contract.\n');
  let text = editNode(discoveryFixture,'C-012',{sources:[{kind:'spec',ref:'current-spec.md',authority:'normative',sha256:sha256(fs.readFileSync(source))}]});
  fs.writeFileSync(locations(dir).graph,text); const g = readGraph(dir), input = draft(projectGraph(g));
  fs.writeFileSync(source,'Changed contract.\n');
  assert.ok(previewHandoff(dir,input).blockers.some(b => b.reason.includes('snapshot changed')));
  assert.equal(publishHandoff(dir,g.hash,input).status,'blocked');
});

test('handoff metadata edits are stale even when graph and body bytes are unchanged', t => {
  const dir = seed(t), g = readGraph(dir); publishHandoff(dir,g.hash,draft(projectGraph(g)));
  const file = locations(dir).handoffJson; fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"status": "ready"','"status": "blocked"'));
  assert.equal(readHandoff(dir,readGraph(dir)).fresh,false);
});

test('a dropped question cannot remain an operative causal prerequisite', () => {
  const text = editNode(discoveryFixture,'D-006',{depends_on:['I-DROPPED']}) + '\n[I-DROPPED]: What is the external permission boundary? #issue {status: dropped, parent: I-001, reason: "The branch was cancelled."}\n';
  assert.ok(projectGraph(parseGraph(text)).blockers.some(b => b.id === 'D-006'));
});

test('unsupported graph schemas remain intact under initialization, updates and repair', t => {
  for (const schema of [0, 1, 99]) {
    const bytes = discoveryFixture.replace('"schema": 2', `"schema": ${schema}`), dir = seed(t, bytes);
    const hash = sha256(bytes), candidate = revise(discoveryFixture);
    assert.throws(() => initDiscovery(dir, {title: 'Resource workflow', intent: 'Inspect resource access.'}), error => error.code === 'EXISTS');
    assert.throws(() => applyGraph(dir, hash, candidate), error => error.code === 'SCHEMA');
    assert.throws(() => patchGraph(dir, hash, {meta: {focus: 'I-010'}}), error => error.code === 'SCHEMA');
    assert.throws(() => repairGraph(dir, hash, candidate), error => error.code === 'REPAIR');
    assert.equal(fs.readFileSync(locations(dir).graph, 'utf8'), bytes);
    assert.equal(fs.existsSync(path.join(locations(dir).state, 'archive')), false);
  }
});

test('an unchanged choice review does not reinstate old selected-option source snapshots', t => {
  const dir = seed(t), local = path.join(dir,'old-context.md'); fs.writeFileSync(local,'Original context.');
  let text = editNode(discoveryFixture,'E-021',{handoff:'omit',sources:[{kind:'doc',ref:'old-context.md',authority:'observed',sha256:sha256(fs.readFileSync(local))}]});
  text = editNode(text,'P-010B',{based_on:['E-021']});
  fs.writeFileSync(locations(dir).graph,text); let g = readGraph(dir);
  patchGraph(dir,g.hash,{add:[{id:'V-NEW',kind:'review',text:'The unchanged choice follows the current user scope.',data:{status:'confirmed',decision:'D-006',based_on:['C-008','C-012'],rationale:'Current user intent and contracts suffice; the former operational context is no longer a necessary premise.'}}],update:[{id:'D-006',data:{reaffirmed_by:['V-NEW']}},{id:'E-021',data:{status:'stale'}}]});
  fs.writeFileSync(local,'Obsolete changed context.'); g=readGraph(dir); const p=projectGraph(g);
  assert.equal(p.readiness,'ready'); assert.ok(!p.sources.some(s => s.ref === 'old-context.md'));
  assert.equal(publishHandoff(dir,g.hash,draft(p)).status,'ready');
});

test('session bootstrap is independent of graph body and never certifies its validity', t => {
  const dir = seed(t), start = hookOutput({cwd:dir,hook_event_name:'SessionStart'},PLUGIN,{}).hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(start) < 600); assert.doesNotMatch(start,/"blockers"|following JSON|ready|approved/);
  const invalidBody = discoveryFixture.replace('"derives_from": "D-006"','"derives_from": "D-404"'); fs.writeFileSync(locations(dir).graph,invalidBody);
  assert.equal(hookOutput({cwd:dir,hook_event_name:'UserPromptSubmit'},PLUGIN,{}),null);
  assert.equal(hookOutput({cwd:dir,hook_event_name:'SessionStart'},PLUGIN,{}).hookSpecificOutput.additionalContext,start);
  assert.throws(()=>readGraph(dir),e=>e.code==='SCHEMA');
  assert.equal(fs.readFileSync(locations(dir).graph,'utf8'),invalidBody);
});

test('user text that resembles Argdown syntax is stored and read back unchanged', t => {
  const dir = temporary(t), meta = { title: 'Compare a === b semantics', intent: 'Keep the {id} field } stable and x = y readable.' };
  initDiscovery(dir, meta);
  const graph = readGraph(dir);
  assert.equal(graph.meta.title, meta.title);
  assert.equal(graph.meta.intent, meta.intent);
  assert.equal(readHeader(dir).title, meta.title);
  const note = 'the {id} field } here === there';
  patchGraph(dir, graph.hash, { meta: { scope: ['a === b'] }, add: [{ id: 'E-500', kind: 'evidence', text: 'Use a === b and {x} here.', data: { status: 'tentative', note } }] });
  const stored = readGraph(dir);
  assert.equal(stored.nodes.get('E-500').data.note, note);
  assert.equal(stored.nodes.get('E-500').text, 'Use a === b and {x} here.');
  assert.deepEqual(stored.meta.scope, ['a === b']);
  assert.match(stored.text, /x = y readable/, 'only runs of === are escaped');
});

test('recovery commands hash and preserve the exact bytes of a graph that is not valid UTF-8', t => {
  const dir = seed(t), p = locations(dir), bytes = Buffer.concat([Buffer.from(discoveryFixture), Buffer.from([0xff, 0xfe, 0x0a])]);
  fs.writeFileSync(p.graph, bytes);
  assert.throws(() => readGraph(dir), e => e.code === 'ENCODING');
  assert.equal(COMMANDS.hash({ project: dir }).graph_sha256, sha256(bytes));
  const repaired = repairGraph(dir, sha256(bytes), revise(discoveryFixture));
  assert.deepEqual(fs.readFileSync(repaired.preserved_damaged_graph), bytes);
  assert.equal(readGraph(dir).meta.revision, 2);
});

test('custom tags with spaces survive patches and Position reconciliation', t => {
  const tagged = discoveryFixture.replace('#evidence { "status": "verified", "issue": "I-010"', '#evidence #(ui flow) { "status": "verified", "issue": "I-010"');
  assert.notEqual(tagged, discoveryFixture);
  const dir = seed(t, tagged), p = locations(dir);
  patchGraph(dir, readGraph(dir).hash, { meta: { focus: 'I-010' } });
  assert.deepEqual(readGraph(dir).nodes.get('E-021').tags.sort(), ['evidence', 'ui flow']);
  fs.writeFileSync(p.graph, editNode(fs.readFileSync(p.graph, 'utf8'), 'P-010A', { status: 'accepted' }));
  const reconciled = reconcilePositionState(dir, sha256(fs.readFileSync(p.graph)));
  assert.ok(reconciled.position_changes.some(c => c.id === 'P-010A' && c.to === 'proposed'));
  assert.ok(readGraph(dir).nodes.get('E-021').tags.includes('ui flow'));
});

test('a damaged or unsealed publication keeps a recorded audit request', t => {
  const dir = seed(t), p = locations(dir), graph = readGraph(dir), { body, covers } = draft(projectGraph(graph));
  assert.equal(publishHandoff(dir, graph.hash, { body, covers, audit_requested: true }).status, 'blocked');
  assert.equal(previewHandoff(dir, { body, covers }).audit_requested, true);
  fs.writeFileSync(p.handoffJson, fs.readFileSync(p.handoffJson, 'utf8').replace('"audit_requested": true', '"audit_requested": false'));
  assert.equal(previewHandoff(dir, { body, covers }).audit_requested, true);
  fs.writeFileSync(p.handoffJson, '{');
  assert.equal(previewHandoff(dir, { body, covers }).audit_requested, true);
  assert.equal(previewHandoff(dir, { body, covers, audit_requested: false }).audit_requested, false);
  fs.rmSync(p.handoffJson); fs.rmSync(p.handoff);
  assert.equal(previewHandoff(dir, { body, covers }).audit_requested, false);
});

test('a snapshot source must match its file when it is recorded', t => {
  const dir = seed(t), spec = path.join(dir, 'specs', 'access.md');
  fs.mkdirSync(path.dirname(spec));
  fs.writeFileSync(spec, 'Access contract.\n');
  const digest = sha256(fs.readFileSync(spec));
  const add = (ref, hash) => ({ add: [{ id: 'E-800', kind: 'evidence', text: 'The contract states access.', data: { status: 'verified', sources: [{ kind: 'spec', ref, authority: 'normative', sha256: hash }] } }] });
  for (const [ref, hash] of [['specs/access.md:3', digest], ['specs/access.md#rules', digest], ['specs/missing.md', digest], ['specs/access.md', 'a'.repeat(64)]]) {
    assert.throws(() => patchGraph(dir, readGraph(dir).hash, add(ref, hash)), e => e.code === 'SOURCE' && e.details[0].startsWith('E-800: snapshot'), ref);
  }
  patchGraph(dir, readGraph(dir).hash, add('specs/access.md', digest));
  assert.equal(readGraph(dir).nodes.get('E-800').data.sources[0].sha256, digest);
});

test('an interrupted archive keeps the graph, so it can be archived again', t => {
  const dir = seed(t), p = locations(dir);
  publishHandoff(dir, readGraph(dir).hash, draft(projectGraph(readGraph(dir))));
  const unlink = fs.unlinkSync;
  const mock = t.mock.method(fs, 'unlinkSync', file => {
    if (file === p.handoff) throw Object.assign(new Error('Simulated failure'), { code: 'EIO' });
    return unlink(file);
  });
  try { assert.throws(() => archiveDiscovery(dir, readGraph(dir).hash), e => e.code === 'EIO'); }
  finally { mock.mock.restore(); }
  assert.equal(fs.existsSync(p.graph), true);
  archiveDiscovery(dir, readGraph(dir).hash);
  assert.deepEqual(fs.readdirSync(p.state), ['archive']);
});

test('readiness gates: visible coverage markers and no patch into handed-off', t => {
  const dir = seed(t), graph = readGraph(dir), { covers } = draft(projectGraph(graph));
  assert.throws(() => previewHandoff(dir, { body: '# Input without markers', covers }), e => e.code === 'COVERAGE');
  assert.throws(() => publishHandoff(dir, graph.hash, { body: '# Input without markers', covers }), e => e.code === 'COVERAGE');
  assert.throws(() => patchGraph(dir, graph.hash, { meta: { status: 'handed-off' } }), e => e.code === 'LIFECYCLE');
});

test('handoff-status reports a recorded source that changed after publication', t => {
  const dir = seed(t), spec = path.join(dir, 'specs', 'access.md');
  fs.mkdirSync(path.dirname(spec));
  fs.writeFileSync(spec, 'Access contract.\n');
  patchGraph(dir, readGraph(dir).hash, { add: [{ id: 'E-800', kind: 'evidence', text: 'The contract states access.',
    data: { status: 'verified', handoff: 'existing', sources: [{ kind: 'spec', ref: 'specs/access.md', authority: 'normative', sha256: sha256(fs.readFileSync(spec)) }] } }] });
  assert.equal(publishHandoff(dir, readGraph(dir).hash, draft(projectGraph(readGraph(dir)))).status, 'ready');
  const handoffStatus = () => spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli-entry.mjs'), 'handoff-status', '--project', dir], { encoding: 'utf8' });
  assert.equal(handoffStatus().status, 0);
  fs.appendFileSync(spec, 'A changed rule.\n');
  const stale = handoffStatus();
  assert.equal(stale.status, 1);
  assert.match(JSON.parse(stale.stdout).source_blockers[0].reason, /snapshot changed: specs\/access\.md/);
});

test('the CLI rejects unknown commands and repeated or unknown flags', async () => {
  await assert.rejects(main(['bogus']), e => e.code === 'ARGS');
  await assert.rejects(main(['status', '--project', ROOT, '--project', ROOT]), e => e.code === 'ARGS');
  await assert.rejects(main(['status', '--id', 'I-001']), e => e.code === 'ARGS');
});
