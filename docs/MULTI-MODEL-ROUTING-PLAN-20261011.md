# 借用 free-claude-code 思路，给我们的聊天接入多模型

日期：2026-10-11
结论：**不用装它，也不用抄代码。我们已有的 `ai-provider.mjs` 架构已经对了，只要松绑 3 个写死的地方。**

---

## 一、先说一个好消息：我们已经有这个东西了

看了代码，`yubenzhe-deploy/server/ai-provider.mjs` 现在是这样的：

```
AI_PROVIDER=openai   →  走 createAiProvider()        → DeepSeek
AI_PROVIDER=ollama   →  走 createOllamaProvider()    → 本机 Ollama
AI_PROVIDER=disabled →  关闭
```

**「一个开关切换不同 AI 供应商」这个骨架已经在了。** 而且里面有几处设计得比 free-claude-code 还严谨（比如它禁止任何用户输入影响主机地址、有指纹校验、有额度限制）。

**所以我们要做的不是"接入"，是"松绑"。**

---

## 二、现在写死了哪 3 个地方

| # | 位置 | 现在写死的 | 问题 |
|---|---|---|---|
| 1 | `ai-provider.mjs:7` | `const ENDPOINT='https://api.deepseek.com/v1'` | 只能连 DeepSeek |
| 2 | `ai-provider.mjs:8` | `const ALLOWED_HOSTS=new Set(['api.deepseek.com'])` | 只允许这一个域名 |
| 3 | `ai-provider.mjs:77` | `payload:{...max_output_tokens:...}` 走 `/responses` | 这是 DeepSeek 私有格式，**不是标准的 `/chat/completions`** |

**第 3 条最关键**：我们现在用的是 DeepSeek 的 `/responses` 接口（OpenAI 新格式）。而**表里所有其他家**（NVIDIA NIM、OpenRouter、智谱、Kimi）都是标准的 `/chat/completions`。

**这两套格式不一样，所以现在就算改了域名也连不上别家。**

---

## 三、要抄 free-claude-code 的哪两个思路

### 思路 ① 按档位路由（per-tier routing）—— 直接抄

它是这么干的：
```
MODEL_OPUS   = "nvidia_nim/moonshotai/kimi-k2.5"    # 难任务
MODEL_SONNET = "open_router/deepseek/deepseek-r1"    # 普通任务
MODEL_HAIKU  = "ollama/qwen2.5:7b"                   # 简单任务（本地免费）
```

**我们怎么用** —— 我们的 `AI_USE_CASES` 已经分了三类，天然可以映射：

| 我们的用途 | 建议档位 | 建议模型 | 为什么 |
|---|---|---|---|
| `research`（资料整理） | 重档 | Kimi K2.5 / GLM-5 | 要读长文本，上下文要够 |
| `content`（内容创作） | 中档 | DeepSeek-V4 / GLM-4.7 | 中文创作，性价比高 |
| `customer_service`（客服草稿） | 轻档 | 本机 Ollama qwen3 | 简单改写，零成本 |

**省钱效果**：客服草稿这种简单活本来也发去 DeepSeek 付费，现在改走本机免费模型，**这部分成本直接归零**。

### 思路 ② 输出过滤 / 本地处理 —— 部分抄

free-claude-code 有「RTK 过滤」，能省最多 90% token。**我们不一定要抄它的实现**（我们是聊天不是终端），但有一个**能立刻用上的版本**：

**在 `boundedJson` 之后加一层"输入裁剪"** —— 用户贴一大段文字进来（我们 `maxInputChars=6000`），可以先在本地做：
- 去掉重复空行
- 去掉超长 URL
- 超长内容只保留首尾 + 中间抽样

**这不需要调任何 API，纯本地字符串处理，省的是实打实的 token 钱。**

---

## 四、具体改什么（给 Codex 的施工单）

### 改动 1：`ai-provider.mjs` 增加「供应商注册表」

把写死的常量换成一个可配置表：

```js
// 供应商定义（新增）
const PROVIDER_REGISTRY = Object.freeze({
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1',
    hosts: ['api.deepseek.com'],
    protocol: 'responses',        // DeepSeek 私有格式，保持不变
    defaultModel: 'deepseek-v4-flash',
  },
  nvidia_nim: {
    endpoint: 'https://integrate.api.nvidia.com/v1',
    hosts: ['integrate.api.nvidia.com'],
    protocol: 'chat_completions', // 标准格式
    defaultModel: 'z-ai/glm4.7',
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1',
    hosts: ['openrouter.ai'],
    protocol: 'chat_completions',
    defaultModel: 'deepseek/deepseek-r1',
  },
  zhipu: {   // 智谱（中国，直连更快）
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    hosts: ['open.bigmodel.cn'],
    protocol: 'chat_completions',
    defaultModel: 'glm-4.7',
  },
  moonshot: { // Kimi（中国）
    endpoint: 'https://api.moonshot.cn/v1',
    hosts: ['api.moonshot.cn'],
    protocol: 'chat_completions',
    defaultModel: 'kimi-k2.5',
  },
});
```

**注意**：这里 `ALLOWED_HOSTS` 仍然必须是**白名单集合**，不能变成"用户随便填"。**安全设计保持不变** —— 这很重要，别改坏。

### 改动 2：`ENDPOINT` / `ALLOWED_HOSTS` 改成按选择取

```js
// 原来：const ENDPOINT = 'https://api.deepseek.com/v1';
//       const ALLOWED_HOSTS = new Set(['api.deepseek.com']);

// 改成：
const providerKey = String(env.AI_PROVIDER || 'disabled');
const provider = PROVIDER_REGISTRY[providerKey];
const ENDPOINT = provider?.endpoint;
const ALLOWED_HOSTS = new Set(provider?.hosts || []);
```

### 改动 3：`run()` 里按 `protocol` 分支

```js
async run({purpose, requirements, prompt, history = [], signal}) {
  if (!Object.hasOwn(PURPOSE_INSTRUCTIONS, purpose)) {
    throw providerError('AI_INVALID_SCOPE', '工作区用途无效。', 400);
  }
  const systemText = BASE_INSTRUCTIONS + '\n' + PURPOSE_INSTRUCTIONS[purpose];
  const userText = '工作区需求（用户资料）：\n' + requirements + '\n\n本次任务：\n' + prompt;

  if (provider.protocol === 'responses') {
    // ===== 原有 DeepSeek 路径，一个字不改 =====
    const data = await call('/responses', { ... 原样 ... });
    ...原有解析...
  }

  // ===== 新增：标准 chat/completions 路径 =====
  const data = await call('/chat/completions', {
    method: 'POST', signal,
    payload: {
      model: config.model,
      stream: false,
      max_tokens: AI_LIMITS.maxOutputTokens,
      messages: [
        { role: 'system', content: systemText },
        ...history,
        { role: 'user', content: userText },
      ],
    },
  });
  const output = data?.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) {
    throw providerError('AI_INVALID_RESPONSE', '模型没有返回可用文本，本次任务未完成。');
  }
  const usage = ...从 data.usage 取...
  return { output: output.trim(), usage };
}
```

### 改动 4：`.env.example` 加说明（照抄语法）

```env
# ===== AI 供应商选择（三选一）=====
# 1) DeepSeek（默认，走私有 /responses 格式）
AI_PROVIDER=openai
AI_MODEL=deepseek-v4-flash
AI_API_KEY=
AI_BASE_URL=https://api.deepseek.com/v1

# 2) NVIDIA NIM（免费档 40 次/分钟，模型多）
# AI_PROVIDER=nvidia_nim
# AI_MODEL=z-ai/glm4.7
# NVIDIA_NIM_API_KEY=nvapi-xxx

# 3) 智谱（中国直连，延迟低，适合东南亚用户）
# AI_PROVIDER=zhipu
# AI_MODEL=glm-4.7
# ZHIPU_API_KEY=xxx

# ===== 按用途分档（可选，抄 free-claude-code 思路）=====
# 不填就统一用 AI_MODEL
AI_MODEL_RESEARCH=nvidia_nim/moonshotai/kimi-k2.5
AI_MODEL_CONTENT=zhipu/glm-4.7
AI_MODEL_CUSTOMER_SERVICE=ollama/qwen3:0.6b
```

---

## 五、⚠️ 三条要守住的边界（别改坏）

这个项目在安全上写得很讲究（注释里明确写了「no user input, prompt, model output or configurable proxy can select the host」）。**改的时候必须保持**：

| 必须保持 | 原因 |
|---|---|
| ✅ **主机白名单仍是硬编码集合** | 绝不能变成"用户能填任意 URL" → 那是 SSRF 漏洞 |
| ✅ **现有 DeepSeek 路径一行不改** | 线上跑着的东西，别动 |
| ✅ **`validateServiceURL` 里的 `.cn` 拦截要重新想** | ⚠️ **见下方警告** |

### ⚠️ 一个坑：现在代码禁止 `.cn` 域名

`deployment-config.mjs:8` 有一句：

```js
url.hostname.endsWith('.cn') → throw Error('Invalid configured service URL.')
```

**这意味着智谱（`open.bigmodel.cn`）和 Kimi（`api.moonshot.cn`）现在会被直接拦掉。**

这条规则是**故意加的**（防止数据流向境内），**要不要放开得你决定** —— 如果我们的用户主要在越南/东南亚，连中国的模型延迟更低、更便宜；但如果考虑数据合规，就得用它们的**国际站**（如 `z.ai`）。

**我建议**：加一个**单独的白名单例外**，只对明确指定的两个域名放开，不要整体去掉 `.cn` 拦截。

---

## 六、这件事的优先级判断

| 项 | 我的判断 |
|---|---|
| **急不急** | 🟡 **不急**。现在 DeepSeek 能跑，用户还没开始用 |
| **该不该做** | ✅ **该做**，但等有第一个真实用户之后再做 |
| **为什么** | 没用户的时候，"省钱"是省不出来的；有用户了才知道哪个用途最费钱，才知道该给哪档配便宜模型 |
| **现在能做的** | 只做**改动 1 + 改动 2**（注册表 + 松绑），**20 分钟**，不碰业务逻辑，零风险 |

**建议路径**：先做改动 1+2 把架子搭好（零风险），`run()` 的分支（改动 3）等真要用的时候再加。

---

## 七、和 free-claude-code 的对比（为什么抄而不装）

| | free-claude-code | 我们自己改 |
|---|---|---|
| 定位 | 给 Claude Code 个人用 | 给我们产品多用户用 |
| 配置 | localhost 单实例单配置 | 服务端统一配置 |
| 免费额度 | NIM 1000 积分/月，条款限"原型" | 各家 Key 自己掌控 |
| 商用 | ❌ 条款不允许 | ✅ 用自己的 Key，合规 |
| 工具调用 | ⚠️ 官方承认不可靠 | 我们本来就不做工具调用 |
| 改动量 | 装一堆东西 | **20 分钟改 2 个常量** |

**结论：思路值钱，代码不值钱。抄思路。**

---

## 八、下一步可以发我这句话

> 按 `docs/MULTI-MODEL-ROUTING-PLAN-20261011.md` 的改动 1 + 改动 2 实现 AI 供应商注册表（只搭架子，不动 `run()` 逻辑，不动现有 DeepSeek 路径），改完跑现有测试确认全绿。

---

## 附录：事实来源

| 内容 | 来源 |
|---|---|
| 我们现有架构（`AI_PROVIDER` 开关、两个 provider） | `yubenzhe-deploy/server/ai-provider.mjs` 实读 |
| 三处写死位置及行号 | 同上，第 7、8、77 行 |
| `.cn` 拦截规则 | `yubenzhe-deploy/server/deployment-config.mjs:8` 实读 |
| free-claude-code per-tier routing 语法 | GitHub README（`MODEL_OPUS` / `MODEL_SONNET` / `MODEL_HAIKU`） |
| NVIDIA NIM 端点与限制（40 RPM、1000 积分/月） | build.nvidia.com 官方 + 第三方实测 |
| 各家端点地址 | 各家官方文档 |
