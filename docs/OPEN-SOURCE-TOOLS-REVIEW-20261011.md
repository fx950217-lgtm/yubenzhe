# 四条外部信息核查 + 我们能用的部分

日期：2026-10-11
回答两个问题：① 这些哪些是我们项目能用的 ② 这些开源库哪些我们用得上

---

## 一句话结论

**四条里只有一条（Anthropic 11 套插件）是能直接拿进项目的；两条只能当"演示素材"；一条不能用（要 Mac + Xcode + 苹果开发者账号，你现在一个都没有）。**

另外，**这四条里有 6 处说法我在官方来源里查不到**，下面单独列出来 —— 别拿这些当决策依据。

---

## 一、先说哪些能查实、哪些查不到（最重要）

| 视频里的说法 | 我查到的情况 | 判定 |
|---|---|---|
| free-claude-code 是一个开源项目 | ✅ 真实存在，GitHub `Alishahryar1/free-claude-code`，MIT 许可 | **真实** |
| "13 亿 token 免费额度" | ❌ 官方 README 里没有这个数字 | **未查实，存疑** |
| "4.6 万 star" | ⚠️ 三个来源分别说 4.6万 / 20,900 / 870+，**互相对不上** | **未查实** |
| iPhone Use 让 Codex 通过 USB 操作真机 | ✅ 真实，`zhongerxin/iPhone-use`，基于 WebDriverAgent | **真实** |
| iPhone Use "支持 iOS 14 至 iOS 16.6" | ❌ 官方反而要求 **macOS + 完整 Xcode + Apple 开发者账号**，这是硬门槛，视频没提 | **视频漏了最关键的条件** |
| iPhone Use "随机延迟 + 定期切换 Face ID 防封" | ❌ 在任何官方来源都找不到 | **未查实，疑似编造** |
| Anthropic 推出 11 套 Claude 插件 | ✅ 真实，`anthropics/knowledge-work-plugins`，Apache-2.0 | **真实** |
| AI 操控手机的"Jev 模型"每条决策 0.4 秒 | ❌ 查不到叫"Jev"的模型 | **未查实，疑似听写错误** |

**只用已查实的部分做决策。** 上面标"未查实"的三条，等能打开官方页面确认了再说。

---

## 二、逐条评估

### ① free-claude-code —— 有借鉴价值，但不是"免费 Claude"

**它到底是什么**（官方自己的话）：
> "This isn't a free Claude Code. It's a way to route Claude Code's interface to different backends."
> 这不是一个免费的 Claude Code，它只是把 Claude Code 的界面接到别的后端上。

**工作原理**：在你电脑上装一个小服务（localhost:8082），把 Claude Code 发给 Anthropic 的请求拦下来，转发到 NVIDIA NIM / OpenRouter / DeepSeek / Ollama / Kimi 这些更便宜的接口上。

**对我们有什么用** —— ⭐ **有一块思路值得抄**：

它的**按档位路由**（per-tier routing）设计：
```
MODEL_OPUS   = "nvidia_nim/moonshotai/kimi-k2.5"      # 最难的任务 → 贵的模型
MODEL_SONNET = "open_router/deepseek/deepseek-r1"      # 普通任务 → 中等模型
MODEL_HAIKU  = "ollama/qwen2.5:7b"                     # 简单任务 → 本地免费模型
```

**这正好是我们 AI 适配层该有的东西**。我的建议：**不装它，抄它的思路** —— 我们已经有了 `AI_PROVIDER` 开关，下一步就是给每个档位配不同的后端。这样：
- 用户不填 API Key → 走本地 Ollama（免费）
- 用户填了 Key → 难任务走贵模型，简单任务走便宜模型
- **用户账单能降 60% 以上**

**不要装它的理由**：
1. 它是给 **Claude Code 这个特定工具**做的补丁，我们的产品不是 Claude Code
2. 官方自己承认**工具调用准确度是最大问题**（免费模型调工具经常调错）—— 我们做的是"AI 帮你装东西"，调错工具 = 装错东西，**这个风险我们不能接受**
3. NIM 免费档限速 40 次/分钟，用户体验会碎

**结论：🟡 抄思路，不装代码。**

---

### ② iPhone Use —— ❌ 我们完全用不了，但可以当演示素材

**真实项目**（注意：视频里说的和这个对不上）：
- 仓库：`zhongerxin/iPhone-use`，作者是前豆包桌面端产品经理钟二信
- 原理：Codex 通过 **USB 线**连真机，底层用 **WebDriverAgent (WDA)**
- 有 17 个工具，MIT 许可，支持中文输入，不用越狱

**为什么我们用不了 —— 三条硬门槛，一条都绕不过**：

| 要求 | 你有吗 |
|---|---|
| **macOS 电脑**（Windows 不行） | ❌ 你是 Windows |
| **完整版 Xcode**（必须 Mac 才能装） | ❌ 装不了 |
| **Apple 开发者账号**（用来签名 WDA Runner） | ❌ 没有，而且**你正在卡的就是这个** |

**还有个更根本的问题**：这个工具是用来**操作 iPhone 的**。但我们的 App 是 **Android 的**（`tongban-android/`）。它对我们的产品**没有任何直接作用**。

**但它有一件事对我们特别有用**：**当演示素材**。

我们的定位是"你告诉 AI 要什么，它在后台干完，你回来看结果"。**演示"AI 干完活"最有冲击力的画面，就是让 AI 操作一部真手机**——下单、刷视频、发消息。iPhone Use 的视频可以拿来给用户看，说明"这就是我们做的东西的方向"。

**结论：❌ 不能用（技术门槛 + 平台不对）；✅ 可作演示素材。**

---

### ③ Anthropic 11 套插件 —— ⭐ 这是唯一一条能直接拿进项目的

**已查实**：
- 仓库：`anthropics/knowledge-work-plugins`
- Apache-2.0 许可（**允许商用，无限制**）
- 2026 年 1 月推出，22,000+ star
- 11 个：Productivity / Marketing / Sales / Finance / Data Analysis / Legal / Product Management / Customer Support / Enterprise Search / Biology Research / Cowork Plugin Management

**它的结构长什么样 —— 这是最有价值的部分**：

```
plugin-name/
├── .claude-plugin/plugin.json   ← 清单文件（叫什么、给谁用）
├── .mcp.json                    ← 要连哪些外部服务
├── commands/                    ← 斜杠指令（如 /sales:call-prep）
└── skills/                      ← 领域知识（AI 自动触发）
```

**关键点：它里面没有一行"代码"，全是 Markdown + JSON。** 也就是说：

**⭐ 我们的"文件工具模板"（`docs/CODEX-TOOLBOX-CATALOG-20261011.txt` 里那套）可以直接照着这个格式改造。**

好处有三个：
1. **格式已被验证** —— 全球 2.2 万人用这套结构，说明它是对的，不用我们自己发明
2. **纯文本，用户能自己改** —— 符合我们"用户自己定义工具"的方向
3. **Apache-2.0，抄结构合法** —— 无商业限制

**具体怎么用**：把我们现有安装清单里的每个工具（比如"装 Node 环境"、"配 Git"、"装手机调试桥"），写成一个这样的目录：

```
tools/install-node/
├── plugin.json      ← {"name":"install-node","desc":"给用户装 Node 环境"}
├── commands/
│   └── install.md   ← 点一下就执行
└── skills/
    └── knowledge.md ← AI 判断"什么时候该用这个"
```

**结论：⭐ 直接抄格式，这是这四条里唯一能落地的。**

---

### ④ AI 操控手机（视频没给名字，但我查到了实际项目）

视频说得含糊（"免连接控制""Jev 模型 0.4 秒"），**但这类项目的真实生态我查到了**，而且**对我们是相关的**（因为我们的 App 是 Android）：

| 项目 | 要不要 Root / 电脑 | 许可 | 对我们的价值 |
|---|---|---|---|
| **OpenDroid** | 不用 Root，只用无障碍服务 | Apache-2.0，**明确无商业限制** | ⭐ **最推荐参考** |
| **PhoneUse**（nidhoggfgg） | 不用 Root、不用 ADB | MIT | ✅ 可参考 |
| **Andclaw**（andforce） | 不用 Root、**不用电脑**，纯手机端跑 | 待查 | ✅ 可参考 |
| iPhone-use / Phone-harness | 要 Mac | MIT | ❌ 平台不对 |

**⭐ 为什么 OpenDroid 特别值得看**：它是唯一一个**自己在 README 里写明"compliant with Google Play Store policies"（符合 Google Play 商店政策）**的。你正要注册 Google Play 上架我们的 App —— **"什么做法不算违规"这个答案，人家已经帮你踩过坑了**。

它用的是 Android 无障碍服务（AccessibilityService），这是**唯一一个在 Google Play 里合法**的自动化路径。（对比：用 adb / 注入 / 模拟点击这些方式上架会被拒。）

**结论：✅ 值得花 1 小时读一遍 OpenDroid 的 README，尤其看它怎么做到合规。**

---

## 三、⚠️ 一个必须提醒的合规红线（延续上一轮"代开账户"的结论）

这四个工具里，**有三个的"典型用法"是拿 AI 自动操作微信 / 小红书 / 抖音去做批量获客**。

**这件事的风险和上一轮"代开账户"是同一类**：

| 风险 | 依据 |
|---|---|
| 违反平台用户协议 | 微信/抖音等明确禁止自动化操作，轻则封号 |
| **触及刑法** | 《刑法》287 条之二 —— 为他人犯罪提供"技术支持"可判刑 |
| **触及反诈法** | 《反电信网络诈骗法》第 31 条 —— 不得"虚构代理关系"开立账号 |

**所以使用原则是**：这四类工具**只能用在用户自己的账号上、用户自己授权的前提下**。**绝不做"我们替客户批量操作账号"** —— 这和上一轮说的"代开账户"是同一个坑。

**OpenDroid 那条合规路线（无障碍服务 + 用户自己开权限）是唯一安全的模式。**

---

## 四、落地清单（按优先级）

| 优先级 | 动作 | 预计耗时 | 说明 |
|---|---|---|---|
| **P0** | 把"文件工具模板"改成 Anthropic 的 `plugin.json` 格式 | 半天 | 唯一能直接进产品的 |
| **P0** | AI 适配层加"按档位路由"（难任务→贵模型，简单任务→本地） | 1 天 | 抄 free-claude-code 思路，能省钱 |
| **P1** | 读 OpenDroid README，记录"Google Play 允许哪些自动化" | 1 小时 | 上架前必看 |
| **P2** | iPhone Use 视频存起来当演示素材 | 5 分钟 | 仅素材 |
| **❌** | 装 free-claude-code / iPhone Use | —— | 都不装 |

---

## 五、下一步可以发我这句话

> 把 `docs/CODEX-TOOLBOX-CATALOG-20261011.txt` 里现有的工具清单，改成 Anthropic 插件那种目录格式（每个工具一个文件夹，含 plugin.json + commands + skills），先做 3 个样板给我看。

---

## 附录：事实来源

| 内容 | 来源 | 状态 |
|---|---|---|
| free-claude-code 存在、MIT、路由原理 | GitHub `Alishahryar1/free-claude-code` README | ✅ 已查实 |
| free-claude-code 官方自我评价 | 同上，"This isn't a free Claude Code..." | ✅ 已查实 |
| "13 亿 token 额度""4.6 万 star""Jev 模型" | —— | ❌ 未查实 |
| iPhone-use（zhongerxin）存在、要 Mac+Xcode+开发者账号 | GitHub `zhongerxin/iPhone-use` README | ✅ 已查实 |
| "支持 iOS 14–16.6""随机延迟 + 切换 Face ID" | —— | ❌ 未查实 |
| Anthropic 11 插件、Apache-2.0、22,000+ star、目录结构 | GitHub `anthropics/knowledge-work-plugins` | ✅ 已查实 |
| OpenDroid 合规声明、Apache-2.0 | GitHub `yashab-cyber/opendroid` README | ✅ 已查实 |
| PhoneUse / Andclaw 免 Root | 各自 GitHub README | ✅ 已查实 |
| 反诈法第 31 条、刑法 287 条之二 | 全国人大法律原文 | ✅ 已查实 |
