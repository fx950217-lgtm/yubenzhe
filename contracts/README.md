# 链上一次分发：本地研发原型

本目录独立于网页和服务端，未接真实钱包、节点或资金。当前合约未经独立审计，不构成可直接用于主网的安全保证，也不构成任何地区的许可判断。

## 运行

需要 Node.js 22+。2026-10-10 已在获准联网的本地环境安装锁定依赖并生成 package-lock.json；依赖安装禁用生命周期脚本、审计和募捐请求。后续在本目录按锁文件复现，缓存也限定于本目录：

```text
npm ci --ignore-scripts --no-audit --no-fund --cache .npm-cache
npm run compile
npm test
```

安装锁定版本的 OpenZeppelin Contracts 5.0.2、Solidity 0.8.20、ethers 6.17.0、Ganache 7.9.2。测试仅创建进程内 EVM，不监听网络、不读取真实钱包、不接受 RPC URL，也不部署到测试网或主网。Ganache 原生加速模块不可用时可回退至 JavaScript。

可选：已有匹配的官方 solc 0.8.20 时设置 SOLC_BINARY 为其可执行文件绝对路径；编译脚本用 --standard-json 调用，不借助 shell。默认使用锁定的 solc-js。目标 EVM 为 paris，未使用 transient storage。

实际编译与测试结果见 TEST-RESULTS.txt。编译产物、依赖、缓存不提交 Git；仅保留源码、锁文件和验证记录。

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

仍需独立审计、目标链与精确代币审查、最大人数Gas测量、正式钱包与UI端到端联调、节点故障/重组事件处理及法律意见。没有主网地址、部署脚本或自动签名入口；不得把本地测试通过称为可安全承载真实资金。

官方参考（2026-10-10查阅）：
- Solidity 安全注意事项及 CEI：https://docs.soliditylang.org/en/latest/security-considerations.html
- OpenZeppelin ReentrancyGuard：https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuard
- OpenZeppelin SafeERC20：https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#SafeERC20
- OpenZeppelin MerkleProof：https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography#MerkleProof
