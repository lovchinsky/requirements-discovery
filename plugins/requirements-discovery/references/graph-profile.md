# Argdown discovery profile — schema 2

`.requirements/current.argdown` is canonical durable reasoning, not a transcript or a second specification. Use the official Argdown parser through the bundled helper. Native relations express reasoning; metadata expresses IBIS topology.

Contents: [Frontmatter](#frontmatter) · [Types and statuses](#types-and-statuses) · [Fact answers and product choices](#fact-answers-and-product-choices) · [Discovery and specification](#discovery-and-specification) · [Assertions and history](#assertions-and-history) · [Local state operations](#local-state-operations).

## Frontmatter

```argdown
===
{
  "discovery": {
    "schema": 2,
    "id": "RD-stable-identifier",
    "title": "Discovery subject",
    "intent": "Recorded user goal, not an invented product scope",
    "status": "active",
    "root": "I-001",
    "focus": "I-010",
    "revision": 1,
    "created_at": "2026-10-05T00:00:00Z",
    "updated_at": "2026-10-05T00:00:00Z"
  }
}
===
```

Lifecycle is `active | paused | handed-off`; focus is an Issue ID or `null`. Optional `scope` is a string array. Preserve identity, root and creation time. `patch` increments revision/time; `apply` requires exactly one revision increment. Frontmatter is data and cannot configure the parser. Maximum graph: 2 MiB; frontmatter: 64 KiB. Unknown/newer schemas are rejected, never downgraded.

Use one definition per stable ID, globally unique across statements/arguments. Use bracket references elsewhere. Separate top-level blocks (definitions, relation blocks and headings) with a blank line; adjacent lines do not parse. Prefix conventions are useful, not type checks. Exactly one semantic tag supplies the type. Extra simple tags are retained. JSON flow metadata is recommended. YAML block metadata is also valid:

```argdown
[E-001]: Current access follows assignments. #evidence {
status: verified
sources:
  - kind: spec
    ref: specs/access.md
    authority: normative
}
```

An opening brace followed by a newline enters Argdown's YAML mode; pretty-printed JSON node metadata is not interchangeable with JSON flow metadata. CRLF is normalized for parsing only; compare-and-swap hashes the exact source bytes.

## Types and statuses

| Tag | Status | Important metadata |
| --- | --- | --- |
| `#issue` | open, deferred, resolved, dropped | parent (except root), resolved_by, resolution_history, reason (dropped) |
| `#position` | proposed, accepted, rejected, withdrawn | issue |
| `#argument` | active, retired | issue; native `<ID>` description, no reconstructed PCS |
| `#evidence` | tentative, verified, contested, stale, superseded | verified needs sources |
| `#constraint` | proposed, agreed, verified, challenged, superseded | verified needs sources |
| `#assumption` | unverified, validated, invalidated | validation |
| `#decision` | accepted, challenged, superseded, withdrawn | resolves array, basis, rationale, based_on array, sources |
| `#review` | confirmed, challenged | decision, complete based_on array, rationale |
| `#consequence` | current, challenged, superseded | derives_from Decision |

`parent` decomposes questions; `related` associates branches without pretending they are parent/child. Positions/arguments attach to an `issue`. `based_on` and `depends_on` are explicit operative causal links; `derives_from` explains a target's origin. Native support/attack/undercut are not automatically causal dependencies. Native contradiction (`><`, model type `contradictory`) is also preserved. Record causal links when their failure would invalidate the claim. Do not use support arrows to attach an Issue to a Position or another Issue.

Sources need `kind: code | spec | doc | research | user`, `ref`, and `authority: normative | observed | reference | intent`. Optional locators, symbols, revision, accessed date and lowercase SHA-256 help reinspection. Sources do not have a universal ranking: inspect their actual scope and authority. Observed code does not silently replace the desired normative contract. A local file source with a recorded `sha256` is rechecked against the file at `ref`, resolved from the project root, so such a `ref` is the file path alone; put line or anchor pointers in `locator`. A recorded node's sources cannot be changed afterwards, not even to add a `sha256`, so record it when you create the node.

`handoff: existing | target | change | invariant | edge | scope | omit` is an editorial hint; the first six label the rendered node, and `existing` or `edge` evidence is material, so a conclusion cannot fold it. `omit` adds no label and hides nothing: it cannot hide a current commitment or known blocker, and the handoff renders every current node. An unresolved Issue/Assumption is blocking by default; `blocking:false` needs a substantive `nonblocking_reason`. Deferral alone never removes a blocker.

## Fact answers and product choices

Resolve a factual question directly with verified Evidence or a verified Constraint. Do not manufacture a Decision for a repository answer:

```argdown
[I-002]: How is staff access assigned? #issue {"status":"resolved","parent":"I-001","resolved_by":"E-001","resolution_history":["E-001"]}

[E-001]: Staff access follows explicit assignments. #evidence {"status":"verified","sources":[{"kind":"spec","ref":"specs/access.md","authority":"normative"}]}
```

A product judgment uses `basis:user` with a user/intent source or `basis:authority` with a normative source that establishes the desired behavior. Factual answers alone never make a projection mechanically ready.

One Decision can resolve several related Issues. `resolves`, optional `selected` Positions and `alternatives` are arrays. Selected Positions must belong to those Issues and be accepted for an accepted Decision. Every resolved Issue points to its current resolver; at most one accepted Decision resolves an Issue.

`Position.status` records current state, not whether it was ever chosen. Every accepted Position must appear in the current accepted Decision's explicit `selected` set for its Issue. Multiple compatible Positions may be selected for one Issue; native contradictory Positions cannot be current together. Semantic review must also check domain exclusivity that is not recorded as a relation. Position IDs do not imply that all candidates are mutually exclusive. Factual closure through verified Evidence/Constraint needs no selected Position or manufactured Decision. Keep an established fact in its verified resolver; Position acceptance denotes an explicit choice, not proof that a hypothesis is true.

```argdown
[D-001]: Use operational navigation with explicit location context. #decision {"status":"accepted","resolves":["I-010","I-020"],"selected":["P-010","P-020"],"basis":"user","based_on":["E-001"],"rationale":"The recorded cross-location work requires this context model.","sources":[{"kind":"user","ref":"Recorded navigation agreement","authority":"intent"}]}
```

Every resolved Issue needs `resolution_history` containing its resolver. `patch` appends a new resolver automatically. On reopening, clear `resolved_by` and retain ordered history. A factual resolver becoming stale also blocks its resolved Issue mechanically; reassess and reopen/replace the answer explicitly.

## Discovery and specification

The handoff renders current nodes verbatim, with any further metadata, and folds branches that were not chosen into conclusions written at handoff; see `handoff-contract.md`. Keep agreed behavior in its Decision, including the judgment, rationale and material implications. Constraints record genuine boundaries; separate Consequences record only material effects that need their own discussion/dependencies. Do not create one node for every feature sentence or duplicate Decision text. FR numbering, stories and acceptance criteria belong to Spec Kit, not to this graph or handoff.

## Assertions and history

All recorded propositions, provenance, original causal links and native reasoning relations are preserved, including those recorded before a decision. Retire/contest old assertions; substantive corrections get new IDs. Wording-only cosmetic rewrites are unnecessary. Do not mutate an old Evidence's text or source to make it say the opposite. Source updates get a new Evidence version.

Mutable operational fields are status, handoff hint, blocking classification, challenge/review history and first successor pointer. Issues additionally permit parent/related classification, current resolver, resolution history and reasons. `challenged_by`, `reaffirmed_by`, `resolution_history` are ordered, append-only. Once `superseded_by` exists, preserve it forever; extend from that successor. `supersedes`, when provided, must match the original's successor pointer. Superseded nodes remain historical. A superseding Decision must account for all Issues resolved by its predecessor, possibly along with additional related Issues.

On supersession/challenge/withdrawal, `patch` reconciles Positions atomically: current explicit selections become accepted; a former accepted Position with no current selection becomes proposed, without inventing rejection or withdrawal. An unchanged selection stays accepted. Explicitly rejected/withdrawn unselected options keep that status; explicit Position status conflicting with a current Decision is an input error. Preserve the old Decision's immutable selected IDs, alternatives and rationale, and the Issue's resolution history. Full `apply` must already contain coherent Position state.

Challenge a contradicted Decision with a material reference and reopen every Issue it resolves. Preserve its original rationale and assess dependent targets. A tentative objection may first be recorded as an open Issue or argument.

For an unchanged resolution reaffirmed after review, append a **new `#review`**:

```argdown
[V-001]: The same navigation remains appropriate after the operating context changes. #review {"status":"confirmed","decision":"D-001","based_on":["E-NEW","C-CURRENT"],"rationale":"The new evidence changes frequency but not the agreed hierarchy or access boundary."}
```

When reaffirming a challenged Decision, use one patch that adds the new Review, appends it last to `reaffirmed_by`, sets the Decision back to accepted and re-resolves every Issue in its `resolves` with `resolved_by` pointing to the Decision; a Review recorded in an earlier patch cannot reaffirm it. The Decision's latest `reaffirmed_by` Review supplies its **complete current basis**; original `based_on`, earlier reviews and original selection reasoning remain retrievable history. The Review must explicitly retain still-material constraints/dependencies. Evidence that belongs only to that historical basis does not block readiness, even when it is stale. Current targets and constraints are still checked independently; a real unresolved problem cannot be hidden by review. If the resolution itself changes, create a successor Decision rather than a Review.

## Local state operations

Always specify the actual discovery project's root. Use the bundled helper:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs" view --project "<root>" --ids I-010 --depth 1
node "${CLAUDE_PLUGIN_ROOT}/dist/discovery.cjs" patch --project "<root>" --expect "<hash>" < "<changes.json>"
```

Patch shape (atomic as a whole, no partial writes):

```json
{
  "meta": {"focus":"I-010"},
  "add": [{"id":"E-NEW","kind":"evidence","text":"A durable finding.","data":{"status":"tentative"}}],
  "update": [{"id":"I-010","data":{"status":"open"},"unset":["resolved_by"]}],
  "relations": {"add":[{"from":"E-NEW","to":"P-010","type":"support"}]}
}
```

Each supplied top-level `data` field replaces its old value, arrays included; absent fields remain. To extend `related`, `challenged_by`, `reaffirmed_by` or `resolution_history`, send the complete existing array plus the new entries. No deletion operation. Patch also derives Position statuses from current selections and returns automatic changes in `position_changes`; it never edits historical Decision selections. When several related nodes change state, put them in one patch so resolution and selection invariants are checked against the complete final update. All validation/history rules apply equally to `patch` and full `apply`. Patches normalize headings/layout through canonical serialization, retain extra metadata, and reparse to verify propositions and native relation directions before writing. Unsupported formatting causes an explicit error; use full `apply`, never silently discard it. A patch cannot change a historic proposition under the same ID.

`view` defaults to focus/root, has depth 0–3, caps included nodes at 80 and reports omissions. Use another ID/view to retrieve omitted material; full `project` is for handoff and whole-state review. Full `apply` remains available for large changes. CAS conflicts require rereading and integrating, not substituting a new hash onto the same stale candidate. Lock ownership is never automatically stolen.

A graph with only inconsistent Position statuses can use `hash` then `positions-reconcile --expect <raw hash>`. This backs up exact graph/handoff bytes and reconciles current state without guessing a missing Decision selection. Other schema/reference/provenance/history defects still fail; generic repair cannot bypass this specific recovery. A changed handed-off graph reopens as active and its previous handoff is stale. A graph already coherent is left unchanged.

Repair is limited to invalid bodies with a readable schema 2 header and preserves damaged bytes. Valid graphs require history-checked updates. Preserve unsupported or malformed headers and recover from a known backup. Repair preserves discovery ID/root/creation time, increments the revision once, and uses active or paused lifecycle. Invalid-body repair is explicit recovery with an exact backup; it does not prove that damaged history is complete.
