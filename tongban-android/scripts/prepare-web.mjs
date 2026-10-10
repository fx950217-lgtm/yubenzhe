import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['build.mjs'], { cwd: path.resolve(root, '../tongban'), stdio: 'inherit', windowsHide: true });
execFileSync(process.execPath, ['scripts/copy-web.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
console.log('当前源码的网页资源已准备；尚未编译、签名或安装 Android 应用。');
