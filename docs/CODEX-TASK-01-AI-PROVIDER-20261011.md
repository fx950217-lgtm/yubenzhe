# Codex 任务 01：把 AI 供应商从 OpenAI 换成 DeepSeek

日期：2026-10-11
依据：`docs/V1.0-SCOPE-AND-EXECUTION-20261011.md` 3.1 节
性质：**单一任务，独立提交**

---

## 背景（给 Codex 的上下文）

当前 `ai-provider.mjs` 把供应商端点**硬编码**为 OpenAI：

```js
const ENDPOINT = 'https://api.openai.com/v1';
const ALLOWED_HOSTS = new Set(['api.openai.com']);
```

因此只填 `AI_API_KEY` 无法切换供应商——请求会被自己的 host 白名单拦住。
DeepSeek 是 OpenAI 兼容接口，所以**沿用 `openai` 这条代码分支，只换端点和白名单**。

DeepSeek 事实（已核实，2026-10-11）：
- `base_url` = `https://api.deepseek.com`（`/v1` 后缀可选，与模型版本无关）
- 模型：`deepseek-v4-flash`（便宜档）/ `deepseek-v4-pro`
- ⚠️ 旧 ID `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 退役，不要使用
- 完全 OpenAI 兼容，走 `/chat/completions`

---

## 任务

### 1. 修改 host 白名单（只改这一处配置）

文件：`yubenzhe-deploy/server/ai-provider.mjs`

```js
const ENDPOINT = 'https://api.deepseek.com/v1';
const ALLOWED_HOSTS = new Set(['api.deepseek.com']);
```

**只改这两行**。理由：代码第 49 行已有校验
`endpoint.protocol !== 'https:' || !ALLOWED_HOSTS.has(endpoint.hostname)`，
换成 DeepSeek 后该校验依然成立（HTTPS + 在白名单内），**不需要改校验逻辑本身**。

### 2. 必须保留的安全约束（一个都不能删）

| 约束 | 位置 | 为什么保留 |
|---|---|---|
| `redirect: 'error'` | `call()` 的 fetch 选项 | 防 SSRF 重定向 |
| host 白名单校验 | 第 49 行 | **真实防线，不是形式** |
| 用户输入只进 `user` role | `BASE_INSTRUCTIONS` 逻辑 | 防 prompt 注入 |
| 响应体大小上限 | `boundedJson` | 防内存耗尽 |
| 超时上限 30s | `Math.min(timeoutMs, 30000)` | 防挂死 |
| 错误不回传上游 body | catch 分支 | 防 Key 泄露 |
| `AI_LIMITS` 限流 | 文件顶部 | 保持不动 |

**特别注意**：供应商名（`AI_PROVIDER` 的值）目前是 `'openai'`。
本次**不要把 `'openai'` 改名成 `'deepseek'`**——那会牵动
`readAiProviderConfiguration`、`createAiProvider`、所有测试、
以及 `start.mjs` 的环境变量校验，属于无收益的大改。
`'openai'` 在这里的含义是「OpenAI 兼容协议」，DeepSeek 走这个分支是正确用法。

> 如果你判断改名收益确实大于成本，**先不要动手**，在提交说明里写清影响面，
> 我确认后再单独开一个任务做。

### 3. 更新受影响的测试

文件：`yubenzhe-deploy/tests/ai-workspace.test.mjs`
（第 106 行，测试标题 `Adapters: OpenAI request scope and secret boundary; ...`）

现在这一行断言 URL 前缀是 `https://api.openai.com/v1/`：

```js
assert.ok(captured.every(x=>x.url.startsWith('https://api.openai.com/v1/')));
```

改为断言 DeepSeek：

```js
assert.ok(captured.every(x=>x.url.startsWith('https://api.deepseek.com/v1/')));
```

同时**复核该测试的意图不要被削弱**——它验证的是「请求真的发到白名单内的域名」。
建议顺手再加一条负向断言（如果测试里还没有）：

```js
// 攻击者控制的地址必须无效：配置里塞 AI_BASE_URL 不应改变实际端点
const cfg = readAiProviderConfiguration({AI_PROVIDER:'openai',AI_MODEL:'m',AI_API_KEY:'k'.repeat(20),AI_BASE_URL:'https://attacker.example'});
// 用该 cfg 构造 provider，断言捕获到的 URL 仍以 https://api.deepseek.com/v1/ 开头
```

### 4. 全仓库搜索残留

执行后确认**没有遗漏**：

```bash
grep -rn "api.openai.com" yubenzhe-deploy/ tongban/ docs/ --include="*.mjs" --include="*.js" --include="*.md" --include="*.txt" --include="*.json"
```

- 命中的**代码/测试文件**：全部改掉
- 命中的**文档文件**（`docs/` 下的历史审计报告）：**不要改**，那些是历史记录，
  改了会破坏审计的可追溯性。只需在提交说明里列出命中的文档清单。

### 5. 更新 `.env.example`

文件：`yubenzhe-deploy/.env.example`

当前是：

```
# Default: requests and reviews work; inference remains disabled.
AI_PROVIDER=disabled
AI_MODEL=
AI_API_KEY=
```

补充 DeepSeek 示例（保持默认仍为 `disabled`，不要改默认值）：

```
# Default: requests and reviews work; inference remains disabled.
AI_PROVIDER=disabled
AI_MODEL=
AI_API_KEY=
# For DeepSeek (OpenAI-compatible, endpoint pinned to https://api.deepseek.com/v1):
#   AI_PROVIDER=openai
#   AI_MODEL=deepseek-v4-flash
#   AI_API_KEY=<your DeepSeek key>
# Do NOT use legacy ids deepseek-chat / deepseek-reasoner (retired 2026-07-24).
```

---

## 验收标准

1. `cd yubenzhe-deploy && node --test tests/ai-workspace.test.mjs` → 全过
2. `cd yubenzhe-deploy && node --test tests/*.test.mjs` → **226 passed / 0 failed**（与改动前一致）
3. `grep -rn "api.openai.com" yubenzhe-deploy/` → **只在文档里命中，代码里零命中**
4. 提交信息里写明：改了哪两行、测试改了哪一行、文档残留清单

---

## 明确不要做的事

- ❌ 不要改 `AI_LIMITS`（成本变了但用量未知，等跑一周再调）
- ❌ 不要动 `BASE_INSTRUCTIONS`（合规红线，与供应商无关）
- ❌ 不要把 `'openai'` 这个供应商标识改名
- ❌ 不要改 `docs/` 下的历史审计文档
- ❌ 不要提交任何真实 API Key
