import { copyFile, mkdir, readFile, rm, lstat, rename, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(project, '../tongban/dist');
const destination = path.join(project, 'www');
const staging = path.join(project, '.www-staging');
const consumer = JSON.parse(await readFile(path.resolve(project, '../tongban/package.json'), 'utf8'));
const nativePackage = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
if (nativePackage.version !== consumer.version) throw new Error('安卓版本与网页版本不一致，拒绝复制旧快照。');
const buildInfo = JSON.parse(await readFile(path.join(source, 'build-info.json'), 'utf8'));
if (buildInfo.version !== consumer.version || !buildInfo.builtAt) throw new Error('请先构建当前版本的网页，再同步原生资源。');
async function removeGenerated(directory) {
  const root = await realpath(project);
  if (![destination, staging].includes(directory)) throw new Error('不是允许清理的网页输出目录。');
  const info = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return;
  const relative = path.relative(root, await realpath(directory));
  if (info.isSymbolicLink() || !info.isDirectory() || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('网页输出目录超出工程或为链接。');
  await rm(directory, { recursive: true, force: true });
}
// Explicit application assets only: never recursively copy installation pages or APKs.
export const WEB_ASSETS = ['index.html', 'app.js', 'app.css', 'icon.png', 'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png', 'privacy.html', 'terms.html'];
const html = await readFile(path.join(source, 'index.html'), 'utf8');
if (!html.includes('app.js') || !html.includes('Content-Security-Policy')) throw new Error('网页构建不完整，未复制。');
for (const entry of WEB_ASSETS) {
  const info = await lstat(path.join(source, entry));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('网页资源必须是普通文件。');
}
await removeGenerated(staging);
await mkdir(staging, { recursive: true });
for (const asset of WEB_ASSETS) await copyFile(path.join(source, asset), path.join(staging, asset));
await copyFile(path.join(project, 'native-assets/webview-unavailable.html'), path.join(staging, 'webview-unavailable.html'));
await removeGenerated(destination);
await rename(staging, destination);
console.log('已复制网页快照；请继续 cap sync android 将资源写入原生工程。');
