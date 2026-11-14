# Contributing

Thanks for helping improve Requirements Discovery.

## Setup

You need Node.js 22.11+.

```sh
npm ci
npm run verify   # build the bundles, run the tests and check the plugin structure
```

To try a change in Claude Code, start it from a separate project with the plugin directory of your clone:

```sh
claude --plugin-dir /absolute/path/to/your/clone/plugins/requirements-discovery
```

## Repository rules

- **The plugin directory holds only runtime files.** Claude Code copies `plugins/requirements-discovery/` into each user's plugin cache as-is. Keep `package.json`, lockfiles, sources and tests outside it: a `package.json` with a lockfile there would make Claude Code install npm dependencies that the bundled helpers do not need. `npm run check` enforces the allowed contents.
- **Commit the bundles.** After changing `src/`, run `npm run build` and commit `plugins/requirements-discovery/dist/` and `build/`; `npm test` and CI fail when they differ from a fresh build.
- **Skills and references are the product's behavior.** Keep `skills/`, `references/`, `agents/` and the READMEs consistent with each other and with what the helper actually accepts. `tests/docs.test.mjs` checks the helper commands and the Argdown examples they name. Add a test when you change a contract.
- **Write each Markdown paragraph and list item on one line.** Editors and GitHub wrap it; hard wraps make diffs noisy and split phrases that tests search for.
- **Keep the boundary.** Discovery records reasoning; formal requirements, stories and acceptance criteria belong to Spec Kit.
- **Avoid new runtime dependencies.** They are bundled into `dist/` together with their licenses, and `npm run check` verifies the embedded notices. A package published without a license file needs its upstream license in `licenses/` and an entry in `scripts/bundled-licenses.mjs` for that exact version.
- **The `lodash-es` override** in `package.json` replaces the version pinned by `chevrotain` 11 (a dependency of `@argdown/core`) with a release that fixes known advisories. Remove it once `@argdown/core` depends on `chevrotain` 12 or later, which does not use lodash.

## Releases

Claude Code detects an update by the plugin's `version`, so a release changes `version` in `plugins/requirements-discovery/.claude-plugin/plugin.json` and in `package.json` (`npm run check` requires both to match). Commits without a version change do not reach installed users.

## Pull requests

Describe the behavior change and the scenario that motivated it, and run `npm run verify` before opening the pull request. By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
