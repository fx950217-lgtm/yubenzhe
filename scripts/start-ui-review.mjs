import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Isolated review data only; never migrate earlier previews or live deployments.
process.env.M0_STATE_DIR=resolve(root,'../ybz-ui-review-20261012');
process.env.M0_PORT='18936';
process.env.INTERNAL_PREVIEW='false';
process.env.YBZ_GROUP_TESTNET_PAYMENTS='false';
console.log('YBZ UI/功能本机验收：独立数据；模拟邮件、真实本机代码；未连接模型、未部署服务器。');
console.log('数据目录：'+process.env.M0_STATE_DIR);
await import('../yubenzhe-deploy/scripts/start-m0.mjs');
