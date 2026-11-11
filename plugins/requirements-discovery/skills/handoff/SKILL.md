---
name: handoff
description: Review and distill current discovery into compact, traceable Spec Kit input; preserve open points and source authority, record semantic review and block unresolved material issues.
argument-hint: "[scope emphasis | audit for an explicitly requested independent review]"
disable-model-invocation: true
---

# Discovery handoff

User request: $ARGUMENTS

Remain in the main conversation. Read `${CLAUDE_PLUGIN_ROOT}/references/graph-profile.md`, `${CLAUDE_PLUGIN_ROOT}/references/requirements-radar.md`, `${CLAUDE_PLUGIN_ROOT}/references/handoff-contract.md` and `${CLAUDE_PLUGIN_ROOT}/references/semantic-review.md`. For an explicitly requested audit also read `${CLAUDE_PLUGIN_ROOT}/references/independent-audit.md`. Use `node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs"` with the discovery's actual project root. If read directly, resolve `${CLAUDE_PLUGIN_ROOT}` from this file's plugin root (two directories above its containing folder) and treat an unexpanded argument placeholder as empty. Never initialize an empty discovery to make a handoff succeed.

## Review current state and authority

Run `project --project "<root>"`. Its readiness is **mechanical**, not semantic approval. Inspect the whole graph, rationale and material source pointers. Challenge the scope and behavior against the five review axes and relevant domain scenarios. Reinspect exact authoritative contracts when currency is uncertain or the sources changed. Source hashes supplement judgment; unchanged graph/body hashes do not prove external truth. Never claim research that unavailable tools did not perform.

Investigate factual gaps from sources. If a finding challenges a commitment, persist the challenge/new evidence and affected state using discovery rules, then regenerate the projection. If product judgment is missing, retain the issue and make a blocked draft. Do not invent approval, silently narrow scope, or mark a blocker nonblocking just to publish. An explicit nonblocking reason must explain why specification can proceed without inventing an answer or hiding the consequence.

## Distill specification input

Write one self-contained Markdown body in the user's language. Carry intent/scope, observed current model, normative constraints, settled target behavior, changes, invariants, material failures/edge cases, assumptions, unresolved points and sources. Distinguish what exists, what is approved and what remains uncertain. Merge related claims into useful prose; do not copy the research journey or every node body.

Include visible `[node-ID]` references for every `required_coverage` ID. Several IDs may share a paragraph. Explain actual meaning, not just coverage markers. Include rejected alternatives only when they explain an operative trade-off. Use recorded source authority/locators/revision and recheck material currency.

Do not introduce unsupported requirements, FR numbering, stories, acceptance criteria, Given/When/Then, API design, implementation plans or tasks. Discovery's settled behavior may be described precisely without expanding it into a new design. Keep behavior with its actual Decision and material constraints/implications.
## Record the semantic review and publish

Prepare temporary stdin JSON `{body,covers}` (add `audit_requested:true` for an explicitly requested audit), then run `handoff-preview`. It returns the exact current graph and normalized body hashes plus an **unfilled** review template. Fill `review.checks` for consistency, source_authority, coverage, decision_quality and readiness with `pass | blocked` and concrete observations. Account for every preview source with `checked | not-needed | unavailable` and a reason. `not-needed` is justified by actual scope/current intent; do not use it to bypass uncertainty about a material authoritative contract. Never fill pass merely because the graph parses, IDs are present or a previous review passed.

No mandatory second model is called. Only when the user explicitly requests an independent audit (including the `audit` argument), run `audit-prepare` for this actual draft and preview hash. Follow `independent-audit.md` to launch a **new** `requirements-discovery:handoff-auditor` with only the snapshots, source paths, original intent and review contracts. Do not fork the discovery conversation, resume an earlier audit or seed your conclusions. Its tools are exactly Read/Grep/Glob; it does not own state or decide intent. Record its original report as `review.independent_audit`. Investigate findings; persist real corrections and run a new audit on new snapshots. Record evidence-backed disagreement separately in `review.audit_responses`. Keep audit_requested true if the agent is unavailable; absence/unavailable findings blocks finalization, never falls back to a claimed pass. An audit request recorded in a prior handoff persists across retries and revisions. If `handoff-preview` reports `audit_requested: true` although nobody asked in this conversation, an earlier explicit request still applies: tell the user and run the audit as requested, unless they explicitly change the review mode. Only an explicit user change of review mode permits audit_requested:false; missing tools do not. Current prior reports are retained even when omitted from retry input: when an earlier `handoff` run for the same graph/draft recorded the report in `handoff.json` (for example, a retry to add `audit_responses`), delete the preview's unfilled `review.independent_audit` template instead of auditing again; if that run was rejected, attach the original report again.

Attach the completed review to the draft JSON, keeping both hashes from the preview:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs" handoff \
  --project "<root>" --expect "<reviewed graph_sha256>" < "<draft-with-review.json>"
```

The receipt records the main conversation's review; it is not proof of prose quality or user agreement. The helper rejects malformed/stale receipts, checks coverage and known blockers, rechecks recorded local snapshots and seals publication metadata. Missing review or unresolved semantic findings produces a marked blocked draft. A requested audit must also pass or have every blocking finding explicitly rejected with evidence; stale reports are rejected. Only a ready publication sets lifecycle handed-off; blocked retains prior lifecycle. A conflict needs rereading, redrafting and reviewing, not a new hash on the stale draft. Remove temporary files after a ready publication; retain recoverable inputs and report any failed write honestly.

The helper writes `.requirements/handoff.md` as plain Markdown and `.requirements/handoff.json` as sealed publication/review metadata. Keep both files together; do not copy metadata into Markdown or prose into JSON.

Run `handoff-status` after publication. Check the actual prose for unsupported conclusions, hidden assumptions and superseded commitments. Ready status requires current graph/body/metadata, review, mechanical readiness and valid recorded local source snapshots, plus a cleared audit when requested. It does not check unrecorded external changes automatically. Remove only your exact prepared audit directory after successful publication, retaining the report in `handoff.json`.

For ready input give both paths and this next-step prompt, adapted to the user's language, without invoking it automatically:

```text
/speckit.specify Create the specification from .requirements/handoff.md. Keep its
intent, constraints, assumptions and open points; surface conflicts with existing
specs or code instead of silently changing the settled intent.
```

If Spec Kit is absent, still deliver the complete handoff without installing or reconfiguring it. For a blocked draft, explain the material blockers and continue only the research/discussion already authorized by the user's task.
