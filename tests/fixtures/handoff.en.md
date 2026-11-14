# Handoff rendering fixture

> Each `[ID]` is a node of `.requirements/current.argdown`. Texts of current nodes are quoted verbatim. Branches that were not chosen are folded into short conclusions that list their nodes by ID; earlier versions are listed by ID beside the current version.

## Intent

Exercise every class of the handoff projection.

## Scope

- Primary navigation
- 1\. A numbered-looking scope item
- \# A heading-looking scope item

## Constraints

- **[C-008]** Navigation must stay usable with thirty workspaces. _(agreed · invariant)_
  - Sources: user, intent: "Fixture scale envelope"
- **[C-012]** Navigation must never imply access to workspaces the user is not assigned to. _(verified · invariant)_
  - Sources: spec, normative: `specs/access.md` (Access contract; sha256: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)
- **[C-020]** Workspace colours should come from the design system. _(proposed)_
  - Derives from: [D-007]

## Facts

- **[E-021]** Users perform workflows that span workspaces. _(verified · existing)_
  - Question: [I-010]
  - Supports: [P-010B]
  - Sources: user, intent: "Fixture scenario: daily cross-workspace work"
- **[E-050]** Thirty workspaces is the largest current tenant. _(verified)_
  - Undercuts: [A-017]
  - Sources: user, intent: "Fixture tenant list"

## Questions and decisions

### [I-001] How should navigation work within the access model?

_open_

**Not chosen**

- \[x] Cross-workspace work is real, so this assumption was invalidated.
  - Branch: [AS-003]

#### [I-010] What defines primary navigation?

_resolved · decision [D-007]_

**Decision [D-007]** _(accepted · basis: user intent)_

> Use operations-first navigation with a persistent workspace switcher in the header.

- Rationale: Supports cross-workspace work at the stated scale.
- Initial basis (the latest review supplies the current one): [E-021], [C-008], [C-012], [A-004]
- Alternatives: [P-010A]
- Reaffirmed by review **[V-002]** _(confirmed)_: The choice still follows the current scope.
  - Rationale: The current contracts suffice.
  - Based on: [C-008], [C-012]
- Consequences:
  - **[Q-001]** Cross-workspace work needs a visible scope. _(current · target)_
  - The header shows the \<workspace> context.
  - \- a line that starts like a list item
- Sources: user, intent: "Fixture agreement: "switcher in the header""
- Earlier versions: [D-006]
- Earlier reviews: [V-001]
- Former consequences: [Q-000]
- terms:
  - switcher: The workspace selector in the header
- rejection reasons: [P-010A]

**Chosen**

- **[P-010B]** Operational areas define navigation; a workspace is a context switcher. _(accepted)_
  - For: [E-021], [A-004]
  - Against: [A-017]

**Arguments**

- **[A-004]** A workspace hierarchy repeats navigation for cross-workspace work. _(active)_
  - Based on: [E-021], [C-008]
  - Supports: [P-010B]
- **[A-017]** The switcher costs one extra click when changing workspace. _(active)_
  - Attacks: [P-010B]
  - Undercut by: [E-050]

**Not chosen**

- A workspace hierarchy did not fit: thirty workspace roots need scrolling on every visit; the older click-cost wording gave way to A-017.
  - Branch: [P-010A], [E-031], [I-030], [A-009]
- **[I-040]** Should workspaces have landing pages? _(dropped)_ — dropped: Operations-first navigation removes the need for workspace landing pages.
  - Branch: [P-040]

##### [I-014] What visual treatment marks the current workspace?

_deferred · not blocking · #mvp_

- Not blocking: Visual styling can follow later.
- Deferred: Waiting for the design system.

**Options under consideration**

- **[P-014A]** A coloured badge using --color-\* tokens, named \<domain>\_\<verb>\_\<object>, see `badge_color`. _(proposed)_

**Not chosen**

- A plain label was not distinctive enough.
  - Branch: [P-014B]

#### [I-020] How is access assigned today?

_resolved · answer [E-030]_

**Answer**

- **[E-030]** Access follows explicit assignments; see `assign()` and \[x] the AT&T \&amp; flags. _(verified)_
  - Sources: code, observed: `src/access.ts` (assign(); revision: abc123)

**Not chosen**

- 1\. Roles were only a hypothesis; assignments are the recorded fact.
  - Branch: [P-020]

## Assumptions

- **[AS-001]** Most users switch workspace less than five times a day. _(unverified · not blocking)_
  - Validation: Measure with ten users.
  - Not blocking: It only tunes the switcher.
- **[AS-002]** Users know their workspace names. _(validated)_
  - Validation: Analytics review.
  - Not blocking: Confirmed in research.

## Open questions

- [I-014] _deferred · not blocking_
