# Codex 任务 02：接入真实邮件投递服务商

日期：2026-10-11
依据：`docs/V1.0-SCOPE-AND-EXECUTION-20261011.md` 3.2 节
性质：**单一任务，独立提交**（不要和任务 01 混在一个 commit 里）

---

## 背景（给 Codex 的上下文）

`yubenzhe-deploy/server/account-mail.mjs` 目前只有三个适配器，**没有一个能真的发信**：

| 适配器 | mode | 行为 |
|---|---|---|
| `createDisabledMailAdapter` | `'disabled'` | 默认，调用 `send()` 直接抛错 |
| `createSimulationMailAdapter` | `'simulation'` | 只把邮件塞进内存 outbox，且仅限 loopback |
| `createInternalPreviewMailAdapter` | `'simulation'` | 同上，但仅限 HTTPS 内测域 |

文件末尾注释已经写明了契约：

```
// A delivery provider implements {mode:'provider',send({to,kind,code,expiresAt,locale})}.
// A production provider and OTP HMAC secret must be explicitly injected; no network is used by default.
```

**本次要做的事**：按这个契约实现一个真实的 provider 适配器。

### 调用方的约束（已确认，实现必须满足）

`server/account-access.mjs` 第 13 行有强制校验：

```js
if (mail.mode === 'provider' && (!config.otpSecret || config.otpSecret.length < 32))
  throw Error('Provider mail requires a persistent OTP secret of at least 32 characters.');
```

即：**只要 mode 是 `'provider'`，`EMAIL_OTP_SECRET` 必须存在且 ≥32 字符，否则服务直接启动失败。**

`ensureMail()`（第 24 行）的分支逻辑：`disabled` 直接 fail 503、`simulation` 非 loopback 就 403。
新增的 `provider` 模式**不应被这两个分支拦到**——实现时确认 `ensureMail` 对 `mode==='provider'` 是放行的。

---

## 任务

### 1. 在 `account-mail.mjs` 中新增 provider 适配器

**要求**：

- 导出函数命名 `createHttpMailAdapter`（或你判断更合适的名字，但要在提交说明里写清）
- 返回对象必须满足：`{ mode: 'provider', async send({to, kind, code, expiresAt, locale}) }`
- **保留原有的三个适配器一行不动**
- 配置从环境变量读取，**不要硬编码任何 Key 或发信地址**
- 遵循仓库现有风格：单文件、无第三方 SDK（若必须用 SDK，先说明理由）

**建议的实现方式**：直接 `fetch` 服务商的 HTTP API，避免引入依赖。
三家主流服务商的接口形状不同，建议**先用一个中性接口抽象**：

```js
// 伪代码示意，不是最终实现
export function createHttpMailAdapter({ endpoint, apiKey, from, timeoutMs = 10000 } = {}) {
  // endpoint 必须是 https，否则 throw
  // apiKey 必须非空且长度合理
  // from 必须是合法邮箱
  return {
    mode: 'provider',
    async send({ to, kind, code, expiresAt, locale }) {
      // 1. 校验参数
      // 2. 组装邮件正文（用 locale 选语言；kind 区分登录/改邮箱等场景）
      // 3. fetch(endpoint, { method:'POST', redirect:'error', headers:{Authorization:...}, body, signal })
      // 4. 非 2xx 抛错，但**不要**把上游响应体拼进错误消息（防泄露）
      // 5. 超时用 AbortController
    }
  };
}
```

### 2. 必须遵守的安全约束（对齐 ai-provider.mjs 的既有标准）

| 约束 | 说明 |
|---|---|
| `redirect: 'error'` | 不跟随跳转，防 SSRF |
| endpoint 必须 `https:` | 拒 http |
| **不要把上游响应体放进错误消息** | 上游可能回显你的 Key |
| 超时上限 | `AbortController` + 10s 量级上限 |
| 日志里**不得**出现验证码明文 | 只记 challengeId / 邮箱域 |
| `to` 地址做格式校验 | 复用 `normalizeEmail` 的思路（该函数在 `account-access.mjs` 里，注意不要造成循环依赖） |

### 3. 邮件正文（用现有语言策略）

仓库有 i18n 意识（`locale` 参数已传入）。第一版**中英各一份**即可，
不要自己发明第三语言。正文至少包含：

- 验证码（醒目、易复制）
- 有效期 `expiresAt`
- 「不是本人操作请忽略」提示
- **绝不**索要助记词、私钥、密码

### 4. 接线（让 provider 真的能被启用）

需要改的地方：

1. `server/product-modules.mjs` 第 15 行现在是：

```js
const mail = mailAdapter || (internalPreview ? createInternalPreviewMailAdapter({origin}) : simulation ? createSimulationMailAdapter({origin}) : undefined);
```

   需要增加 `provider` 分支：环境变量配好时返回 `createHttpMailAdapter(...)`，
   否则维持原行为（`undefined` → 上层落到 `disabled`）。

2. `server/start.mjs` 的环境变量白名单/校验（如有）需要加入新变量名。
   **先读一遍再改**，不要凭猜。

### 5. 新增环境变量

在 `.env.example` 追加（**默认保持关闭**）：

```
# Real email delivery (optional). When unset, email verification stays disabled.
# EMAIL_PROVIDER=http
# EMAIL_ENDPOINT=https://api.example-mail.com/v3/mail/send
# EMAIL_API_KEY_FILE=/run/secrets/email_api_key
# EMAIL_FROM=no-reply@yourdomain.com
# EMAIL_OTP_SECRET=<at least 32 random characters; persistent; never rotate casually>
```

⚠️ 优先支持 `*_API_KEY_FILE` 读文件的方式（`ai-provider.mjs` 已有此模式，
且读文件时会检查 `statSync().mode & 0o077`）。**直接放环境变量的 Key 容易进日志。**

### 6. 新增测试

在 `yubenzhe-deploy/tests/` 下新增或扩展测试，至少覆盖：

1. `mode` 是 `'provider'`
2. 注入 mock `fetchImpl`，断言请求发到了配置的 endpoint、带了 `Authorization`
3. endpoint 是 `http:` 时构造失败
4. 上游返回 500 时 `send()` 抛错，且**错误消息里不含上游响应体内容**
5. `otpSecret` 短于 32 字符时，`account-access.mjs` 启动校验抛错（这条可能已有，确认一下）
6. **回归**：`disabled` / `simulation` / `internal-preview` 三个适配器行为不变

---

## 验收标准

1. `cd yubenzhe-deploy && node --test tests/*.test.mjs` → **全过，且总数 ≥ 226 + 新增数**
2. 不配置任何 EMAIL_* 变量时，服务行为**与改动前完全一致**（邮件仍是 disabled）
3. 源码里 grep 不到任何真实邮箱、真实 Key
4. 提交信息里写明：新增文件/函数名、新增环境变量清单、新增测试数

---

## 明确不要做的事

- ❌ 不要改 `createDisabledMailAdapter` / `createSimulationMailAdapter` / `createInternalPreviewMailAdapter` 的现有行为
- ❌ 不要默认打开邮件（默认必须仍为 disabled，避免误发信）
- ❌ 不要提交真实 API Key 或真实发信域名
- ❌ 不要自行注册/购买任何邮件服务（那是运营动作，由我来做）
- ❌ 不要为此引入重量级 SDK（优先原生 fetch）
