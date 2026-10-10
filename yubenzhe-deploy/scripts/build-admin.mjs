import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync, copyFileSync, rmSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = resolve(root, '../tongban');
const source = resolve(root, '../tongban-admin');
const version = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8')).version;
const consumerVersion = JSON.parse(readFileSync(resolve(consumer, 'package.json'), 'utf8')).version;
if (version !== consumerVersion) throw new Error('Admin and consumer versions must match before building.');
const require = createRequire(resolve(consumer, 'package.json'));
const { build } = require('esbuild');
const publicRoot = resolve(root, 'public');
const target = resolve(publicRoot, 'admin');
const temporary = resolve(publicRoot, '.admin-stage-' + randomUUID());
function removeOutput(directory) {
  const scope = relative(publicRoot, resolve(directory));
  if (!scope || scope === '..' || scope.startsWith('..' + sep) || isAbsolute(scope)) throw new Error('Output must stay inside the deployment public directory.');
  rmSync(directory, { recursive: true, force: true });
}

// Build to memory first: an unsuccessful bundle never replaces a usable output.
const result = await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'ui/entry.tsx')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'external',
  outfile: resolve(temporary, 'app.js'),
  write: false,
  nodePaths: [resolve(source, 'node_modules')],
  alias: { '@/lib/admin-client': resolve(root, 'ui/admin-client.ts') },
  define: { 'process.env.NODE_ENV': '"production"' },
});
try {
  mkdirSync(temporary, { recursive: true });
  for (const file of result.outputFiles) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.contents);
  }
  writeFileSync(resolve(temporary, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>愚笨者 · 独立验收后台</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  copyFileSync(resolve(source, 'public/favicon.svg'), resolve(temporary, 'favicon.svg'));
  for (const name of ['social-ops.html', 'social-ops.js', 'social-ops.css']) copyFileSync(resolve(root, 'ui', name), resolve(temporary, name));
  writeFileSync(resolve(temporary, 'build-info.json'), JSON.stringify({ version, kind: 'admin', builtAt: new Date().toISOString() }, null, 2) + '\n');
  removeOutput(target);
  renameSync(temporary, target);
} finally {
  removeOutput(temporary);
}
console.log('Built independent admin UI ' + version + '.');
