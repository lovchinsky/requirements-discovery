# Requirements Discovery for Claude Code

[![CI](https://github.com/lovchinsky/requirements-discovery/actions/workflows/ci.yml/badge.svg)](https://github.com/lovchinsky/requirements-discovery/actions/workflows/ci.yml)

Version **1.1.0**. A Claude Code plugin for nonlinear requirements discovery in an ordinary conversation. Requirements Engineering exposes gaps, IBIS organizes questions and alternatives, and Design Rationale keeps the reasons behind each decision. The result is a reviewed input for a specification, rendered from that reasoning with its IDs and original wording, that you can hand to [Spec Kit](https://github.com/github/spec-kit).

The plugin works with any domain. It keeps its state locally in `.requirements/current.argdown` and uses the official [Argdown](https://argdown.org) parser.

## Requirements

- **Node.js 22.11+** on `PATH`
- **Claude Code 2.1.63+**

The plugin's helpers are prebuilt with their dependencies bundled, so using the plugin needs no `npm install`.

## Installation

Install from this repository's marketplace in one step, inside a Claude Code session (v2.1.275+) or from your shell (v2.1.292+):

```text
/plugin install requirements-discovery --marketplace lovchinsky/requirements-discovery
```

```sh
claude plugin install requirements-discovery --marketplace lovchinsky/requirements-discovery
```

On older Claude Code versions, add the marketplace first:

```sh
claude plugin marketplace add lovchinsky/requirements-discovery
claude plugin install requirements-discovery@requirements-discovery
```

To enable the plugin for one project only, run the shell install from that project's root with `--scope local`.

Auto-update is off by default for third-party marketplaces. Turn it on under `/plugin` → **Marketplaces**, or update manually:

```sh
claude plugin marketplace update requirements-discovery
claude plugin update requirements-discovery@requirements-discovery
```

## Usage

```text
/requirements-discovery:discover <goal and links to sources>
```

Then talk normally: explore facts, compare alternatives, change topic, return to earlier questions and refine your intent. The plugin keeps one current discovery per project or worktree.

| Command | Effect |
| --- | --- |
| `/requirements-discovery:discover` | Restores the active discovery and its focus |
| `/requirements-discovery:discover status` | Shows state, open questions and handoff currency |
| `/requirements-discovery:discover pause` | Pauses facilitation and keeps the state |
| `/requirements-discovery:discover resume` | Reactivates the discovery; an existing handoff becomes stale |
| `/requirements-discovery:discover new <goal>` | Archives the current state and starts a separate discovery |
| `/requirements-discovery:handoff` | Concludes the branches that were not chosen, reviews the state and writes `.requirements/handoff.md` and `.requirements/handoff.json` |
| `/requirements-discovery:handoff audit` | Adds an independent read-only audit before publication |

Both skills set `disable-model-invocation: true`: they run only when you invoke them.

### How discovery records reasoning

Factual questions are closed by verified Evidence or a verified Constraint. Product judgments become Decisions backed by your stated intent or a normative source. Positions show the current choice; the reasons and decision chains are kept as Design Rationale. Formal requirements, user stories and acceptance criteria belong to Spec Kit, not to discovery.

### Handoff

The helper renders `handoff.md` from the graph rather than having Claude rewrite it. Current questions, decisions, chosen options, arguments, facts, constraints and assumptions appear verbatim with their IDs; earlier versions are listed by ID beside the current one. Branches that were not chosen (options you explored and left, or never explored because another one settled the question) are folded into short conclusions that Claude writes at handoff time and that list the folded node IDs. Every graph ID stays referenced, so a decision number in the handoff always leads back to its full reasoning in `current.argdown`. A retired node that the current state still relies on is shown with its text, because it blocks readiness. Labels are rendered in English or Ukrainian. Because nothing is paraphrased, a large discovery produces a long handoff.

The handoff gets a semantic review of consistency, source authority, coverage, decision quality and readiness. Unresolved blockers leave it a draft marked `blocked`. A `ready` handoff is bound to the exact graph, text, review and recorded local source hashes; changing any of them makes it stale.

On request, an independent auditor runs in a fresh context with only Read, Grep and Glob. It receives snapshots of the graph, the draft and the sources. A requested audit must be settled before the handoff can become ready.

A ready handoff moves the discovery to `handed-off`. Spec Kit is installed separately, and you start it yourself. The handoff skill suggests this prompt:

```text
/speckit.specify Create the specification from .requirements/handoff.md. Keep its
intent, constraints, assumptions and open points; surface conflicts with existing
specs or code instead of silently changing the settled intent.
```

## Local state

| Path | Contents |
| --- | --- |
| `.requirements/current.argdown` | Questions, alternatives, facts, constraints, assumptions, arguments, decisions and consequences |
| `.requirements/handoff.md` | The specification input, rendered from the graph as plain Markdown |
| `.requirements/handoff.json` | Status, hashes, coverage, branch conclusions, blockers and review metadata |
| `.requirements/archive/` | Preserved state from `new` and from recovery of damaged state |

`handoff.md` and `handoff.json` form one publication; `handoff-status` checks that they match each other and the graph, and reports whether the graph and recorded conclusions still render the same Markdown. All files are plain text: commit `.requirements/` to share the rationale with your team, or add it to `.gitignore`.

The helpers validate the graph, preserve assertions and provenance, and write atomically under a writer lock with an expected SHA-256 check. Unsupported formats are never overwritten. See the [graph profile](plugins/requirements-discovery/references/graph-profile.md) for details.

## Hooks, permissions and privacy

The only hook is a short `SessionStart` bootstrap for startup, resume, clear, compact and fork. It reads the bounded graph header and points Claude to the graph and the skill. Paused and handed-off discoveries stay inactive. If the hook output is missing or the behavior was lost after compaction, run `/requirements-discovery:discover`; use `resume` for an inactive discovery.

The plugin runs local Node helpers and makes no network requests. It does not install Spec Kit or change permission settings; Claude Code asks for permission to run the helpers as usual. See [SECURITY.md](SECURITY.md).

You can run the helper yourself; `<plugin root>` is the installed plugin directory, which the handoff skill prints in its `handoff-status` command:

```sh
node "<plugin root>/dist/discovery.cjs" status --project /absolute/project
node "<plugin root>/dist/discovery.cjs" handoff-status --project /absolute/project
node "<plugin root>/dist/discovery.cjs" render --project /absolute/project <<< '{}'
node "<plugin root>/dist/discovery.cjs" --help
```

`handoff-status` exits nonzero unless a ready, current handoff exists.

## Development

The repository is a marketplace with one plugin. Claude Code installs only `plugins/requirements-discovery/`; the Node project around it builds and tests that directory. Building needs Node.js 22.11+.

```sh
npm ci
npm run verify   # build the bundles, run the tests and check the plugin structure
```

The bundles in `plugins/requirements-discovery/dist/` are committed because Claude Code copies the plugin as-is, without a build step; CI fails when they differ from a fresh build. See [CONTRIBUTING.md](CONTRIBUTING.md).

| Path | Purpose |
| --- | --- |
| `.claude-plugin/marketplace.json` | Marketplace catalog |
| `plugins/requirements-discovery/` | The plugin: manifest, skills, auditor agent, hook, references and bundles |
| `plugins/requirements-discovery/dist/*.cjs` | Prebuilt helpers with bundled dependencies and their licenses |
| `src/`, `tests/`, `scripts/` | Helper source, tests, build and structure checks |
| `build/` | Build inventory of bundled packages and licenses, verified by `npm run check` |

## License

The original code is MIT licensed, see [LICENSE](LICENSE). Full license texts and attributions of the bundled dependencies are embedded as comments at the end of `plugins/requirements-discovery/dist/discovery.cjs` and `hook.cjs`.
