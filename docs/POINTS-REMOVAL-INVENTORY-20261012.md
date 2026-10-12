# 积分子系统（points）完整依赖盘点 — 彻底物理删除清单

- 项目根目录：`C:/Users/Administrator/Documents/Codex/2026-10-09/git-2/work/yubenzhe`
- 盘点日期：2026-10-12
- 目的：为「积分功能彻底物理删除」提供可执行的删除清单
- 方法：Grep 只读搜索，关键词覆盖 `points` / `POINT` / `积分` / `points_accounts` / `points_transactions` / `points_entries` / `points_reservations` / `getPointsAccount` / `getPointsLedger` / `createPointsService` / `formatPoints` / `mountPoints` / `service-reserve` / `task-reserve` / `local-trial` 及大小写变体；已排除 `node_modules` / `dist` / `build`
- 所有路径均为相对项目根目录形式
- 行号来自当前工作区快照，删除前请复核

---

## 0. 结论速览

积分不是「一个独立页面」，而是**穿透前端工作台、后端任务结算、账号注销核销、管理后台、数据库迁移**的一整条链路。核心耦合点是：

1. **任务结算（workbench）**：积分是文件任务的唯一计费单位（`billing_unit='POINT'`），任务执行 3 步各扣 10 POINT。删除积分 = 删除工作台任务计费，必须同时决定「工作台任务是否保留、如何计费」。
2. **账号注销核销**：注销账号时 `points.closeAccount()` 会烧掉剩余积分；`beforeDeleteAccount` 里还有 `points.hasReservations()` 阻断。删积分必须改这两处，否则注销流程报错或悬挂。
3. **群协作（group-workflows）**：群协作任务的执行依赖工作台积分预算（`budgetPoints` / `acceptPoints`）。删积分必须同时改群协作的批准逻辑。
4. **管理后台（product-admin / product-ops）**：运营后台有独立的「服务积分核对」只读视图。
5. **数据库**：`014-points.sql` 建 4 张积分表 + 给 `workbench_tasks` 加 7 个 points 列；`015-retire-platform-assets.sql` **不涉及**积分表。

**⚠️ 最高风险：不存在「只删积分文件」这条路。** 任务结算、群协作、账号注销三处都与积分深度耦合。详见第 5 节。

---

## 1. 核心文件清单（可直接删除的）

### 1.1 整个文件只服务积分 → 可整文件删除

| 文件（相对路径） | 行数 | 作用 |
|---|---|---|
| `tongban/src/points.js` | 11 | 积分页面组件，导出 `mountPoints` / `formatPoints`。整文件仅服务积分 |
| `tongban/src/points.css` | 1 | 积分页面样式（`.points-page` 等）。整文件仅服务积分 |
| `tongban/tests/points.test.mjs` | 19 | 前端积分组件测试。整文件仅服务积分 |
| `yubenzhe-deploy/server/points-service.mjs` | 32 | 积分服务核心（账户/流水/预留/结算/核销）。整文件仅服务积分 |
| `yubenzhe-deploy/tests/points-service.test.mjs` | 43 | 后端积分服务测试（含工作台经积分结算的端到端）。整文件仅服务积分 |
| `yubenzhe-deploy/tests/v02-points-http.test.mjs` | 55 | 积分 HTTP 生命周期测试。整文件仅服务积分 |
| `yubenzhe-deploy/tests/v02-points-query.test.mjs` | 6 | 积分分页查询测试。整文件仅服务积分 |
| `yubenzhe-deploy/migrations/014-points.sql` | 30 | 建 4 张积分表 + 给 workbench_tasks 加 7 列。整文件仅服务积分（见第 4 节处置建议） |

### 1.2 文件里只有部分代码是积分相关 → **不能整删，需改代码**

| 文件（相对路径） | 行数 | 积分相关部分 |
|---|---|---|
| `tongban/src/app.js` | 272 | import / 路由 / 导航 / 返回逻辑中有积分分支（见 2.1） |
| `tongban/src/app-navigation.js` | 68 | 路由映射 + 父子视图判定有 `points` 分支（见 2.2） |
| `tongban/src/mine.js` | 238 | 帮助文案 + `mine` 点击分发有 `points`（见 2.3） |
| `tongban/src/bill-center.js` | 35 | 账单中心一处文案提到「独立积分页面」（见 2.4） |
| `tongban/src/workbench.js` | 228 | 大量 `isPoints` / `pointsValue` / 预算逻辑（见 2.5） |
| `tongban/src/workbench-hub.js` | 90 | 工作台首页积分卡片 + `onPoints` 回调（见 2.6） |
| `tongban/src/social-client.js` | 143 | API client 的 `getPointsAccount` / `getPointsLedger`（见 2.11） |
| `tongban/src/group-workflows.js` | 56 | 群协作批准积分预算（见 2.9） |
| `tongban/src/distribution-preview.js` | 23 | 分发预览文案「不扣积分」 |
| `tongban/src/discover-community.js` | 49 | 赏金/榜单文案「不使用积分」（见 2.10） |
| `tongban/src/account-access-ui.js` | 22 | ⚠️ 见 2.7：**未发现真正积分代码**（详见说明） |
| `tongban/src/ai-workspace.js` | 163 | 云端申请文案「不扣积分」（见 2.8） |
| `tongban/src/install.html` | 4 | 安装页文案「独立的服务积分」 |
| `tongban/src/theme-skins.css` | 494 | `.points-*` 皮肤样式（见 2.12） |
| `tongban/src/workbench-hub.css` | 8 | `.wh-points-card` / `.wh-points-number` 样式 |
| `yubenzhe-deploy/server/workbench-service.mjs` | 224 | 积分计费与结算核心逻辑（见 2.16） |
| `yubenzhe-deploy/server/product-modules.mjs` | 64 | 装配积分服务 + 路由分发 + 注销钩子（见 2.15） |
| `yubenzhe-deploy/server/product-admin.mjs` | 93 | 运营后台积分只读视图（见 2.18） |
| `yubenzhe-deploy/server/group-workflows.mjs` | 282 | 群协作积分预算（见 2.19） |
| `yubenzhe-deploy/server/retire-platform-assets.mjs` | 22 | 归档说明文案含 POINT |
| `yubenzhe-deploy/server/workbench-adapters.mjs` | 157 | ⚠️ 见 2.14：仅英文单词 "points"（要点），**非积分** |
| `yubenzhe-deploy/server/ai-provider.mjs` | 115 | 系统提示词含「服务积分」字样 |
| `yubenzhe-deploy/server/ai-service.mjs` | 151 | ⚠️ 见 2.20：未发现真正积分代码（提示词类） |
| `yubenzhe-deploy/server/social-database.mjs` | 19 | 迁移清单包含 `014-points.sql`（见 4.3） |
| `yubenzhe-deploy/ui/product-ops.js` | 48 | 管理后台 UI 的积分分区（见 2.21） |

> 说明：上表"行数"为**实测物理行数**（`awk 'END{print NR}'`，2026-10-12 复核）。该项目 `tongban/src/` 大量使用**单行压缩写法**（一个逻辑块压在一行内），因此"物理行数"很小，但单行可达数百字符——**不能以行数衡量改动量**，请以第 2 节的引用点条数为准（如 `workbench.js` 仅 228 行但含约 22 处积分引用）。1.1 表行数为精确值，已逐文件核对。

---

## 2. 引用点清单（需要改代码、不能直接删文件）

**这是最重要的部分。** 每条给出 `文件路径:行号` + 原文（截断 120 字符）+ 处理建议。

### 2.1 `tongban/src/app.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/app.js:32` | `import { mountPoints } from './points.js';` | 删除该 import 行 |
| `tongban/src/app.js:73` | `if(['messages','contacts','mine','workbench','points'].includes(currentView)&&!socialClient.getProfile())...` | 从数组删除 `'points'` |
| `tongban/src/app.js:75` | `else if(currentView==='points')socialCleanup=mountPoints(page,{client:socialClient,onNavigate:navigate});` | 删除该整行分支 |
| `tongban/src/app.js:81` | `...onShare:file=>navigate('discover',...),onPoints:()=>navigate('points'),onAccount:()=>navigate('mine'),...` | 从传给 `mountWorkbenchHub` 的对象中删除 `onPoints:()=>navigate('points'),` 片段 |
| `tongban/src/app.js:191` | `...<div class="notice warn">积分不可转让、不可提现，仅可用于消耗站内服务。</div>...` | 从 `noticeModal()` 模板删除该 `<div class="notice warn">…积分…</div>` 片段 |
| `tongban/src/app.js:214` | `if(currentView==='points'){navigate('workbench');return true}` | 删除该行（`androidBack()` 中的积分返回分支） |

> 注：`app.js:81` 与 `:191` 是超长行，删除的是行内片段而非整行。`app.js:214` 若删除后需确认 `workbench` 兜底分支（:215）仍覆盖。

### 2.2 `tongban/src/app-navigation.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/app-navigation.js:8` | `export const isAppView = view => MAIN_NAV.some(...)||view==='contacts'||view==='bills'||view==='points';` | 删除行尾 `||view==='points'` |
| `tongban/src/app-navigation.js:30` | `if(view==='points')return '#workbench/points';` | 删除该行 |
| `tongban/src/app-navigation.js:47` | `if(['mine/points','workbench/points'].includes(value))return {view:'points',options:{}};` | 删除该行（hash → view 映射） |
| `tongban/src/app-navigation.js:65` | `if(parent==='points')return 'workbench';` | 删除该行（父子激活判定） |

### 2.3 `tongban/src/mine.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/mine.js:86` | `...新任务使用独立试用积分；确认前可查看预算，用量和退回积分均有记录。...` | 修改 FAQ 文案，删除积分相关表述 |
| `tongban/src/mine.js:90` | `<details><summary>积分可以用来做什么？</summary><p>POINT 仅用于消耗站内 AI 与平台服务...</p></details>` | 删除整个 `<details>…积分…</details>` 条目 |
| `tongban/src/mine.js:139` | `if (name === 'points') { onNavigate('points'); return; }` | 删除该行（`mine` 点击分发） |

### 2.4 `tongban/src/bill-center.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/bill-center.js:25` | `...仅展示当前设备发起的链上交易，完整收支请查看区块浏览器。积分用量在独立积分页面查看。...` | 删除文案中「积分用量在独立积分页面查看。」一句 |

### 2.5 `tongban/src/workbench.js`（积分深度耦合，改动量大）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/workbench.js:7` | `const isPoints=task=>task?.billingUnit==='POINT';` | 删除（或改为恒 false）。所有 `isPoints(...)` 引用需一并清理 |
| `tongban/src/workbench.js:8` | `const pointsValue=v=>typeof v==='string'&&...?'未提供';` | 删除函数 |
| `tongban/src/workbench.js:9` | `const taskBudget=t=>isPoints(t)?String(t.budgetPoints||'100'):money(t.budgetMicro);` | 删除（预算显示改用 micro 单一路径或彻底移除） |
| `tongban/src/workbench.js:11` | `if(isPoints(task)){const r=task.plan?.estimatedPointsRange;...}` | 删除 isPoints 分支 |
| `tongban/src/workbench.js:17` | `const priceVersion=task=>{const value=isPoints(task)?task.pointsPriceVersion:task.priceVersion;...};` | 删除 isPoints 分支 |
| `tongban/src/workbench.js:29` | `function pointsBudget(value){...throw Error('请输入 1–1000 的整数积分预算。');...}` | 删除函数（预算改回 micro） |
| `tongban/src/workbench.js:74` | `...先看计划，再确认积分预算。只有确认后才预留积分，未用部分会退回；积分仅用于站内服务。...` | 修改文案 |
| `tongban/src/workbench.js:106` | `...+(isPoints(task)?'以下来自任务执行记录…以本次积分账单为准。':'以下来自任务执行记录…')+` | 删除 isPoints 三元，保留 micro 文案 |
| `tongban/src/workbench.js:107` | （超长行，含 points 相关渲染） | ⚠️ 待确认：需整行复核后按 isPoints 分支处理 |
| `tongban/src/workbench.js:111` | `const points=isPoints(t),editable=points&&['awaiting-confirmation',...].includes(t.status),...` | 删除 `points` 变量并改 `editable` 判定 |
| `tongban/src/workbench.js:117` | `...(points&&!final(t.status)&&!awaiting?...:'')+` | 删除 `points&&` 条件 |
| `tongban/src/workbench.js:123` | `...已记录用量以积分账单为准。...` | 修改文案 |
| `tongban/src/workbench.js:127` | （超长行，含 points 分支） | ⚠️ 待确认：需整行复核 |
| `tongban/src/workbench.js:128` | `if(!points)body+='<p class="wb-plan-notice">这是历史本地试用任务，仅保留旧记录，不转换积分。可按这个目标新建积分任务。</p>';` | 删除该行 |
| `tongban/src/workbench.js:129` | （超长行，含 points 分支） | ⚠️ 待确认：需整行复核 |
| `tongban/src/workbench.js:130` | `if(points&&!awaiting&&!final(t.status))body+='<div class="wb-actions">'+...` | 删除 `points&&` 条件 |
| `tongban/src/workbench.js:132` | （超长行，含 points 分支） | ⚠️ 待确认：需整行复核 |
| `tongban/src/workbench.js:135` | `...(points&&!final(t.status)?button('cancel-request','取消任务'):'')+(!points||final(t.status)?button('reuse',...):'')` | 删除 points 条件，简化为 micro 分支 |
| `tongban/src/workbench.js:185` | `if(!isPoints(selected))throw Error('历史试用任务不可继续扣费，请按目标新建积分任务。');` | 删除该校验 |
| `tongban/src/workbench.js:187` | `...Object.assign(input,{approvalId:a.id,approvalAction:a.action,budgetPoints:pointsBudget(...),acceptPoints:true});` | 删除 `budgetPoints` / `acceptPoints` 字段 |
| `tongban/src/workbench.js:214` | `const value=await post('plan',{goal:...,fileIds:...,locale:'zh-CN',budgetPoints:pointsBudget(draft.budget)});planNotice=value.plan;` | 改回 `budgetMicro`（或删除 budget 字段） |
| `tongban/src/workbench.js:218` | `if(!isPoints(selected))throw Error('历史试用任务不可继续执行，请新建积分任务。');` | 删除该校验 |
| `tongban/src/workbench.js:219` | （超长行，含 points 分支） | ⚠️ 待确认：需整行复核 |
| `tongban/src/workbench.js:221` | `selected=(await post('tasks/'+selected.id+'/budget-request',{version:selected.version,budgetPoints:pointsBudget(...),acceptPoints:true})).task;` | 改回 micro 字段 |

> ⚠️ **`workbench.js` 是前端改动最重的文件**（约 22 处）。若不重新设计「工作台计费」，此处删除后工作台任务将失去预算/进度/审批 UI。

### 2.6 `tongban/src/workbench-hub.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/workbench-hub.js:16` | `const pointNumber=value=>BigInt(value).toLocaleString('en-US');` | 删除函数 |
| `tongban/src/workbench-hub.js:17` | `export function mountWorkbenchHub(root,{client,toast=()=>{},onAccount=()=>{},...,onPoints=()=>{},onCollaborate=()=>{},...}={}){` | 删除参数 `onPoints=()=>{},` |
| `tongban/src/workbench-hub.js:26` | `let summaryEpoch=0,summaryBusy=false,pointsState='idle',activityState='idle',pointsAccount=null,recentTasks=[];` | 删除 `pointsState` / `pointsAccount` 变量 |
| `tongban/src/workbench-hub.js:27` | （icons 对象，含 `points:'<path .../>'` 图标定义） | 删除 icons 里的 `points:` 键 |
| `tongban/src/workbench-hub.js:32` | `const ready=pointsState==='ready';` | 删除 |
| `tongban/src/workbench-hub.js:33` | `const pointHint=pointsState==='loading'||pointsState==='idle'?'正在读取积分…':...` | 删除 |
| `tongban/src/workbench-hub.js:36` | （超长行，含积分卡片 `wh-points-card` 渲染） | ⚠️ 待确认：删除积分卡片整个 section 片段 |
| `tongban/src/workbench-hub.js:40` | `if(!owner){pointsState='signed-out';activityState='signed-out';...}` | 删除 `pointsState='signed-out';` |
| `tongban/src/workbench-hub.js:41` | `const turn=++summaryEpoch;summaryBusy=true;pointsState='loading';activityState='loading';...` | 删除 `pointsState='loading';` |
| `tongban/src/workbench-hub.js:42` | `const results=await Promise.allSettled([Promise.resolve().then(()=>{...return client.getPointsAccount();}),Promise.resolve().then(()=>{...return client.authenticatedRequest('workbench/tasks');})]);` | 删除第一个 `getPointsAccount()` Promise（保留 tasks） |
| `tongban/src/workbench-hub.js:45` | `if(account?.unit==='POINT'&&account.nonTransferable===true&&...){pointsAccount=account;pointsState='ready';}else{...}` | 删除整行积分校验 |
| `tongban/src/workbench-hub.js:67` | （超长行，含「复制模板不扣积分」文案） | 删除文案中积分表述 |
| `tongban/src/workbench-hub.js:68` | （超长行，含「执行前确认 POINT 预算，未用积分退回」文案） | 删除积分表述 |
| `tongban/src/workbench-hub.js:80` | `if(action==='points'){onPoints();return;}if(action==='chat-entry'){...}` | 删除 `if(action==='points'){onPoints();return;}` 片段 |

### 2.7 `tongban/src/account-access-ui.js`

- 搜索结果：Grep 显示 `account-access-ui.js:10` 命中，但复查（区分大小写）**未发现真正的 `point` 相关标识符**。命中来自超长行中的子串噪声（如 "endpoint" 等）。
- 处理建议：**无需改动**。⚠️ 若后续用更宽松的大小写搜索仍命中，请以第 10 行超长行逐字符复核。

### 2.8 `tongban/src/ai-workspace.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/ai-workspace.js:84` | `...申请过程不扣积分，不代表服务已开通。...` | 删除/改写积分文案 |
| `tongban/src/ai-workspace.js:95` | `...· 验收期间不扣积分...` | 删除/改写积分文案 |
| `tongban/src/ai-workspace.js:115` | （第 115 行命中，实际为本地 AI 配置导出文案，未见积分字样）| ⚠️ 待确认：命中疑似来自其他匹配，复核实为无积分 |

### 2.9 `tongban/src/group-workflows.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/group-workflows.js:32` | `...<label>本次最高积分预算<input name="budget" type="number" min="1" max="1000"...>...` | 删除积分预算表单及「积分不可转让」提示 |
| `tongban/src/group-workflows.js:51` | `...adopt(await post('approve',{version:...,proposalDigest:...,budgetPoints:String(data.get('budget')||budget),acceptPoints:true}));...` | 删除 `budgetPoints` / `acceptPoints` 字段 |

> ⚠️ 群协作与积分预算强耦合，删除后群协作批准流程需重新设计。

### 2.10 `tongban/src/distribution-preview.js` / `discover-community.js`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/distribution-preview.js:7` | `...当前不会签名、扣除积分或增加链上资产。...` | 删除「扣除积分」表述 |
| `tongban/src/distribution-preview.js:13` | `...无主网、随机分发、代付或积分兑换。...` | 删除「积分兑换」表述 |
| `tongban/src/discover-community.js:34` | `...合作完成不代表已付款，不使用积分或模拟资产结算。...` | 删除「或积分」表述 |
| `tongban/src/discover-community.js:36` | `...不读取或展示钱包资产、积分数量或趣味币数量。...` | 删除「积分数量」表述 |

### 2.11 `tongban/src/social-client.js`（前端 API client）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/social-client.js:98` | `getPointsAccount:()=>request('points/account'),` | 删除该方法 |
| `tongban/src/social-client.js:99` | `getPointsLedger:({cursor}={})=>request('points/ledger'+(cursor?'?cursor='+encodeURIComponent(cursor):'')),` | 删除该方法 |

### 2.12 `tongban/src/theme-skins.css` / `workbench-hub.css`（样式）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/theme-skins.css:413` | `...`.points-overview strong,.points-ledger>article>span,...{font-family:var(--font-number);...}`` | 从选择器组删除 `.points-*` |
| `tongban/src/theme-skins.css:428` | `.section-head h2,.points-page>h3,.wh-section h2,...{font-size:12.5px;...}` | 从选择器组删除 `.points-page>h3` |
| `tongban/src/theme-skins.css:446` | `.points-overview{border-radius:var(--radius-l);background:var(--ink);color:#fff;padding:24px}` | 删除该 CSS 规则 |
| `tongban/src/theme-skins.css:447` | `.points-overview strong{color:#fff;font-size:34px}` | 删除 |
| `tongban/src/theme-skins.css:448` | `.points-rules,.wallet-custody-notice{...}` | 从选择器组删除 `.points-rules` |
| `tongban/src/theme-skins.css:449` | `.points-page,.bill-page{color:var(--text)}` | 从选择器组删除 `.points-page` |
| `tongban/src/theme-skins.css:467` | `.points-overview>span,.points-overview p{color:var(--hero-muted)}` | 删除 |
| `tongban/src/theme-skins.css:478` | `.points-page{background:transparent}` | 删除 |
| `tongban/src/theme-skins.css:479` | `.points-overview{margin:18px 0 12px}` | 删除 |
| `tongban/src/workbench-hub.css:6/8` | `.wh-points-card{...}` / `.wh-points-number{...}` / `.wh-points-label{...}` | 删除 `.wh-points-*` 规则（在第 6、8 行的超长行内，按片段删） |

### 2.13 `yubenzhe-deploy/server/server.mjs`

- Grep（`points`/`POINT`/`createPointsService`）命中 `server.mjs:18`，但复查为 `gatePage` 模板 HTML 中的子串噪声，**未见真正的积分路由注册或 handler**。
- 后端积分路由注册实际在 **`product-modules.mjs`**（见 2.15）。
- 处理建议：**`server.mjs` 无需改动**。⚠️ 若已有其他分支改动，请复核第 18 行超长模板行。

### 2.14 `yubenzhe-deploy/server/workbench-adapters.mjs`

- 命中均为英文单词 **"points"**（意为"要点/条目"），如：
  - `:52` `['read','核对目标与要点','Review goal and requested points']`
  - `:66` `/\bkey points\b/`
  - `:77` `return {points:(items.length?items:placeholders).slice(0,20),...}`
  - `:82` `const extracted=goalItems(text,locale),points=extracted.points.map(markdownText);`
- 处理建议：**不是积分**，**无需改动**。

### 2.15 `yubenzhe-deploy/server/product-modules.mjs`（后端装配中枢）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `yubenzhe-deploy/server/product-modules.mjs:7` | `import {createPointsService} from './points-service.mjs';` | 删除 import |
| `yubenzhe-deploy/server/product-modules.mjs:20` | `let points,community,workbench,desktop,devices,groupWorkflows,aiChannel,aiChannelFiles;` | 从声明删除 `points,` |
| `yubenzhe-deploy/server/product-modules.mjs:30` | `if(points.hasReservations?.(account.id))fail(409,'POINTS_PENDING','请先结束仍占用积分的服务订单。');` | 删除该行（`beforeDeleteAccount` 钩子） |
| `yubenzhe-deploy/server/product-modules.mjs:33` | `deleteAccountData:account=>{...points.closeAccount?.(account.id,{withinTransaction:true});}` | 删除 `points.closeAccount?.(...)` 片段 |
| `yubenzhe-deploy/server/product-modules.mjs:39` | `points=createPointsService({database,socialService:social,enabled:testServices,now});` | 删除该行 |
| `yubenzhe-deploy/server/product-modules.mjs:42` | `workbench=createWorkbenchService({...,pointsService:points,...});` | 删除 `pointsService:points,` 参数 |
| `yubenzhe-deploy/server/product-modules.mjs:54` | `if(path.startsWith('points/'))return points.handle(request);` | 删除该路由分发行 |
| `yubenzhe-deploy/server/product-modules.mjs:55` | `if(path==='chain-gifts/capabilities'){...featureScope:'social-distribution-and-point-campaigns',...pointsRedemption:false,...}` | 删除/改写积分相关字段与文案 |
| `yubenzhe-deploy/server/product-modules.mjs:56` | `if(path.startsWith('chain-gifts/')||path.startsWith('point-campaigns/')){...fail(503,...,'...不会扣积分...');}` | 删除 `point-campaigns/` 分支或改写文案 |
| `yubenzhe-deploy/server/product-modules.mjs:63` | `return {social,points,community,workbench,...};` | 从返回对象删除 `points,` |
| `yubenzhe-deploy/server/product-modules.mjs:51` | `...platform-fee...积分仅用于平台服务。`（平台资产移除文案） | 改写文案（如保留） |

### 2.16 `yubenzhe-deploy/server/workbench-service.mjs`（后端结算核心）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `workbench-service.mjs:4` | `const POINT_STEP=10n,POINT_PRICE_VERSION='local-points-v1';` | 删除常量 |
| `workbench-service.mjs:5` | `const pointAmount=value=>{...fail(400,'POINTS_BUDGET_INVALID','积分预算须为 1–1000 的整数。');...};` | 删除函数 |
| `workbench-service.mjs:6` | `const pointTask=task=>task.billing_unit==='POINT';` | 删除（或恒 false） |
| `workbench-service.mjs:12` | `export function createWorkbenchService({database,socialService,enabled=false,now=Date.now,processor=processLocalFiles,pointsService=null,desktopCapabilities=null}={}){` | 删除参数 `pointsService=null,` |
| `workbench-service.mjs:18` | （view 里 `...(pointTask(task)?{estimatedPoints:...}:{})` 展开） | 删除 pointTask 分支 |
| `workbench-service.mjs:22` | `function pointPlan(plan,spent='0'){if(pointsService&&plan.status==='ready'){...billingUnit:'POINT',...}return plan;}` | 删除函数或改为直返 plan |
| `workbench-service.mjs:23` | `...plan=pointPlan(planGoal(...));...` | 改为 `planGoal(...)` |
| `workbench-service.mjs:24` | `const budget=pointsService?pointAmount(input.budgetPoints??'100'):amount(input.budgetMicro??'100000');...` | 改为仅走 micro 分支 |
| `workbench-service.mjs:26` | （newPlan INSERT 后 `if(pointsService)run("UPDATE workbench_tasks SET billing_unit='POINT',estimated_points=?...`） | 删除 pointsService 分支 |
| `workbench-service.mjs:30-49` | `function settle(task,status,error=null){ ... if(pointTask(task)){ ... pointsService.settle({...}) ... } ... }` | 整段删除 pointTask 分支，仅保留 micro 结算 |
| `workbench-service.mjs:32` | `// Only completed, confirmed steps can consume points. Failed processing refunds all.` | 删除注释 |
| `workbench-service.mjs:35` | `if(!pointsService)throw Error('Points service required for POINT task');` | 删除 |
| `workbench-service.mjs:37` | `const result=pointsService.settle({owner:task.owner_id,resourceId:task.id,spent:total.toString(),requestId:'workbench-settle:'+task.id});` | 删除（积分结算调用） |
| `workbench-service.mjs:45` | `...pointTask(task)?'local-points':'platform-trial'...` | 改为固定 `'platform-trial'` |
| `workbench-service.mjs:46` | `...pointTask(task)?'0':total.toString(),...pointTask(task)?'0':released.toString(),...` | 删除 pointTask 分支 |
| `workbench-service.mjs:48` | `event(task,status,pointTask(task)?{spentPoints:...}:{settledMicro:...});` | 删除 pointTask 分支 |
| `workbench-service.mjs:54` | `...WHERE ... (reserved_micro<>'0' OR reserved_points<>'0' OR cost_micro<>'0')...` | 删除 `reserved_points` 条件 |
| `workbench-service.mjs:59` | `if(pointTask(task)?BigInt(task.spent_points)+POINT_STEP>...:priceMicro(...)>...){...}` | 删除 pointTask 分支 |
| `workbench-service.mjs:62` | `if(pointTask(task))run('UPDATE workbench_tasks SET spent_points=? WHERE id=?',...);` | 删除 |
| `workbench-service.mjs:63` | `event(task,'step-completed',{...pointTask(task)?{points:POINT_STEP.toString(),pointsPriceVersion:...}:{}});` | 删除 pointTask 分支 |
| `workbench-service.mjs:69` | `if(pointsService)for(const task of all("SELECT * FROM workbench_tasks WHERE billing_unit='LEGACY_TRIAL' AND status NOT IN (...)"))settle(task,'cancelled','LEGACY_BILLING_RETIRED');` | 删除或改写（迁移旧任务逻辑） |
| `workbench-service.mjs:71` | `...if(BigInt(task.reserved_micro)>0n||BigInt(task.reserved_points)>0n||...)settle(...)...` | 删除 `reserved_points` 条件 |
| `workbench-service.mjs:76` | `...if(BigInt(task.reserved_micro)>0n||BigInt(task.reserved_points)>0n||...)settle(task,'cancelled','ACCOUNT_RESTRICTED');` | 删除 `reserved_points` 条件 |
| `workbench-service.mjs:79` | `...(pointsService?" AND billing_unit='POINT'":" AND billing_unit='LEGACY_TRIAL'"));` | 改为固定 LEGACY_TRIAL（或重定） |
| `workbench-service.mjs:81` | `...'running' AND billing_unit=?',owner,pointsService?'POINT':'LEGACY_TRIAL');` | 删除 pointsService 三元 |
| `workbench-service.mjs:84` | `...'queued' AND billing_unit=? ORDER BY...',owner,pointsService?'POINT':'LEGACY_TRIAL');` | 同上 |
| `workbench-service.mjs:87` | `const before=pointTask(task)?BigInt(task.spent_points)+POINT_STEP:priceMicro(...);` | 删除 pointTask 分支 |
| `workbench-service.mjs:88` | `if(before>BigInt(pointTask(task)?task.budget_points:task.budget_micro)){...}` | 删除 pointTask 分支 |
| `workbench-service.mjs:112` | （capabilities 里 `...(pointsService?{billingUnit:'POINT',...}:{billingUnit:'LEGACY_TRIAL',...})`） | 删除 pointsService 分支 |
| `workbench-service.mjs:115` | `...fields(input,['requestId','goal','fileIds','locale',pointsService?'budgetPoints':'budgetMicro']);...` | 改为 `'budgetMicro'` |
| `workbench-service.mjs:132` | `if(method==='POST'&&route==='estimate'&&pointsService)fail(410,'WORKBENCH_LEGACY_RETIRED','请使用积分任务计划入口。');` | 删除 `&&pointsService` |
| `workbench-service.mjs:147` | `...if(pointsService&&!pointTask(task))fail(410,'WORKBENCH_LEGACY_RETIRED','历史试用任务只能查看或取消。');` | 删除 pointsService 条件 |
| `workbench-service.mjs:152` | `...plan=pointPlan(planGoal(...),task.spent_points);` | 改为 `planGoal(...)` |
| `workbench-service.mjs:154` | `if(pointTask(task)?BigInt(plan.estimatedPoints)>1000n:BigInt(plan.estimatedMicro)>1000000n)...` | 删除 pointTask 分支 |
| `workbench-service.mjs:157` | `if(pointTask(task))run('UPDATE workbench_tasks SET estimated_points=? WHERE id=?',...);` | 删除 |
| `workbench-service.mjs:166` | `if(pointsService&&!pointTask(task)&&name!=='cancel')fail(410,...);` | 删除 pointsService 条件 |
| `workbench-service.mjs:167` | `if(pointTask(task)&&('budgetMicro' in input||'acceptTrial' in input))fail(400,'POINTS_REQUIRED','此任务只能使用积分预算。');` | 删除该行 |
| `workbench-service.mjs:171-186` | `if(pointTask(task)){ ... pointsService.ensureTrial(owner); pointsService.reserve({...}); ... }else{ ... }` | 删除 pointTask 整块，保留 micro 分支 |
| `workbench-service.mjs:190` | `...BigInt(task.reserved_micro)===0n&&BigInt(task.reserved_points)===0n&&...` | 删除 `reserved_points` 条件 |
| `workbench-service.mjs:201` | `if(pointTask(task)?BigInt(task.spent_points)+POINT_STEP>...:...){...}` | 删除 pointTask 分支 |
| `workbench-service.mjs:207` | `if(pointTask(task)&&input.acceptPoints!==true)fail(400,'QUOTE_NOT_CONFIRMED','请确认追加积分预算。');` | 删除 |
| `workbench-service.mjs:208` | `const budget=pointTask(task)?pointAmount(input.budgetPoints):amount(input.budgetMicro);...` | 删除 pointTask 分支 |
| `workbench-service.mjs:210` | `...JSON.stringify(pointTask(task)?{oldBudgetPoints:...,payer:'local-points'}:{...})...` | 删除 pointTask 分支 |
| `workbench-service.mjs:214` | `...pointTask(task)?(input.acceptPoints!==true||input.budgetPoints!==parameters.newBudgetPoints):...` | 删除 pointTask 分支 |
| `workbench-service.mjs:215` | `...if(pointTask(task)){pointsService.reserve({...});run('UPDATE workbench_tasks SET budget_points=?,reserved_points=? WHERE id=?',...);}else run(...)...` | 删除 pointTask 分支，保留 micro |
| `workbench-service.mjs:222` | `...`（cleanupDeletedAccount 超长行）| ⚠️ 待确认：需复核是否含积分引用 |

> ⚠️ **`workbench-service.mjs` 是后端最重改动**（约 40 处）。`pointsService` 参数被移除后，`newPlan` / `settle` / `tick` / `approve` 全部计费路径都要回落到 micro 逻辑或新方案。

### 2.17 `yubenzhe-deploy/server/task-payment-verifier.mjs`

- Grep（`points`/`POINT`/`getPointsAccount` 等）**未命中**。该文件是链上任务付款核验器，**与积分无关**。
- 处理建议：**无需改动**。（与 2.20 群协作的链上付款是独立链路。）

### 2.18 `yubenzhe-deploy/server/product-admin.mjs`（管理后台）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `product-admin.mjs:17` | `const pointRow=row=>({id:row.owner_id,...,unit:'POINT',updatedAt:row.updated_at});` | 删除函数 |
| `product-admin.mjs:18` | `const taskRow=row=>({...,estimatedPoints:row.estimated_points,budgetPoints:row.budget_points,...});` | 删除 points 字段映射 |
| `product-admin.mjs:25` | `points:{table:'points_accounts',key:'owner_id',search:'owner_id',status:...,map:pointRow},` | 删除该分区注册 |
| `product-admin.mjs:38` | `...readOnly:['points','tasks','bounties'].includes(kind)};` | 从数组删除 `'points'` |
| `product-admin.mjs:52-58` | `if(kind==='points'){ ... points_entries / points_reservations / points_transactions 查询 ... }` | 删除整段（含 reconciliation 对账） |
| `product-admin.mjs:81` | `const match=/^(accounts|providers|tokens|bounties|reports|points|tasks)(?:\/...)?$/.exec(path);` | 从正则删除 `points|` |
| `product-admin.mjs:87` | `...fields(query,[]);if(kind==='points'){...}` | 删除 points 分支 |

### 2.19 `yubenzhe-deploy/server/group-workflows.mjs`（群协作）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `group-workflows.mjs:46` | `...one('SELECT id,status,version,spent_points,budget_points FROM workbench_tasks WHERE id=? AND owner_id=?',...)` | 删除 points 列查询 |
| `group-workflows.mjs:50` | `...estimatedPoints:'30',budgetPoints:task?.budget_points||'100',spentPoints:task?.spent_points||'0',pointsPriceVersion:'local-points-v1',...` | 删除 points 字段 |
| `group-workflows.mjs:115` | `function executionMatches(row){...task.billing_unit==='POINT'&&...}` | 删除 `billing_unit==='POINT'` 条件 |
| `group-workflows.mjs:147` | `const input=request.input||{};fields(input,['requestId','version','proposalDigest','acceptPoints','budgetPoints']);` | 删除 `acceptPoints` / `budgetPoints` |
| `group-workflows.mjs:151` | `if(input.acceptPoints!==true||typeof input.budgetPoints!=='string'||...BigInt(input.budgetPoints)<30n||...>1000n)fail(400,'POINTS_APPROVAL_REQUIRED','请明确批准 30–1000 积分的预算。');` | 删除该行（积分批准校验） |
| `group-workflows.mjs:158` | `...approval_json=?...{requestId,proposalDigest,budgetPoints:input.budgetPoints,...}...'...已批准文件工具与积分预算；没有授权付款。')` | 删除 budgetPoints 与积分文案 |
| `group-workflows.mjs:167` | `...call('plan',{...,budgetPoints:input.budgetPoints});` | 删除 budgetPoints 参数（或改 micro） |
| `group-workflows.mjs:169` | `if(!planned.task||...||planned.task.billingUnit!=='POINT')fail(409,'EXECUTION_SCOPE_CHANGED',...);` | 删除 `billingUnit!=='POINT'` 条件 |
| `group-workflows.mjs:179` | `...call('tasks/'+task.id+'/confirm',{...,budgetPoints:input.budgetPoints,acceptPoints:true});` | 删除 budgetPoints/acceptPoints |

> ⚠️ 群协作的批准界面依赖积分预算，删除积分后群协作需重新设计（见第 5 节）。

### 2.20 `yubenzhe-deploy/server/` 其余文件

| 文件:行 | 原文（截断） | 处理建议 |
|---|---|---|
| `retire-platform-assets.mjs:16` | `...scope:'Offline history only; no automatic conversion to POINT or chain assets',tables});` | 改写文案（去掉 "POINT"） |
| `ai-provider.mjs:14` | `...没有任何工具、文件、网络、账号、钱包、服务积分或管理权限。...` | 改写系统提示词（去掉「服务积分」） |
| `ai-service.mjs:54` | （超长行，命中疑似提示词/文案） | ⚠️ 待确认：复核后决定是否改写 |
| `social-database.mjs:6` | `const MIGRATIONS=[...,'014-points.sql','015-retire-platform-assets.sql',...];` | 见 4.3 数据库处置 |

### 2.21 `yubenzhe-deploy/ui/product-ops.js`（管理后台前端）

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `product-ops.js:2` | `export const sections={...,points:['服务积分核对','active','closed'],...};` | 删除 sections 里的 `points:` 键 |
| `product-ops.js:4` | `const names={...,available:'可用积分',reserved:'预留积分',unit:'单位',...,estimatedPoints:'预计积分',budgetPoints:'预算积分',...};` | 删除积分字段中文名 |
| `product-ops.js:7` | `...({'unavailable':'未接通',...,'POINT':'POINT'}[value])...` | 删除 `'POINT':'POINT'` 映射 |
| `product-ops.js:26` | `if(value.reconciliation){$('detail').append(node('h3','只读积分核对'),...)}` | 删除该行（积分对账渲染） |
| `product-ops.js:27` | `for(const [key,title] of [[...,['ledger','最近积分流水'],['reservations','任务预留'],...]]...)` | 删除 `ledger` / `reservations` 两个条目 |

### 2.22 `tongban/src/install.html`

| 位置 | 原文（截断） | 处理建议 |
|---|---|---|
| `tongban/src/install.html:4` | `...AI 工作台、好友协作、自托管钱包，以及独立的服务积分。...</p>...工作任务使用内测试用积分；...` | 删除「以及独立的服务积分」「内测试用积分」表述 |

### 2.23 `yubenzhe-deploy/server/account-access.mjs` / `social-service.mjs` / `retire-platform-assets.mjs`

| 文件:行 | 说明 | 处理建议 |
|---|---|---|
| `account-access.mjs:37` | `function beforeDelete(a){if(exposure(a.id))fail(409,'FINANCIAL_OBLIGATIONS',...);}` | 与积分间接相关：`exposure` 由 `product-modules` 注入的 `beforeDeleteAccount` 提供（含 `points.hasReservations`）。删除积分后需同步确认此处不再引用积分 |
| `account-access.mjs:103` | `return {handlePublic,handle,...,beforeDelete,onDelete,...};` | 导出清单，无直接积分引用，**无需改动**（前提是注入的 beforeDeleteAccount 已清理） |
| `social-service.mjs:10` | `export function createSocialService({...,beforeDeleteAccount=()=>{},deleteAccountData=()=>{},});` | 参数透传，**无需改动** |
| `social-service.mjs:44` | `...beforeDeleteAccount,deleteAccountData:account=>{...deleteAccountData(account);}};` | 参数透传，**无需改动**（积分钩子由 product-modules 提供） |

---

## 3. 测试清单

### 3.1 前端（`tongban/tests/`）— 基线：56 个 `*.test.mjs`（另有 1 个辅助文件 `helpers/profile-fixtures.mjs`）

| 文件 | 处理 | 说明 |
|---|---|---|
| `tongban/tests/points.test.mjs` | **整文件删除** | 8 个用例全部只测积分组件（`formatPoints` / `mountPoints` / ledger / 账户切换）。 |
| `tongban/tests/v02-consumer-boundary.test.mjs` | **删具体用例 + 改断言** | ⚠️ **高优先**：<br>· `:8` `test('active app has no platform transfer...')` — 含 `assert.match(app,/mountPoints/);` **「积分必须存在」断言**，必须删除该断言。<br>· `:10` `test('new POINT page and chain overview styles...')` — 整用例删除（`points.css` 将不存在）或从数组 `['points.css','chain-wallet.css']` 删除 `'points.css'`。 |
| `tongban/tests/app-navigation.test.mjs` | **删具体用例** | `:16` `test('points moves to workbench and existing Mine bookmarks remain usable')` 整用例删除（`viewFromHash('#mine/points')` → `'points'` 等断言将失败）。 |
| `tongban/tests/workbench-hub.test.mjs` | **改具体用例** | 多个用例通过 `getPointsAccount` 注入 mock：`:130`、`:153`、`:155`、`:158`、`:166`、`:180`、`:185`。用例名：`brand home renders exact copy, one primary action and only real account/task summary data`（:128）、`summary preserves zero and empty results...`（:152）、`late summary responses...`（:163）、`signed-out home reads no private summary...`（:178）、`recent task ordering...`（:184）。需删除积分 mock/断言（如 `>:9,876 分</strong>`、`积分不可转让…`、`积分暂不可用`）。 |
| `tongban/tests/workbench.test.mjs` | **改 helper + 用例** | `:96-97` `budgetApproval` / `pointsTask` helper 含 `billingUnit:'POINT'` / `budgetPoints` / `spentPoints`；`:101,:112,:125,:132,:138,:139` 用例引用积分预算/审批。需改。 |
| `tongban/tests/workbench-cost-ui.test.mjs` | **改具体用例** | `:49-51`（`预计积分区间` / `21 POINT–39 POINT`）、`:59-60`（`30 POINT`）、`:68-75`（`已使用积分` / `最高积分预算` / `剩余预算` / `当前预留` 断言）。 |
| `tongban/tests/workbench-experience-ui.test.mjs` | **改具体用例** | `:12,:15`（plan/task helper 含 points 字段）、`:44`（`确认积分预算，开始执行`）、`:52`（`确认积分预算，开始执行`）、`:93,:96+`（超长行含 points）。 |
| `tongban/tests/social-client.test.mjs` | **删具体用例** | `:112` `test('POINT reads use the authenticated social cookie scope and encode opaque cursors')` 整用例删除；`:113` `test('late POINT reads cannot survive account-session clearing')` 整用例删除。 |
| `tongban/tests/mine.test.mjs` | **改断言** | `:91` 断言 `assert.doesNotMatch(...,/data-mine-action="(?:...|points|...)"/)` — 可保留（积分入口已无）；`:355` `assert.doesNotMatch(...,/余额|提现|积分转让|邀请.{0,8}奖励|.../)` — 积分转让字样可保留为"反例"断言，无需改。低风险。 |
| `tongban/tests/wallet-intent.test.mjs` | **改具体用例** | `:28` `test('background chain balance refresh does not redraw independent points or workbench pages')` — 内部 `context.currentView='points'`，需改为其他 view 或删除该用例。 |
| `tongban/tests/device-code-ui.test.mjs` | **改 mock** | `:64` mock client 含 `getPointsAccount:()=>new Promise(()=>{})`，需删除该字段。 |
| `tongban/tests/asset-gift-route.test.mjs` | **改断言** | `:65` `assert.match(root.innerHTML,/不会签名、扣除积分或增加链上资产/)` — 如 `distribution-preview.js` 改文案需同步改；或保留语义等价断言。 |

### 3.2 后端（`yubenzhe-deploy/tests/`）— 基线：42 个 `*.test.mjs`（无子目录）

| 文件 | 处理 | 说明 |
|---|---|---|
| `yubenzhe-deploy/tests/points-service.test.mjs` | **整文件删除** | 16 个用例全部围绕 `createPointsService` / 工作台经积分结算 / 核销。 |
| `yubenzhe-deploy/tests/v02-points-http.test.mjs` | **整文件删除** | `:12` 单个大用例 `V0.2 web cookie reaches POINT plan, confirmation, completed output and retired routes`。 |
| `yubenzhe-deploy/tests/v02-points-query.test.mjs` | **整文件删除** | `:6` 单用例 `POINT pagination consumes HTTP query cursor...`。 |
| `yubenzhe-deploy/tests/product-modules.test.mjs` | **改具体用例** | `:28`（`rejects ... 'points/account', code('POINTS_UNCONFIGURED')`）、`:34`（`points/account` 返回 `available:'1000'`）、`:38`（`points/reward|transfer|...` 断言）、`:42-44`（`startTask` 用 `budgetPoints`）、`:55`（`test('account closure voids local service points and cannot recreate their entitlement')` 整用例删除）。 |
| `yubenzhe-deploy/tests/product-admin.test.mjs` | **删/改用例** | `:40`（`without creating POINT accounts` + `admin('points').items.length===0` + `points_accounts` count）、`:50`（`test('POINT view reconciles every integer entry...')` **整用例删**）、`:62`（`test('account restriction cancels queued, running and paused file work without extra POINT consumption')` — 含积分消耗断言，需重写）。 |
| `yubenzhe-deploy/tests/group-workflows.test.mjs` | **改具体用例** | `:27`（`approval` helper 含 `acceptPoints:true,budgetPoints:'100'`）、`:46`（`spent_points` 断言）、`:77`（`test('membership, author, version, digest and points consent are independent approval boundaries')` — 含 `POINTS_APPROVAL_REQUIRED`）、`:83`、`:164`（`test('unsent cancellation releases reserved points...')`）、`:166`（`reserved_points` 断言）。 |
| `yubenzhe-deploy/tests/group-workflow-migration.test.mjs` | **改具体用例** | `:47-54`（插入 `points_accounts` / `points_transactions` / `points_entries` / `points_reservations` 旧数据）、`:71` 用例名含 "points"、`:108` 断言 `points_accounts.available='970'`。⚠️ 这是**迁移回归保护**测试，删积分表后必须重写。 |
| `yubenzhe-deploy/tests/internal-preview.test.mjs` | **改具体用例** | `:56`（`/api/social/points/account` 在 401 路径列表中）、`:76`（`points/account` 200 断言）、`:125,:127`（`workbench/plan` 带 `budgetPoints`、`confirm` 带 `acceptPoints`/`pointsPriceVersion`）、`:131`（`task.spentPoints==='30'`）。 |
| `yubenzhe-deploy/tests/moment-artifacts.test.mjs` | **改具体用例** | `:16-17`（`workbench/plan` 带 `budgetPoints:'100'`，`confirm` 带 `acceptPoints:true`/`pointsPriceVersion`）。 |
| `yubenzhe-deploy/tests/workbench-experience.test.mjs` | **改断言** | `:28`（用例名含 "no reservation"）、`:154`（`test('explicit includes, key points and colon lists...')` — **此处 "key points" 是英文"要点"，非积分**，⚠️ 不要删）。其余部分用例经积分预算，需复核。 |
| `yubenzhe-deploy/tests/v02-retirement.test.mjs` | **改断言** | `:13`（`assert.equal(... 'points_accounts' count, 0)`）、`:14`（`assert.equal(... name='points_accounts' , undefined)`）。这里断言的是 **V0.2 平台资产退役**，积分账户断言为"应不存在"（因为旧库不含 014）。⚠️ 删 014 后此处行为需复核：`v02-retirement` 的 OLD 迁移列表实际**不含 014**（见该文件 `:10`），故这两条 `points_accounts` 断言本就在验证"没有积分表"。**风险较低**，但 `:14` 那条若删 014 迁移仍需确认 openSocialDatabase 全量迁移后行为。 |

> **测试基线（当前）**：前端 56 个 `*.test.mjs`（+1 个 `helpers/profile-fixtures.mjs` 辅助文件）、约 490 处 `test(`；后端 42 个 `*.test.mjs`、约 420 处 `test(`。上表标「整文件删除」的后端 3 个 + 前端 1 个；标「删具体用例」的约 6 处；标「改断言/改 mock」的十余处。

---

## 4. 数据库处置

### 4.1 `014-points.sql` 建了什么

**四张积分表：**

1. **`points_accounts`**（账户余额）
   - `owner_id TEXT PRIMARY KEY REFERENCES accounts(id)`
   - `available TEXT NOT NULL DEFAULT '0'`（可用积分）
   - `reserved TEXT NOT NULL DEFAULT '0'`（预留积分）
   - `created_at INTEGER NOT NULL`、`updated_at INTEGER NOT NULL`、`closed_at INTEGER`

2. **`points_transactions`**（幂等事务流水）
   - `id TEXT PRIMARY KEY`、`owner_id TEXT NOT NULL REFERENCES accounts(id)`
   - `request_id TEXT NOT NULL`、`signature TEXT NOT NULL`、`reason TEXT NOT NULL`
   - `delta TEXT NOT NULL`、`status TEXT NOT NULL`、`resource_id TEXT`
   - `response TEXT NOT NULL DEFAULT '{}'`、`created_at INTEGER NOT NULL`
   - `UNIQUE(owner_id,request_id)`
   - 索引：`CREATE INDEX points_ledger_owner ON points_transactions(owner_id,created_at,id);`

3. **`points_entries`**（复式记账分录，正负平衡）
   - `id TEXT PRIMARY KEY`、`transaction_id TEXT NOT NULL REFERENCES points_transactions(id)`
   - `account_key TEXT NOT NULL`、`delta TEXT NOT NULL`

4. **`points_reservations`**（任务预算预留）
   - `resource_id TEXT PRIMARY KEY`、`owner_id TEXT NOT NULL REFERENCES accounts(id)`
   - `amount TEXT NOT NULL`、`spent TEXT NOT NULL DEFAULT '0'`、`released TEXT NOT NULL DEFAULT '0'`
   - `status TEXT NOT NULL CHECK(status IN ('reserved','settled'))`、`updated_at INTEGER NOT NULL`

**同时给 `workbench_tasks` 追加 7 个列**（`014-points.sql:24-30`）：
- `billing_unit TEXT NOT NULL DEFAULT 'LEGACY_TRIAL'`
- `estimated_points TEXT NOT NULL DEFAULT '0'`
- `budget_points TEXT NOT NULL DEFAULT '0'`
- `reserved_points TEXT NOT NULL DEFAULT '0'`
- `spent_points TEXT NOT NULL DEFAULT '0'`
- `released_points TEXT NOT NULL DEFAULT '0'`
- `points_price_version TEXT`

> ⚠️ 关键：这 7 个列**改动了非积分表 `workbench_tasks`**。删除积分时若想清理这些列，需 `ALTER TABLE ... DROP COLUMN`（SQLite 支持有限，见 4.4）。

### 4.2 `015-retire-platform-assets.sql` 是否操作积分表？

**否。** 该文件全部操作平台资产（custody）相关表：
- 删触发器 `platform_account_created`
- 删表：`asset_gift_messages` / `asset_outbox` / `asset_claims` / `asset_gift_eligibility` / `asset_gifts` / `asset_deposits` / `asset_withdrawals` / `asset_lines` / `asset_journals` / `asset_balances` / `asset_requests` / `wallet_challenges` / `wallet_deletions` / `wallet_binding_history` / `wallet_bindings` / `asset_risk` / `asset_incidents` / `asset_registry` / `platform_accounts`
- `ALTER TABLE community_preferences DROP COLUMN asset_public`

**完全不涉及 points 表。** 唯一的"关联"是 `retire-platform-assets.mjs`（服务端归档器）的文案出现 "POINT" 一词（表示"不自动转成积分"），非数据库操作。

### 4.3 其它迁移是否引用积分表？

对 `yubenzhe-deploy/migrations/` 全目录 Grep（`points`/`POINT`，忽略大小写），**只有 `014-points.sql` 命中**。其余 001–022 迁移均不引用积分表。

此外，积分表名也出现在 **迁移清单** `yubenzhe-deploy/server/social-database.mjs:6`：
```
const MIGRATIONS=[...,'013-social-experience.sql','014-points.sql','015-retire-platform-assets.sql','016-cloud-desktops.sql',...,'022-device-claims-capabilities.sql'];
```
以及迁移回归测试 `group-workflow-migration.test.mjs`、`v02-retirement.test.mjs`（见第 3 节）。

### 4.4 建议的处置方式：删迁移文件 vs 新增 drop 迁移

迁移运行器（`social-database.mjs:14-15`）逻辑：
- 读取 `social_migrations` 表，要求 `version` 连续（`r.version===i+1`）且 `rows.length <= MIGRATIONS.length`；
- 按 `MIGRATIONS` 数组顺序执行，**计算每个文件内容的 SHA-256 checksum**，已应用迁移若 checksum 不匹配则抛 `Social migration checksum mismatch`；
- **已应用的迁移不会重跑**（`if(!old){...}`）。

#### 方案 A：直接删除 `014-points.sql`（并改 MIGRATIONS 数组）

- **对新库（全新空数据库）**：可行。删掉 `014-points.sql`、从 `MIGRATIONS` 移除该条目、把后续迁移版本号重排。**但**：后续 015–022 的文件是固定版本序号写在数组里的，删中间一个会导致数组与文件名序号错位——需**重命名 015–022 为 014–021**，否则 `MIGRATIONS` 版本连续性检查与文件名对不上（运行器用 `index+1` 作为 version，但归档逻辑用文件名硬编码 `if(file==='015-retire-platform-assets.sql')`，**重命名会破坏归档触发**）。
- **对已有数据库（生产/已应用 014 的库）**：**危险且不完整**。checksum 检查会因 014 消失而遇到 "迁移序列不连续/长度不足" 或直接跳过清理，**已建的 4 张表和 workbench_tasks 的 7 个列会永久残留在旧库里**（因为迁移只增不删，删除迁移文件不会回滚已应用的 DDL）。
- 结论：**只适合"从未部署过"的纯新库**；只要有任何已上线数据库，此方案会留下孤儿表。

#### 方案 B：新增一个 drop 迁移（推荐）

新增例如 `023-drop-points.sql`（追加到 `MIGRATIONS` 数组末尾），内容：
```sql
DROP TABLE IF EXISTS points_entries;
DROP TABLE IF EXISTS points_transactions;
DROP TABLE IF EXISTS points_reservations;
DROP TABLE IF EXISTS points_accounts;
DROP INDEX IF EXISTS points_ledger_owner;
-- 如需清理 workbench_tasks 列（SQLite 3.35+ 支持 DROP COLUMN）：
ALTER TABLE workbench_tasks DROP COLUMN billing_unit;
ALTER TABLE workbench_tasks DROP COLUMN estimated_points;
ALTER TABLE workbench_tasks DROP COLUMN budget_points;
ALTER TABLE workbench_tasks DROP COLUMN reserved_points;
ALTER TABLE workbench_tasks DROP COLUMN spent_points;
ALTER TABLE workbench_tasks DROP COLUMN released_points;
ALTER TABLE workbench_tasks DROP COLUMN points_price_version;
```
- **对新库**：001–014 仍建表，023 立刻删表，最终 schema 正确（略浪费）。
- **对已有库**：023 作为未应用迁移被正常执行，**真正清理旧库的 4 张表与列**。
- **注意**：014 的 `ALTER TABLE workbench_tasks ADD COLUMN ... NOT NULL DEFAULT` 与 023 的 `DROP COLUMN` 成对；SQLite 的 `DROP COLUMN` 对"有默认值/被索引/被视图引用"的列有限制，需在目标 SQLite 版本上实测。
- **注意**：drop 迁移前建议先做数据归档（仿 `retire-platform-assets.mjs` 的离线归档 + checksum 模式），否则积分流水不可恢复。

#### 综合建议

**推荐方案 B（新增 drop 迁移）+ 保留 014 历史**：
1. 保留 `014-points.sql` 及其在 `MIGRATIONS` 中的位置（避免破坏既有库的 checksum 链条）。
2. 新增 `023-drop-points.sql` 做物理删除。
3. 如需版本号干净，可考虑给 023 加数据归档步骤。
4. 若确定**所有环境都是全新库、无任何已部署数据**，才可用方案 A（且必须同步重命名 015–022 并修正 `social-database.mjs` 里 `015-retire-platform-assets.sql` 的硬编码判断）。

---

## 5. ⚠️ 高风险点（删了会出事的地方）

### 5.1 非积分功能依赖积分表 — **有，且是关键路径**

| 依赖方 | 位置 | 风险 |
|---|---|---|
| **工作台任务结算** | `yubenzhe-deploy/server/workbench-service.mjs`（约 40 处）+ `tongban/src/workbench.js`（约 22 处） | ⚠️ **最高危**。积分是文件任务的唯一计费单位（`billing_unit='POINT'`），3 步各扣 10 POINT。删除积分 = 任务失去计费模型。若不重新设计，`settle()` 会因 `if(!pointsService)throw Error('Points service required for POINT task')` 直接抛错。 |
| **账号注销核销** | `yubenzhe-deploy/server/product-modules.mjs:30,33` | ⚠️ `beforeDeleteAccount` 里 `points.hasReservations()` 阻断 + `deleteAccountData` 里 `points.closeAccount()`。删除积分后若不同步清理这两处，注销流程会因 `points` 未定义而 `TypeError`。 |
| **群协作任务** | `yubenzhe-deploy/server/group-workflows.mjs:147,151,167,179` + `tongban/src/group-workflows.js:32,51` | ⚠️ 群协作任务的执行预算完全走 `budgetPoints`/`acceptPoints`，且 `executionMatches()` 校验 `billing_unit==='POINT'`。删除积分 = 群协作失去预算批准机制。 |
| **管理后台** | `yubenzhe-deploy/server/product-admin.mjs:25,52-58` + `ui/product-ops.js:2,26,27` | 运营后台有独立积分只读视图与对账。删除后管理后台需去掉该分区。 |
| **账号限制（治理）** | `product-admin.mjs:62` 对应测试 | 账号被限制时会通过 `settle(task,'cancelled','ACCOUNT_RESTRICTED')` 结算任务，依赖积分预留。 |

### 5.2 「看似无关实际相关」的耦合

1. **`workbench_tasks` 表被积分改造**：014 迁移给这个**非积分表**加了 7 个积分列（`billing_unit` / `*_points` / `points_price_version`）。看似"删积分表"，实则要动工作台主表。而且 `billing_unit` 是 `LEGACY_TRIAL` vs `POINT` 的计量开关，被 `workbench-service.mjs:69,79,81,84` 和 `group-workflows.mjs:115` 大量引用。
2. **`LEGACY_TRIAL` 历史迁移逻辑**：`workbench-service.mjs:69` 特地迁移旧的 `LEGACY_TRIAL` 任务到积分体系（`settle(task,'cancelled','LEGACY_BILLING_RETIRED')`）。积分删除后这段迁移逻辑失去意义，但存量 `billing_unit='LEGACY_TRIAL'` 的历史任务数据仍在库里。
3. **`v02-consumer-boundary.test.mjs` 的"积分必须存在"断言**（`:8` `assert.match(app,/mountPoints/)`）：这是**消费端边界守卫测试**，专门断言 app 必须挂载 `mountPoints`。删除积分会**直接让这个测试失败**——它不是"积分测试"，而是"产品边界测试"，容易被漏掉。
4. **`v02-retirement.test.mjs`** 用 `points_accounts` 表不存在来验证 V0.2 平台资产退役。删 014 后，这个"不存在"断言的含义会变化（因为该测试的 OLD 迁移列表本就不含 014，见 `:10`），需复核。
5. **文案层遍布**：`app.js:191`、`mine.js:86,90`、`workbench.js` 多处、`distribution-preview.js:7,13`、`discover-community.js:34,36`、`ai-workspace.js:84,95`、`install.html:4`、`ai-provider.mjs:14` 等都有"积分/POINT"字样。物理删除若不清理文案，会出现"删了功能但到处说积分"的残留。
6. **`retire-platform-assets.mjs:16`** 归档 payload 里写死 `'no automatic conversion to POINT'`——与积分的语义关联（"平台资产不转积分"）会被打断。
7. **`task-payment-verifier.mjs` 容易被误删**：它名字与"任务付款"相关，但**实际是链上 BSC 测试网付款核验，与积分无关**（Grep 零命中）。不要误删。同理 `workbench-adapters.mjs` 的 "points" 是英文"要点"（`:52,66,77,82`），**非积分**。
8. **`account-access-ui.js:10` / `server.mjs:18` / `ai-workspace.js:115`** 命中来自超长行的子串噪声或英文词，**复核后确认非积分**。

### 5.3 测试基线

| | 测试文件数 | `test(` 计数（约） |
|---|---|---|
| 前端 `tongban/tests/` | 56（+1 辅助） | 490 |
| 后端 `yubenzhe-deploy/tests/` | 42 | 420 |

> 计数方式：`grep -rho "test(" <dir> --include=*.mjs | wc -l`，包含 `test(` / `test.skip(` 等子串计数，为**上界近似值**（不含 `.test(` 精确去重）。文件数为 `ls | wc -l` 精确值。

### 5.4 删除执行顺序建议

1. **先定产品决策**：工作台任务/群协作删除积分后**如何计费或是否停用**。这决定第 2 节 `workbench.js` / `workbench-service.mjs` / `group-workflows.mjs` 是"删"还是"改回 micro"。
2. 后端代码：`product-modules.mjs` → `workbench-service.mjs` → `group-workflows.mjs` → `product-admin.mjs`，最后删 `points-service.mjs`。
3. 前端代码：`app.js` → `app-navigation.js` → `workbench-hub.js` → `workbench.js` → `social-client.js`，最后删 `points.js`/`points.css`。
4. 数据库：新增 drop 迁移（方案 B），重排/修正 `social-database.mjs`。
5. 测试：删 4 个整文件 + 改约 15 处用例/断言（尤其 `v02-consumer-boundary.test.mjs:8` 的 `mountPoints` 断言）。
6. 文案：清理 2.x 表格中所有"积分/POINT"文案。
7. 全量跑前端 + 后端测试验证基线归零。

---

## 附录：搜索覆盖与排除

- **搜索工具**：Grep（ripgrep）只读搜索。
- **已搜索文件范围**：`tongban/src/`、`tongban/tests/`、`yubenzhe-deploy/server/`、`yubenzhe-deploy/migrations/`、`yubenzhe-deploy/tests/`、`yubenzhe-deploy/ui/`、根 `package.json`。
- **排除**：`node_modules`、`dist`、`build`。
- **关键词**（含大小写变体）：`points`、`POINT`、`积分`、`Points`、`poInt`、`points_accounts`、`points_transactions`、`points_entries`、`points_reservations`、`getPointsAccount`、`getPointsLedger`、`createPointsService`、`formatPoints`、`mountPoints`、`service-reserve`、`task-reserve`、`local-trial`、`local-welcome`、`local-points`、`billing_unit`、`billingUnit`、`pointsService`、`onPoints`、`acceptPoints`、`budgetPoints`。
- **标注 `⚠️ 待确认` 的位置**：`workbench.js:107,127,129,132,219`；`workbench-service.mjs:222`；`ai-workspace.js:115`；`ai-service.mjs:54`。这些是超长压缩行，需人工逐字符复核后决定删除范围。
- **建议的二次验证**：删除完成后，用 Grep 复跑全部关键词（忽略大小写）确认零命中；并对 `workbench-adapters.mjs` / `task-payment-verifier.mjs` 确认"points"仅剩英文"要点"和链上付款语义。
