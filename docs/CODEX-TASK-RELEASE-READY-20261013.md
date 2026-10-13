# 任务书 · 正式可用版发布准备（2026-10-13）

> 收件人：Codex
> **本任务书替代 `CODEX-TASK-TEST-CHANNEL-20261013.md`（那份是「单开一条临时测试通道」，已被用户否决）。**
>
> 用户原话：
> 「我现在要的版本**不要只能链接一次的**，要**能和正式上架一样的**，才有用，**多人测试，多人链接**，才能达到效果。你给 codex 的命令，是**升级**，**完成测试**，然后还**缺少什么东西就补充完整**，安卓和 win 的。」

---

## 第零节 · 目标解读（先对齐意图）

用户不要「一次性测试环境」，要**能像正式产品那样被多人使用**的环境。具体拆成 4 件事：

| # | 要做 | 含义 |
|---|---|---|
| **1** | **升级** | 服务器从 dev.10 升到当前最新（含 U 组界面重构、A 组多钱包、B 组 Tab 徽标与消息菜单） |
| **2** | **多人可用** | **去掉共享门禁**，让**每个人用自己的邮箱注册独立账号**（不是大家共用一个 reviewer 账号） |
| **3** | **完成测试** | 端到端跑通「下载 App → 注册 → 配对设备 → 派任务 → 收结果」，且**多人同时**验证 |
| **4** | **补齐缺失** | 把还没做的功能补上（见第三节），重点补**新手引导**——多人测试时新用户第一次用 |
| **5** | **打包两端** | 产出可安装的 **Android APK** 与 **Windows 安装包**，指向升级后的服务器 |

**⚠️ 用户说的「只能链接一次」，指的是现在这套**：
- 服务器只有一个共享门禁账号（`reviewer`），大家共用 → 不是真正的多人
- 门禁会话只存在进程内、服务重启就失效 → 感觉「连一次就没了」
- App 根本过不了门禁 → 实际连一次都连不上

**➡️ 所以本任务的核心动作是：把「内测门禁模式」改成「公开多用户模式」。**

---

## 第一节 · 现状实测（别重新摸索）

### 1.1 服务器

| 项 | 值 |
|---|---|
| 主机 | `66.42.56.29`（`yubenzhe-sg-01`），**YBZ 专用机**，非 lovemart |
| 连接 | `root` + 密钥 `work/server-access/yubenzhe-singapore-20261009.pem`（仓库外，`C:\Users\Administrator\Documents\Codex\2026-10-09\git-2\work\server-access\`） |
| 资源 | 磁盘剩 58G、内存 3.9G（用 766M）——**够几十人测试** |
| 部署 | Docker Compose 四容器：`frontend`(18808) / `admin`(18809) / `Caddy`(443+8443) / `ollama` |
| 当前版本 | **dev.10** |
| 发布目录 | `/opt/yubenzhe/releases/0.14.0-dev.10-final`；`ops/current` 与 `ops/image` 指向它 |
| 数据目录 | `/opt/yubenzhe/state`、`ai-state`、`ollama-state`、`secrets`（linuxuser，0700） |
| 可回滚 | 0.10.0 / 0.11.0 / 0.11.1 / 0.12.0 / 0.12.1 / 0.13.0 / dev.10 **全在** |

**当前 frontend 环境变量**：
```
ROLE=frontend  BIND_HOST=0.0.0.0  PORT=8080
PUBLIC_ORIGIN=https://66.42.56.29
INTERNAL_PREVIEW=true      ← 门禁来源
PUBLIC_FRONTEND=false
M0_SIMULATION=false
```

**Caddy 配置**（`/opt/yubenzhe/releases/0.9.0/Caddyfile.public`，注意配置放在 **0.9.0 目录**、独立于版本）：
```
https://66.42.56.29        { tls acme profile shortlived; reverse_proxy 127.0.0.1:18808 }
https://66.42.56.29:8443   { tls acme profile shortlived; reverse_proxy 127.0.0.1:18809 }
```
证书是 **Let's Encrypt IP 证书**，实测受系统信任（`SAN: IP Address = 66.42.56.29`）。

### 1.2 门禁实测

```
GET https://66.42.56.29/api/social/access/capabilities
→ 401 {"error":"请先登录内部预览，再使用产品账号。","code":"INTERNAL_PREVIEW_REQUIRED"}
```
`/healthz` 免门禁（返回 `0.14.0-dev.10`）。

### 1.3 注册流程（**好消息：天然支持多人**）

`server/account-access.mjs:53` 的 `finishEmailLogin()`：
```js
let a=one('SELECT a.* FROM accounts a JOIN account_emails e ON e.account_id=a.id WHERE e.email_norm=? AND a.deleted_at=0',row.email_norm);
let created=false;
if(!a){ ... INSERT INTO accounts(...) ... ; created=true; }
```
→ **邮箱验证通过后，账号不存在就自动建号**。**每个邮箱 = 一个独立账号，天然支持多人注册。**

⚠️ 但注册目前只有**一条路**：邮箱验证码。没有「用户名+密码」注册（`password_salt/hash` 是旧账号占位值）。

### 1.4 ⚠️ 公开模式目前缺邮件适配器（**本任务必须解决**）

`server/start.mjs:26`：
```js
const mailAdapter=!internalPreview&&!simulation&&(role==='frontend'||process.env.SOCIAL_DATABASE_PATH)?createMailAdapterFromEnvironment():undefined;
```
`server/product-modules.mjs:21`：
```js
const mail=mailAdapter||(internalPreview?createInternalPreviewMailAdapter({origin}):simulation?createSimulationMailAdapter({origin}):createMailAdapterFromEnvironment({env:mailEnv}));
```
→ 公开模式（`internalPreview=false` + `simulation=false`）下，若 `EMAIL_PROVIDER=disabled`（默认），**两条路都返回 undefined** → `mail.mode='disabled'` → 注册直接 503 `EMAIL_DISABLED`。

**➡️ 所以「公开 + 能注册」在今天代码里不存在，必须新增（见第二节）。**

### 1.5 两端产物（都落后）

| 端 | 最新包 | 时间 | 缺什么 |
|---|---|---|---|
| **Windows** | `yubenzhe-0.14.0-dev.12-windows-x64-setup.exe` | 10-12 15:01 | U 组界面重构(18:00 起) + A 组 + B 组 |
| **Android** | `YBZ-0.14.0-dev.8-android.apk` | 10-11 12:52 | **缺两天全部改动** |

打包工具链**齐全**：
- Windows：`yubenzhe-desktop/package.json` 的 `build:win`（`prepare-web.mjs` + electron-builder），依赖已装
- Android：JDK 21（`work/android-toolchain/jdk/jdk-21.0.12.1+1`）+ SDK 36 + `gradlew` + 签名 `work/android-signing/original/tongban-preview.p12`
- 地址同步：`scripts/configure-native-endpoints.mjs`（从 `tongban/dist/public-deployment.json` 生成安卓 `DeploymentConfig.java` 与桌面 `deployment.cjs`）

### 1.6 功能缺口（第 3 节要补的）

| 组 | 状态 | 证据 |
|---|---|---|
| **A 组**（多钱包 + 诚实导航） | ✅ 已交 | `aea2238` |
| **B 组**（Tab 徽标 + 消息菜单） | ✅ 已交 | `3644a3a` |
| **C 组**（地址簿） | ❌ 未做 | 搜 `地址簿`/`addressBook` 零命中 |
| **D 组**（深色跟随 / 骨架屏 / **新手引导**） | ❌ 未做 | 搜 `prefers-color-scheme` / `skeleton` / `onboarding` 全部零命中 |

---

## 第二节 · A · 服务器升级 + 改成多人可用

### 2.1 新增「公开测试邮箱」作用域（代码改动，5 处）

**改动 1 · `server/account-mail.mjs`** — 在 `createInternalPreviewMailAdapter` 后新增：

```js
export function createPublicTestMailAdapter({origin}={}){
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)
    throw Error('Public test mail requires an explicit HTTPS origin.');
  return simulationMail(url.origin,'public-test');
}
```

**改动 2 · `server/account-access.mjs`** — 放开 `public-test` 的两处检查：

位置 A（约 L24 `ensureMail`）：
```js
const trustedSimulationScope=mail.scope==='internal-preview'||mail.scope==='public-test';
if(mail.mode==='simulation'&&!trustedSimulationScope&&!loopback(ip))
  fail(403,'SIMULATION_LOCAL_ONLY','模拟邮件仅限本机验证环境。');
```

位置 B（约 L25 `requirePreviewTestEmail`）：
```js
const testOnlyScope=mail.scope==='internal-preview'||mail.scope==='public-test';
if(testOnlyScope&&!value.split('@')[1]?.endsWith('.test'))
  fail(403,'TEST_EMAIL_ONLY','测试阶段请使用 .test 保留域邮箱注册。');
```

⚠️ 改错误码前先确认没有测试/前端依赖 `INTERNAL_TEST_EMAIL_ONLY` 字面量。

**改动 3 · `server/product-modules.mjs`** — 新增 `publicTest` 参数与分支：
```js
const mail=mailAdapter||(internalPreview?createInternalPreviewMailAdapter({origin}):publicTest?createPublicTestMailAdapter({origin}):simulation?createSimulationMailAdapter({origin}):createMailAdapterFromEnvironment({env:mailEnv}));
```
并加校验：
```js
if(publicTest&&(internalPreview||simulation))
  throw Error('PUBLIC_TEST_MAIL must not be combined with INTERNAL_PREVIEW or M0_SIMULATION.');
```

**改动 4 · `server/start.mjs`** — 读取并校验新环境变量：
```js
const publicTest=process.env.PUBLIC_TEST_MAIL==='true';
```
校验规则（`publicTest=true` 时）：
- 必须 `role==='frontend'`
- 必须 `PUBLIC_FRONTEND=true`（无门禁）
- 必须 `INTERNAL_PREVIEW=false` 且 `M0_SIMULATION=false`
- `PUBLIC_ORIGIN` 必须是**显式 HTTPS origin**
- 必须提供 `EMAIL_OTP_SECRET`（≥32 字符、持久）
- ⚠️ **不放松** `L23` 的 `M0_SIMULATION` 回环校验

把 `publicTest` 传入 `createProductModules()`。

**改动 5 · 测试**（6 条）：
1. `createPublicTestMailAdapter` 拒绝非 HTTPS / 带路径 / 带账号密码的 origin
2. `publicTest` 与另两个模式组合时抛错
3. `.test` 邮箱在 public-test 作用域能拿到 `simulationCode`
4. 非 `.test` 邮箱返回 403
5. `loopback` 作用域**回归未变**
6. `internal-preview` 作用域**回归未变**

### 2.2 部署：把生产切成公开多用户模式

⚠️ **这是动线上，必须按 2.4 的备份流程走。**

改发布目录的 `.env`（`/opt/yubenzhe/releases/<新版本>/.env`）：

| 变量 | 旧值 | 新值 |
|---|---|---|
| `INTERNAL_PREVIEW` | `true` | **`false`** |
| `PUBLIC_FRONTEND` | `false` | **`true`** |
| `PUBLIC_TEST_MAIL` | — | **`true`** |
| `M0_SIMULATION` | `false` | `false`（不变） |
| `PUBLIC_ORIGIN` | `https://66.42.56.29` | 不变 |
| `EMAIL_OTP_SECRET` | 已有 | 复用（≥32 字符） |

**必须同时做的两件事**：

1. **撤掉门禁登录页**：`PUBLIC_FRONTEND=true` 时 `server.mjs:83` 不再显示门禁页（已核对逻辑），无需改代码，但要**验证**。
2. **⚠️ 撤掉 `/internal/` 内部资料**：公开后这个目录等于对外公开。当前 `yubenzhe-deploy/public/frontend/internal/` 里有合约 ABI 与 `.sol` 源码文本。**构建公开镜像前必须移除该目录**（或确认里面没有不宜公开的内容）。
   - 若内部商业计划书 PDF 也在里面，**必须删除**。

### 2.3 ⚠️ 注册邮箱的两条路（**必须让用户知道**）

| 路 | 做法 | 现状 |
|---|---|---|
| **甲（立即可用）** | `PUBLIC_TEST_MAIL=true` → 测试者用 `xxx@example.test` 注册，**验证码直接显示在页面上** | ✅ 本任务实现 |
| **乙（正式，上架前必做）** | 配 `EMAIL_PROVIDER=http` + `EMAIL_ENDPOINT` + `EMAIL_API_KEY` + `EMAIL_FROM` → **真实邮箱收发** | ⚠️ 需要用户提供邮件服务账号，**本任务不做**，只留好接口 |

**甲路的关键限制（务必写进交付报告）**：
- 测试者**必须**用 `.test` 结尾的邮箱（如 `xiaoming@example.test`）——这是 RFC 保留域，永不真实存在
- 验证码**显示在页面上**，不是发到邮箱
- **每人用不同邮箱 = 各自独立账号**，这才是「多人测试」

### 2.4 升级与备份流程（**严格遵守**）

1. **停写**：停 `frontend` 与 `admin` **两个**写入者（不能只停 frontend）
2. **成套备份**：用 `scripts/backup.mjs` 的 SQLite backup API，**三库一起**（state / ai-state / social-state）
   - ❌ **不能**只复制运行中的 `.sqlite` 主文件（会漏 WAL）
   - ❌ **不能**逐库分别备份（跨库时刻不一致）
3. **隔离演练**：先在隔离目录恢复并验证（`backup-suite.mjs` 的 `restore-drill` 只接受它自己生成的带 `manifest.json` 的完整 snapshot）
4. **构建新镜像**：用当前 HEAD 构建 `yubenzhe-public:<新版本>`
5. **先起一个**：先启动 frontend 完成迁移并验证，**再启动 admin**
   - ⚠️ 升级后的库**不能**交给不支持迁移的旧镜像
6. **切 ops**：`ops/current` → 新 release 目录；`ops/image` → 新镜像
7. **验证**：`/healthz` 返回新版本号；不带任何 cookie 请求 `/api/social/access/capabilities` **不再返回 `INTERNAL_PREVIEW_REQUIRED`**

**回滚点**：`/opt/yubenzhe/backups/pre-internal-cutover-20261011T004550Z`（切换前另取当前版本完整备份）

---

## 第三节 · B · 补齐功能缺口

### 3.1 ⭐ D3 新手引导（**本组最重要**）

**为什么最要紧**：多人测试时，每个人都是第一次用。现在「装电脑端 → 出机器码 → 手机输码」只有文字说明，新用户会卡住。

**要做**（照 `CODEX-TASK-DETAIL-POLISH-20261013.md` 的 D3）：
- 首次打开（无设备时）走 **4 步引导**：
  1. YBZ 是什么（一句话：人做决策，机器干活）
  2. 去电脑装 YBZ（给出下载入口）
  3. 电脑上会出 8 位机器码
  4. **在这里输入机器码**（引导里直接能输）
- 可跳过（右上角「跳过」）
- **只出现一次**（本机记录已看过）
- 有设备时不出现

**🚫 红线**：不许做成挽留弹窗、不许评分请求、不许诱导。就是功能说明。

### 3.2 D1 深色跟随系统

- 外观设置增加「跟随系统」选项（现在只能手动切）
- 用 `prefers-color-scheme`，系统切换时实时响应
- 三套皮肤（白天/黑天/护眼）× 跟随系统组合**无样式错乱**

### 3.3 D2 骨架屏

- 主要列表页（消息 / 设备 / 任务看板 / 钱包资产）加载时显示骨架屏
- 骨架块形状贴合真实内容
- 加载完成平滑替换，不抖动

### 3.4 C2 地址簿

- 转账时能从**本机地址簿**选地址
- 条目录入：备注名 + 地址 + 可选备注
- ⚠️ **只存本机**，零上传

### 3.5 迁移编号

当前已到 **028**。新的从 **029** 开始。**先查 `server/social-database.mjs` 的 `MIGRATIONS` 数组末尾**，**严禁跳号**，**不得删除历史迁移**（含 `014-points.sql`）。

---

## 第四节 · C · 打包两端

### 4.1 同步服务地址

`scripts/configure-native-endpoints.mjs` 从 `tongban/dist/public-deployment.json` 的 `previewOrigin` 生成两端配置。

确认 `previewOrigin = "https://66.42.56.29"`（本任务不改地址，只换版本）。

然后：
```
node scripts/configure-native-endpoints.mjs windows
node scripts/configure-native-endpoints.mjs android
```

### 4.2 Windows

```
pnpm --dir tongban install --frozen-lockfile
pnpm --dir tongban build
node yubenzhe-deploy/scripts/stage-frontend.mjs tongban/dist
cd yubenzhe-desktop && npm run build:win
```

产出：`yubenzhe-0.14.0-dev.13-windows-x64-setup.exe` + `.zip`，附 SHA-256。

### 4.3 Android

```
cd tongban-android && npm run android:release
```

⚠️ **必须用原签名** `work/android-signing/original/tongban-preview.p12`（保证覆盖升级不丢数据）。
产出：`YBZ-0.14.0-dev.13-android.apk`，附 SHA-256 与签名者指纹。

### 4.4 版本号

统一升到 **`0.14.0-dev.13`**（或你判断的下一个 dev 号），三端（tongban / yubenzhe-deploy / yubenzhe-desktop）保持一致。

⚠️ `yubenzhe-desktop/package.json` 当前是 `dev.12`，**要同步**。

⚠️ 安卓 `android/app/build.gradle` 当前是 `versionCode 17` / `versionName "0.14.0-dev.8"`，**两个都要同步**（`versionCode` 必须递增）。

### 4.5 ⚠️ 包名带测试后缀（**上架会出问题，必须处理**）

**实测现状**：

| 端 | 当前标识 | 位置 |
|---|---|---|
| **安卓** | `app.tongban.wallet.**demo**` | `android/app/build.gradle:8`（默认值，可被 `previewApplicationId` property 覆盖） |
| **Windows** | `app.yubenzhe.desktop.**preview**` | `yubenzhe-desktop/package.json:23` |

**问题**：应用商店的包名/Bundle ID **一经上架不可更改**。带 `.demo` / `.preview` 后缀的名称在上架审核时会被视为测试包，**且上架后无法改**。

**要做**：
- 安卓 → `app.yubenzhe.mobile`（或你确认的正式名）
- Windows → `app.yubenzhe.desktop`

**➡️ 我替你定了：现在就改**（趁还没上架）。

理由：包名一经上架**永久不可更改**；测试阶段只有少数几个测试者，卸载重装成本极低；现在不改，上架前还得重来一遍并重新测。

**必须同时做的**：
- 在新手引导或测试说明里加一句「**如果装过旧版，请先卸载再装新版**」
- 交付报告里写明**新旧包名对照**

**⚠️ 不要**只改显示名而不改包名（那等于没改）

---

## 第五节 · D · 多人端到端测试

### 5.1 单人闭环（先跑通一条）

1. 安卓装 APK / Windows 装 exe
2. 用 `xiaoming@example.test` 注册（验证码在页面显示）
3. Windows 端生成机器码 → 手机输入 → 配对成功
4. 手机派一个任务给电脑 → 收到结果
5. 群聊拉 AI + 备注 → 点 AI 头像拉单聊
6. 钱包：创建第二个钱包 → 切换 → 余额跟着切
7. 底部 Tab 出现未读红点

### 5.2 多人并发（**用户明确要的**）

用 **≥5 个互不相同的 `.test` 邮箱**同时注册，验证：

1. 5 个账号**各自独立**（互不可见对方的设备与消息）
2. 5 台设备各自配对**互不干扰**
3. 并发派任务时服务端不串号（每个任务回到正确的发起者）
4. 服务端**资源没爆**（内存 / CPU 在可接受范围）
5. 注册限流生效（同 IP 高频请求被 429）

### 5.3 提供测试邀请说明

产出**一页给测试者的说明**（中文、大白话）：
- 装哪个包（给下载地址）
- 用什么邮箱格式注册（`你的名字@example.test`）
- 验证码在哪看（页面上直接显示）
- 怎么把手机和电脑连起来（机器码）
- 遇到问题怎么反馈

---

## 第六节 · 红线

| # | 红线 |
|---|---|
| **R1** | **不动** `45.76.163.5` / `202.182.103.202` / `106.53.203.33`（与本任务无关） |
| **R2** | `45.77.247.167` **当前离线**，不要唤醒它 |
| **R3** | **平台零收费**：不出现购买/充值/订阅/余额/提现/套餐/积分/价格数字 |
| **R4** | **三处不能误删**：① `workbench-adapters.mjs` 的 `points`（英文"要点"）② `task-payment-verifier.mjs`（链上 BSC 付款核验）③ `021-ai-channel.sql` 的 `lease_id`/`lease_until`（任务租约） |
| **R5** | **设备 ≠ 好友**：设备会话永远只有本人可见，不进群/朋友圈/别人列表 |
| **R6** | **对话内容不入库**：服务器只中转，不存 prompt / 输出 / 文件字节 |
| **R7** | **不开主网、不做真实 Gas 代付、不做分佣、不接云服务商** |
| **R8** | **不放松** `M0_SIMULATION` 的回环约束与 `internal-preview` 的既有校验 |
| **R9** | **公开镜像不得包含** `/internal/` 内部资料 |
| **R10** | 升级必须**停写后成套备份**，不能只复制 `.sqlite` 主文件 |

---

## 第七节 · 验收标准（31 项）

### 服务器（8 项）
1. `/healthz` 返回 `0.14.0-dev.13`（或新 dev 号）
2. 不带 cookie 请求 `/api/social/access/capabilities` **不再返回 `INTERNAL_PREVIEW_REQUIRED`**
3. 网页 `https://66.42.56.29/` 直接可用（**不再出现门禁登录页**）
4. `/internal/` 在公网**不可访问**（404 或不存在）
5. 三库完整（`integrity_check` + `foreign_key_check` 通过）
6. 升级前备份存在且可恢复（有 `manifest.json`）
7. `docker ps` 显示 frontend/admin 均为新版本镜像
8. Caddy 证书仍有效（HTTPS 握手成功、日期未过期）

### 注册与多人（8 项）
9. `a@example.test` 注册成功，返回 `created: true`
10. `b@example.test` 注册成功，且**与 a 是不同账号**（`userId` 不同）
11. 非 `.test` 邮箱（如 `a@gmail.com`）注册返回 403
12. 验证码能在响应里读到（`simulationCode`）
13. 5 个不同邮箱同时注册全部成功
14. 5 个账号互相看不到对方的设备（查 A 的账号，看不到 B 的设备）
15. 同 IP 高频注册被限流（429）
16. 已注册账号再次登录**不重复建号**（`created: false`）

### 两端（9 项）
17. Android APK 可安装、可启动、可连服务器
18. Windows 安装包可安装、可启动、可连服务器
19. 两端版本号一致（`0.14.0-dev.13`）
20. 两端 SHA-256 已记录
21. Android 签名与原包一致（覆盖升级不丢数据）
22. **新手引导**在首次打开时出现，4 步，可跳过，只出现一次
23. 深色跟随系统生效（系统切深色，App 实时跟随）
24. 骨架屏在消息/设备/任务/钱包四页出现
25. **包名已改为正式名**：安卓 `app.yubenzhe.mobile`、Windows `app.yubenzhe.desktop`；并已附「装过旧版需先卸载」的提示与新老包名对照

### 端到端（6 项）
26. 机器码配对成功（电脑出码 → 手机输码）
27. 手机派任务给电脑 → 收到结果
28. 群聊拉 AI + 备注 → 点 AI 头像拉出单聊
29. 钱包创建第二个钱包 → 切换 → 余额跟随
30. 底部 Tab 未读红点出现
31. **≥5 人并发测试**全部通过，服务端资源正常

---

## 第八节 · 回滚

**任何一步失败，立即回滚**：

1. 保持入口维护页或拒绝访问（**不要**把旧镜像直接向公网开放——旧版可能让社交 API 绕过门禁）
2. 回滚前**另取当前版本完整备份**（保留切换以来新增账号、聊天、文件、任务）
3. 选**匹配且已验证**的成套备份
4. 切回 `ops/current` + `ops/image`
5. 详细步骤见 `docs/INTERNAL-PREVIEW-RUNBOOK.txt` 第六节

⚠️ 回滚**不能**靠删表、建空库或篡改迁移校验和。

---

## 第九节 · 不做的事

- ❌ 不改 `M0_SIMULATION` 的回环约束
- ❌ 不动 `internal-preview` 的既有校验（那是另一条线路的安全边界）
- ❌ 不接真实邮件服务（本任务只留接口，等用户提供账号）
- ❌ 不开主网、不做真实 Gas 代付、不做分佣、不接云服务商
- ❌ 不删任何历史迁移
- ❌ 不给 AI 建账号（AI 消息仍由设备主人代发）
- ❌ 不在公开镜像里放 `/internal/` 资料
- ⚠️ 遇到与本任务书冲突的现状 → **先报告，不要自行改方向**

---

## 附：证据索引

| 结论 | 依据 |
|---|---|
| 门禁拦截 | 实测 401 `INTERNAL_PREVIEW_REQUIRED` |
| publicFrontend 无门禁 | `server/server.mjs:83-84` |
| 门禁分支条件 | `server/server.mjs:87-94` |
| 邮箱验证后自动建号 | `server/account-access.mjs:53`（`created=true`） |
| 公开模式缺 mail | `server/start.mjs:26` + `server/product-modules.mjs:21` |
| simulation 绑回环 | `server/start.mjs:23` |
| simulation origin 必须回环 | `server/product-modules.mjs:19` |
| 内部预览邮件作用域 | `server/account-mail.mjs:8-11` |
| 模拟邮件 IP 校验 | `server/account-access.mjs:24` |
| `.test` 邮箱限制 | `server/account-access.mjs:25` |
| 服务器结构 | 实测 `docker ps` / `ls /opt/yubenzhe` |
| Caddy 双端口先例 | 实测 `cat /opt/yubenzhe/releases/0.9.0/Caddyfile.public` |
| 升级/回滚流程 | `docs/INTERNAL-PREVIEW-RUNBOOK.txt` 第六节 |
| 构建命令 | `yubenzhe-deploy/README.txt` |
| D/C 组明细 | `docs/CODEX-TASK-DETAIL-POLISH-20261013.md` |
