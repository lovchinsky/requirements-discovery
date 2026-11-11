import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const LICENSE_START = '// BEGIN BUNDLED DEPENDENCY LICENSES';
export const LICENSE_END = '// END BUNDLED DEPENDENCY LICENSES';
export const normalizeNotice = text => text.replace(/\r\n|\r|\u2028|\u2029/g, '\n').replace(/\n?$/, '\n');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Every bundled input is first-party source or code of a package with known notices.
export function retainedPackages(root, inputs) {
  const packages = new Map();
  const modules = path.join(root, 'node_modules');
  for (const input of inputs) {
    if (input.startsWith('src/')) continue;
    if (!input.startsWith('node_modules/')) throw new Error(`Cannot attribute bundled input ${input} to a package.`);
    let dir = path.dirname(path.resolve(root, input));
    while (dir.startsWith(modules + path.sep) && !fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
    if (!dir.startsWith(modules + path.sep)) throw new Error(`No package.json owns bundled input ${input}.`);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    packages.set(pkg.name, { dir, pkg });
  }
  return [...packages.values()].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
}

// Published packages that ship without a license file, keyed by exact version, so a new
// version fails until its terms are reviewed. The text comes from the upstream repository.
const SUPPLEMENTED_LICENSES = {
  'string-pixel-width@1.11.0': {
    file: 'licenses/string-pixel-width/LICENSE.md',
    source: 'https://github.com/adambisek/string-pixel-width/blob/a0ec4aef30357bc7ed541a4fdab3b5eca7d6b630/LICENSE.md',
  },
};

export function collectNotices(root, { dir, pkg }) {
  const names = fs.readdirSync(dir).filter(name => /^(license|notice|copying)([._-]|$)/i.test(name)).sort();
  const notices = names.map(file => ({ file, text: normalizeNotice(fs.readFileSync(path.join(dir, file), 'utf8')) }));
  let note;
  if (!names.some(name => /^license/i.test(name))) {
    const supplement = SUPPLEMENTED_LICENSES[`${pkg.name}@${pkg.version}`];
    if (!supplement) throw new Error(`Missing bundled license for ${pkg.name}@${pkg.version}`);
    notices.push({ file: supplement.source, text: normalizeNotice(fs.readFileSync(path.join(root, supplement.file), 'utf8')) });
    note = 'The published package has no license file; its license text is taken from the upstream repository.';
  }
  return { name: pkg.name, version: pkg.version, license: pkg.license, notices, ...(note ? { note } : {}) };
}

export function licenseFooter(packages) {
  const lines = [LICENSE_START.slice(3), 'Upstream source is mechanically bundled/minified; original notices follow.'];
  for (const pkg of packages) {
    lines.push('', `Package: ${pkg.name}@${pkg.version} (${pkg.license})`);
    if (pkg.note) lines.push(pkg.note);
    for (const notice of pkg.notices) {
      lines.push(`Source notice: ${notice.file}`, notice.text.trimEnd());
    }
  }
  lines.push(LICENSE_END.slice(3));
  // Prefix every physical JS line, including metadata and Unicode separators.
  // A notice containing */ cannot terminate line comments or inject code.
  return '\n' + lines.join('\n').split(/\r\n|\n|\r|\u2028|\u2029/).map(line => line ? '// ' + line : '//').join('\n') + '\n';
}

export function licenseInventory(packages) {
  return packages.map(({ notices, ...pkg }) => ({ ...pkg,
    notices: notices.map(({ file, text }) => ({ file, sha256: digest(text) })),
  }));
}
