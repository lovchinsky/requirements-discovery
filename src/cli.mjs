import { DiscoveryError, projectGraph, viewGraph, sha256 } from './graph.mjs';
import { findProject, readGraph, readBytes, locations, stdinText } from './storage.mjs';
import { initDiscovery, applyGraph, patchGraph, reconcilePositionState, setLifecycle, status, archiveDiscovery, repairGraph, renderDraft, previewHandoff, prepareAudit, publishHandoff, handoffStatus } from './operations.mjs';

export const HELP = `Requirements Discovery local helper

node dist/discovery.cjs COMMAND --project /absolute/project [--expect SHA256]

Read-only commands:
  status          Graph existence, focus, blockers, hash and handoff freshness
  check           Official Argdown parsing and semantic integrity checks
  project         Current specification-input projection as JSON
  view            Bounded neighborhood; --ids I-001,D-006 --depth 0|1|2|3
  render          stdin JSON {language?, conclusions?}; prints handoff Markdown;
                  optional --expect refuses a graph changed since the preview
  handoff-preview stdin JSON {language?, conclusions?, audit_requested?}; hashes,
                  branches still without a conclusion, unfilled review
  handoff-status  Verify the handoff is ready, current and reproducible from the graph
  hash            Hash raw graph bytes (for repairing an invalid graph)

Write commands (no API calls or conversation processing):
  init            stdin JSON: {title, intent, scope?}; never overwrites
  apply           --expect required; stdin: complete candidate Argdown
  patch           --expect required; stdin JSON: {meta?, add?, update?, relations?}
  positions-reconcile --expect raw hash; repair only Position state, backup first
  lifecycle       --expect required; --status active|paused
  audit-prepare   --expect required; stdin JSON {language?, conclusions?}; graph/draft snapshots
  handoff         --expect required; stdin JSON: {language?, conclusions?, review?, audit_requested?}
                  Renders handoff.md from the graph and writes handoff.json metadata
  archive         --expect required; preserve current files before new discovery
  repair          --expect required; stdin: repaired Argdown; preserves damaged bytes

Without --project, use CLAUDE_PROJECT_DIR or the nearest repository/discovery.
Exit 0: success. Exit 1: invalid state, conflict or unready handoff-status.
`;

export const OPTIONS = ['--project', '--expect', '--status', '--ids', '--depth'];

// Commands that print Markdown rather than JSON.
export const MARKDOWN = new Set(['render']);

// The single list of commands; tests and documentation checks are derived from it.
export const COMMANDS = {
  init: async c => initDiscovery(c.project, await c.json()),
  apply: async c => applyGraph(c.project, c.expected, await stdinText()),
  patch: async c => patchGraph(c.project, c.expected, await c.json()),
  'positions-reconcile': c => reconcilePositionState(c.project, c.expected),
  lifecycle: c => setLifecycle(c.project, c.expected, c.options['--status']),
  status: c => status(c.project),
  check: c => {
    const graph = readGraph(c.project);
    return { valid: true, graph_sha256: graph.hash, nodes: graph.nodes.size, relations: graph.relations.length };
  },
  project: c => projectGraph(readGraph(c.project)),
  render: async c => renderDraft(c.project, c.expected, await c.json()),
  view: c => viewGraph(readGraph(c.project), c.options['--ids']?.split(','), c.options['--depth'] === undefined ? 1 : Number(c.options['--depth'])),
  'handoff-preview': async c => previewHandoff(c.project, await c.json()),
  'audit-prepare': async c => prepareAudit(c.project, c.expected, await c.json()),
  handoff: async c => publishHandoff(c.project, c.expected, await c.json()),
  'handoff-status': c => {
    const result = handoffStatus(c.project);
    if (!result.ready) process.exitCode = 1;
    return result;
  },
  archive: c => archiveDiscovery(c.project, c.expected),
  hash: c => ({ graph_sha256: sha256(readBytes(locations(c.project).graph)) }),
  repair: async c => repairGraph(c.project, c.expected, await stdinText()),
};

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['--help', '-h', 'help'].includes(argv[0])) return process.stdout.write(HELP);
  const [command, ...rest] = argv;
  if (!Object.hasOwn(COMMANDS, command)) throw new DiscoveryError('ARGS', `Unknown command ${command}. Run --help.`);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!OPTIONS.includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--') || options[key]) {
      throw new DiscoveryError('ARGS', `Invalid or repeated argument ${key}. Run --help.`);
    }
    options[key] = rest[i + 1];
  }
  const json = async () => {
    try { const text = await stdinText(); return JSON.parse(text); }
    catch (error) { if (error instanceof DiscoveryError) throw error; throw new DiscoveryError('JSON', 'Input must be valid JSON.'); }
  };
  const project = findProject(process.cwd(), options['--project'] ?? process.env.CLAUDE_PROJECT_DIR);
  const result = await COMMANDS[command]({ project, expected: options['--expect'], options, json });
  process.stdout.write(MARKDOWN.has(command) ? result : `${JSON.stringify(result, null, 2)}\n`);
}

export function report(error) {
  const result = { ok: false, code: error.code ?? 'INTERNAL', error: error.message, ...(error.details?.length ? { details: error.details } : {}) };
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
}
