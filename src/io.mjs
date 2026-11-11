import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { DiscoveryError, MAX_GRAPH_BYTES, MAX_HEADER_BYTES } from './errors.mjs';

export function findProject(cwd, projectDir) {
  if (projectDir) return path.resolve(projectDir);
  let dir = path.resolve(cwd);
  for (;;) {
    // A nested repository/worktree is a boundary: never inherit an outer discovery.
    if (fs.existsSync(path.join(dir, '.requirements', 'current.argdown')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

export function locations(project) {
  const root = path.resolve(project);
  const state = path.join(root, '.requirements');
  return { root, state, graph: path.join(state, 'current.argdown'), handoff: path.join(state, 'handoff.md'), handoffJson: path.join(state, 'handoff.json'), lock: path.join(state, '.write-lock') };
}

export function assertReal(file, directory = false) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new DiscoveryError('PATH', `${file} must be a regular ${directory ? 'directory' : 'file'}, not a symlink.`);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export function ensureDirectory(dir) {
  assertReal(dir, true);
  fs.mkdirSync(dir, { recursive: true });
}

// Reads exact bytes: hashes, compare-and-swap and backups must never see a lossy decode.
function readBounded(file, maxBytes, prefixBytes) {
  assertReal(path.dirname(file), true);
  assertReal(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new DiscoveryError('SIZE', `${file} is not a regular file within the size limit.`);
    if (prefixBytes === undefined) return fs.readFileSync(fd);
    const buffer = Buffer.alloc(Math.min(stat.size, prefixBytes));
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!read) break;
      offset += read;
    }
    return buffer.subarray(0, offset);
  } finally { fs.closeSync(fd); }
}

export function readBytes(file, maxBytes = MAX_GRAPH_BYTES) {
  return readBounded(file, maxBytes);
}

// Strict decoding keeps the BOM, so the decoded text hashes like the file's bytes.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function decodeText(bytes, file) {
  try { return utf8.decode(bytes); }
  catch { throw new DiscoveryError('ENCODING', `${file} is not valid UTF-8.`); }
}

export function readFile(file, maxBytes = MAX_GRAPH_BYTES) {
  return decodeText(readBytes(file, maxBytes), file);
}

// One lookahead byte distinguishes a complete 64 KiB header from a truncated
// closing line. Never parse the body or certify reasoning readiness.
export function readHeader(project) {
  const meta = frontMatterHeader(readBounded(locations(project).graph, MAX_GRAPH_BYTES, MAX_HEADER_BYTES + 1).toString('utf8'))?.discovery;
  if (!meta || meta.schema !== 2 || !['active', 'paused', 'handed-off'].includes(meta.status) || !Number.isSafeInteger(meta.revision) || meta.revision < 1 || typeof meta.id !== 'string' || typeof meta.root !== 'string' || (meta.focus !== null && typeof meta.focus !== 'string')) throw new DiscoveryError('SCHEMA', 'Invalid or unsupported discovery header.');
  return meta;
}

export function frontMatterHeader(text) {
  const match = /^(?:\uFEFF)?===[ \t]*\r?\n([\s\S]*?)\r?\n===[ \t]*(?:\r?\n|$)/.exec(text.slice(0, MAX_HEADER_BYTES + 1));
  if (!match || Buffer.byteLength(match[0], 'utf8') > MAX_HEADER_BYTES) throw new DiscoveryError('FRONTMATTER', 'Missing or oversized frontmatter.');
  return load(match[1]);
}

export async function stdinText(limit = MAX_GRAPH_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > limit) throw new DiscoveryError('SIZE', 'Input exceeds the size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
