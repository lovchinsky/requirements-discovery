import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNotices, retainedPackages, licenseFooter, licenseInventory } from './bundled-licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The plugin directory holds only runtime files; the build inventory stays in the project.
const dist = 'plugins/requirements-discovery/dist';
const outputs = [], inventory = {}, retainedInputs = {};
for (const [output, entry] of [['discovery', 'src/cli-entry.mjs'], ['hook', 'src/hook-entry.mjs']]) {
  const result = await build({ absWorkingDir: root, entryPoints: [entry], outfile: `${dist}/${output}.cjs`, write: false,
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true,
    // The appended footer carries every bundled package's complete notices.
    legalComments: 'none', metafile: true,
    // Keep linked dependencies under node_modules/ paths, so their notices are attributed.
    preserveSymlinks: true,
    plugins: [{ name: 'argdown-without-side-effects', setup(builder) {
      // @argdown/core declares no "sideEffects", so esbuild would keep its default
      // application and Graphviz. Only the parser classes are imported; mark the
      // entry side-effect free and let tree shaking drop the rest.
      builder.onResolve({ filter: /^@argdown\/core$/ }, async ({ path: specifier, pluginData, ...args }) => {
        if (pluginData === 'resolved') return undefined;
        const resolved = await builder.resolve(specifier, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: 'resolved' });
        return { ...resolved, sideEffects: false };
      });
    }}],
    logLevel: 'warning'
  });
  // Metafile.inputs also lists tree-shaken packages. Inventory only actual code.
  const retained = [...new Set(Object.values(result.metafile.outputs).flatMap(info => Object.entries(info.inputs ?? {}).filter(([, input]) => input.bytesInOutput > 0).map(([input]) => input)))];
  const packages = retainedPackages(root, retained).map(pkg => collectNotices(root, pkg));
  outputs.push([path.join(root, `${dist}/${output}.cjs`), result.outputFiles[0].text + licenseFooter(packages)]);
  inventory[output] = { packages: licenseInventory(packages) };
  retainedInputs[output] = retained.filter(input => input.startsWith('node_modules/')).sort();
}
// Write only once every bundle has its complete notices.
fs.mkdirSync(path.join(root, dist), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
for (const [file, text] of outputs) fs.writeFileSync(file, text);
for (const [output, retained] of Object.entries(retainedInputs)) {
  fs.writeFileSync(path.join(root, `build/${output}.metafile.json`), JSON.stringify({ retained_inputs: retained }, null, 2) + '\n');
}
fs.writeFileSync(path.join(root, 'build/dependencies.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log('Built offline Argdown CLI and lightweight SessionStart hook.');
