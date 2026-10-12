import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Deliberately isolated from the existing M0 and production data directories.
process.env.M0_STATE_DIR=resolve(root,'../ybz-group-review-20261012');
process.env.M0_PORT='18926';
process.env.INTERNAL_PREVIEW='false';
process.env.YBZ_GROUP_TESTNET_PAYMENTS='false';
console.log('YBZ 群协作代码审核：独立本机数据；模型未配置；公网测试网付款关闭。');
console.log('数据目录：'+process.env.M0_STATE_DIR);
await import('../yubenzhe-deploy/scripts/start-m0.mjs');
