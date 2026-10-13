# 国内可用的开源「Codex 类」工具（2026-10-13 实查）

> 你要的：**国内能用、开源的、类似 Codex 的命令行 AI 干活工具**。
> 我查了官方文档和第三方实测，下面每一个都标了**来源可信度**。

---

## 一、结论：先看这三个

| 排名 | 工具 | 谁做的 | 开源许可 | 一句话 |
|---|---|---|---|---|
| 🥇 | **Qwen Code** | 阿里（通义） | **Apache-2.0** | 最成熟、生态最全、**能接 Ollama 本地模型** |
| 🥈 | **OpenCode** | 社区（anomalyco） | **MIT** | 第三方实测**最快 + 最省 token**，多模型切换最灵活 |
| 🥉 | **Kimi Code CLI** | 月之暗面 | **MIT** | 上下文 256K，支持 OpenAI 兼容协议 |

**另外两个也真开源，但方向不同**：
- **CodeBuddy Code**（腾讯）—— 功能很强，但**不是开源软件**，是免费工具（npm 包）。国内直连最顺。
- **GLM/ZCode**（智谱）—— 模型开源，**工具本身不是开源项目**，是智谱的配套 CLI。

---

## 二、逐个说清楚

### 🥇 Qwen Code（阿里通义）

| 项 | 值 |
|---|---|
| 仓库 | `github.com/QwenLM/qwen-code` |
| 许可 | **Apache-2.0**（真开源） |
| 出身 | 基于 Google Gemini CLI v0.8.2 二次开发（官方在 README 里明确致谢），从 v0.1 起独立发展 |
| 模型 | 通义千问系列；**也支持 OpenAI / Anthropic / Gemini 协议 + 本地 Ollama / vLLM** |
| 免费额度 | ⚠️ **第三方文章称"中国大陆每日 2000 次免费"** —— 但**官方文档现在说的是付费方案**（Token Plan / Coding Plan / 按量付费），**免费额度这事你要自己上官网确认，我不敢打包票** |

**安装**（Windows，管理员 cmd）：
```
curl -fsSL -o %TEMP%\install-qwen.bat https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.bat && %TEMP%\install-qwen.bat --source bailian
```
或 npm：
```
npm install -g @qwen-code/qwen-code@latest
```
（需要 Node.js 22+）

**它有什么**：读写多文件、跑命令、Plan 只读规划模式、Skills、SubAgents、MCP、`QWEN.md` 项目记忆、无头模式（`qwen -p "..."` 适合脚本/CI）。

**为什么值得优先看**：
- **支持接本地模型**（Ollama）→ 装上 RTX 5070 可以**完全免费、无限次**
- 有 `qwen serve` 守护进程 + ACP 协议 → 别的 agent 可以委托它干活
- 官方还有一条「**Qwen Code Claw**」：让 Claude / Codex 把活委托给 Qwen Code

**⚠️ 注意**：工具的**壳子免费**，**模型要钱**（除非你接本地 Ollama）。官方文档列的模型：`qwen3.8-max`、`qwen3.7-plus`、`qwen3.6-flash`、`glm-5.2`、`deepseek-v4-pro` 等。

---

### 🥈 OpenCode（社区，MIT）

| 项 | 值 |
|---|---|
| 仓库 | `anomalyco/opencode` |
| 许可 | **MIT**（真开源，最宽松） |
| 出身 | 社区项目，**很多国内工具的底层就是它**（小米 MiMo-Code、华为 DevEco-Code 都是 fork 它做的增强版） |
| 特色 | 漂亮的 TUI 界面、**多 provider 支持、配置文件自定义工具权限**（权限隔离比 Claude Code 更透明） |

**第三方实测结论**（同一模型 `deepseek-v4-flash`、同一测试题、7 款工具横评）：
- 🏆 **OpenCode 最快（32 秒）+ 最省 token（11.7K）**，质量过关

**安装**：
```
npm install -g opencode-ai
opencode --version
```

**为什么值得看**：**轻量、架构现代、配置透明**、出问题容易定位。第三方的"新手建议"就是**从 OpenCode 起步**。

**⚠️ 缺点**：遇到模糊需求时，它倾向于"按最可能的解释直接执行"，**不像 Claude Code 会主动追问**。（这一点对你的产品挺重要——见下面第五节）

---

### 🥉 Kimi Code CLI（月之暗面）

| 项 | 值 |
|---|---|
| 许可 | **MIT** |
| 发布 | 2025-10-27 首发（当时叫 Kimi CLI），2026-01 改名 Kimi Code CLI |
| 模型 | Kimi K2.5 系列，**上下文 256K** |
| 特色 | 双模交互（Ctrl-X 切 Shell 模式 / Agent 模式）、原生支持 **ACP 协议**、支持**接第三方 OpenAI 兼容 API** |
| 另有 | **Kimi Code Desktop** 桌面客户端（macOS + Windows） |

**⚠️ 状态提醒**：据百度百科，项目**正在从 Python 重写为 Node.js + TypeScript**，处于「社区发展初期探索阶段」。**这意味着它现在的稳定性可能不如前两个。**

---

### CodeBuddy Code（腾讯）—— 不是开源，但国内最好用

| 项 | 值 |
|---|---|
| 许可 | ❌ **不是开源软件**（免费工具） |
| 安装 | `npm install -g @tencent-ai/codebuddy-code`（需要 Node 22+ 和 Git） |
| 特色 | 功能非常全：Plan & Think 模式、Skills、Hooks、SubAgents、MCP、Daemon 守护进程、`auto-mode` 自动分类 |

**⚠️ 为什么我要提它**：虽然不开源，但**国内直连最顺**（腾讯云），而且它有一条对你产品很关键的能力——

```
codebuddy -p "查询"
```
**无头模式**（跑完就退出，适合脚本调用）。还有 `codebuddy daemon start --port 8080`（守护进程 + HTTP 接口）。

**➡️ 对你的 YBZ 来说，"能不能被无头调用"比"开不开源"重要得多。**

---

### GLM / ZCode（智谱）

**要分清**：
- **GLM 是模型**（智谱 Z.ai）—— 模型权重开源
- **GLM Coding Plan 是套餐**（$18/月起）
- **ZCode 是智谱配套的 CLI** —— **不是开源项目**

第三方提醒：「**ZCode 是它们清单上的一个工具，不是 Claude Code 或 OpenCode 的替代品**」。

---

## 三、一张对比表

| 工具 | 开源 | 许可 | 能接本地模型 | 能无头调用 | 国内网络 | 成熟度 |
|---|---|---|---|---|---|---|
| **Qwen Code** | ✅ | Apache-2.0 | ✅ Ollama/vLLM | ✅ `qwen -p` | 🟢 最好 | 🟢 高 |
| **OpenCode** | ✅ | MIT | ✅ 任意兼容 | ✅ | 🟡 可 | 🟢 高（实测最快） |
| **Kimi Code CLI** | ✅ | MIT | ✅ | ✅ | 🟢 好 | 🟡 重写中 |
| **CodeBuddy Code** | ❌ | 专有（免费） | ？ | ✅ `-p` + daemon | 🟢 最好 | 🟢 高 |
| **ZCode**（智谱） | ❌ | 专有 | ？ | ？ | 🟢 好 | 🟡 |

**成本对照（大方向，具体自己查官网）**：
- **接本地 Ollama** → **完全免费**（你有 RTX 5070，跑得动中小模型）
- **按量付费 API** → 第三方实测说 `deepseek-v4-flash` 是"当前网关下最佳编码模型"，而且**便宜**
- **包月套餐** → GLM Coding Lite $18/月、OpenCode Go $10/月（后者是**按美元额度**算：$12/5小时、$30/周、$60/月）

---

## 四、⚠️ 三个坑（都是查证出来的）

### 1. 「开源」和「免费」是两回事
**壳子免费不代表模型免费。** 真正的成本大头在 API 调用。100% 免费只有一条路：**接本地 Ollama**。

### 2. 「免费额度」的说法要自己核实
第三方文章说「Qwen Code 中国大陆每日 2000 次免费」，但**官方文档现在列的是付费方案**。
**➡️ 我不替这个数字打包票，你上阿里云官网确认。**

### 3. 「模型」和「工具」不要搞混
这是最常见的误解：

| 层 | 是什么 | 谁提供 |
|---|---|---|
| **Agent（手）** | 读仓库、改文件、跑命令 | Claude Code / Codex / **OpenCode** / Qwen Code |
| **Model（脑）** | 决定手该干什么 | DeepSeek / GLM / Qwen / Kimi |
| **账单** | 脑怎么付钱 | 订阅 / 按量 / 本地免费 |

**DeepSeek 和 GLM 是"脑"，不是"手"。它们不提供 agent。**
「DeepSeek 的编程 agent」这个东西**不存在**——你要装的是 OpenCode 或 Qwen Code，然后把它指向 DeepSeek。

---

## 五、🎯 这件事跟你的 YBZ 有什么关系（重点）

你的平台现在**只接了 Codex**（`ai-registry.mjs` 里 Codex 是唯一 `executionMode: 'tools'`）。

**如果你要接国内的，我的建议顺序**：

| 顺位 | 接谁 | 为什么 |
|---|---|---|
| **1** | **Qwen Code** | ✅ **开源**（Apache-2.0）→ 可以合法集成；✅ **支持本地 Ollama** → 用户零成本；✅ **无头模式 `qwen -p`** → 好调用；✅ 国内网络最顺 |
| **2** | **OpenCode** | ✅ **MIT 最宽松**；✅ 实测最快最省 token；⚠️ 但它是 TUI 优先，无头调用要先验证 |
| **3** | **CodeBuddy Code** | 国内最顺、有 daemon，但**不开源**——集成前要看清许可 |
| 备 | Kimi Code CLI | 还在重写期，**先观察** |

**⚠️ 一个技术前提你必须知道**：
你现在的 `codex-runner.mjs` 用的是 `codex exec --json --sandbox workspace-write` 这套参数。
**换成任何一个新工具，都要重写一个 runner**（大概照抄 `codex-runner.mjs` 的结构，参数换成那个工具的无头模式）。

**⚠️ 另一个关键点（很可能会踩）**：
第三方实测发现——**OpenCode 面对模糊需求时会"按最可能的解释直接执行"，不像 Claude Code 会主动追问。**

**这正好撞上你产品的灵魂**：「人做决策，机器干活」——**机器应该在拿不准的时候停下来问你**。
所以如果你要接 OpenCode 这类工具，**"停下来问人"这个决策卡机制得由你的平台层兜住**（不能指望工具自己会问）。

**好消息**：你已经有这套机制了（`ai-decision-policy.mjs`）。

---

## 六、一句总结

> **最该看的是 Qwen Code**（阿里，Apache-2.0，能接本地 Ollama，国内最顺，有无头模式）。
> **最该对比的是 OpenCode**（MIT，实测最快最省 token，很多国产工具的底层）。
> **最省钱的用法**：装 Qwen Code 或 OpenCode + **接你本机 Ollama** → **无限次免费**。
> **最该注意的是**：壳子免费 ≠ 模型免费；而且工具自己不会"停下来问人"，**那得靠你的平台**。

---

## 附 · 证据与可信度标注

| 结论 | 来源 | 可信度 |
|---|---|---|
| Qwen Code 是 Apache-2.0 | 官方 GitHub README + qwen.ai 官网 | ✅ 官方 |
| Qwen Code 基于 Gemini CLI v0.8.2 | 官方 README 明确致谢 | ✅ 官方 |
| Qwen Code 支持 Ollama/vLLM、多协议 | 官方 README | ✅ 官方 |
| OpenCode 是 MIT，仓库 anomalyco/opencode | 第三方分析文章 | ⚠️ 第三方（建议 GitHub 复核） |
| OpenCode 实测最快 32s / 最省 11.7K token | 第三方横评（2026-08-04） | ⚠️ 第三方实测，条件有限 |
| Kimi Code CLI 是 MIT、256K 上下文、正在重写 | 百度百科 | ⚠️ 第三方百科 |
| CodeBuddy Code 不开源、有 `-p` 和 daemon | 腾讯官方文档 codebuddy.cn | ✅ 官方（"不开源"是我按许可描述判断） |
| 「Qwen Code 每日 2000 次免费」 | 第三方文章 | ⚠️ **待核实，官方文档未确认** |
| 「DeepSeek 没有官方编码 CLI」 | 第三方分析 | ⚠️ 第三方 |
