import { copyFile, mkdir, readFile, rm, lstat, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(project, '../tongban/dist');
const destination = path.join(project, 'www');
const staging = path.join(project, '.www-staging');
// Explicit application assets only: never recursively copy installation pages or APKs.
export const WEB_ASSETS = ['index.html', 'app.js', 'app.css', 'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png'];
const html = await readFile(path.join(source, 'index.html'), 'utf8');
if (!html.includes('app.js') || !html.includes('Content-Security-Policy')) throw new Error('网页构建不完整，未复制。');
for (const entry of WEB_ASSETS) {
  const info = await lstat(path.join(source, entry));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('网页资源必须是普通文件。');
}
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const asset of WEB_ASSETS) await copyFile(path.join(source, asset), path.join(staging, asset));
await copyFile(path.join(project, 'native-assets/webview-unavailable.html'), path.join(staging, 'webview-unavailable.html'));
await rm(destination, { recursive: true, force: true });
await rename(staging, destination);
console.log('已复制网页快照；请继续 cap sync android 将资源写入原生工程。');
