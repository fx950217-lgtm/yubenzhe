# 任务书 · 服务器「公开测试通道」（2026-10-13）

> ⛔ **本任务书已被替代，不要执行。**
> 用户 2026-10-13 05:55 明确：「不要只能链接一次的，要能和正式上架一样的，多人测试，多人链接」。
> 单开一条临时测试通道不满足该要求。**请改用 `CODEX-TASK-RELEASE-READY-20261013.md`。**
> 本文保留仅作技术参考（端口/Caddy 那部分结论仍然有效）。

> 收件人：Codex
> 目标：在 `66.42.56.29` 上**新增一条不设门禁的测试通道**，让手机 App / Windows App 能连上真机测试。**现有网页服务不动。**
> 用户已确认走这条路线（方案丙）。

---

## 第零节 · 为什么做这个（先读懂问题）

### 0.1 现状卡点（已实测）

用户要拿手机 App 和 Windows App 真机测功能，但**连不上服务器**：

```
GET https://66.42.56.29/api/social/access/capabilities
→ 401 {"error":"请先登录内部预览，再使用产品账号。","code":"INTERNAL_PREVIEW_REQUIRED"}
```

**原因**：服务器跑的是 `INTERNAL_PREVIEW=true` 模式，所有产品 API 先要求一个**外层门禁会话**（浏览器输入账号密码拿到的 cookie）。网页版没问题，**原生 App 不会带这个 cookie，被挡在门外**。

README 里也写明了：
> 「Android、iOS、Windows 旧原生包…未重打包，**且不支持新增外层门禁**」

### 0.2 为什么不能简单改配置解决

现有三种模式，**没有任何一种**同时满足「公网 + 无门禁 + 可注册」：

| 模式 | 门禁 | 注册方式 | 能否用于公网 |
|---|---|---|---|
| `INTERNAL_PREVIEW=true`（现状） | ✅ 有 | 内部预览模拟码 | ❌ App 被拦 |
| `M0_SIMULATION=true` | ❌ 无 | 模拟码 | ❌ **硬约束**：`start.mjs:23` 强制绑回环 + `product-modules.mjs:19` 要求 origin hostname 必须是 localhost/127.0.0.1 |
| 两个都 false | ❌ 无 | **真实邮件** | ✅ 但用户**没有邮件服务**（`EMAIL_PROVIDER` 未配） |

### 0.3 本任务的做法

**新增第三种邮件作用域 `public-test`**，并**新开一组容器**承载它：

- 无门禁（`PUBLIC_FRONTEND=true` + `INTERNAL_PREVIEW=false`）
- 用「模拟邮件」但**允许非回环地址**（因为作用域是 `public-test`，不是 `loopback`）
- 仍然**只允许 `.test` 保留域邮箱**（不能注册真实邮箱）
- 验证码直接在 API 响应里返回（`simulationCode`），跟内部预览一样
- **独立数据目录**，不污染生产库
- **不暴露** `/internal/` 内部资料

---

## 第一节 · 服务器现状（已实测，别重新摸索）

### 1.1 连接方式

| 项 | 值 |
|---|---|
| 主机 | `66.42.56.29`（主机名 `yubenzhe-sg-01`） |
| 用户 | `root` |
| 密钥 | `work/server-access/yubenzhe-singapore-20261009.pem`（在仓库外，`C:\Users\Administrator\Documents\Codex\2026-10-09\git-2\work\server-access\`） |
| 系统 | Ubuntu / kernel 6.8.0-146 |
| 资源 | 磁盘剩 58G、内存 3.9G（用 766M） |

### 1.2 现有部署（**不要动**）

**Docker Compose 四容器**：

| 容器 | 镜像 | 端口 |
|---|---|---|
| `yubenzhe-acceptance-frontend-1` | `yubenzhe-public:0.14.0-dev.10-final` | `127.0.0.1:18808->8080` |
| `yubenzhe-acceptance-admin-1` | 同镜像 | `127.0.0.1:18809->8080` |
| `yubenzhe-acceptance-public-proxy-1` | `caddy:2.11.7-alpine` | 对外 443 |
| `yubenzhe-acceptance-ollama-1` | `ollama/ollama` | 内部 11434 |

**发布目录**：`/opt/yubenzhe/releases/0.14.0-dev.10-final`
**当前指向**：`ops/current` → 上述目录；`ops/image` = `yubenzhe-public:0.14.0-dev.10-final`
**数据目录**：`/opt/yubenzhe/state`、`ai-state`、`ollama-state`、`secrets`（linuxuser 所有，0700）
**历史发布**：0.10.0 / 0.11.0 / 0.11.1 / 0.12.0 / 0.12.1 / 0.13.0 / dev.10（都可回滚）

### 1.3 现有容器环境变量（frontend）

```
ROLE=frontend
BIND_HOST=0.0.0.0
PORT=8080
PUBLIC_ORIGIN=https://66.42.56.29
INTERNAL_PREVIEW=true      ← 门禁来源
PUBLIC_FRONTEND=false
M0_SIMULATION=false
```

---

## 第二节 · 代码改动清单（逐处）

### 改动 1 · `server/account-mail.mjs` 新增 public-test 适配器

**在 `createInternalPreviewMailAdapter` 之后新增**：

```js
export function createPublicTestMailAdapter({origin}={}){
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)
    throw Error('Public test mail requires an explicit HTTPS origin.');
  return simulationMail(url.origin,'public-test');
}
```

`simulationMail(origin,scope)` 是现成的内部函数，`scope` 传 `'public-test'` 即可。

⚠️ **不改** `createSimulationMailAdapter` 的回环校验（那是 `loopback` 作用域的约束，保持原样）。

### 改动 2 · `server/account-access.mjs` 放开 public-test 的两处检查

**位置 A（约 L24，`ensureMail`）**：

现状：
```js
if(mail.mode==='simulation'&&mail.scope!=='internal-preview'&&!loopback(ip))
  fail(403,'SIMULATION_LOCAL_ONLY','模拟邮件仅限本机验证环境。');
```

改为：
```js
const trustedSimulationScope=mail.scope==='internal-preview'||mail.scope==='public-test';
if(mail.mode==='simulation'&&!trustedSimulationScope&&!loopback(ip))
  fail(403,'SIMULATION_LOCAL_ONLY','模拟邮件仅限本机验证环境。');
```

**位置 B（约 L25，`requirePreviewTestEmail`）**：

现状：
```js
if(mail.scope==='internal-preview'&&!value.split('@')[1]?.endsWith('.test'))
  fail(403,'INTERNAL_TEST_EMAIL_ONLY','内部预览请使用 example.test 测试邮箱。');
```

改为：
```js
const testOnlyScope=mail.scope==='internal-preview'||mail.scope==='public-test';
if(testOnlyScope&&!value.split('@')[1]?.endsWith('.test'))
  fail(403,'TEST_EMAIL_ONLY','测试通道只能使用 .test 保留域邮箱。');
```

⚠️ 注意：改错误码时要确认没有测试或前端依赖 `INTERNAL_TEST_EMAIL_ONLY` 这个字符串；如有依赖，保留原码并新增分支。

### 改动 3 · `server/product-modules.mjs` 增加 publicTest 分支

**L21 现状**：
```js
const mail=mailAdapter||(internalPreview?createInternalPreviewMailAdapter({origin}):simulation?createSimulationMailAdapter({origin}):createMailAdapterFromEnvironment({env:mailEnv}));
```

改为（新增 `publicTest` 参数与分支）：
```js
const mail=mailAdapter||(internalPreview?createInternalPreviewMailAdapter({origin}):publicTest?createPublicTestMailAdapter({origin}):simulation?createSimulationMailAdapter({origin}):createMailAdapterFromEnvironment({env:mailEnv}));
```

同时在函数签名解构里加 `publicTest=false`，并 import `createPublicTestMailAdapter`。

**校验（新增，放在 L17 附近）**：
```js
if(publicTest&&(internalPreview||simulation))
  throw Error('PUBLIC_TEST_MAIL must not be combined with INTERNAL_PREVIEW or M0_SIMULATION.');
```

### 改动 4 · `server/start.mjs` 读取并校验新环境变量

**L21 附近**加：
```js
const publicTest=process.env.PUBLIC_TEST_MAIL==='true';
```

**校验规则（新增）**：
- `publicTest=true` 时：
  - 必须 `role==='frontend'`
  - 必须 `PUBLIC_FRONTEND=true`（无门禁）
  - 必须 `INTERNAL_PREVIEW=false` 且 `M0_SIMULATION=false`
  - `PUBLIC_ORIGIN` 必须是**显式 HTTPS origin**（协议、host、无账号密码、无路径）
  - 必须提供 `EMAIL_OTP_SECRET`（≥32 字符，持久）
- ⚠️ **不放松** `L23` 的 `M0_SIMULATION` 回环校验（那是另一条线路）

把 `publicTest` 传进 `createProductModules({...})`。

### 改动 5 · `server/server.mjs` 确认无门禁路径

**无需改动**，但要在验收时确认：
- `L83-84`：`publicFrontend=true` 时不显示门禁页 ✅
- `L87-94`：门禁分支都以 `internalPreview` 为前置条件，`internalPreview=false` 时不进入 ✅

⚠️ **不要动这两段逻辑**，只做确认。

### 改动 6 · 测试

新增测试覆盖：
1. `createPublicTestMailAdapter` 拒绝非 HTTPS / 带路径 / 带账号密码的 origin
2. `publicTest` 与 `internalPreview`/`simulation` 组合时抛错
3. `public-test` 作用域下：`.test` 邮箱可取到 `simulationCode`
4. `public-test` 作用域下：非 `.test` 邮箱（如 `a@gmail.com`）返回 403
5. `loopback` 作用域行为**未变**（回归）
6. `internal-preview` 作用域行为**未变**（回归）

---

## 第三节 · 部署改动（新容器）

### 3.1 构建新镜像

用**当前最新代码**（含 A/B 组）构建：

```
yubenzhe-test:0.14.0-dev.13-test
```

构建步骤参照现有 `Dockerfile`（`node:24-bookworm-slim` 基底）。

⚠️ **前端构建顺序**（照既有约定）：
```
pnpm --dir tongban install --frozen-lockfile
pnpm --dir tongban build
node yubenzhe-deploy/scripts/stage-frontend.mjs tongban/dist
```
⚠️ **不要**把 `/internal/` 内部资料放进测试镜像（那是内部预览专属）。

### 3.2 新增 compose 文件（独立一组，不动现有 compose）

新建 `compose.test.yaml`，包含**一个 frontend-test 容器**：

| 环境变量 | 值 |
|---|---|
| `ROLE` | `frontend` |
| `BIND_HOST` | `0.0.0.0` |
| `PORT` | `8080` |
| `PUBLIC_ORIGIN` | `https://66.42.56.29:<新端口>`（见 3.3） |
| `INTERNAL_PREVIEW` | `false` |
| `PUBLIC_FRONTEND` | `true` |
| `M0_SIMULATION` | `false` |
| **`PUBLIC_TEST_MAIL`** | **`true`** |
| `EMAIL_OTP_SECRET` | 复用现有（≥32 字符） |
| `SOCIAL_DATABASE_PATH` | **独立目录**，见 3.4 |

**端口映射**：宿主机 `127.0.0.1:18810->8080`（避开现有 18808/18809）

### 3.3 HTTPS 与 Caddy（**已实测可行，有现成先例**）

**结论：用新端口，走同一套 Let's Encrypt IP 证书。服务器现在就是这么给 admin 做的。**

**实测证据**——服务器上 `/opt/yubenzhe/releases/0.9.0/Caddyfile.public`（注意：Caddy 配置与证书数据放在 **0.9.0 目录**，独立于版本发布，所以升级版本不会动它）：

```
https://66.42.56.29 {
    tls {
        issuer acme {
            dir https://acme-v02.api.letsencrypt.org/directory
            profile shortlived
        }
    }
    reverse_proxy 127.0.0.1:18808
}

# Independent authenticated product administration
https://66.42.56.29:8443 {
    tls {
        issuer acme {
            dir https://acme-v02.api.letsencrypt.org/directory
            profile shortlived
        }
    }
    reverse_proxy 127.0.0.1:18809
}
```

→ **同一 IP 的不同端口各自走 ACME 签 IP 证书**，已有先例。`profile shortlived` 即 Let's Encrypt 的 IP 证书档位（实测 443 的证书 `SAN: IP Address = 66.42.56.29`，受系统信任）。

**要做**：在 Caddyfile **追加第三段**（端口避开已用的 443 与 8443）：

```
https://66.42.56.29:9443 {
    tls {
        issuer acme {
            dir https://acme-v02.api.letsencrypt.org/directory
            profile shortlived
        }
    }
    reverse_proxy 127.0.0.1:18810
}
```

⚠️ **改完用 `caddy reload`（容器内执行），不要 `docker compose restart`** —— 那会打断生产服务。

⚠️ **还要放行 9443**：检查 `ufw status` 与 Vultr 侧的防火墙规则，两边都要开。

### 3.3.1 ⚠️ 必须同时改一处前端校验（**本任务的关键门槛**）

`tongban/src/deployment-config.js:2` 现在**拒绝带端口的地址**：

```js
function httpsURL(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash
     ||url.port||url.hostname.endsWith('.cn'))        // ← url.port 被明确拒绝
    throw Error('Invalid public deployment URL.');
  return url.href.replace(/\/$/,'');
}
```

而且 `L6` 要求 pathname 必须是 `/`：

```js
const previewOrigin=httpsURL(env.YBZ_PREVIEW_ORIGIN||defaults.previewOrigin);
if(new URL(previewOrigin).pathname!=='/')throw Error('YBZ_PREVIEW_ORIGIN must be an origin.');
```

→ **「路径分流」和「带端口」两条路里，只有带端口能走，且必须先放开这一处。**

**改法（最小改动，不要放松所有 URL）**：新增一个只给 `previewOrigin` 用的函数：

```js
function publicOrigin(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname.endsWith('.cn'))
    throw Error('Invalid public deployment URL.');
  if(url.pathname!=='/')throw Error('YBZ_PREVIEW_ORIGIN must be an origin.');
  return url.origin;
}
```

把 `L6` 的 `previewOrigin` 改用 `publicOrigin(...)`；其余 URL（`rpcUrls` / `explorerUrl` / `faucetUrl` / `ollamaDownloadUrl`）**保持 `httpsURL` 不变**。

**安卓 / Electron 端不需要改**（已核实）：
- `DeploymentConfig.java`：`PREVIEW_ORIGIN` 是编译期生成的字符串常量，**无端口校验** ✅
- `yubenzhe-desktop/src/device-manager.cjs:11` 的 `trustedOrigin()` 用 `url.origin` 比较，**端口本来就是 origin 的一部分** ✅

**测试通道地址定为**：`https://66.42.56.29:9443`

### 3.4 独立数据目录（**重要**）

```
mkdir -p /opt/yubenzhe/test-state
chown 1000:1000 /opt/yubenzhe/test-state
chmod 700 /opt/yubenzhe/test-state
```

测试容器挂载 `/opt/yubenzhe/test-state`，**不挂载生产 `state/` / `ai-state/`**。

理由：测试注册的账号写进生产库会污染真实数据。

⚠️ 首次启动会自动跑迁移（001–028），这是预期行为。**不要**把测试库和生产库混用。

### 3.5 隔离要求（硬）

- ❌ **不修改**现有 `compose.yaml` / `compose.internal.yaml` / `.env`
- ❌ **不动**现有四个容器（frontend / admin / proxy / ollama）
- ❌ **不改** `ops/current` 和 `ops/image`
- ❌ **不共享**数据目录
- ❌ 测试容器**不挂载** `public/frontend/internal`

---

## 第四节 · 安全红线（本任务最重要的一节）

| # | 红线 | 理由 |
|---|---|---|
| **S1** | `PUBLIC_TEST_MAIL` 必须**默认关闭**，只能由显式环境变量开启 | 防止误在生产开启 |
| **S2** | `public-test` 作用域**只允许 `.test` 保留域**邮箱 | `.test` 是 RFC 保留域，永不真实存在，不可能误发给真人 |
| **S3** | 必须校验 `PUBLIC_ORIGIN` 是**完整的 HTTPS origin** | 沿用内部预览的严格校验风格 |
| **S4** | `public-test` 与 `internalPreview`/`simulation` **互斥**，组合即抛错 | 避免模式混淆造成的提权 |
| **S5** | **不得放松** `M0_SIMULATION` 的回环约束（`start.mjs:23`、`product-modules.mjs:19`） | 那是防止模拟码泄露到公网的原始防线 |
| **S6** | **不得修改** `internal-preview` 作用域的任何现有校验 | 生产安全边界，动了就是回归 |
| **S7** | 测试容器**不得暴露** `/internal/` 内部资料（商业计划书 PDF 等） | 无门禁实例上这些资料等于公开 |
| **S8** | 测试容器**不得**共用生产数据目录 | 防止测试数据污染真实账号 |
| **S9** | 测试通道**不得**开启真实链上资金、真实 Gas 代付、真实邮件 | 延续既有红线 |
| **S10** | 测试通道**必须**可以**一条命令停掉**（`docker compose -f compose.test.yaml down`） | 测完即撤 |

---

## 第五节 · 验收标准（24 项）

### 代码（6 项）
1. `createPublicTestMailAdapter` 存在，拒绝非 HTTPS / 带路径 / 带账号密码
2. `publicTest` 与另外两个模式组合时抛错
3. `.test` 邮箱在测试通道能拿到 `simulationCode`
4. 非 `.test` 邮箱在测试通道返回 403
5. `loopback` 作用域回归测试通过（行为未变）
6. `internal-preview` 作用域回归测试通过（行为未变）

### 部署（6 项）
7. `compose.test.yaml` 存在且**只定义测试容器**
8. 测试容器端口为 `18810`；Caddy 新监听 `9443`（与已用的 443 / 8443 不冲突）；`18808` / `18809` 未被改动
9. 测试容器使用 `/opt/yubenzhe/test-state`，**未挂载**生产目录
10. 现有四容器**状态未变**（`docker ps` 对比迁移前后）
11. `ops/current` 与 `ops/image` **未变**
12. `compose.yaml`、`compose.internal.yaml`、`.env` **未变**（可用哈希证明）

### 端到端（6 项）
13. `GET https://`66.42.56.29:9443`/healthz` 返回新版本号
14. `GET https://`66.42.56.29:9443`/api/social/access/capabilities` **不再返回 `INTERNAL_PREVIEW_REQUIRED`**
15. 用 `xxx@example.test` 走完「请求验证码 → 校验 → 注册成功」，**验证码能在响应里读到**
16. 用 `a@gmail.com` 请求验证码 → **403**
17. 测试通道的账号**不出现在生产库**（分别查两库的账号表对比）
18. 生产网页服务 `https://66.42.56.29/` **仍正常**（门禁仍在、版本仍为 dev.10 或你升到的新版）

### 安全（4 项）
19. `/internal/business-plan.pdf` 在测试通道**不可访问**
20. 测试通道响应头包含 HTTPS 与安全头（对照现有 Caddy 配置）
21. `docker compose -f compose.test.yaml down` 能一条命令停掉
22. 全项目搜 `PUBLIC_TEST_MAIL`，除本任务新增处外**零命中**
23. `publicOrigin()` **只用于 `previewOrigin`**；`rpcUrls` / `explorerUrl` / `faucetUrl` / `ollamaDownloadUrl` 仍走原 `httpsURL`（带端口的地址在这些位置**依然被拒**）
24. Caddy 变更用 `caddy reload` 生效，**未重启** compose；`docker ps` 显示原有四容器 uptime 连续未中断

---

## 第六节 · 回滚

**测试通道回滚**（最简单）：
```
ssh root@66.42.56.29
cd /opt/yubenzhe/test
docker compose -f compose.test.yaml down
```
→ 生产服务完全不受影响（因为从未动过）。

**如果生产出了问题**（不应发生，但要有预案）：
- 生产当前回滚点：`/opt/yubenzhe/backups/pre-internal-cutover-20261011T004550Z`
- 详细回滚步骤见 `docs/INTERNAL-PREVIEW-RUNBOOK.txt` 第六节
- ⚠️ 回滚 SQLite 必须用 backup API，**不能只复制 .sqlite 主文件**（会漏 WAL）
- ⚠️ 停写后**成套备份**三库，不能逐库备份（跨库时刻不一致）

---

## 第七节 · 不要做的事

- ❌ 不要在现有容器上改环境变量来「顺便试试」
- ❌ 不要改 `ops/current` / `ops/image`
- ❌ 不要修改 `internal-preview` 的既有校验
- ❌ 不要放松 `M0_SIMULATION` 的回环约束
- ❌ 不要把测试数据写进生产目录
- ❌ 不要在测试镜像里放 `/internal/` 资料
- ❌ 不要开主网、不要真实 Gas 代付、不要真实邮件、不要接云服务商、不要做分佣
- ❌ 不要碰 `45.76.163.5` / `202.182.103.202` / `106.53.203.33`（这三台与本任务无关）
- ⚠️ `45.77.247.167`（另一台 AI 工具云机）**当前离线**，与本任务无关，不要去唤醒它

---

## 第八节 · 顺带要做的一件事（可选，用户另行确认）

用户希望测试通道跑**最新版本**。所以构建测试镜像时**用当前 HEAD**（含 U 组界面重构、A 组多钱包、B 组 Tab 徽标与消息菜单）。

⚠️ 但**生产通道仍停在 dev.10** —— **不要**顺手把生产也升级。生产升级是**另一件事**，需用户单独确认（要停写 + 成套备份 + 隔离演练）。

---

## 附：证据索引

| 结论 | 依据 |
|---|---|
| 门禁拦截 API | 实测 `GET /api/social/access/capabilities` → 401 `INTERNAL_PREVIEW_REQUIRED` |
| 门禁分支条件 | `server/server.mjs:83-84`、`L87-94` |
| publicFrontend 无门禁 | `server/server.mjs:83`（`!publicFrontend` 才显示门禁页） |
| simulation 绑回环 | `server/start.mjs:23` |
| simulation origin 必须回环 | `server/product-modules.mjs:19` |
| 邮件适配器选择 | `server/product-modules.mjs:21` |
| 内部预览作用域校验 | `server/account-mail.mjs:8-11` |
| 模拟邮件 IP 校验 | `server/account-access.mjs:24` |
| `.test` 邮箱限制 | `server/account-access.mjs:25` |
| 内部预览模式校验 | `server/internal-preview.mjs:9-16` |
| 部署结构 | 服务器实测 `docker ps` / `ls /opt/yubenzhe` |
| 安卓只信系统 CA | `tongban-android/android/app/src/main/res/xml/network_security_config.xml` |
| Let's Encrypt IP 证书 | 实测 443 握手：`issuer: Let's Encrypt`, `SAN: IP Address = 66.42.56.29` |
| 升级/回滚步骤 | `docs/INTERNAL-PREVIEW-RUNBOOK.txt` 第六节 |
| 部署与构建命令 | `yubenzhe-deploy/README.txt` |
