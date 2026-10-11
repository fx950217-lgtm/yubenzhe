# 链上一次分发：BSC 测试网内部审核

本目录独立于网页和服务端，提供固定地址等额分发、专用无价值测试代币及可复现的部署工具。新增脚本只接受 BSC 测试网 chainId 97；2026-10-11 已在 BSC 测试网真实部署测试代币与等额分发合约；部署及交易事实见 TEST-RESULTS.txt 和 ../yubenzhe-deploy/reports/internal-chain-acceptance.json。当前合约未经独立审计，不用于主网或真实资金。

默认内审模式为 `EqualDistribution`。`SingleDistribution` 随机原型保留用于本地研究，选择性中止边界尚未解决，部署脚本与消费者写操作不开启随机模式。

## 运行

需要 Node.js 22+。2026-10-10 已在获准联网的本地环境安装锁定依赖并生成 package-lock.json；依赖安装禁用生命周期脚本、审计和募捐请求。后续在本目录按锁文件复现，缓存也限定于本目录：

```text
npm ci --ignore-scripts --no-audit --no-fund --cache .npm-cache
npm run compile
npm run export-abi
npm test
```

安装同级 `tongban` 锁定依赖后，可额外运行 `npm run test:wallet-integration`。该测试直接调用实际消费者钱包的加密 vault、预览及确认签名，将所有 HTTP 请求拦截到进程内 chainId 97 EVM，验证 approve/fund/claim/refund；不会连接公网节点。

安装锁定版本的 OpenZeppelin Contracts 5.0.2、Solidity 0.8.20、ethers 6.17.0、Ganache 7.9.2。`npm test` 仅创建进程内 EVM，不监听网络、不读取真实钱包、不接受外部 RPC URL，也不部署到外部链。部署脚本测试使用临时合成账户验证本地签名与回执；Ganache 原生加速模块不可用时可回退至 JavaScript。

可选：已有匹配的官方 solc 0.8.20 时设置 SOLC_BINARY 为其可执行文件绝对路径；编译脚本用 --standard-json 调用，不借助 shell。默认使用锁定的 solc-js。目标 EVM 为 paris，未使用 transient storage。

实际编译与测试结果见 TEST-RESULTS.txt。完整编译产物、依赖、缓存不提交 Git；`exports/*.json` 是可供 ethers 使用的已版本化 ABI 与创建代码哈希，执行 `export-abi` 可从锁定源码复现。导出文件里的 `not-deployed` 指它们是通用接口，链上事实必须以具体部署回执和 `chain-preview.json` 为准。

## 默认等额协议与前端接口

`EqualDistribution` 构造函数仅接受 chainId 97，为 `constructor(Config c, address[] recipients)`，Config 字段按顺序为 `token, campaignId, amount(uint128), claimStart(uint64), expiresAt(uint64)`。地址名单固定 1..200 个，不允许零地址、重复地址、发送者自身或活动合约自身。分发额使用代币最小单位整数；每人获得 `amount / count`，尾差每个最小单位依次给名单靠前的固定名额，领取顺序不会改变金额。没有随机或罚金。

- sender 本机签名创建活动；向活动地址 `approve(totalAmount)` 后本人调用 `fund()`，必须在 claimStart 至少 60 秒前完整供资。
- `[claimStart, expiresAt)` 由固定接收地址本人调用 `claim(index)`；不接收可改写收款方参数。重复、旁观者、复制交易或越过窗口的领取不能改变名额。
- 到期后任何地址可调用 `refundExpired()`，未领取额只回不可更改的 sender。单个领取失败原子回滚，可在窗口内重试；代币永久冻结仍可能阻断退款。
- `recipientIndex(address)` 返回从 1 开始的名额；0 表示未入选。`participants(index)` 返回 `(account, claimed, allocation, received)`；还有 `recipientCount, claimable(index), funded, refunded, claimedCount, totalAmount, remaining, totalPaid, totalRefunded, claimStart, expiresAt, token, sender, campaignId, phase`。
- phase：0 Locked（未供资或未起始）、1 Active（已供资且可领取）、2 Closed（已领空、到期或已退款）。到期 Closed 不等于已退款，仍需查看 refunded/remaining。
- 事件：`Funded(sender,amount)`、`Claimed(index,recipient,paid)`、`Refunded(sender,amount)`。记录区块哈希、交易哈希与日志序号，并等待确认；链重组时退回核查。
- 没有管理员、升级、平台提款、提前撤销、改接收人、代付或积分兑换入口。等额活动不会调用通用随机原型的 commit/reveal/finalize。

固定名单地址及全部资金操作在链上公开；不要在链上写入邮箱、产品用户 ID、聊天关系或私密文件。这里没有证明某地址对应唯一自然人，产品还需独立完成账户与地址控制权核对。

`InternalTestToken` 只允许部署在 chainId 97，固定名称 `YBZ Internal Test Token`、符号 `YBZt`、精度 18，创建时向部署者发行 1,000,000 枚；没有后续 mint、owner、暂停、税费或升级接口。它没有经济价值，不冒充稳定币，也不承诺兑换。

## 测试网部署：先准备，再核对，最后显式签名

部署计划不包含任何密钥。示例（尖括号内容必须替换成审核过的实际测试值；时间是 Unix 秒）：

```json
{
  "schemaVersion": 1,
  "chainId": 97,
  "mode": "equal",
  "sender": "<专用测试发送地址>",
  "tokenAddress": null,
  "campaignId": "<非零32字节活动ID>",
  "amount": "1000000000000000000",
  "recipients": ["<接收地址1>", "<接收地址2>"],
  "claimStart": 0,
  "expiresAt": 0,
  "confirmations": 3,
  "maxFeePerTxWei": "50000000000000000"
}
```

`tokenAddress: null` 会先创建固定供应测试币，再创建等额活动。使用已有测试币必须通过与本地编译版本完全相同的运行代码及供应量检查。只创建代币时将 mode 改为 `token-only`，只保留 schemaVersion/chainId/mode/sender/confirmations/maxFeePerTxWei。起始需留出部署、供资与审核时间，脚本要求至少距链上当前时间 300 秒；建议内审预留更充裕的人工操作窗口。每笔实际 Gas 仍由相应签名人承担，没有固定美元费用。

```text
node scripts/testnet.mjs prepare --plan review-plan.json --out prepared/review.json
node scripts/testnet.mjs check --plan review-plan.json --rpc https://明确核准的测试网RPC
node scripts/testnet.mjs deploy --plan review-plan.json --rpc https://明确核准的测试网RPC --key-file C:\安全目录\ybz-test-key.json --out deployments/internal-review --confirm-testnet
node scripts/testnet.mjs receipt --journal deployments/internal-review/deployment.json --rpc https://明确核准的测试网RPC
```

prepare 完全离线，不读取密钥。check 只读取网络、时间、测试 BNB 与代币身份，零测试 BNB 会明确显示待补充，不伪称可部署。deploy 必须显式提供专用测试密钥文件绝对路径，文件在 Git 仓库之外，格式如下，POSIX 权限须为 0600；Windows 请限制文件 ACL。严禁使用有真实资产的钱包、助记词或服务器密钥：

```json
{"purpose":"ybz-bsc-testnet-only","chainId":97,"expectedAddress":"<计划sender>","privateKey":"<仅专用测试私钥>"}
```

脚本不从环境变量、默认钱包、控制台或普通 plan 读取私钥，不打印密钥、签名原文或原始 RPC 错误。支持 HTTPS RPC，拒绝 URL 用户名/密码；访问令牌如需包含在 RPC URL 中也不得贴入公开日志。签名前核对 sender/chainId/Gas 最高费用，广播前再次验证链。不会替用户 approve 或 fund，资金锁定继续由钱包界面明确预览和签署。

`deployment.json` 在广播前先落盘保存确定的交易哈希、nonce、CREATE 预期地址、公开创建数据和费用上限，后续更新采用临时文件落盘及原子替换。广播结果未知时立即停止，禁止自动重发、换 nonce 或重复创建；运行 receipt 查询同一交易。已有输出目录的部署日志不能被覆盖。如第一笔测试币成功而第二笔活动尚未部署，先核查现有日志，再用已确认 tokenAddress 和新计划/新输出目录只创建缺失的活动，不能重新创建测试币。

prepare 的 `sourceVerification` 和部署目录 `verification-input.json` 包含确切 Solidity Standard JSON 与编译器版本，可用于区块浏览器提交源码验证。工具不持有区块浏览器 API Key，也不把本地字节码核对称为浏览器已公开验证；如果未提交，应明确显示尚未完成源码公开验证。

receipt 校验 chainId 97、确认数、规范区块哈希、原发送人/nonce、完整创建字节码与构造参数、代币代码、活动不可变字段和固定名单，生成 `chain-preview.json`。它包含 mode、chainId、distributionAddress、tokenAddress、campaignId、runtimeHash、tokenRuntimeHash、noEconomicValue；无密钥或参与者秘密。只有相互匹配的完整已确认部署才 enabled=true；仅代币、未确认、回滚、未知结果均不开启活动写操作。运行字节码哈希来自具体部署（活动含 immutable 值），不能用带占位值的编译运行代码哈希替代。

前端从可信同源配置读取上述字段，再核对链及链上代码；不可从任意页面参数信任合约地址。当前只开放 equal 写操作，随机模式继续实验停用。公开运行前仍需独立审计与目标链钱包端到端验收。

## 以下为保留的随机原型协议（不在默认内审中开放）

## 资产与权限

- 每个合约只有一个活动、一种 ERC20、一个发送者、固定金额、固定白名单、固定窗口。创建和 fund 都由发送者的钱包签署；approve 只是授权该合约从发送者转入准确金额。资金必须完整到账才进入已锁定状态。
- 没有 owner、管理员、多签提款、暂停、升级、任意外部调用、迁移、sweep 或提取手续费接口。平台不持有合约中的提款凭据。发送者也不能提前撤销或改参数。
- 合约仅将资金发送至白名单本人；到期余款只退回不可更改的原发送者。任何人可触发退款，但不能改变收款方。
- 本原型只支持经过核准的普通精确转账 ERC20；不支持原生 BNB、手续费币、rebase 币。SafeERC20 处理回退/false/no-return，入账和出账余额差再次验证准确金额。恶意币可伪造 balanceOf；黑名单/暂停/升级发行人可阻止包括退款在内的转账，因此不能对任意代币保证到账或解锁。
- 直接向合约误转的其他代币、额外代币或强制发送的原生币不计入活动，也没有管理员回收入口，可能永久无法取回。只使用 fund 流程；此限制是避免引入任意资产提取权的明确取舍。

## 固定时间协议

1. 创建：明确 token、campaignId、Merkle 根、2..200 个固定名额、整数最小单位金额、全部时间与早领惩罚。名单必须恰好覆盖 0..N-1，每个地址仅一个名额；scripts/protocol.mjs 拒绝重复地址。
2. 锁定：sender 在 commitStart 至少 60 秒前完成 fund；部署到起始也至少间隔 60 秒。等待期间不能领取或注册承诺。
3. 承诺：[commitStart, commitEnd)，每个白名单本人提交绑定领取人、slot、秘密及 domain 的承诺；一次提交不可替换。domain 包含 chainId、合约地址、sender、campaignId。邀请叶子还包含链、sender、campaignId、slot、地址与邀请盐；证明不能被旁观者复制抢领。
4. 揭示：[commitEnd, revealEnd)，先确认全部 N 个承诺已登记。参与人用自己的地址揭示秘密。错误秘密、重复揭示、跨名额/跨合约重放被拒绝。秘密应由本人用密码学随机源生成并独立保存，不能发送给平台或其他参与者；测试中的固定秘密仅为合成夹具。
5. 分配：[revealEnd, expiresAt)，全部 N 人揭示才允许任意人 finalize。把各人的带域哈希贡献异或再哈希，结果与揭示先后无关。每个固定名额取 1..1,000,000 的哈希权重，按权重分配，至少一最小单位。整数余数归种子预定的名额，不归最后一位调用者。该方案是随机权重分配，不承诺所有金额组合等概率；取模还存在极小偏差。
6. 领取：固定名额单独 claim，收款人必须是该地址本人。金额不会被先到者抢占。早领惩罚从 initialPenaltyBps 随时间线性衰减到 0；decayDuration 结束后足额领取。早领惩罚不重新分配，留到期退款。领取前必须明确展示本次到账与扣减；零金额领取会拒绝，稍后可重试。
7. 到期：[expiresAt, +∞)，所有 claim/finalize 关闭。refundExpired 把未领取金额、未成功转账金额和早领惩罚退给 sender；未完成 commit/reveal 的活动全额退回。不存在使用缺席者子集、区块哈希、时间戳或管理员指定随机数的备用开奖。

合约 phase 输出三态：Locked（含尚未fund及承诺/揭示）、Active（已分配且仍可领取）、Closed（领空、退款或到期）。到期的 Closed 不表示退款已执行；必须分别查看 refunded、remaining、totalRefunded。若所有人早领仍有惩罚余额，保持 Active 至到期以保留清晰的资金状态。

## commit-reveal 与防抢跑的实际边界

纯粹的 commit-reveal 不能同时消除最后揭示者选择中止和保证活性。本原型采用 all-reveal-or-refund：最后揭示者不能通过选择不同子集获得另一种已完成分配，但可以拒绝揭示，令整个活动失败；跨多个活动选择性中止仍可偏置成功活动的样本。不能把此机制描述成公平性已被密码学完整解决。

随机性要求至少一个独立诚实参与者在全部承诺冻结前保密其随机秘密。发送者若控制全部白名单、勾结所有参与人、收集秘密或用多个虚假账号参与，则该假设不成立；链上无法证明一个地址对应一个真实人。还存在最后揭示者拒绝服务、泄密、验证者审查/时间戳影响以及用户错过窗口的风险。所有人必须配合，所以当前原型适合提前确认的小型协作群，不适合开放的无人协调抢红包。

延迟和时间衰减仅减少立即抢领的动机与时间优势；它们不构成彻底防 MEV/sniping，也不保证交易按用户期望排序。固定名额、固定个人分配和非共享资金池才使复制 reveal/claim 不能偷走他人额度。若未来需要兼顾公开参与、强随机公平和活性，应另行设计并审计独立随机信标/VRF或可恢复承诺方案；不能默默换成可预测链随机。

白名单“私密”指凭邀请限制谁能参加，**不指链上匿名性**：commit 中的地址、盐和证明公开，链上资金往来也公开；Merkle根不隐藏已公开参与者。

## 失败与金额守恒

所有状态修改入口使用 OpenZeppelin ReentrancyGuard；资金操作先记录效果，再进行外部交互。领取失败整笔交易回滚，claimed/received/remaining/totalPaid 不改变，可以在截止前重试；其他人各自领取不受该地址失败影响。退款失败也回滚，可在发行人恢复转账后再次调用。

只在受支持代币与无额外转入的模型下：

```text
fundedAmount = totalPaid + remaining + totalRefunded
finalize: sum(allocation[i]) = fundedAmount
claim: paid <= allocation[i], per-address claim <= 1
expiry: remaining -> immutable sender, never -> platform admin
```

外部代币永久冻结合约或sender时，本合约无法强迫发行人退款。不要宣传“失败必然自动退款到账”；准确说法是到期可触发原地址退款，仍受代币可转账条件限制。标准 ERC20 转账不会要求收款合约确认接收，因此“转账成功但接收合约没有提币功能”无法被通用合约自动识别或退款。白名单地址须由领取人确认能管理该代币；本实现保证的是转账明确失败时可重试、到期可触发退款。所有Gas已经支付给链，不返还。

## Gas、积分、活动预算

默认每笔交易的发起人自付 Gas：sender 支付创建/approve/fund，领取人支付自己的 commit/reveal/claim，调用 finalize/refund 的人支付该次 Gas。没有 paymaster/relayer、平台补贴、积分或固定法币Gas价格逻辑。

如果产品要求sender承担所有领取Gas，需要另行设计钱包签名授权、重放保护、预算和独立relay/paymaster；不能仅改界面就宣称已实现。活动补贴默认关闭；独立多签营销预算不得取得本分发合约的提款权。积分核销发链上资产没有在此实现，也不能通过这个合约推定其法律定性。

## 测试覆盖与上线边界

测试覆盖：不可变参数和窗口、sender/allowance/余额、白名单与复制承诺、commit/reveal各阶段、秘密错误/重复/域重放、揭示顺序、分配和转账金额守恒、时间衰减/最小单位、缺席到期退款、失败领取隔离与重试、false返回/手续费币、退款重试、代币回调重入、无管理员ABI。

仍需独立审计、目标链与精确代币审查、正式钱包与UI端到端联调、节点故障/重组事件处理及法律意见。随机原型不通过新增部署脚本开放；没有主网地址或主网自动签名入口。等额最大人数本地 Gas 结果见 TEST-RESULTS.txt，不得把本地测试通过称为可安全承载真实资金。

官方参考（2026-10-10查阅）：
- Solidity 安全注意事项及 CEI：https://docs.soliditylang.org/en/latest/security-considerations.html
- OpenZeppelin ReentrancyGuard：https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuard
- OpenZeppelin SafeERC20：https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#SafeERC20
- OpenZeppelin MerkleProof：https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography#MerkleProof
