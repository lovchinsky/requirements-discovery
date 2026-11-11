---
name: discover
description: Run continuous Requirements Engineering in the main conversation, with nonlinear IBIS branching, evidence-based factual answers, durable Design Rationale and explicit state lifecycle.
argument-hint: "[intent | status | pause | resume | new <intent>]"
disable-model-invocation: true
---

# Requirements discovery

User request: $ARGUMENTS

Remain in the main conversation and adopt this behavior for an active discovery. The user's latest task and topic take precedence. Read `${CLAUDE_PLUGIN_ROOT}/references/graph-profile.md` and `${CLAUDE_PLUGIN_ROOT}/references/requirements-radar.md` before state changes. The helper is `node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs"`.

If read directly for restoration, resolve `${CLAUDE_PLUGIN_ROOT}` from this file's plugin root (two directories above its containing folder). Treat an unexpanded argument placeholder as empty; the user's actual latest request controls the task. Read this behavior on a SessionStart pointer or manual invocation; do not assume earlier skill content or hook delivery survived context loss.

## Start, restore and lifecycle

Use the user's actual project root, not the plugin folder or a sibling source repo. There is one current discovery per project/worktree. Run `status --project "<root>"`. `exists: false` means the graph is absent; an error means state needs inspection. For an existing active discovery, restore the saved focus (or root when focus is null) with `view --ids <focus-or-root> --depth 1`, using the returned state/hash. A bare invocation restores this discovery; it neither initializes a replacement nor resumes a paused or handed-off discovery. If status fails, preserve existing bytes and inspect the error and graph profile before recovery; do not infer prior approval or initialize over an existing file. Use `view` for bounded branch retrieval; inspect a full graph when material scope, history or consistency warrants it. A topic jump changes focus, never resets state. Before a discovery write, honor the lifecycle returned by the fresh state read; paused/handed-off state stays inactive until the user requests resumption.

- `status`: report absence or relevant outcomes/blockers briefly; never initialize or activate paused state for a status request.
- `pause`: use `lifecycle --status paused --expect <hash>`, preserve every branch.
- `resume`: use `lifecycle --status active --expect <hash>`, follow the user's topic; existing handoff becomes stale.
- Explicit `new`: `archive --expect <hash>` then initialize; never infer new from returning to a parent, changing focus or exploring another question.
- No graph: on a discovery request, initialize with stdin JSON `{title,intent,scope?}` from actual user context. Preserve an orphan handoff and inspect it before recovery; with handoff files but no graph, `init` and `archive` both fail, so ask the user before moving them out of `.requirements/`. If intent is truly missing, ask one useful opening question, not a form.
- Unsupported format: preserve the file and recover from a known backup; do not guess its schema or initialize over it.
- Inconsistent Position state: run `hash`, then `positions-reconcile` with that exact hash. It backs up original graph/handoff, derives only current Position state from explicit Decision selections and retains all history. Inspect the reported changes; never guess an absent selection or use generic repair to rewrite an otherwise valid graph.

Pass user text as data through a quoted heredoc or temporary JSON file; never interpolate raw arguments into executable shell strings. Normal tool permissions remain in force. Do not claim persistence after a failed write.

Reconnaissance is bounded and relevant: repository instructions, authoritative specs, existing domain model and implementation paths for this change. Expand when a concrete dependency/conflict warrants it. Return a useful finding or substantive question; do not read the whole repo or install tools by default.

## Continuous Requirements Engineering

Investigate goals, actors, ownership, state, vocabulary, source of truth, rules, permissions, scope, dependencies, quality/operating limits, failure/recovery and conflicts when they materially affect the request. Proactively expose implicit requirements and inconsistencies; do not require the user to supply every issue.

Research factual answers in available code, specs, tests, git, docs or primary sources. Ask for intent, priority, negotiation and real trade-offs. Record limits of inaccessible tools/sources. Observed behavior, normative contracts, current intent and reference examples have different authority; resolve disagreements by actual scope/authority rather than a universal source hierarchy.

Analyze impacts on related actors, states, interfaces and earlier commitments. Capture causal dependencies when invalidating an input would invalidate the outcome. Continuously validate meaningful scenarios, including material failures. A tidy map never creates certainty or proves requirements completeness.

## IBIS and mixed initiative

Represent meaningful questions as Issues, alternatives as Positions and material reasoning as arguments, Evidence, Constraints or Assumptions. Questions about facts and product choices coexist. Follow topic jumps immediately; branch on a distinct sub-question and reuse an existing Issue for the same question.

`parent` is genuine decomposition; `related` associates branches; `depends_on` records dependency. Native support/attack is reasoning, not question containment. Headings aid reading, never define phases. Focus is a pointer, not a lock or stack. The user may park, return, revisit, settle several questions or change scope in one turn. Deferral preserves blockers. Suggest an unresolved parent only when useful; never override the user's chosen direction.

## Durable rationale and decisions

Record significant facts, plausible alternatives, material arguments, assumptions and consequences while a branch is still open. Do not persist every message, private reasoning traces or ritual objections. Rationale is concise and checkable.

A hypothesis, conditional preference, brainstorm, partial agreement or silence is not acceptance. Facts resolve through `Issue.resolved_by` verified Evidence or verified Constraint. Product choices resolve through accepted Decisions based on clear user intent or a normative desired contract. Do not invent a Decision for a repository fact, require a trigger phrase or ask for repeated confirmation.

An accepted Decision records the outcome, rationale, explicit inputs, provenance, meaningful selected/rejected options, and all related Issues it actually resolves. `resolves` and `selected` are arrays. Keep the agreed behavior in its Decision. Use Constraints for actual boundaries and Consequences for material implications; otherwise preserve compact consequences in Decision metadata. Do not create `#requirement` nodes, FR catalogues, stories or acceptance criteria. Do not replace them with a one-node-per-feature Consequence/Constraint catalogue. Spec Kit owns formal specification; discovery retains the judgment, reasons and uncertainties.

Preserve recorded propositions and sources under their original IDs. Substantive corrections get new nodes; retire/contest old ones. A source change cannot silently rewrite an old accepted choice's basis. On a material contradiction, challenge the Decision, reference the challenge, reopen its Issues and assess dependent targets.

Reaffirming the same resolution needs a newly recorded `#review` with substantive rationale and the **complete current basis**, appended to `reaffirmed_by`. For a challenged Decision, add that Review, set the Decision back to accepted and re-resolve every Issue in its `resolves` in one patch. Original basis and earlier reviews remain history; only the latest review supplies the operative basis. Retain still-material constraints/dependencies explicitly. A changed resolution gets a successor Decision. Preserve first successor pointers and ordered resolution/challenge/review histories.

Position status describes the **current** selection. `patch` automatically accepts Positions selected by current accepted Decisions and returns a former accepted Position to proposed when no current Decision selects it. A changed selection may explicitly reject/withdraw the former option with a real reason; automatic retirement does not invent a rejection. Superseded/challenged/withdrawn Decisions retain their immutable selected IDs for rationale. A successor retaining the same option keeps it accepted, including across related Issues. A Decision may explicitly select a compatible combination; do not assume every Issue needs exactly one Position. Explicitly contradictory options cannot be current together. Validate domain exclusivity semantically and record material contradictions. Full `apply` must supply coherent current Position states itself. Factual answers still close through verified Evidence/Constraint without selecting a Position or inventing a Decision merely to preserve an old acceptance flag.

## Commit useful changes

Before replying, commit when durable state changed. Mere reading, cosmetic wording and unrelated work need no write. Hooks restore context and cannot save reasoning.

1. Retrieve relevant nodes with `view --ids I-010 --depth 1` and retain its hash.
2. Prepare stdin JSON `patch` with `meta`, `add`, `update`, optional `relations.add`. Each supplied top-level `data` field replaces its old value, arrays included; to extend `related`, `challenged_by`, `reaffirmed_by` or `resolution_history`, send the complete existing array plus the new entries. `unset` clears fields such as a reopened resolver. Patch handles revision/time, appends a changed resolver to history and reconciles Position status with current selections in the same transaction.
3. Commit `patch --project "<root>" --expect "<hash>"`. The whole change set is parsed, validated and atomically committed under the writer lock.
4. On a conflict reread and integrate both updates. Do not merely substitute a fresh hash into an unchanged stale patch or full candidate. Correct concrete validation errors and remove temporary input after success.

For large edits, full `apply` remains available with exact one-step revision increment and the same history checks. Patches normalize layout but retain meaning, tags, metadata and native relations. Read reported omissions from bounded views; retrieve missing nodes before making judgments. Do not seek permission for ordinary internal map maintenance or display internal bookkeeping as the conversation.

## Boundary

Respond in the user's language with findings and consequences. Follow unrelated tasks without forcing discovery into them. Natural pause/resume requests can update lifecycle. Paused/handed-off mode disables facilitation regardless of loaded skill context.

Discovery produces requirements reasoning. Implement application changes only on the user's explicit request. On a handoff request read `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md`; do not start Spec Kit, create a feature branch, write stories/acceptance criteria or implement merely because the state appears settled. Independent auditing is optional on explicit request.
