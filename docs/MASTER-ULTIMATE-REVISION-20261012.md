# ⭐ 终极改版任务书（一次交付给 Codex）

日期：2026-10-12
基线版本：0.14.0-dev.11
当前 commit：`ba4acfa`
工作分支：`codex/m0-local-test`

---

## 📌 给 Codex 的总说明（先读这段）

**本文件是 2026-10-12 全部决策的汇总，一次交付、按顺序执行、最后输出总验证报告。**

用户原话：

> 「上面有很多，从移除平台积分哪里 上面还有一些我记不清了，然后一起添加进来 做成终极改版我给codex」

**执行纪律（必须遵守）**：

1. **按批次顺序执行**（P0 → P7），**不要跳序**
2. **每批次完成后跑测试并报告**，不要全部做完才测
3. **每批次单独 commit**，message 用英文，说清改了什么
4. **遇到与本文档冲突的旧代码/旧文档 → 以本文档为准**
5. **遇到本文档没写、但你判断需要做的改动 → 先做，但在报告里单独列出「超出范围的决定」**
6. **任何破坏性操作（删文件、删表、改迁移）→ 先列出清单，不要直接执行**
7. **不要动服务器**（详见「红线 R1」）

**当前基线（改动前必须确认）**：

| 项 | 值 |
|---|---|
| 前端测试 | `tongban/tests/` **56 个** `.test.mjs` |
| 后端测试 | `yubenzhe-deploy/tests/` **42 个** `.test.mjs` |
| 迁移文件 | `migrations/` 001–**022** |
| 已通过基线 | 前端 508 / 后端 414 / 电脑版 51 / AI 通道专项 62 |

---

## 📋 批次总览

| 批次 | 内容 | 难度 | 依赖 |
|---|---|---|---|
| **P0** | 平台方针固化（零收费 + 积分删除 + 不做租赁） | 🔴 高（面广） | 无 |
| **P1** | 装机工具包补齐（五类软件清单） | 🟢 低 | 无 |
| **P2** | 钱包：多链 + TP 对标 + 合规硬约束 | 🔴 高 | 无 |
| **P3** | Gas 代付方案落地（ERC-4337） | 🟡 中 | P2 |
| **P4** | AI 注册表（固定端整合所有 AI） | 🟡 中 | 无 |
| **P5** | AI 授权代操作（D1 安全档） | 🟢 低 | P4 |
| **P6** | 手机端 AI 板块（动态生成） | 🟡 中 | P4 |
| **P7** | AI 群聊 + 同机并发 | 🔴 **最高** | P4 + P6 |

**⚠️ P7 是全部任务里最难的，涉及 `seq` / 租约 / `ack` 三机制改造。如果时间紧张，P7 可以单独一轮做。**

---

## 🔴 第零节 · 全局红线（不可违反，所有批次通用）

### R1. 不要动现有服务器

**用户明确指令**：「不要动现在有的三个服务器」

| IP | 用途 | 状态 |
|---|---|---|
| `45.76.163.5` | lovemart 生产（Vultr 新加坡） | ❌ **禁改** |
| `66.42.56.29` | lovemart 相关 | ❌ **禁改** |
| `202.182.103.202` | 待确认 | ❌ **禁改** |
| `106.53.203.33` | 腾讯云国内机 | ❌ **禁改** |
| `45.77.247.167` | 新云机（用户自己配） | ⚠️ **本轮不动**（Codex 只读已批，改动需用户单独授权） |

**禁止**：SSH 登录、重启、改配置、部署、删文件、通过 API 操作。
**如果某操作可能牵连这些机器 → 先停下来问用户。**

### R2. 平台方针（最高优先级，覆盖所有旧代码）

用户原话：**「不做租赁，只做链接。积分删除，平台无任何收费项目。」**

1. **平台零收费**：无购买、无充值、无订阅、无余额、无提现、无套餐、**无价格数字**
2. **积分体系彻底物理删除**：`points.js` / `points-service.mjs` / 4 张积分表 / 相关测试与文案**全删**
3. **AI 任务不计量**：不做预算预留、不做用量结算、不留账本（**原「每完成步骤 10 分」作废**）
4. **设备只做四件事**：连接、远控、AI 任务、文件收发。**不做出租、租赁、卡密、兑换码、租期**

### R3. ⚠️ 三处绝对不能误删

| 文件 | 为什么不能删 |
|---|---|
| `workbench-adapters.mjs` | 里面的 `"points"` 是英文「**要点**」的意思，不是积分 |
| `task-payment-verifier.mjs` | 是**链上付款核验**，与积分无关 |
| `021-ai-channel.sql` 的 `lease_id`/`lease_until` | 是**任务租约**（防同设备并发），**≠ 出租租约** |

### R4. 设备 ≠ 好友（用户反复强调）

用户原话：

> 「设备不能做成"好友" —— 设备会话只有你本人可见，不能进群/朋友圈，服务端强制隔离」

**必须保持**：实测 `PASS device entry is owner-only and creates no friendship`
**不得**引入任何「设备是好友」的逻辑。

### R5. 服务器只转达

**不得**把 AI 对话全文、prompt、文件字节存入数据库。
（providers 元数据、任务状态可以入库）

### R6. 主网/付费资源未授权

主网部署、真实付费、Gas 代付的**实际开启**均未授权。**P3 只做代码和测试，不做真实链上支出。**

---

## 【P0】平台方针固化：零收费 + 积分删除 + 不做租赁

**详细清单**：`docs/POINTS-REMOVAL-INVENTORY-20261012.md`（566 行逐行清单）
**任务书**：`docs/CODEX-TASK-LINKS-ONLY-AND-ZERO-FEE-20261012.md`

### P0.1 关于积分（⚠️ 已有完整清单，照做）

**规模**：66 个文件命中、**8 个可整删**、**26 个需改**、**4 张表**

**8 个可整删的文件**：
```
tongban/src/points.js                              (11 行)
tongban/src/points.css
tongban/tests/points.test.mjs
yubenzhe-deploy/server/points-service.mjs          (32 行)
yubenzhe-deploy/tests/points-service.test.mjs
yubenzhe-deploy/tests/v02-points-http.test.mjs
yubenzhe-deploy/tests/v02-points-query.test.mjs
migrations/014-points.sql                          (30 行) ⚠️ 见下
```

**⚠️ 数据库铁律**：
- ❌ **不得直接删 `014-points.sql`**（会破坏已有库迁移链，旧库 4 张表永久残留）
- ✅ **保留 014 + 新增 `023-drop-points.sql`** 追加到 `social-database.mjs` 的 MIGRATIONS 数组末尾

**后端删除顺序（严格按此序，避免中途出现未定义引用）**：
```
product-modules.mjs → workbench-service.mjs → group-workflows.mjs
→ product-admin.mjs → ui/product-ops.js → 最后删 points-service.mjs
```

**前端删除顺序**：
```
app.js → app-navigation.js → workbench-hub.js → workbench.js
→ social-client.js → 最后删 points.js / points.css
```

**⚠️ 一个易漏的测试**：
`tongban/tests/v02-consumer-boundary.test.mjs:8` 有 `assert.match(app,/mountPoints/)`
—— 这是**产品边界守卫测试**，不是积分测试，删积分会让它失败。**要同步改这个断言。**

### P0.2 三处深度耦合（高风险）

| 位置 | 耦合内容 |
|---|---|
| 任务结算 | `workbench-service.mjs` 约 **40 处**积分引用 |
| 账号注销核销 | 注销流程里有积分核销逻辑 |
| 群协作预算 | `group-workflows.mjs` 有积分预算 |

### P0.3 文案清理（必须做，否则用户会看到已删功能）

**已知需要改的**：`tongban/src/install.html`（**本会话已修 3 处，请复核**）
- 「独立的服务积分」→ 已改为「自己的电脑远控」
- 「工作任务使用内测试用积分」→ 已改为「不计量、不收费」
- 已补「平台零收费，无积分体系」

**同一批要改的还有**：
- `tongban/dist/install.html`（已同步）
- `yubenzhe-deploy/public/frontend/install.html`（已同步）
- 全项目搜 `积分` / `收费` / `充值` / `余额` / `提现` / `套餐` / `购买`，逐一复核

### P0.4 AGENTS.md（本会话已改 8 处，请复核）

已做的改动：
- 新增第 3-14 行方针段（最高优先级）
- 第 19 行：删「收费与」→「主网与生产部署仍未授权」
- 第 23 行：「五 Tab、积分、钱包…」→ 去掉积分
- 第 39 行：删「积分卡」
- 第 43 行：删整条积分卡固定显示句
- 第 45 行：整段重写为「平台零收费、无积分体系」
- 第 50/51 行：删「和积分边界」「积分服务订单」
- 第 62 行：**历史记录，原文不改**，末尾加注
- 第 70 行：「真实收费、Gas 代付和积分兑资产」→「主网、Gas 代付仍关闭」

### P0.5 不做租赁（代码层核对）

**已核实**：租赁/出租/卡密/兑换凭证在代码里 **零命中**
`022-resource-rentals.sql` **从未创建**

→ **本条无代码要改，只需确认**。

### P0 验收标准（12 项）
1. 8 个积分文件全删
2. `023-drop-points.sql` 已加入 MIGRATIONS 数组，且 **014 未被修改**
3. `git diff` 确认 014 字节未变
4. 26 个文件里的积分引用全部清除
5. `v02-consumer-boundary.test.mjs` 的 `mountPoints` 断言已同步
6. 三处深度耦合（任务结算/注销核销/群预算）已处理
7. 全项目搜「积分」「收费」「充值」等词，命中数为 0（历史记录除外）
8. `install.html` 三个副本无过时文案
9. AGENTS.md 8 处改动已生效
10. 三处误删坑（R3）**未被误删**
11. 前端/后端测试全部通过（基线 508/414 会下降，如实报告）
12. **报告里如实说明** 114 张积分表在旧库中的状态

---

## 【P1】装机工具包补齐

**任务书**：`docs/CODEX-TASK-LINKS-ONLY-AND-ZERO-FEE-20261012.md` 第三节

### P1.1 五类必备软件清单

| 类别 | 清单 | 备注要求 |
|---|---|---|
| **邮箱** | Gmail + Outlook + Proton + Zoho | **标注「要不要手机号」** |
| **浏览器** | Chrome / Firefox / Edge | — |
| **社交** | Telegram / WhatsApp / Discord | — |
| **AI 工具** | 按 `P4 AI 注册表` 的探测规则 | 与 P4 联动 |
| **YBZ 必备** | 电脑连接器 + Node.js | — |

### P1.2 ⚠️ 一条不能骗人的限制

**不能做「一键自动安装」按钮。**
原因：ChatGPT、Claude 登录都要过验证码/手机验证，这是它们防机器人，**绕不过去**。
**写了就是骗人。**

### P1 验收标准（3 项）
1. 五类清单已落实到电脑端安装向导
2. 邮箱类标注了「是否需要手机号」
3. **没有**任何「一键自动登录 AI」的虚假承诺

---

## 【P2】钱包：多链 + TP 对标 + 合规硬约束

**任务书**：`docs/WALLET-TP-BENCHMARK-PLAN-20261012.md`
**合规审查**：`docs/WALLET-COMPLIANCE-REVIEW-20261012.md`

### P2.1 现状问题（13 处硬编码 chainId 97）

`tongban/src/wallet.js` 里 `97` 写死在：
```
L50 / L62 / L247 / L282-299 / L348 / L379 / L389 / L434 / L441 / L450 / L495 / L512
```

### P2.2 改造目标：多链

**建议 4 条主流 EVM 主网**：`56`(BSC) / `1`(Ethereum) / `137`(Polygon) / `42161`(Arbitrum)
**保留**：`97`（BSC 测试网）

**⚠️ 但主网开启需要用户单独授权**（见 R6）。**本轮只做代码，不改真实网络配置。**

### P2.3 三个已知设计缺陷

| 缺陷 | 位置 | 问题 |
|---|---|---|
| vault 绑死 chainId 97 | `wallet.js:50/62` | 多链会冲突，**必须改成按链分别存储** |
| 不支持合约地址转账 | `wallet.js:289` | 首版限制，需评估是否放开 |
| type 0 传统交易 | `wallet.js:512` | 非 EIP-1559，多链要评估 |

### P2.4 DApp 浏览器：双红线（安全 + 上架）

**❌ 不要内嵌 WebView**
**✅ 走「白名单列表 + 系统浏览器打开」**

原因（两条都成立）：
- **安全**：WebView 里跑任意 DApp = 任意代码执行风险
- **上架**：Apple 3.1.1 管「绕过内购」，内嵌浏览器是高风险特征

### P2.5 合规硬约束（C1–C14，必须全部遵守）

**本会话新增 3 条**：
- **C12 零收费**：平台无任何收费项目
- **C13 积分删除**：无积分体系
- **C14 只做链接**：设备不做租赁

**关键合规事实（已核实）**：
| 事实 | 出处 |
|---|---|
| Apple 3.1.5(i)：钱包**必须企业账号** | ✅ 官方条款 |
| Apple 3.1.1：不能用加密货币/钱包**解锁功能** | ✅ 官方条款 |
| Apple 3.1.5(v)：**禁止**「邀请返利送币」「完成任务送币」 | ✅ 官方条款 |
| Apple 5.1.1(ix)：crypto **exchange** 须法人实体 | ✅ 官方条款 |
| Google Play：**非托管钱包豁免牌照** | ✅ 官方帮助页 |
| Apple 4.2.7：远控**默认不能连云端主机**（但通用整机不受限） | ✅ 官方条款 |

**⚠️ 三条绝对不能做（会直接踩线上架）**：
- ❌ 用钱包**解锁**任何高级功能
- ❌ 任何形式的**邀请返利送币 / 完成任务送币**
- ❌ Gas 代付包装成**可充值/可购买/可转赠**的东西

### P2 验收标准（8 项）
1. 13 处硬编码 chainId 已抽成网络表
2. vault 按链分别存储
3. 合约地址转账限制已评估并说明
4. DApp 浏览器**没有**内嵌 WebView
5. **有**白名单机制
6. C1–C14 全部落实
7. 三条「绝对不能做」有测试证明未违反
8. **未开启任何主网**（除非用户单独授权）

---

## 【P3】Gas 代付方案落地（ERC-4337）

**方案文档**：`docs/GASLESS-AND-PAYMASTER-PLAN-20261012.md`

### P3.1 现状：完全没有任何代付能力

**证据（自己代码）**：
- `contracts/README.md:137`：「**没有 paymaster/relayer、平台补贴…**」
- `contracts/README.md:139`：「**不能仅改界面就宣称已实现**」
- `tongban/src/wallet.js:298/483`：余额不够付 gas **直接拒绝**
- `wallet.js:512`：`signTransaction({type:0, chainId:97})` —— 纯 EOA 自付

### P3.2 ⚠️ 多链必须先解决的合约硬锁

```solidity
// contracts/src/EqualDistribution.sol:55
if (block.chainid != 97 || ...) revert InvalidConfig();

// contracts/src/InternalTestToken.sol:10
if (block.chainid != 97) revert TestnetOnly();
```

**必须改成构造参数白名单**（不是直接删）。

**⚠️ `SingleDistribution.sol:114` 的 `block.chainid` 签名域绑定是正确的防跨链重放，不许动。**

### P3.3 技术选型：ERC-4337（用户已确认「走成熟标准」+「多链」）

**EntryPoint 全链同地址**：
```
v0.7  0x0000000071727De22E5E9d8BAf0edAc6f37da032   ← 推荐
v0.8  0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
v0.6  0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789   ← 2026 计划弃用
```

**BSC 首选：NodeReal MegaFuel**（官方补贴）
```
主网 56：https://bsc-megafuel.nodereal.io/4337/paymaster
测试网 97：https://bsc-megafuel-testnet.nodereal.io/4337/paymaster
```

**⚠️ MegaFuel 硬限制**：`maxFeePerGas` 1 gwei / 单笔 2,000,000 gas / 授权 600 秒 / 单批 8 笔 / UserOp 存活 10 分钟

### P3.4 ❌ 本轮不做的事（重要）

| 不做 | 原因 |
|---|---|
| **不实际开启代付** | R6：主网/付费资源未授权 |
| **不做路线 C**（平台私钥代发） | 等于托管，合规爆炸 |
| **不做无人值守自动登录** | 见 P5 |

**本轮只做**：代码框架 + 单元测试 + 合约改造（但不部署主网）。

### P3.5 ⚠️ 待用户决策的岔口（先按默认做）

**「Gas 费由谁承担」用户尚未选择。**

**默认走法**：技术按「平台全包」建架构，但**先只开放「创建/首次入场」**，保留随时降级到「只提示」的开关。

**⚠️ 必须有「预算耗尽自动降级」**（提示用户自付），不得直接崩溃。

### P3 验收标准（7 项）
1. `EqualDistribution.sol` 的 `chainId != 97` 改成参数白名单
2. `InternalTestToken.sol` 同上
3. `SingleDistribution.sol:114` **未被改动**
4. 代付代码框架完成 + 有单元测试
5. **预算耗尽降级路径**有测试
6. 风控：白名单 + 限速 + 预算上限 + 70%/90% 告警
7. **未做任何真实链上支出**

---

## 【P4】AI 注册表（固定端整合所有 AI）

**任务书**：`docs/CODEX-TASK-AI-REGISTRY-AND-DELEGATED-AUTH-20261012.md`

### P4.1 🔴 核心问题：「Codex」写死在 7 处

| # | 位置 | 问题 |
|---|---|---|
| 1 | `device-bridge/codex-runner.mjs:18` | `findCodex()` 只找 Codex |
| 2 | `device-bridge/capabilities.mjs:29-30` | 只探测 Codex 登录态 |
| 3 | `device-bridge/ai-channel.mjs:113` | `provider:'Codex'` 写死 |
| 4 | **`server/ai-channel.mjs:97`** | **`input.provider!=='Codex'` 硬校验 → 其他 AI 被 400 拒绝** ⚠️ 最关键 |
| 5 | `server/ai-channel.mjs:44` | `statusView` 写死 |
| 6 | `server/ai-channel.mjs:48` | `sourceLabel` 写死 |
| 7 | `server/ai-channel.mjs:142` | SQL 插入字面量 |

### P4.2 新建 `device-bridge/ai-registry.mjs`

**必须输出**：
```js
{
  providers: [
    {id:'codex',  name:'Codex',  installed:true,  loggedIn:true,  version:'0.153.4', reason:''},
    {id:'claude', name:'Claude', installed:false, loggedIn:null,  version:null,      reason:'本机未检测到。'},
  ],
  scannedAt: 1760000000000
}
```

**探测规则至少 4 条**：`codex` / `claude` / `workb` / `ollama`
**必须做成可扩展数组**（加新 AI 不改逻辑）

### P4.3 探测纪律（⚠️ 必须遵守）

- ✅ 每条**独立超时**（建议 5 秒），一条卡住不拖垮全部
- ✅ 只用 `captureCommand()` 的 `shell:false`，**不执行 .bat/.cmd/脚本**
- ✅ **探测失败 = `installed:false`，绝不猜**
- ✅ **不读任何 AI 的配置/凭据文件**
- ❌ **不做全盘扫描找 exe**

### P4.4 迁移 `024-ai-providers.sql`

```sql
ALTER TABLE ai_channel_devices ADD COLUMN providers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ai_channel_tasks   ADD COLUMN provider  TEXT NOT NULL DEFAULT 'codex';
```
⚠️ **只增不删，不改 022，不加依赖枚举的 CHECK 约束**

### P4.5 安全要求

`providers[].id` **必须走正则白名单**（建议 `^[a-z][a-z0-9-]{1,23}$`），**禁止任意字符串入库**（防注入）

### P4 验收标准（8 项）
1. `ai-registry.mjs` 存在，输出上述结构
2. ≥4 条探测规则，数组可扩展
3. 独立超时，单条失败不影响其他
4. 未装的返回 `installed:false`，不抛异常
5. 不读配置/凭据，不执行脚本，不全盘扫
6. `server/ai-channel.mjs:97` 不再硬校验 `'Codex'`
7. `providers[].id` 白名单校验有测试
8. 迁移 `024` 只增不删

---

## 【P5】AI 授权代操作（只做 D1 安全档）

**⚠️ 只做 D1，不做 D2。**

### P5.1 现状：代码故意不做这件事

`capabilities.mjs:30` 原文：
> 「请从官方来源安装并**由本人登录**。」

### P5.2 D1 安全档（**做这个**）

**能力**：检测到 AI 需登录 → 手机端收到提醒卡片
**文案**：「这台电脑上的 Codex 需要登录，**请在电脑上完成**」
**不代操作，只提醒。**

### P5.3 ❌ D2 代操作档（**本轮不做**）

**原因（必须写进代码注释）**：
- ⚠️ **可能违反 AI 服务条款**（多数 AI 明确禁止自动化登录）
- ⚠️ **后果可能是用户账号被封**
- 这**不是「能不能做」的问题，是「做了用户可能吃亏」**

**D2 如果将来要做，四条硬约束**：确认弹窗不可跳过 / 凭据绝不落盘 / 无人看屏禁止 / 默认关闭可一键关停

### P5 验收标准（3 项）
1. D1 提醒能收到
2. D1 **不代操作**（有测试证明没碰凭据）
3. **D2 未实现**

---

## 【P6】手机端 AI 板块（动态生成）

**任务书**：`docs/CODEX-TASK-AI-REGISTRY-AND-DELEGATED-AUTH-20261012.md` C 块

### P6.1 设备详情页加 AI 板块

在 `tongban/src/personal-devices.js` 里，按 `providers` **动态生成**入口。

### P6.2 ⚠️「没安装的」怎么显示 —— 默认走「标灰」

用户原话「没安装就不匹配」。两种做法：

| 方案 | 说明 |
|---|---|
| 甲：不显示 | 界面最干净 |
| **乙：标灰 + 说明（默认）** | 用户能看到「还差什么」，有引导 |

**➡️ 默认乙，做成开关可切甲。**

### P6.3 备注文案（用户明确要求「要备注」）

| 入口 | 备注 |
|---|---|
| Codex | 电脑上的编码智能体 |
| Claude | 电脑上的对话智能体 |
| WorkB | 电脑上的工作助手 |
| Ollama | 电脑上的本地模型 |
| 未安装 | 「本机未检测到，请在电脑安装后刷新」 |

⚠️ **备注文案必须可配置**

### P6 验收标准（5 项）
1. AI 板块由 `providers` **动态生成**（非写死）
2. 未安装的展示方式可切换（甲/乙）
3. 点入口带对正确的 provider
4. 备注文案可配置
5. **仍走 `ownedDevice()` 鉴权**，另一账号访问 404

---

## 【P7】AI 群聊 + 同机并发（⚠️ 最难）

**任务书**：`docs/CODEX-TASK-AI-GROUP-CHAT-20261012.md`

### P7.1 用户确认的三项决策

| 问题 | 用户选择 |
|---|---|
| AI 之间能否互相看到回复 | **能（会形成讨论）** |
| AI 分布 | **同一台电脑装了多个** |
| 自动回复 | **每轮都要你点一下才继续** ← **关键刹车** |

### P7.2 🔴 核心矛盾：AI 不是账号，进不了群

```sql
-- migrations/003-social.sql:14
sender TEXT NOT NULL REFERENCES accounts(id)   -- ⚠️ 必须是账号
-- migrations/003-social.sql:12
account_id ... REFERENCES accounts(id)          -- ⚠️ 同上
```

**➡️ 走「甲」路线：AI 消息由设备主人代发 + provider 标记**
**显示成「我 · Codex · 我的电脑」**
**✅ 不动核心表，不建影子账号**

### P7.3 并发改造（6 处硬限制）

| # | 位置 | 现在 |
|---|---|---|
| 1 | `codex-runner.mjs:117` | `if(active)throw fail('AI_BUSY',...)` |
| 2 | `codex-runner.mjs:104` | `let active=null` |
| 3 | `codex-runner.mjs:143` | `get busy(){...}` |
| 4 | `device-bridge/ai-channel.mjs:80` | `if(active)throw fail('AI_RELAY_RESPONSE',...)` |
| 5 | `ai-channel.mjs:84` | 单个 `active` 对象 |
| 6 | `ai-channel.mjs:113` | 单状态上报 |

**改造方向**：`active=null` → `active=new Map()`，**上限 3（可配置）**，满了**排队不报错**

### P7.4 ⚠️ 最难的三处（改错会消息错乱/丢失/重复）

| 机制 | 现在 | 必须改成 |
|---|---|---|
| **`seq`** | 全局递增 | **按任务独立递增** |
| **`leaseUntil`** | 单个 | **按任务独立** |
| **`ack`** | 单个序号 | **按任务独立** |

### P7.5 防循环四道兜底（即使用户手动模式也要有）

1. 轮数上限（默认 10，可配）
2. 总时长上限（建议 30 分钟）
3. 相同内容重复检测
4. 用户离开页面/断网 → 自动停

### P7.6 ⚠️ 新边界问题

**用户电脑上有文件/项目/凭据。AI 在有别人的群里发言 = 可能泄露电脑信息。**

**➡️ 建议：有好友的群默认禁止 AI 发言，需显式开启。**

### P7.7 迁移 `025-ai-group-chat.sql`

```sql
ALTER TABLE messages ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN device_id TEXT;
-- 群设置加 allow_device_ai
```
⚠️ 只增不删

### P7 验收标准（10 项）
1. AI 消息 `sender` 是**本人账号**（不伪造）
2. **未**给 AI 建 accounts 记录
3. **有**轮数上限（10）
4. **有**总时长上限
5. 单机并发上限 3，满了排队
6. `seq`/`leaseUntil`/`ack` **按任务隔离**（有测试）
7. 有好友的群**默认禁止** AI 发言
8. **有**「一键停全部」按钮
9. 现有「设备仅本人可见」仍通过
10. AI 群消息**不进**朋友圈/搜索/好友推荐

---

## 🗄️ 迁移编号总表（⚠️ 严禁撞号）

**已核实**：`migrations/` 当前到 `022`，`023` 尚未被文件占用。

| 编号 | 文件 | 所属批次 |
|---|---|---|
| `023` | `023-drop-points.sql` | P0 |
| `024` | `024-ai-providers.sql` | P4 |
| `025` | `025-ai-group-chat.sql` | P7 |

**⚠️ 迁移运行器要求 version 连续**（`social-database.mjs:14-15`），**跳号会失败**。
**⚠️ 每加一个都要先检查 MIGRATIONS 数组里前一个是否已存在。**

---

## 📊 最终交付要求

### 必须产出

1. **改动文件完整清单**（含增删改三类，标出行数变化）
2. **每个批次的测试结果**（通过/失败数）
3. **测试基线变化报告**（前端从 508、后端从 414，各变成多少）
4. **迁移编号实际使用表**（确认 023/024/025 未撞号）
5. **⚠️ 超出范围的决定**单独列出（本文档没写但你做了判断的）
6. **未完成项**如实列出（不要谎报完成）
7. **每个批次一个 commit**

### 禁止事项（再强调）

- ❌ 不许动服务器（R1）
- ❌ 不许误删 R3 三处
- ❌ 不许直接删 `014-points.sql`
- ❌ 不许开启主网/真实付费
- ❌ 不许实现 D2 代操作档
- ❌ 不许把 AI 做成好友
- ❌ 不许把对话内容入库
- ❌ 不许「写了没测」就报完成

### 诚实标注要求（延续本项目习惯）

- 明确区分「✅ 官方查实」和「⚠️ 第三方/推测」
- 查不到的就说查不到，**不要编**
- **不能把 CLI 正常结束等同于交付成功**

---

## 🔢 执行顺序建议

```
P0 (积分删除)     ← 面最广，先做，之后所有批次都受益
    ↓
P1 (装机包)        ← 简单，穿插做
    ↓
P4 (AI 注册表)     ← 后续 P5/P6/P7 都依赖它
    ↓
P5 (D1 提醒)       ← 依赖 P4
    ↓
P6 (手机 AI 板块)  ← 依赖 P4
    ↓
P2 (钱包多链)      ← 独立
    ↓
P3 (Gas 代付)      ← 依赖 P2 的链改造
    ↓
P7 (AI 群聊并发)   ← 最难，最后做，可单独一轮
```

**⚠️ 如果用户想分批交付：建议 P0+P1 先交，然后 P4+P5+P6，然后 P2+P3，最后 P7。**

---

## 附：本任务书引用的全部文档

| 文档 | 内容 |
|---|---|
| `docs/POINTS-REMOVAL-INVENTORY-20261012.md` | 积分删除逐行清单（566 行） |
| `docs/CODEX-TASK-LINKS-ONLY-AND-ZERO-FEE-20261012.md` | P0 任务书 |
| `docs/WALLET-TP-BENCHMARK-PLAN-20261012.md` | P2 钱包方案 |
| `docs/WALLET-COMPLIANCE-REVIEW-20261012.md` | P2 合规审查（C1–C14） |
| `docs/GASLESS-AND-PAYMASTER-PLAN-20261012.md` | P3 Gas 代付方案 |
| `docs/CODEX-TASK-AI-REGISTRY-AND-DELEGATED-AUTH-20261012.md` | P4/P5/P6 任务书 |
| `docs/CODEX-TASK-AI-GROUP-CHAT-20261012.md` | P7 任务书 |
| `docs/MACHINE-CODE-PAIRING-STATUS-20261012.md` | 机器码配对现状（已完成，供参考） |
| `docs/YBZ-DESKTOP-DEVICE-CODE-ACCEPTANCE-20261012.txt` | dev.11 验收报告 |
| `AGENTS.md` | 项目约定（本会话已改 8 处） |
