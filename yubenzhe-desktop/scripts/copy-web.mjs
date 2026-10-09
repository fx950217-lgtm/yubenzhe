import { mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '..', 'tongban', 'dist');
const target = path.join(root, 'web');
const files = ['index.html', 'app.js', 'app.css', 'icon.png', 'icon.svg', 'apple-touch-icon.png', 'manifest.webmanifest', 'privacy.html', 'terms.html'];
await mkdir(target, { recursive: true });
for (const file of await readdir(target)) await rm(path.join(target, file), { recursive: true, force: true });
const hashes = {};
for (const file of files) {
  const bytes = await readFile(path.join(source, file));
  if (file === 'index.html' && !bytes.toString().includes('愚笨者')) throw new Error('请先生成已更名为愚笨者的前端 dist。');
  await copyFile(path.join(source, file), path.join(target, file));
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(path.join(root, 'web-assets-verification.json'), JSON.stringify({ source: '../tongban/dist', version: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, files: hashes }, null, 2) + '\n');
console.log(`Copied ${files.length} consumer assets; download/admin assets excluded.`);
