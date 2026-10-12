# Codex 执行情况核对
**核对时间**：2026-10-11 20:15
**方法**：逐份任务书对照代码 + 实跑测试 + curl 公网（不猜）

---

## 零、总览：三份任务，做了 1 份

| 我给你的任务书 | 内容 | 状态 |
|---|---|---|
| `CODEX-SHARE-TO-DISCOVER` | 成果分享到发现 | ✅ **做完了**（上一轮核实过） |
| `CODEX-WORKBENCH-REPOSITION` | 工作台定位调整 | ✅ **做完了，而且做得更好** |
| `CODEX-PATH-A-PHASE1` | 一键装AI + 推荐问卷 | ❌ **完全没做** |
| `CODEX-PERSONAL-PROFILE` | commit + 自用档位 | ❌ **没做**（commit 仍未执行） |

---

## 一、✅ 定位调整：做完了，而且超出要求

### 1.1 副标题 + 说明（我要求的，全做了）

`workbench-hub.js` 第 34 行实测：
```
<h1>工作台</h1>
<p class="wh-hero-subtitle">把你的电脑变成 AI 工作站</p>
<p class="wh-hero-description">帮你装好 AI、配好环境、连上手机。不用懂技术。</p>
<p class="wh-hero-quote">技能交给 AI，判断留给自己。</p>
```

✅ 副标题改了
✅ 一行人话说明加了
✅ 品牌 quote **降为小字保留**（正是我要求的）
✅ 主按钮改为「**连接我的电脑 →**」（比原来的「新建任务」更贴定位）

### 1.2 首页入口撤下（做得很聪明）

我要求撤下赏金/服务商/活跃榜/趣味币。**Codex 的做法比我要求的更好：**

它用了 `<template data-retired-home-entries>` 把它们**包起来**：
```html
<template data-retired-home-entries>
  创作者中心 / 赏金论坛 / 服务商 / 活跃榜 / 趣味币发行
</template>
```

**这意味着**：代码**一个字都没删**，只是浏览器不会渲染 `<template>` 里的内容。
将来想恢复，删掉 `<template>` 标签就行。**这是"保留但撤下"的最优雅实现。**

首页现在只剩三项（我要求的）：
```
我的设备      · 连接自己的电脑 · Windows 连接器可用
云端电脑      · 没有电脑时使用 · 待接入
模型与工具    · 查看安装说明 · 自动推荐与自动安装待接入
```

### 1.3 ⭐ 我要求的关键那句话，加了，而且加得更好

我要求加「我们不提供 AI 本身。我们负责把它装好、配好、连上你的手机。」

实测第 34 行确实有：
```html
<p class="wh-foot">我们不提供 AI 本身。我们负责把它装好、配好、连上你的手机。</p>
```

**它还主动多写了三句我没要求的**（但都很好）：
```html
<p class="wh-hero-availability">当前可连接电脑、查看安装说明；自动推荐、自动安装和云电脑待接入。</p>
<p class="wh-muted">当前需你按说明安装；需要账号的 AI，需你自行登录。第三方 AI 的订阅或用量费用由你向服务商支付。</p>
```

> **这两句正是我反复强调的「诚实标注」** —— 它主动做了，说明理解了设计意图。

### 1.4 场景说明（我要求的两句，都加了）

```
设备页：      适合你已经有电脑的情况。
云端电脑页：  适合你还没有电脑，或者电脑不方便带着走的情况。
```

### 1.5 三步引导（我要求的，加了）

`personal-devices.js` 第 12 行：
```
① 手机装 App      → 链接到 install.html
② 电脑装连接器    → 下载 YBZ-电脑连接器.zip
③ 装 AI           → 如实标注「自动推荐与自动安装待接入」
```

**而且它多做了一件我没要求的事**：
`yubenzhe-deploy/public/frontend/downloads/YBZ-电脑连接器.zip` **真的生成了**，
所以第②步的下载链接是**能点的**，不是死链。

### 1.6 文件小工具正名（我要求的，做了）

原来叫「新建任务」，现在首页区块标题是「**文件小工具**」，说明写着：
> 「不用 AI 也能整理文件。添加的文件会发送到当前工作台服务处理；在线使用时会上传服务器。」

⚠️ **注意这里有个细节**：我要求写「不会上传文件」，但 Codex 写的是「**在线使用时会上传服务器**」。

**它是对的，我错了。** 因为前端的文件任务确实要把文件传到后端处理（`workbench-service.mjs` 有文件上传）。
**它没有为了迎合我的要求而写虚假文案** —— 这点值得表扬。

---

## 二、❌ 路径A第一期：完全没做

我上一轮给的 `CODEX-PATH-A-PHASE1-20261011.txt`，逐项核实：

| 我要求的 | 实际 | 状态 |
|---|---|---|
| `device-bridge/install.ps1` | 不存在 | ❌ |
| `server/ai-catalog.json` | 不存在 | ❌ |
| `POST /api/devices/:id/install` | 无 | ❌ |
| `POST /api/devices/ai-recommendation` | 无 | ❌ |
| AI 推荐问卷（3 题） | 无 | ❌ |
| Ollama 一键装 | 无 | ❌ |
| 安装接口防 RCE 设计 | 无 | ❌ |

**`device-bridge/` 目录的文件时间戳全是 14:15 左右** —— 也就是**上一轮做的，本轮没动过**。

**结论：路径A第一期，一行都没写。**

---

## 三、❌ commit：依然没做

```
git log --oneline -1
→ 1a98e74 Archive 0.9.0 manifest and baseline current dev.7 source
```

**`git log` 的第一条还是 dev.7 时代的提交。**

| 时间 | 改动文件数 |
|---|---|
| 13:55 | 74 |
| 18:20 | 108 |
| **20:15** | **114** |

**又多了 6 个文件，还是没提交。**

这是**连续第三次**提醒了。风险持续累积：
- 114 个文件的工作量
- 含整个设备桥、云电脑后端、成果分享、定位调整
- **全在未提交的工作区里**

---

## 四、测试与公网（实测数据）

| 项目 | 结果 |
|---|---|
| **前端测试** | **441 / 441 全绿** ✅ |
| 后端测试 | 299 项，298 通过，1 失败 |
| 失败原因 | `EBUSY` —— 本地服务占用 node.exe，**非代码问题** |
| **公网版本** | **仍是 dev.10**（没升版本） |

**注意**：定位调整做完了，但**没升版本号、没部署到公网**。
所以**公网上看到的还是旧文案**，你在本地才能看到新的。

---

## 五、我的判断：为什么"做了这个没做那个"

从结果看，Codex 的行为模式是：

| 任务类型 | 它做不做 |
|---|---|
| **改文案、改界面、调层级** | ✅ 做，而且做得好 |
| **加新功能（带安全设计）** | ✅ 做（设备桥、成果分享） |
| **纯运维/流程类（commit、部署）** | ❌ **反复不做** |
| **我最新给的任务** | ❌ 可能还没收到 / 还没跑 |

**推测**：
1. **定位调整是你直接让它做的**（你说"给我一个提示词我让 codex 调整"，说明你发了）→ 所以做了
2. **路径A任务书可能你还没发给它** → 所以没做
3. **commit 它一直没做** —— 这个可能是它**在等你明确许可**（因为提交是"不可逆"动作，而且项目有"不要 commit 等我看报告"的历史约定）

---

## 六、建议

### 立刻做（一条指令）

```
请立即执行以下操作，不要做其他改动：

1. 先检查是否有敏感文件会被提交：
   - yubenzhe-deploy/device-bridge/device-state.json（含设备 token，绝对不能提交）
   - 任何 .env / *.db / *.sqlite / access-hash.json / otp-secret
   如果有，先加入 .gitignore

2. 按逻辑分组 commit（不要一个大 commit）：
   - overseas region & deployment config standardization
   - cloud desktop backend skeleton
   - moment artifact sharing to discover
   - personal device bridge and remote control
   - cloud chat via ollama
   - workbench repositioning (install-manager positioning)
   - documentation

3. 不要 push。

4. 完成后贴出：git log --oneline -15 和 git status --short
```

### 然后

如果路径A任务书你还没发，**现在发**。
如果已经发了但 Codex 没动，**再发一次**，可以加一句「这是当前最高优先级的开发任务」。

---

## 七、一句话总结

> **✅ 定位调整：做完了，而且做得比我要求的更好**
> （撤入口用了 `<template>` 保留代码、主动补了诚实标注、没有为迎合我而写虚假文案）
>
> **❌ 路径A（一键装AI + 推荐问卷）：完全没做**
> **❌ commit：连续第三次没做，114 个文件悬着**
>
> **最紧急的还是 commit。** 它比任何功能都重要 —— 因为功能可以重做，但丢了就没了。

---

## 附：本轮实测原始输出

```
前端：tests 441 / pass 441 / fail 0
后端：tests 299 / pass 298 / fail 1  (EBUSY，环境问题)

curl https://66.42.56.29/healthz
→ {"version":"0.14.0-dev.10","stage":"internal-preview"}

git log --oneline -1
→ 1a98e74  (仍是 dev.7 时代)

git status --short | wc -l
→ 114

workbench-hub.js:34
→ <p class="wh-hero-subtitle">把你的电脑变成 AI 工作站</p>
→ <p class="wh-foot">我们不提供 AI 本身。我们负责把它装好、配好、连上你的手机。</p>

device-bridge/ 时间戳：14:10–14:22（本轮未改动）
device-bridge/install.ps1：不存在
server/ai-catalog.json：不存在
```
