import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// A new local review database: never migrate an earlier user's preview state here.
process.env.M0_STATE_DIR=resolve(root,'../ybz-ultimate-review-20261012');
process.env.M0_PORT='18934';
process.env.INTERNAL_PREVIEW='false';
process.env.YBZ_GROUP_TESTNET_PAYMENTS='false';
console.log('YBZ 终极改版本地审核：独立数据目录；主网、实际代付、云端部署均未启用。');
console.log('数据目录：'+process.env.M0_STATE_DIR);
await import('../yubenzhe-deploy/scripts/start-m0.mjs');
