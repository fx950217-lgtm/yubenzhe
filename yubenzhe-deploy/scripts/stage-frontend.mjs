import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, copyFileSync, rmSync, mkdirSync, writeFileSync, renameSync, lstatSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2] && resolve(process.argv[2]);
const version = JSON.parse(readFileSync(resolve(root, '../tongban/package.json'), 'utf8')).version;
if (!source) throw new Error('Supply the built consumer dist directory.');
const required = ['index.html', 'app.js', 'app.css', 'build-info.json', 'sw.js', 'privacy.html', 'terms.html', 'icon.png', 'icon.svg', 'apple-touch-icon.png', 'manifest.webmanifest', '_headers'];
const optional = ['app.js.LEGAL.txt', 'app.css.LEGAL.txt', 'install.html', 'install-qr.svg'];
for (const name of required) {
  const file = resolve(source, name);
  if (!existsSync(file) || !lstatSync(file).isFile()) throw new Error('Missing regular consumer build file: ' + name);
}
const info = JSON.parse(readFileSync(resolve(source, 'build-info.json'), 'utf8'));
if (info.version !== version) throw new Error('Consumer output version does not match the current source. Rebuild before staging.');
const index = readFileSync(resolve(source, 'index.html'), 'utf8');
const app = readFileSync(resolve(source, 'app.js'), 'utf8');
if (!index.includes('愚笨者') && !app.includes('愚笨者')) throw new Error('Frontend is missing the current product brand.');
if (app.includes('/api/admin/') || index.includes('/api/admin/')) throw new Error('Consumer build contains a forbidden admin API entry.');
const publicRoot = resolve(root, 'public');
const target = resolve(publicRoot, 'frontend');
const relation = relative(target, source);
if (!relation || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith('..' + sep))) throw new Error('Source must be outside the staging output folder.');
const temporary = resolve(publicRoot, '.frontend-stage-' + randomUUID());
function removeOutput(directory) {
  const scope = relative(publicRoot, resolve(directory));
  if (!scope || scope === '..' || scope.startsWith('..' + sep) || isAbsolute(scope)) throw new Error('Output must stay inside the deployment public directory.');
  rmSync(directory, { recursive: true, force: true });
}
try {
  mkdirSync(temporary, { recursive: true });
  for (const name of [...required, ...optional]) {
    const file = resolve(source, name);
    if (existsSync(file)) {
      if (!lstatSync(file).isFile()) throw new Error('Consumer resource must be a regular file: ' + name);
      copyFileSync(file, resolve(temporary, name));
    }
  }
  removeOutput(target);
  renameSync(temporary, target);
} finally {
  removeOutput(temporary);
}
mkdirSync(resolve(root, 'reports'), { recursive: true });
writeFileSync(resolve(root, 'reports/frontend-staging.json'), JSON.stringify({
  version,
  stagedAt: new Date().toISOString(),
  indexSha256: createHash('sha256').update(index).digest('hex'),
  appSha256: createHash('sha256').update(app).digest('hex'),
  adminEntry: false,
  historicalDownloadsIncluded: false,
  deployed: false,
  scope: 'local-development-web-build',
}, null, 2) + '\n');
console.log('Staged consumer web ' + version + '; no deployment or native installation performed.');
