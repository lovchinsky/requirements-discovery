import fs from 'node:fs';
import path from 'node:path';
import { findProject, locations, readHeader, stdinText } from './io.mjs';

export function hookOutput(input, pluginRoot, environment = process.env) {
  // Reject other events before inspecting files, including calls from stale hook
  // registrations. A custom-agent session must keep its own behavior and tools.
  if (!input || input.hook_event_name !== 'SessionStart' || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || input.agent_id || input.agent_type) return null;
  const project = findProject(input.cwd, environment.CLAUDE_PROJECT_DIR), p = locations(project);
  if (!fs.existsSync(p.graph)) return null;
  const graph = JSON.stringify(p.graph);
  const behavior = JSON.stringify(path.join(pluginRoot, 'skills', 'discover', 'SKILL.md'));
  const emit = additionalContext => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } });
  let meta;
  try { meta = readHeader(project); }
  catch {
    return emit(`Requirements discovery needs state recovery:\n${graph}\nPreserve its bytes. On a discovery request, read ${behavior} and inspect status before any recovery. Follow the user's latest task.`);
  }
  if (meta.status !== 'active') {
    return emit(`Requirements discovery is ${meta.status}; facilitation is inactive.\n${graph}\nFollow the user's latest task. Resume only on request with /requirements-discovery:discover resume.`);
  }
  // Only pointers: the skill restores and validates the actual current state.
  // No behavioral catalogue, graph projection, readiness claim or path truncation.
  return emit(`Active requirements discovery:\n${graph}\nRead ${behavior} to restore discovery behavior and current focus from graph state. Follow the user's latest task.`);
}

export async function runHook(pluginRoot) {
  try {
    const input = JSON.parse(await stdinText(4 * 1024 * 1024)), output = hookOutput(input, pluginRoot);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch { /* Fail open. Never log prompts, classify decisions, mutate or block. */ }
}
