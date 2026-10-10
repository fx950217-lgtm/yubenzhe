import { mkdir, readFile, writeFile, copyFile, rm, lstat, realpath, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '..', 'tongban', 'dist');
const target = path.join(root, 'web');
const staging = path.join(root, '.web-staging');
const files = ['index.html', 'app.js', 'app.css', 'icon.png', 'icon.svg', 'apple-touch-icon.png', 'manifest.webmanifest', 'privacy.html', 'terms.html'];
const consumer = JSON.parse(await readFile(path.resolve(root, '../tongban/package.json'), 'utf8'));
const buildInfo = JSON.parse(await readFile(path.join(source, 'build-info.json'), 'utf8'));
if (buildInfo.version !== consumer.version || !buildInfo.builtAt) throw new Error('请先构建当前版本的网页，再同步原生资源。');
async function removeGenerated(directory) {
  const actualRoot = await realpath(root);
  if (![target, staging].includes(directory)) throw new Error('不是允许清理的网页输出目录。');
  const info = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return;
  const relative = path.relative(actualRoot, await realpath(directory));
  if (info.isSymbolicLink() || !info.isDirectory() || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('网页输出目录超出工程或为链接。');
  await rm(directory, { recursive: true, force: true });
}
for (const file of files) {
  const info = await lstat(path.join(source, file));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('网页资源必须是普通文件。');
}
await removeGenerated(staging);
await mkdir(staging, { recursive: true });
const hashes = {};
for (const file of files) {
  const bytes = await readFile(path.join(source, file));
  if (file === 'index.html' && !bytes.toString().includes('愚笨者')) throw new Error('请先生成已更名为愚笨者的前端 dist。');
  await copyFile(path.join(source, file), path.join(staging, file));
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
}
await removeGenerated(target);
await rename(staging, target);
await writeFile(path.join(root, 'web-assets-verification.json'), JSON.stringify({ source: '../tongban/dist', version: consumer.version, builtAt: buildInfo.builtAt, wrapperVersion: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, files: hashes }, null, 2) + '\n');
console.log(`Copied ${files.length} consumer assets; download/admin assets excluded.`);
