# Requirements Discovery

Nonlinear requirements discovery for Claude Code. Questions, alternatives, facts, decisions and rationale are kept in `.requirements/current.argdown`; a reviewed handoff for Spec Kit is written to `.requirements/handoff.md` and `.requirements/handoff.json`.

Requires **Node.js 22.11+** on `PATH`. The helpers in `dist/` bundle their dependencies, so no `npm install` is needed. Install in a Claude Code session:

```text
/plugin install requirements-discovery --marketplace lovchinsky/requirements-discovery
```

```text
/requirements-discovery:discover <goal and links to material sources>
/requirements-discovery:discover status | pause | resume | new <goal>
/requirements-discovery:handoff
/requirements-discovery:handoff audit
```

Behavior and format contracts are in `references/`. Installation, usage and development: <https://github.com/lovchinsky/requirements-discovery>.

The original code is MIT licensed, see [LICENSE](LICENSE). Full license texts and attributions of the bundled dependencies are embedded as comments at the end of `dist/discovery.cjs` and `dist/hook.cjs`.
