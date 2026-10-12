import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// A fresh local review database; never upgrade earlier previews or live data.
process.env.M0_STATE_DIR=resolve(root,'../ybz-detail-review-20261013');
process.env.M0_PORT='18938';
process.env.INTERNAL_PREVIEW='false';
process.env.YBZ_GROUP_TESTNET_PAYMENTS='false';
console.log('YBZ 细节打磨本机审核：独立测试数据；未连接真实模型、未部署服务器。');
console.log('数据目录：'+process.env.M0_STATE_DIR);
await import('../yubenzhe-deploy/scripts/start-m0.mjs');
