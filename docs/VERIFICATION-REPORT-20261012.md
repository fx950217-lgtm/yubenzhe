# 独立检测报告（2026-10-12 15:10）

> 检测人：阿墨（独立于 Codex）
> 检测对象：`codex/m0-local-test` 分支，基线 `ba4acfa` → 最新 `a117824`
> 检测方式：**实跑**，不是读报告。所有数字都是我在本机重新跑出来的。

---

## 第零节 · 一句话结论

**Codex 这次交付质量很高，8 个批次的东西基本都真做出来了。**
但**有 1 个必须修的问题**（部署目录是旧的），另有 5 个小瑕疵。

---

## 第一节 · 先说最重要的一条 ⚠️

### 🔴 部署目录 `yubenzhe-deploy/public/frontend/` 还是旧的 dev.10

| 项 | 值 |
|---|---|
| `public/frontend/build-info.json` | **`0.14.0-dev.10`**，构建于 10-11 14:21 |
| 当前源码 `tongban/dist` | **`0.14.0-dev.12`**，构建于 10-12 14:54 |
| 里面还有积分代码吗 | **有**（`app.js` 里有积分页面组件、积分流水表） |

**为什么这是问题**：
- 本地预览（`start-m0.mjs`）用 `tongban/dist` → **新的，没问题**
- **正式部署**默认用 `public/frontend` → **会部署旧的 dev.10 界面，积分还在**

**➡️ 部署前必须先跑一次**：
```
cd C:\Users\Administrator\Documents\Codex\2026-10-09\git-2\work\yubenzhe\yubenzhe-deploy
node scripts/stage-frontend.mjs ../tongban/dist
```

---

## 第二节 · 测试结果（我实跑的）

| 测试 | 我跑的结果 | Codex 自己跑的结果 | 判定 |
|---|---|---|---|
| 前端 `tongban/tests/` | **581 / 581 通过** | 581 / 581 | ✅ 一致 |
| 后端 `yubenzhe-deploy/tests/` | 529 / 530 | 530 / 530 | ⚠️ 见下 |
| 桌面端 | （未单跑） | 78 / 78 | ✅ |

### 关于后端那 1 个"失败"

| 项 | 详情 |
|---|---|
| 失败测试 | `real startup rejects unknown, incomplete or short-secret mail configuration…` |
| 报错 | `spawnSync C:\Program Files\nodejs\node.exe EBUSY` |
| 我做了什么 | ① 单独重跑 → 仍 EBUSY ② 换 Codex 自带 node 跑 → 仍 EBUSY |

**这个测试要 `spawnSync` 启一个子进程**，而**本机环境不允许**（EBUSY = 文件被占用/被拦）。

**➡️ 我换了办法直接验证它想验的东西**（手动用错误配置启服务）：

| 场景 | 期望 | 实际 | 判定 |
|---|---|---|---|
| `EMAIL_PROVIDER=unknown` | 启动失败 | `Error: Unsupported EMAIL_PROVIDER.` + exit=1 | ✅ |
| `EMAIL_OTP_SECRET=short` | 启动失败 | `Error: Provider mail requires a persistent EMAIL_OTP_SECRET of at least 32 characters.` | ✅ |
| `EMAIL_ENDPOINT=http://`（明文） | 启动失败 | `Error: Invalid HTTP email configuration.` | ✅ |
| 是否误建数据库 | 不该建 | **目录为空，一个库都没建** | ✅ |

**➡️ 结论：这个测试失败是环境限制，不是代码缺陷。被测行为完全正确。**

---

## 第三节 · 逐批核对（对照终极改版任务书）

### ✅ P0 平台方针（零收费 + 积分删除）

| 检查项 | 结果 |
|---|---|
| 7 个积分文件删除 | ✅ `points.js` / `points.css` / `points.test.mjs` / `points-service.mjs` / 3 个积分测试，**全删** |
| `014-points.sql` | ✅ **保留**（铁律遵守） |
| `023-drop-points.sql` | ✅ 已建，**先归档再删**（`archiveRetiredServiceHistory`），drop 4 表 + 1 索引 |
| 迁移编号 | ✅ **001–025 连续**，`MIGRATIONS` 数组里 023/024/025 都已注册 |
| 前端源码积分残留 | ✅ `tongban/src/` 干净（剩余命中全是测试的**反向断言**，即"确认页面不出现积分"） |

**⚠️ 两处非源码残留**：
| 位置 | 说明 |
|---|---|
| `design/brand-home.html`、`design/ui-preview-cn.html` | 设计稿里还有「购买积分」「算力按积分计费」——**不部署，但建议清掉** |
| `yubenzhe-deploy/public/admin/product-ops.js` | 管理后台还有「服务积分核对」功能（Codex 有意保留为只读核对历史） |

### ✅ R3 三处红线（绝不能误删）

| 文件 | 结果 |
|---|---|
| `workbench-adapters.mjs` 里的 `points`（英文"要点"） | ✅ **完好**（`points:(items.length?items:placeholders)`） |
| `task-payment-verifier.mjs`（链上付款核验） | ✅ **完好** |
| `021-ai-channel.sql` 的 `lease_id`/`lease_until` | ✅ **完好** |

### ✅ P2 钱包多链

- 新增 `chain-registry.js`（链注册表，抽掉写死的 97）✅
- 新增 `wallet-dapp-policy.js`（248 行）+ `wallet-dapp-policy.test.mjs`（312 行）✅
- 新增 `wallet-multichain.test.mjs`（111 行）✅
- `wallet.js` 改动 **165 增 / 109 删**（大改）✅

### ✅ P3 Gas 代付框架

- 新增 `wallet-fee-policy.js`、`server/paymaster-service.mjs`（8693B）✅
- 合约：`EqualDistribution.sol` / `InternalTestToken.sol` **改成链白名单**（各 12 增）✅
- ✅ **`SingleDistribution.sol` 完全未被改动**（`git diff ba4acfa..a117824 -- contracts/src/SingleDistribution.sol` **零输出**），L114 的 `keccak256(abi.encode(block.chainid, address(this), msg.sender, c.campaignId))` 防跨链重放签名域**完好无损**

### ✅ P4 AI 注册表（最关键的一处已解除）

| 检查项 | 结果 |
|---|---|
| **`input.provider!=='Codex'` 硬校验** | ✅ **已解除**，改为 `checkedProviderId(input.provider)` + 白名单正则 `^[a-z][a-z0-9-]{1,23}$` |
| `device-bridge/ai-registry.mjs` | ✅ 已建（7992B） |
| 探测规则可扩展数组 | ✅ `AI_PROVIDER_RULES`，`Promise.all` 并行、**每条独立超时 ≤5000ms** |
| 元数据不外泄 | ✅ 注释明确「Only metadata crosses the relay」，可执行路径不过中继 |

**⚠️ 一个遗留**：`server/ai-channel.mjs:152` 的设备表 `provider` 列**仍写死 `'Codex'`**：
```js
..., state.workspaceLabel, 'Codex', now(), JSON.stringify(state.providers), state.scannedAt
```
（`providers` JSON 列是对的，只有这个单数列是遗留。影响小，但确实是"写死 Codex"的漏项。）

**⚠️ 另一个偏差**：`claude` 和 `workb` 在 catalog 里是 `mode:'disabled'` —— **能探测到、但不能派任务**，只有 `codex`（tools）和 `ollama`（chat-only）可执行。

### ✅ P5 D1 登录提醒

- 新增 `tongban/tests/ai-login-reminders.test.mjs` ✅
- 文案：「这台电脑上的 Codex 需要登录，**请在电脑上完成**」—— **只提醒，不代操作** ✅

### ✅ P6 手机 AI 板块

- 新增 `tongban/src/device-ai-providers.js` + 测试 ✅

### ✅ P7 群聊 + 并发（最难的一批）

| 检查项 | 结果 |
|---|---|
| `task-pool.mjs` 并发池 | ✅ 已建，**`maxConcurrent` 限 1–3**，`active=new Map()` |
| 资源守卫 | ✅ CPU 负载 < 92% 且可用内存 ≥ 8%，否则**排队不报错** |
| 任务目录隔离 | ✅ `isolatedTaskDirectory()`，拒绝符号链接 |
| 双端接入 | ✅ `provider-runner.mjs` 用 `createTaskPool`；`device-bridge/ai-channel.mjs` 改 `active=new Map()` + `maxConcurrent` |
| 不串味 | ✅ 注释明确「never sends Claude/WorkB/Ollama prompts to Codex as a fallback」 |
| 新增迁移 `025-ai-group-chat.sql` | ✅ 26 行 |

**⚠️ 说明**：`codex-runner.mjs:117` 和 `ollama-runner.mjs:53` 里**仍有 `AI_BUSY` 单任务锁** —— 但这是**正确的**：每个 runner 实例只跑一个任务，**并发由上层 pool 管**。

**✅ 结论：P7 改造思路正确，不是漏改。**

---

## 第四节 · 安装包现状

| 端 | 最新包 | 版本 | 说明 |
|---|---|---|---|
| **Windows** ⭐ | `yubenzhe-desktop/dist/yubenzhe-0.14.0-dev.12-windows-x64-setup.exe` | dev.12 | 112,599,334 B，SHA256 `f8a25345…9811c` |
| **Windows** | 同目录 `…dev.12…zip` | dev.12 | 154,206,040 B，SHA256 `11966812…7f508` |
| **Android** | `x20/outputs/native-apps/YBZ-0.14.0-dev.8-android.apk` | **dev.8** | ❌ 落后，不含本轮 |

**⚠️ Codex 自己在 `final-desktop-verification.log` 里诚实标注**：
```
"actualWindowsDeviceTested": false,
"installerRunOnWindows": false,
"actualLocalModelRunOnWindows": false
```
**➡️ 意思是：Windows 包装好了，但没人真机装过。这需要你实测。**

---

## 第五节 · 问题清单（按优先级）

| # | 问题 | 严重度 | 建议 |
|---|---|---|---|
| 1 | `public/frontend/` 是旧 dev.10 构建，**含积分代码** | 🔴 **部署前必修** | 跑 `stage-frontend.mjs` |
| 2 | 设备表 `provider` 列写死 `'Codex'` | 🟡 低 | 可留到下轮 |
| 3 | `claude`/`workb` 只能探测不能执行 | 🟡 中 | 按设计如此，需你确认是否接受 |
| 4 | 管理后台仍有积分核对 | 🟡 低 | Codex 有意保留 |
| 5 | 设计稿 `design/*.html` 有过时积分文案 | 🟢 很低 | 不部署，有空清 |
| 6 | Android 仍是 dev.8 | 🔴 **要手机测必须先打** | 需要你拍板 |

**已复核确认**（原本留的两个悬念，现已查实）：
- ✅ `SingleDistribution.sol` **未被改动**（git diff 零输出），防重放签名域完好
- ✅ Windows dev.12 包产出于 **15:01:44**，`SHA256SUMS.txt` 最后写于 **15:03**，**包在 Codex 收尾之前就完成并校验过**，不是半成品
- ✅ Codex 最近一次文件写入是 **15:03**，之后**已完全停止**（检测时已静默 8 分钟）

---

## 第六节 · 下一步

| 你想干什么 | 发我这句 |
|---|---|
| 修部署目录（**强烈建议先做**） | 「**跑 stage-frontend**」 |
| 打安卓包 | 「**只打安卓包**」 |
| 现在就实测网页版 | 「**打开 18934**」 |
| 让 Codex 修第 2–6 项 | 「**把这几个问题发给 Codex**」 |

---

## 附：检测方法（可复核）

| 检测 | 命令 |
|---|---|
| 前端测试 | `cd tongban && node --test tests/*.test.mjs` |
| 后端测试 | `cd yubenzhe-deploy && node --test tests/*.test.mjs` |
| 迁移链 | `ls migrations/*.sql` |
| 积分残留 | `grep -rn "积分" --include="*.js" --include="*.mjs" .` |
| mail 拒绝行为 | 见第二节手动验证表 |
