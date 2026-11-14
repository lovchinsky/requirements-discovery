---
name: handoff
description: Review the current discovery and publish it as verbatim, traceable Spec Kit input rendered from the graph; fold branches that were not chosen into short conclusions, preserve open points and source authority, record semantic review and block unresolved material issues.
argument-hint: "[scope emphasis | audit for an explicitly requested independent review]"
disable-model-invocation: true
---

# Discovery handoff

User request: $ARGUMENTS

Remain in the main conversation. Read `${CLAUDE_PLUGIN_ROOT}/references/graph-profile.md`, `${CLAUDE_PLUGIN_ROOT}/references/requirements-radar.md`, `${CLAUDE_PLUGIN_ROOT}/references/handoff-contract.md` and `${CLAUDE_PLUGIN_ROOT}/references/semantic-review.md`. For an explicitly requested audit also read `${CLAUDE_PLUGIN_ROOT}/references/independent-audit.md`. Use `node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs"` with the discovery's actual project root. If read directly, resolve `${CLAUDE_PLUGIN_ROOT}` from this file's plugin root (two directories above its containing folder) and treat an unexpanded argument placeholder as empty. Never initialize an empty discovery to make a handoff succeed.

## Review current state and authority

Run `project --project "<root>"`. Its readiness is **mechanical**, not semantic approval. Inspect the whole graph, rationale and material source pointers. Challenge the scope and behavior against the five review axes and relevant domain scenarios. Reinspect exact authoritative contracts when currency is uncertain or the sources changed. Source hashes supplement judgment; unchanged graph/body hashes do not prove external truth. Never claim research that unavailable tools did not perform.

Investigate factual gaps from sources. If a finding challenges a commitment, persist the challenge/new evidence and affected state using discovery rules, then render again. If product judgment is missing, retain the issue and make a blocked draft. Do not invent approval, silently narrow scope, or mark a blocker nonblocking just to publish. An explicit nonblocking reason must explain why specification can proceed without inventing an answer or hiding the consequence.

## Conclude the branches that were not chosen

The helper renders `handoff.md` from the graph; you do not write or paraphrase its prose. Current nodes appear verbatim with their IDs. Earlier versions, resolutions and reviews are listed by ID beside their record. A retired node that the operative state still relies on is shown with its text in its own section, because it is a blocker. Everything else (unselected options of decided questions, retired reasoning and the reasoning about those options) is folded into short conclusions that you write now. Discovery does not record them: a branch is usually left unfinished when the user turns to another option.

1. Run `handoff-preview` with stdin `{"language":"<tag>"}`. Labels exist for `en` and `uk`; for another user language use the closest one, since node texts stay in their own language. `branches.unconcluded` groups the nodes that still need a conclusion by the issue they hang from. `branches.fold_candidates` suggests current evidence and fact-answered questions that bear only on those branches; they are suggestions, so keep a fact that describes existing behavior the specification needs. `previous` holds the language and conclusions of the last rendered publication; reuse a conclusion only if its branch is unchanged. Read the nodes with `view` before concluding anything.
2. Write one conclusion per abandoned branch, usually one per decided issue: `{issue, covers, text}`. `issue` is the current issue under which it is shown, `covers` lists every node of the branch, and `text` is a short, self-contained judgment in the user's language: what was explored and why it was not taken, or that it was not explored because another option settled the question. Summarize the recorded reasoning (decision rationale, attacking arguments, user statements) and say when the graph records no reason. Do not give a reason per node, restate the chosen option or add claims, requirements, stories or acceptance criteria.
3. An option explored and abandoned often leaves fact-resolved sub-questions and evidence that would otherwise render as part of the chosen solution. Fold them into the same conclusion. The helper accepts a fold only for a closed branch: it refuses to fold a commitment or blocker of the projection (a current decision, a chosen or live option, an agreed constraint, a consequence, an assumption, an open question, material evidence), anything a remaining current node depends on, reasoning that bears on a current node, a question outside the conclusion's issue, and a node not linked to the rest of the conclusion. Do not conclude away a moot open question of an abandoned branch: drop it in the graph with its reason under discovery rules; a dropped question concludes itself and its options with that reason.
4. If a verbatim text would mislead an unfamiliar engineer, correct the graph under discovery rules (a new version, a challenge, a dropped issue) and render again. Never edit the handoff text by hand.

Run `render --expect "<preview graph_sha256>"` with the same stdin JSON and read the whole draft; it refuses a graph changed since the preview, so the text you review is the one the preview hashed. Branches still without a conclusion are marked in it.

## Record the semantic review and publish

Prepare temporary stdin JSON `{language,conclusions}` (add `audit_requested:true` for an explicitly requested audit), then run `handoff-preview`. It returns the exact current graph and rendered body hashes plus an **unfilled** review template whose sources are those of every node the draft shows with its text; `concluded:false` means a branch still lacks a conclusion. Fill `review.checks` for consistency, source_authority, coverage, decision_quality and readiness with `pass | blocked` and concrete observations about the rendered draft. Account for every preview source with `checked | not-needed | unavailable` and a reason. `not-needed` is justified by actual scope/current intent; do not use it to bypass uncertainty about a material authoritative contract. Never fill pass merely because the graph parses, IDs are present or a previous review passed.

No mandatory second model is called. Only when the user explicitly requests an independent audit (including the `audit` argument), run `audit-prepare` for this actual draft and preview hash. Follow `independent-audit.md` to launch a **new** `requirements-discovery:handoff-auditor` with only the snapshots, source paths, original intent and review contracts. Do not fork the discovery conversation, resume an earlier audit or seed your conclusions. Its tools are exactly Read/Grep/Glob; it does not own state or decide intent. Record its original report as `review.independent_audit`. Investigate findings; persist real corrections and run a new audit on new snapshots. Record evidence-backed disagreement separately in `review.audit_responses`. Keep audit_requested true if the agent is unavailable; absence/unavailable findings blocks finalization, never falls back to a claimed pass. An audit request recorded in a prior handoff persists across retries and revisions. If `handoff-preview` reports `audit_requested: true` although nobody asked in this conversation, an earlier explicit request still applies: tell the user and run the audit as requested, unless they explicitly change the review mode. Only an explicit user change of review mode permits audit_requested:false; missing tools do not. Current prior reports are retained even when omitted from retry input: when an earlier `handoff` run for the same graph/draft recorded the report in `handoff.json` (for example, a retry to add `audit_responses`), delete the preview's unfilled `review.independent_audit` template instead of auditing again; if that run was rejected, attach the original report again.

Attach the completed review to the same JSON, keeping both hashes from the preview:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs" handoff \
  --project "<root>" --expect "<reviewed graph_sha256>" < "<conclusions-with-review.json>"
```

The receipt records the main conversation's review; it is not proof of prose quality or user agreement. The helper renders the body again, rejects malformed/stale receipts and conclusions, checks that every branch is concluded and known blockers, rechecks recorded local snapshots and seals publication metadata. Missing review or unresolved semantic findings produces a marked blocked draft. A requested audit must also pass or have every blocking finding explicitly rejected with evidence; stale reports are rejected. Only a ready publication sets lifecycle handed-off; blocked retains prior lifecycle. A conflict needs rereading, reconcluding and reviewing, not a new hash on the stale draft. Remove temporary files after a ready publication; retain recoverable inputs and report any failed write honestly.

The helper writes `.requirements/handoff.md` as plain Markdown and `.requirements/handoff.json` as sealed publication metadata (schema 3), including the renderer version, language and conclusions that reproduce the Markdown. Keep both files together and never edit either by hand.

Run `handoff-status` after publication; `reproduction` reports whether the graph and recorded inputs still render the published bytes (`reproducible`), or why not (`differs`, `renderer-changed`, `not-renderable`, `legacy-prose` for a publication of an earlier plugin version). Read the published draft for unsupported conclusions, hidden assumptions and superseded commitments. Ready status requires current graph/body/metadata, review, mechanical readiness and valid recorded local source snapshots, plus a cleared audit when requested. It does not check unrecorded external changes automatically. Remove only your exact prepared audit directory after successful publication, retaining the report in `handoff.json`.

For ready input give both paths and this next-step prompt, adapted to the user's language, without invoking it automatically:

```text
/speckit.specify Create the specification from .requirements/handoff.md. Keep its
intent, constraints, assumptions and open points; surface conflicts with existing
specs or code instead of silently changing the settled intent.
```

If Spec Kit is absent, still deliver the complete handoff without installing or reconfiguring it. For a blocked draft, explain the material blockers and continue only the research/discussion already authorized by the user's task.
