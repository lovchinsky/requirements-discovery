# Semantic review, in the main conversation

Apply these tests with domain judgment. Do not turn them into a questionnaire, new workflow phases or a demand that the user approve internal map maintenance. Investigate available sources; ask only for a genuinely unresolved product judgment.

Review the rendered draft from `render`, not the graph alone: current texts appear verbatim, so a text that misleads an unfamiliar engineer is fixed in the graph and rendered again. Keep discovery at the level of intent, judgments, facts, boundaries and material implications. Check for a parallel FR/story/acceptance-criteria catalogue, including one disguised as Consequence/Constraint nodes. Decisions carry agreed behavior; Constraints and Consequences carry material boundaries and implications.

| Axis | Challenge | Evidence of a pass |
| --- | --- | --- |
| consistency | Does the draft reconcile current intent, constraints, lifecycle, permissions and cross-branch dependencies? | Material contradictions are resolved or explicit blockers; no stale/superseded target is presented as current |
| source_authority | Which source establishes each material claim, and is it current for this scope? | Normative, observed, intent and reference are distinguished; exact material contracts rechecked when uncertain |
| coverage | Can an unfamiliar engineer understand every current commitment, known assumption and unresolved point, and why each branch that was not chosen was left? | Verbatim texts are self-contained; each conclusion matches the reasoning recorded for its branch, folds nothing that still shapes the target and adds no claim; no unsupported scope narrowing or omitted material scenario |
| decision_quality | Is each choice actually settled, with enough rationale to explain the trade-off? | Facts are not policy Decisions; hypotheses/partial agreement remain proposed; current reviews preserve historical rationale |
| readiness | Can specification proceed without inventing a product choice or concealing a material risk? | Real blockers remain blocked; nonblocking uncertainties have a concrete reason and consequence |

Check the strongest relevant counterexample. Compare a proposed happy path with permission denial, stale context, partial failure, retry, concurrency or external disagreement when those scenarios matter to the actual system. Do not invent speculative obligations merely to fill a category.

For each source in the preview receipt, record what was actually checked and its scope/revision/locator, or why reinspection is unnecessary. If a relevant tool or source is unavailable, say so; do not fabricate access or validation. New findings that challenge the graph must be persisted and the draft regenerated before review can pass. A prior review does not cover a later graph or revised draft.

On an explicit request for an independent audit, follow `independent-audit.md`. Prepare the actual graph/draft snapshots, then launch a new namespaced `handoff-auditor`, without forking/resuming or supplying the main conversation's conclusions. Its tools are Read/Grep/Glob only. Record its artifact-bound assessment; unresolved or unavailable findings block a requested audit. The main conversation investigates findings, preserves any evidence-backed rejection separately, and owns all state changes and publication. Do not call it automatically on ordinary handoff.
