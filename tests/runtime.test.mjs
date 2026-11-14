import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT, PLUGIN } from './helpers.mjs';

// Runs the committed bundles from a copy of the plugin directory, as Claude Code installs it:
// outside this project, so no node_modules can be resolved from a parent directory.
test('the installed plugin directory works offline end to end', async t => {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-runtime-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const unpacked = path.join(temporary, 'requirements-discovery');
  fs.cpSync(PLUGIN, unpacked, { recursive: true });
  const fixtureFile = path.join(ROOT, 'tests', 'fixtures', 'discovery.argdown');
  const environment = { ...process.env, NODE_PATH: '' };
  delete environment.CLAUDE_PROJECT_DIR;

  function processResult(executable, args, options = {}) {
    const result = spawnSync(executable, args, {
      cwd: temporary, encoding: 'utf8', env: environment,
      timeout: 15000, maxBuffer: 4 * 1024 * 1024, ...options,
    });
    assert.ifError(result.error);
    assert.equal(result.status, options.expectedStatus ?? 0, result.stderr || result.stdout);
    if (options.expectedCode) assert.equal(JSON.parse(result.stderr).code, options.expectedCode, result.stderr);
    return result.stdout;
  }
  const cli = path.join(unpacked, 'dist', 'discovery.cjs');
  const hook = path.join(unpacked, 'dist', 'hook.cjs');
  const run = (project, command, input, args = [], expectedStatus = 0) => JSON.parse(
    processResult(process.execPath, [cli, command, '--project', project, ...args], {
      input: input === undefined ? undefined : typeof input === 'string' ? input : JSON.stringify(input),
      expectedStatus,
    }),
  );
  const runHook = (project, event = 'SessionStart', extra = {}) => processResult(
    process.execPath, [hook], { input: JSON.stringify({ cwd: project, hook_event_name: event, ...extra }) },
  );
  const fresh = path.join(temporary, 'Чистий проєкт ; $(literal)');
  const fixture = path.join(temporary, 'Fictional settled fixture');
  let emptyProjection, initialHash, prepared;

  await t.test('help, a fresh project and the SessionStart bootstrap', () => {
    assert.match(processResult(process.execPath, [cli, '--help']), /--expect/);
    fs.mkdirSync(fresh);
    assert.equal(runHook(fresh), '');
    assert.deepEqual(fs.readdirSync(fresh), []);
    assert.equal(run(fresh,'status').exists,false);
    assert.deepEqual(fs.readdirSync(fresh), []);
    run(fresh, 'init', { title: 'Перевірка встановлення', intent: 'Дослідити цільову поведінку.' });
    assert.equal(run(fresh, 'check').valid, true);
    for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) {
      const output = JSON.parse(runHook(fresh, 'SessionStart', { source }));
      assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
      assert.ok(output.hookSpecificOutput.additionalContext.includes(path.join(unpacked, 'skills', 'discover', 'SKILL.md')));
      assert.ok(output.hookSpecificOutput.additionalContext.includes(JSON.stringify(path.join(fresh, '.requirements', 'current.argdown'))));
      const pointers = [path.join(unpacked, 'skills', 'discover', 'SKILL.md'), path.join(fresh, '.requirements', 'current.argdown')];
      assert.ok(Buffer.byteLength(pointers.reduce((text, file) => text.replaceAll(JSON.stringify(file), ''), output.hookSpecificOutput.additionalContext)) < 300);
      assert.match(output.hookSpecificOutput.additionalContext,/restore discovery behavior and current focus/);
    }
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(unpacked,'hooks','hooks.json'),'utf8')).hooks),['SessionStart']);
    for (let i=0;i<3;i++) assert.equal(runHook(fresh,'UserPromptSubmit',{prompt:'A normal unrelated message.'}), '');
    assert.equal(processResult(process.execPath, [hook], { input: 'not JSON' }), '');
  });

  await t.test('input errors are structured and change nothing', () => {
    const before = run(fresh, 'check').graph_sha256;
    processResult(process.execPath, [cli, 'patch', '--project', fresh, '--expect', before], { input: '{not json', expectedStatus: 1, expectedCode: 'JSON' });
    processResult(process.execPath, [cli, 'bogus', '--project', fresh], { expectedStatus: 1, expectedCode: 'ARGS' });
    processResult(process.execPath, [cli, 'status', '--project', fresh, '--project', fresh], { expectedStatus: 1, expectedCode: 'ARGS' });
    assert.equal(run(fresh, 'check').graph_sha256, before);
  });

  await t.test('a blocked handoff stays a draft and requirement nodes are not authorable', () => {
    emptyProjection = run(fresh, 'project');
    assert.equal(emptyProjection.readiness, 'blocked');
    initialHash = run(fresh, 'check').graph_sha256;
    processResult(process.execPath,[cli,'patch','--project',fresh,'--expect',initialHash],{
      input:JSON.stringify({add:[{id:'R-NOT-AUTHORABLE',kind:'requirement',text:'A duplicate specification.',data:{status:'agreed'}}]}),expectedStatus:1,expectedCode:'INPUT',
  });
  assert.equal(run(fresh,'check').graph_sha256,initialHash);
  processResult(process.execPath, [cli, 'handoff', '--project', fresh, '--expect', initialHash], { input: JSON.stringify({ body: '# A hand-written draft', covers: ['I-001'] }), expectedStatus: 1, expectedCode: 'INPUT' });
  const blocked = run(fresh, 'handoff', {}, ['--expect', initialHash]);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.discovery_status, 'active');
  assert.match(fs.readFileSync(path.join(fresh, '.requirements', 'handoff.md'), 'utf8'), /BLOCKED/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fresh, '.requirements', 'handoff.json'), 'utf8')).status, 'blocked');
  });

  await t.test('a reviewed ready handoff and its freshness checks', () => {
    fs.mkdirSync(path.join(fixture, '.requirements'), { recursive: true });
    fs.copyFileSync(fixtureFile, path.join(fixture, '.requirements', 'current.argdown'));
    const projection = run(fixture, 'project');
    assert.equal(projection.readiness, 'ready');
    const unconcluded = run(fixture, 'handoff-preview', {});
    assert.equal(unconcluded.concluded, false);
    assert.deepEqual(unconcluded.branches.unconcluded.map(group => [group.issue, group.nodes.map(n => n.id)]), [['I-010', ['P-010A']]]);
    const draft = { language: 'uk', conclusions: [{ issue: 'I-010', covers: ['P-010A'], text: 'Synthetic runtime conclusion; not a semantic requirements review.' }] };
    const rendered = processResult(process.execPath, [cli, 'render', '--project', fixture, '--expect', unconcluded.graph_sha256], { input: JSON.stringify(draft) });
    processResult(process.execPath, [cli, 'render', '--project', fixture, '--expect', '0'.repeat(64)], { input: JSON.stringify(draft), expectedStatus: 1, expectedCode: 'CONFLICT' });
    assert.match(rendered, /^# Resource workflow\n/); assert.match(rendered, /## Питання й рішення/);
    const withoutReview = run(fixture, 'handoff', draft, ['--expect', run(fixture, 'check').graph_sha256]);
    assert.equal(withoutReview.status,'blocked');
    const preview = run(fixture,'handoff-preview',draft);
    const review = preview.review;
    for (const check of review.checks) { check.result = 'pass'; check.note = 'Synthetic receipt tests only publication integrity, not model judgment.'; }
    for (const source of review.sources) { source.result = 'not-needed'; source.note = 'Fictional fixture source, not an actual product claim.'; }
    const published = run(fixture, 'handoff', {...draft,review}, ['--expect', preview.graph_sha256]);
    assert.equal(published.status, 'ready');
    const handoffMarkdown = path.join(fixture, '.requirements', 'handoff.md');
    const handoffJson = path.join(fixture, '.requirements', 'handoff.json');
    const metadataBytes = fs.readFileSync(handoffJson, 'utf8');
    const metadata = JSON.parse(metadataBytes);
    assert.equal(published.file, handoffMarkdown);
    assert.equal(published.metadata_file, handoffJson);
    assert.equal(fs.readFileSync(handoffMarkdown, 'utf8'), rendered);
    assert.deepEqual(metadata.conclusions, draft.conclusions);
    assert.equal(metadata.body_sha256, hash(fs.readFileSync(handoffMarkdown)));
    assert.equal(metadata.graph_sha256, published.graph_sha256);
    const sealed = run(fixture, 'handoff-status'); assert.equal(sealed.ready, true); assert.equal(sealed.reproduction, 'reproducible');
    fs.unlinkSync(handoffJson);
    assert.equal(run(fixture, 'handoff-status', undefined, [], 1).ready, false);
    fs.writeFileSync(handoffJson, '{');
    assert.equal(run(fixture, 'handoff-status', undefined, [], 1).ready, false);
    fs.writeFileSync(handoffJson, metadataBytes.replace('"status": "ready"', '"status": "blocked"'));
    assert.equal(run(fixture, 'handoff-status', undefined, [], 1).ready, false);
    fs.writeFileSync(handoffJson, metadataBytes);
    assert.equal(run(fixture, 'handoff-status').ready, true);
    assert.equal(runHook(fixture, 'UserPromptSubmit'), '');
    assert.match(JSON.parse(runHook(fixture, 'SessionStart')).hookSpecificOutput.additionalContext, /inactive/);
    fs.appendFileSync(path.join(fixture, '.requirements', 'handoff.md'), '\nManual change.\n');
    assert.equal(run(fixture, 'handoff-status', undefined, [], 1).ready, false);
  });

  await t.test('lifecycle, patch, view, compare-and-swap, supersession and Position reconciliation', () => {
    const restored = run(fixture,'lifecycle',undefined,['--expect',run(fixture,'check').graph_sha256,'--status','active']);
    const patched = run(fixture,'patch',{meta:{focus:'I-010'},add:[{id:'E-OFFLINE',kind:'evidence',text:'A tentative offline finding.',data:{status:'tentative'}}]},['--expect',restored.graph_sha256]);
    assert.equal(run(fixture,'view',undefined,['--ids','E-OFFLINE','--depth','0']).nodes[0].id,'E-OFFLINE');
    const conflict = processResult(process.execPath,[cli,'patch','--project',fixture,'--expect',restored.graph_sha256],{input:JSON.stringify({meta:{focus:'I-001'}}),expectedStatus:1,expectedCode:'CONFLICT'});
    assert.equal(conflict,'');
    assert.equal(run(fixture,'check').graph_sha256,patched.graph_sha256);
    const superseded = run(fixture,'patch',{update:[
      {id:'D-006',data:{status:'superseded',superseded_by:'D-OFFLINE'}},
      {id:'I-010',data:{resolved_by:'D-OFFLINE'}},{id:'Q-001',data:{status:'superseded'}}
    ],add:[{id:'D-OFFLINE',kind:'decision',text:'A revised fictional navigation judgment.',data:{status:'accepted',resolves:['I-010'],selected:['P-010A'],based_on:[],basis:'user',rationale:'The fictional user explicitly changed scope.',sources:[{kind:'user',ref:'Fictional changed scope',authority:'intent'}]}}]},['--expect',patched.graph_sha256]);
    assert.ok(superseded.position_changes.some(c=>c.id==='P-010B'&&c.to==='proposed'));
    const choices=run(fixture,'view',undefined,['--ids','P-010A,P-010B','--depth','0']).nodes;
    assert.equal(choices.find(n=>n.id==='P-010A').data.status,'accepted');
    assert.equal(choices.find(n=>n.id==='P-010B').data.status,'proposed');
    const graphFile=path.join(fixture,'.requirements/current.argdown');
    const damaged=fs.readFileSync(graphFile,'utf8').split('\n').map(line=>{
      if(!line.startsWith('[P-010B]:')) return line;
      const brace=line.indexOf('{'), data=JSON.parse(line.slice(brace)); data.status='accepted';
      return line.slice(0,brace)+JSON.stringify(data);
    }).join('\n');
    fs.writeFileSync(graphFile,damaged);
    const reconciled=run(fixture,'positions-reconcile',undefined,['--expect',run(fixture,'hash').graph_sha256]);
    assert.equal(fs.readFileSync(path.join(reconciled.preserved_original,'current.argdown'),'utf8'),damaged);
    assert.equal(run(fixture,'check').valid,true);
  });

  await t.test('a requested audit gates publication until a fresh report passes', () => {
    // After the supersession the former choice and its argument are the branch not chosen; D-006 and Q-001 are history.
    assert.deepEqual(run(fixture,'handoff-preview',{}).branches.unconcluded.map(group=>[group.issue,group.nodes.map(n=>n.id)]),[['I-010',['P-010B','A-004']]]);
    const auditDraft={conclusions:[{issue:'I-010',covers:['P-010B','A-004'],text:'Synthetic runtime conclusion for the superseded navigation choice.'}],audit_requested:true};
    const auditPreview=run(fixture,'handoff-preview',auditDraft), auditReview=auditPreview.review;
    for(const c of auditReview.checks){c.result='pass';c.note='Synthetic publication mechanics only; not a semantic model assessment.';}
    for(const s of auditReview.sources){s.result='not-needed';s.note='Fictional runtime fixture source.';}
    const report=auditReview.independent_audit; delete auditReview.independent_audit;
    const auditMissing=run(fixture,'handoff',{...auditDraft,review:auditReview},['--expect',auditPreview.graph_sha256]);
    assert.equal(auditMissing.status,'blocked'); assert.equal(auditMissing.independent_audit,'missing');
    const retryDraft={...auditDraft}; delete retryDraft.audit_requested;
    assert.equal(run(fixture,'handoff-preview',retryDraft).audit_requested,true);
    assert.equal(run(fixture,'handoff',{...retryDraft,review:auditReview},['--expect',auditPreview.graph_sha256]).status,'blocked');
    prepared=run(fixture,'audit-prepare',auditDraft,['--expect',auditPreview.graph_sha256]);
    assert.equal(hash(fs.readFileSync(prepared.graph)),auditPreview.graph_sha256);
    assert.equal(hash(fs.readFileSync(prepared.draft)),auditPreview.body_sha256);
    assert.equal(run(fixture,'check').graph_sha256,auditPreview.graph_sha256);
    report.result='pass'; report.limits=['Synthetic report; no model invocation or host-isolation attestation.'];
    for(const c of report.checks){c.result='pass';c.note='Synthetic independent receipt verifies only binding and publication integrity.';}
    auditReview.independent_audit=report;
    assert.equal(run(fixture,'handoff',{...auditDraft,review:auditReview},['--expect',auditPreview.graph_sha256]).status,'ready');
    const auditedState=run(fixture,'handoff-status'); assert.equal(auditedState.ready,true); assert.equal(auditedState.audited,true);
    fs.rmSync(prepared.directory,{recursive:true});
  });

  await t.test('repair preserves damaged bytes and refuses identity, revision and lifecycle changes', () => {
    const repairProject = path.join(temporary,'Damaged body repair');
    fs.mkdirSync(path.join(repairProject,'.requirements'),{recursive:true});
    const repairFile = path.join(repairProject,'.requirements/current.argdown');
    const original = fs.readFileSync(fixtureFile,'utf8');
    const invalidBody = original.replace('"derives_from": "D-006"','"derives_from": "D-MISSING"');
    fs.writeFileSync(repairFile,invalidBody);
    const rawHash = run(repairProject,'hash').graph_sha256;
    const candidate = original.replace('"revision": 1','"revision": 2');
    for (const [forbidden, expectedCode] of [[candidate.replace('RD-resource-workflow','RD-other'),'HISTORY'],[candidate.replace('"revision": 2','"revision": 19'),'HISTORY'],[candidate.replace('"status": "active"','"status": "handed-off"'),'LIFECYCLE'],[candidate+'\n[R-FORBIDDEN]: A duplicate formal requirement. #requirement {status: proposed}\n','SCHEMA']]) {
      processResult(process.execPath,[cli,'repair','--project',repairProject,'--expect',rawHash],{input:forbidden,expectedStatus:1,expectedCode});
      assert.equal(fs.readFileSync(repairFile,'utf8'),invalidBody);
    }
    const repaired = run(repairProject,'repair',candidate,['--expect',rawHash]);
    assert.equal(repaired.revision,2);
    assert.equal(fs.readFileSync(repaired.preserved_damaged_graph,'utf8'),invalidBody);
    assert.equal(run(repairProject,'check').valid,true);
  });
});
