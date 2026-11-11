# Independent handoff audit

Use this contract only for an explicitly requested independent audit, including `/requirements-discovery:handoff audit`. Ordinary handoff still requires the main agent's five-axis semantic review. An audit adds an independent assessment; neither assessment can override mechanical blockers or invent user agreement.

## Prepare and launch

Distill the real draft first. Put `{body,covers,audit_requested:true}` in temporary JSON and run `handoff-preview`, then:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs" audit-prepare \
  --project "<root>" --expect "<preview graph_sha256>" < "<draft.json>"
```

The helper creates a private `.requirements/.audit-<uuid>/` directory containing the exact graph bytes, normalized `draft.md` and `manifest.json`. It checks coverage and the expected graph hash under the writer lock without changing graph/handoff. The manifest supplies hashes, scope, project root, source inventory and an unfilled `audit_template`. These snapshots fix the review target; they do not prove prose quality or source currency. Keep the canonical graph and publication unchanged until the main agent has considered the report.

Launch the custom agent **`requirements-discovery:handoff-auditor` as a new agent**. Do not use a fork of the main thread, resume a previous agent, or pass the discovery conversation, your assessment, previous audit reports or an expected READY verdict. Give only the snapshot/manifest paths, project root, scope, the absolute paths of both contracts (`semantic-review.md` and this file) and necessary original user-intent excerpts or source snapshots. Do not paraphrase uncertain intent into agreement. Custom agents start with their own system prompt and basic host environment; project/user CLAUDE.md may still apply. Fresh context therefore means no discovery-thread history, not absence of all host instructions.

The bundled tool allowlist is exactly `Read, Grep, Glob`; the auditor cannot use Bash, writes, web/MCP or nested agents. Enforce that allowlist through the Claude custom-agent definition, not merely a request in a generic agent's prompt. If the host cannot launch this fresh restricted agent, retain audit_requested and publish only a blocked draft; do not silently substitute the main review or pretend it ran. If no auditor ran, omit review.independent_audit and explain the unavailable capability in the main review. An unchecked template is not a report and must not be submitted as one; preserve the request flag rather than inventing results.

Supply local copies of material primary web sources when needed, with original URLs, locators and observed dates. A URL alone cannot be inspected with these tools. Do not add web/Bash access to work around that limitation. The auditor reports inaccessible material sources as unavailable and distinguishes code's observed behavior from normative specs and recorded user intent.

## Report and main-agent response

Attach the returned JSON verbatim as `review.independent_audit`. The report fields are `auditor` (the exact namespaced custom-agent name), `context: "fresh"`, the two snapshot hashes, `result: pass | blocked | unavailable`, `checks`, `findings` and `limits`. All five axes need `result: pass | blocked | unavailable` and a concrete `note`. Findings are an array; an empty array is valid for a pass. Each finding is:

```json
{
  "id": "AUD-1",
  "check": "consistency",
  "severity": "blocking",
  "nodes": ["D-012", "C-007"],
  "source": "specs/access.md, authorization boundary",
  "note": "Explain the material contradiction and its effect on specification.",
  "correction": "Suggest what to investigate or clarify, without deciding intent."
}
```

Use graph IDs that actually exist, including the root Issue for missing scope or scenarios. Finding IDs are unique within the report, not new graph nodes. Preserve the original assessment even if the main agent disagrees. `limits` is a string array describing scope, inaccessible inputs and supplied rather than independently computed hash bindings. A pass with blocking findings or failed checks is invalid, and so is a blocked result with neither a blocking finding nor a failed check.

Investigate every blocking finding independently. If it reveals a real defect, update canonical state/draft through ordinary discovery rules, regenerate snapshots and run **another new auditor**. Any graph or body change invalidates the old audit; do not relabel it with new hashes or resume the same auditor after supplying your correction narrative.

If the finding is false, record a separate `review.audit_responses` entry:

```json
{
  "finding": "AUD-1",
  "result": "rejected",
  "note": "Explain why the claimed defect does not apply to the actual scope.",
  "source": "Exact evidence pointer establishing that explanation."
}
```

`open` is also allowed and remains blocking. Respond once to a known blocking finding. Rejection must be an evidence-backed assessment, not "the auditor is wrong" or "we need to publish". The helper validates the record's structure, not its substantive truth. An unavailable check cannot be cleared by rejecting a different finding; a blocked check without findings remains blocking. A blocked check is cleared only when all its recorded blocking findings were explicitly rejected. The original report and responses both remain in publication metadata.

## Publication and cleanup

Keep `audit_requested:true` on the draft. Fill the main semantic review independently and publish `{body,covers,audit_requested:true,review}`. Missing/unavailable audit or unresolved findings blocks publication; stale/malformed reports are rejected. A report supplied without the flag still participates in the gate, so disabling the flag cannot hide a known finding. The local helper does not call an LLM or verify model identity/context/tool execution; host isolation is enforced by the invocation and custom-agent definition. Typed receipts provide traceability, not attestation.

A sealed prior publication records the audit request for this discovery. Omitting the flag on a retry, changing the body, or committing a graph revision does not silently cancel it. If the user explicitly changes the requested review mode, set `audit_requested:false`; never infer cancellation from unavailable tools or a desire to publish. A current prior report for the same graph/body is carried into publication even if omitted from new input; its findings cannot be hidden by changing the flag. Its prior responses carry only with that same report, never onto a newly supplied report. A changed artifact needs a new audit when requested.

Run `handoff-status`: it reports `audit_requested`, `audited` and the audit outcome (`pass`, `cleared-with-responses`, `blocked`, `unavailable`, `missing` or `not-requested`). Ready publication validates audit bindings to the reviewed graph before the lifecycle revision; graph/body/metadata freshness and local source snapshot checks still apply. Preserve the report in `handoff.json`. Remove only the exact temporary audit directory returned by your preparation after successful publication; keep recoverable inputs on a failed write. Never use a broad cleanup glob or remove `.requirements`.
