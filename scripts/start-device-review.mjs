import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Dedicated review state; never migrates the pre-existing group/production databases.
process.env.M0_STATE_DIR=resolve(root,'../ybz-device-review-20261012');
process.env.M0_PORT='18930';
process.env.INTERNAL_PREVIEW='false';
process.env.YBZ_GROUP_TESTNET_PAYMENTS='false';
console.log('YBZ 安装器与机器码审核：独立本机数据；真实模型和公网付款未启用。');
console.log('数据目录：'+process.env.M0_STATE_DIR);
await import('../yubenzhe-deploy/scripts/start-m0.mjs');
