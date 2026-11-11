# Specification input contract

Handoff distills the current reasoning state into two files:

- `.requirements/handoff.md`: self-contained Markdown in the user's language, containing specification input and a draft banner when blocked.
- `.requirements/handoff.json`: publication metadata, containing schema, discovery identity, revision, status, timestamp, graph/body/metadata hashes, coverage IDs, blockers, audit request and the semantic review with any audit report.

The Markdown contains no generated metadata frontmatter. JSON contains no copy of the prose. Both files form one publication and are required for readiness. Handoff is input for Spec Kit, not the specification, research transcript or implementation plan.

Carry intent/scope, observed current behavior, normative constraints, settled target behavior, intended changes, invariants, material failure/edge scenarios, assumptions, open points and source authority. Preserve their distinctions. Several related outcomes may share a paragraph and its visible `[ID]` references. Important rejected options appear only when they explain an operative trade-off.

Do not create FR numbering, stories, acceptance criteria, API design, task lists or plans unless the user explicitly requests that separate work. Do not silently turn uncertain facts, conditional preferences or superseded commitments into approved intent. Follow `semantic-review.md` before publication.

## Mechanical and semantic readiness

`project` reports **mechanical** readiness. It checks known blocking Issues, Assumptions, challenged commitments, current causal dependencies and factual closures. Shared/deep dependencies are traversed iteratively; circular operative justification is blocked. A root container may remain open, but at least one product Decision must establish target behavior. Factual answers alone are insufficient.

Publication also needs a recorded semantic review of the actual draft and graph. Run `handoff-preview` with `{body,covers}` to obtain their hashes and an unfilled review template. Review five axes and account for current source pointers; fill the template with concrete observations, then publish `{body,covers,review}`. `body` is normalized as `body.trim() + "\n"` before hashing. The receipt refers to the pre-publication graph; `handoff.json`'s graph hash seals the next lifecycle revision. Changing either draft or graph requires a fresh review/preview.

All five checks need `pass | blocked` and a substantive note. Each source needs `checked | not-needed | unavailable` with a reason. `not-needed` must explain why source reinspection is unnecessary (e.g. current user intent, immaterial rejected option); it is not a bypass for an unknown material contract. Missing review, blocked findings or unavailable material sources result in a blocked draft. Malformed/stale review input is rejected. Local file pointers with a recorded `sha256` are rechecked at preview, publication and `handoff-status`; changed or unavailable snapshots block readiness. URLs are not fetched by the helper.

The receipt makes the review explicit and traceable. It **does not prove** that the model assessed the prose correctly or that agreement exists. The helper checks recorded results and hashes, not natural-language meaning. No mandatory second model is called; an independent read-only audit is optional on explicit user request. Never mark pass just because the graph parses or IDs are present.

An explicitly requested audit is gated, not merely advisory logging: follow `independent-audit.md`, prepare actual snapshots and launch a new restricted custom agent after drafting. Record `review.independent_audit`, bound to both preview hashes. Missing/unavailable reports and unresolved blocking findings prevent ready publication; malformed/stale reports are rejected. Preserve the original report and any evidence-backed main-agent `audit_responses`. A supplied report participates even if audit_requested is false. An independent pass never overrides the main semantic review, mechanical blockers, source currency or missing product intent.

## Publication and currency

Coverage requires every ID in `required_coverage` both in `covers` and visibly in the body. A marker alone does not communicate a requirement. Coverage is necessary but insufficient; semantic review verifies that the prose conveys the actual claim. Known blocking state cannot be overridden by a pass receipt or an omit hint.

Ready publication moves discovery to `handed-off`. A blocked publication carries a prominent draft banner and retains the prior lifecycle. It is never approved Spec Kit input. Under the writer lock, publication atomically writes `handoff.md`, then `handoff.json`, then the next graph for ready input. Hash bindings detect incomplete or mismatched publications. Each handoff file is limited to 4 MiB. `body_sha256` hashes the exact Markdown bytes; `metadata_sha256` hashes canonical JSON excluding that hash field. Missing or unreadable files fail freshness. Manual changes or later lifecycle/reasoning updates invalidate currency. Archive and Position reconciliation preserve both files. The helper returns `file` for Markdown and `metadata_file` for JSON. Hashes protect freshness, not authenticity against a deliberate local writer.

External source changes without a recorded local snapshot hash require agent reinspection. A current document's hashes do not certify external truth or complete domain coverage. `handoff-status` exits nonzero unless the reviewed document is current, mechanically ready and has no changed recorded local source snapshots.

Only the user's subsequent request invokes `/speckit.specify`. Spec Kit remains responsible for specification writing; the plugin never installs or reconfigures it.
