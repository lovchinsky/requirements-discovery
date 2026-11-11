# Requirements coverage radar

Use these concerns to detect a material gap. Select what matters for this change; this is not a form, interview script, checklist to complete, or ordered workflow. Requirements work recurs as new intent or evidence appears.

| Concern | Look for | Useful evidence |
| --- | --- | --- |
| Intent and scope | Who benefits, observable goal, boundaries, success, priorities | User intent, existing goals, approved scope |
| Actors and authority | Roles, delegation, ownership, tenancy, location boundaries, privilege changes | Permission policies, authorization paths, actor specs |
| Domain and source of truth | Entity identity, relationships, vocabulary, authoritative state, conflicting representations | Domain specs, models, constraints, integration contracts |
| Existing behavior and change | What exists, what must change, what remains a constraint, affected callers | Normative specs plus observed code/tests; record disagreements |
| Lifecycle and rules | States, transitions, invariants, concurrency, timing, prohibited operations | State models, transactions, handlers, persisted rules |
| Dependencies and impact | Cross-branch coupling, existing requirements affected, compatibility, migration needs | Callers, interfaces, specs, data ownership and histories |
| Quality and operations | Relevant scale, performance, availability, accessibility, usability, observability, support | Known workloads, incidents, objectives, operational docs |
| Failure and recovery | Partial success, retries, stale state, external disagreement, cancellation, repair, duplicate work | Integration behavior, incident evidence, failure-path tests |
| Uncertainty and conflict | Unverified assumptions, ambiguous terms, evidence gaps, incompatible goals | Explicit provenance, alternatives, rationale and unresolved issues |
| Validation | Can the target behavior satisfy goals and constraints under meaningful scenarios? | Concrete scenarios, stakeholder judgment, repo evidence |

Bring a concern into the conversation when it changes a real choice or exposes a system hole. Do not open speculative branches for every row. A tiny change needs little discovery; a cross-domain system change needs broader impact work.

For each material claim, distinguish:

- **Normative:** the approved contract or business rule says what must hold.
- **Observed:** inspected code/tests/runtime show what currently happens.
- **Intent:** the user has supplied a goal or made a product trade-off.
- **Reference:** research or an example suggests an option; it does not bind us.
- **Assumed:** a claim is not validated yet; explain what would validate it.

Consistency review should challenge an attractive design with the strongest relevant counterexample, not generate a ritual list of objections. Examine scope boundaries, conflicting authority, lifecycle transitions, inaccessible states and external failures where relevant. Record an unresolved conflict honestly. Do not flatten disagreement into a confident summary.

At handoff, distinguish coverage from closure. A known nonblocking uncertainty can remain open with its consequence stated. An unknown critical permission model or a challenged invariant cannot become settled because discussion has run long. The graph aids engineering judgment; it cannot prove requirements completeness or stakeholder agreement.
