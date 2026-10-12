# 全套配置清单（AI 安装 + 邮箱 + 社交 + 工作流 + 服务器 + 域名）

> 用途：把「愚笨者」跑起来需要的所有外部资源，一次性统计成清单。
> 每一条都标注：**现在是什么状态** / **要不要花钱** / **要不要你亲自操作**。
> 统计时间：2026-10-11 · 对应版本 0.14.0-dev.10

---

## 一、一句话结论（先看这里）

| 项目 | 现在的状态 | 你还需不需要做什么 |
|---|---|---|
| **AI 安装脚本** | ❌ **还不存在**，只有连接器（远控） | 要让 Codex 做（任务书已附） |
| **邮箱** | ⚠️ 代码做好了，但**开关是关的** | 要买一家邮件服务，填 3 个值 |
| **社交** | ✅ **不需要任何外部服务商** | 什么都不用买 |
| **工作流** | ✅ 文件小工具能用，不依赖外部服务 | 什么都不用买 |
| **服务器** | ✅ **已经在跑**（新加坡，公网可访问） | 已跑通，不用再买 |
| **域名** | ❌ **你还没买**（现在用 IP 地址访问） | 要买一个，约 ¥60–80/年 |

**一句话人话版**：
> 服务器你已经有了，社交和工作流不用额外花钱。**真正缺的只有三样：域名、邮件服务、AI 安装脚本**。
> 前两样花钱能立刻解决（加起来一年不到 200 块），第三样是开发活，交给 Codex。

---

## 二、AI 安装脚本（你要的「一键装 AI」）

### 2.1 现在的真实情况

**目前工作台里没有 AI 安装脚本。** 我逐行核对过前端代码：

- `tongban/src/workbench-hub.js` 第 34 行首页写着：「当前可连接电脑、查看安装说明；**自动推荐、自动安装和云电脑待接入**」
- 第 62 行的「文件工具模板」只有 4 个**不需要 AI** 的规则小工具（订单去重、会议整理、活动清单、资料整理）
- 第 57 行「云端电脑」页：`<button disabled>开通一台云电脑（待接入）</button>`
- 全项目搜索 `ollama.com/download`，只出现在 `deployment-config.js` 里当**一个配置常量**，没有任何页面用它

**已经真实存在的只有「电脑连接器」**（远控，不是装 AI）：
`/downloads/YBZ-电脑连接器.zip`（33MB，含 node.exe，即开即用）

### 2.2 AI 推荐清单（四档，按你的要求分「免费 / 少量花费 / 效果好」）

| 档位 | 名字 | 安装方式 | 要登录吗 | 花钱吗 |
|---|---|---|---|---|
| **① 免费本地** | Ollama + Qwen3 | 一个 exe 双击装，模型一条命令拉下来 | 不要 | **完全免费** |
| **② 少量花费** | DeepSeek | 网页注册 → 拿 Key → 填进工作台 | 要（网页） | 按量付费，几分钱一次 |
| **③ 功能可以** | Codex CLI / Claude Code | 命令行装，扫码登录 | 要（扫码） | 有免费额度 |
| **④ 效果最好** | ChatGPT Plus / Claude Pro | 装桌面客户端，自己登录 | 要（自己登录） | 每月 $20 左右 |

### 2.3 每一档的官方地址（直接抄进工作台）

| 项目 | 官方网址 | 备注 |
|---|---|---|
| Ollama 下载 | `https://ollama.com/download` | 已存在于 `deployment-config.js` |
| Ollama 模型 | `qwen3:0.6b` | 服务器在用；本机可换更大的 |
| DeepSeek 开放平台 | `https://platform.deepseek.com` | 拿 API Key |
| DeepSeek 接口地址 | `https://api.deepseek.com/v1` | 已写进 `.env.example` |
| DeepSeek 模型名 | `deepseek-v4-flash` | ⚠️ **不要用 `deepseek-chat`（2026-07-24 已退役）** |
| OpenAI ChatGPT | `https://chatgpt.com` | 桌面版 |
| Anthropic Claude | `https://claude.ai` | 桌面版 |
| Codex CLI | `https://github.com/openai/codex` | 命令行 |
| 服务器内置模型 | `http://ollama:11434` | 仅服务器内网 |

### 2.4 ⚠️ 三个必须知道的现实（写给你，不写给客户）

1. **登录没法自动化**。ChatGPT、Claude 登录都要过验证码 / 手机验证，这是它们防机器人。所以「一键装」只能做到「一键装好，然后弹个框让客户自己登录」。
2. **会被杀毒软件拦**。安装程序 + 下载模型 = 典型可疑行为，Windows Defender 会报警。需要提前做代码签名（要花钱）或者干脆引导客户手动点「仍要运行」。
3. **法律责任**。你替客户装第三方 AI，如果装的是破解版或者绑定你的账号，可能踩到对方的服务条款。**所以只能装官方原版，账号必须客户自己的** —— 这条已经写进工作台文案了。

---

## 三、邮箱（发验证码用）

### 3.1 现在的真实情况

- 代码**已经写好**：`yubenzhe-deploy/server/account-mail.mjs`（5.4KB），有三个适配器
- **默认是关的**：`EMAIL_PROVIDER` 不填 → 走 `createDisabledMailAdapter`，直接抛错
- 内测阶段用「模拟邮件」：只在本地回环地址生效，不真发信
- **必须有一个密钥**：`EMAIL_OTP_SECRET`，至少 32 位随机字符，**一旦设定不能随便换**（换了所有人登录状态失效）

### 3.2 需要填的 4 个值

```
EMAIL_PROVIDER=http
EMAIL_ENDPOINT=https://api.xxx-mail.com/v3/mail/send
EMAIL_API_KEY_FILE=/run/secrets/email_api_key
EMAIL_FROM=no-reply@你的域名.com
EMAIL_OTP_SECRET=<32 位随机字符>
```

### 3.3 邮件服务商可选（都支持海外、按量付费）

| 服务商 | 官网 | 免费额度 | 上手难度 |
|---|---|---|---|
| **Resend** | `https://resend.com` | 3000 封/月免费 | ⭐ 最简单 |
| **Brevo** | `https://brevo.com` | 300 封/天免费 | ⭐⭐ 简单 |
| **Mailgun** | `https://mailgun.com` | 试用期免费 | ⭐⭐⭐ 中等 |
| **Amazon SES** | `https://aws.amazon.com/ses/` | 便宜（$0.10/千封） | ⭐⭐⭐⭐ 稍复杂 |

**推荐 Resend** —— 注册 5 分钟，免费额度够你验证阶段用一年。

⚠️ **注意**：`EMAIL_FROM` 必须是你自己的域名（比如 `no-reply@yubenzhe.com`）。这就是为什么**域名要先买**。

---

## 四、社交（不用花钱）

**结论：社交功能不需要任何外部服务商。**

理由（已核对代码）：
- 好友、群聊、朋友圈、动态、通知 —— 全部在你自己的服务器上，数据存在 `social.sqlite`
- 推送通知用的是 `web-push` 库（浏览器原生能力），不走第三方
- 成果分享到发现（`017-moment-artifacts.sql`）也是本地实现
- 唯一的外部依赖就是**邮件**（发验证码），见上一节

**所以社交这块：什么都不用买。**

---

## 五、工作流（不用花钱）

**结论：文件小工具不依赖任何外部服务。**

已核对的 4 个能用的小工具（`workbench-hub.js` 第 6 行 `WORKFLOW_STARTERS`）：

| 工具 | 干什么 | 状态 |
|---|---|---|
| 订单表去重 | CSV 去重 + 处理报告 | ✅ 可用 |
| 会议文字整理 | 删重复行 + 统计 | ✅ 可用 |
| 活动准备清单 | 生成待办结构 | ✅ 可用 |
| 资料整理与行动方案 | 三角色协作 | ⚠️ 待接入模型 |

**唯一需要外部东西的地方**：如果以后让 AI 真的去干活（第 4 个工具那种），就需要 **AI Key**（见第二节）。

---

## 六、服务器（已经在跑，不用再买）

### 6.1 你实际在用的（已跑通）

| 项目 | 值 |
|---|---|
| **服务器 IP** | `66.42.56.29` |
| **服务器名** | `yubenzhe-sg-01`（新加坡） |
| **安装路径** | `/opt/yubenzhe` |
| **当前版本** | `0.14.0-dev.10` |
| **健康检查** | `https://66.42.56.29/healthz` |
| **管理后台** | `https://66.42.56.29:8443/product-ops.html` |
| **容器** | 前面 Caddy（自动 HTTPS）+ 应用 + Ollama |

实测健康检查返回（真实数据）：
```json
{"ok":true,"service":"frontend","version":"0.14.0-dev.10",
 "stage":"internal-preview",
 "desktop":{"available":false,"code":"DESKTOP_UNCONFIGURED"}}
```

### 6.2 配置里的区域设置（注意别搞混）

`.env.example` 里写着 `DEPLOY_REGION=us-west-2`，**这只是默认配置值，不代表服务器搬到了美西**。你的服务器实际在新加坡。

可选区域共 5 个：`us-west-2` / `us-east-1` / `ap-northeast-1`（东京）/ `ap-southeast-1`（新加坡）/ `eu-west-1`（爱尔兰）

### 6.3 如果以后要扩服务器，推荐这几家

| 服务商 | 官网 | 特点 |
|---|---|---|
| **Vultr** | `https://vultr.com` | 新加坡/日本节点多，$6/月起 |
| **DigitalOcean** | `https://digitalocean.com` | 老牌，$6/月起，文档好 |
| **Hetzner** | `https://hetzner.com` | 最便宜，€4/月起，但只有欧美 |
| **AWS Lightsail** | `https://aws.amazon.com/lightsail/` | 和云电脑同一家，好打通 |

---

## 七、域名（你还没买，这是最优先的事）

### 7.1 现状

**你目前没有域名，项目还是用 IP 地址 `66.42.56.29` 访问。** 这有 3 个坏处：

1. **没法上架苹果/谷歌商店** —— 商店审核要看正式域名
2. **没法配邮箱** —— `EMAIL_FROM` 必须有域名
3. **客户记不住、不信任** —— IP 地址看起来像钓鱼站

### 7.2 域名注册商推荐（海外优先）

| 注册商 | 官网 | .com 价格 | 推荐度 |
|---|---|---|---|
| **Cloudflare Registrar** | `https://dash.cloudflare.com` | 按成本价，约 $10/年 | ⭐⭐⭐⭐⭐ 最推荐（无溢价、送 DNS、送 CDN） |
| **Porkbun** | `https://porkbun.com` | 约 $11/年 | ⭐⭐⭐⭐ 便宜、界面友好 |
| **Namecheap** | `https://namecheap.com` | 约 $11/年 | ⭐⭐⭐⭐ 老牌 |
| **阿里云/腾讯云** | `https://wanwang.aliyun.com` | 约 ¥60/年 | ⭐⭐ 便宜但需实名，海外业务不推荐 |

**推荐：Cloudflare** —— 买完直接送 DNS 管理 + 免费 CDN + 免费 SSL，一站式。

### 7.3 买完域名要做 3 件事

1. **解析到服务器**：加一条 A 记录，指向 `66.42.56.29`
2. **改 `YBZ_PREVIEW_ORIGIN`**：把 `https://66.42.56.29` 换成 `https://你的域名`
3. **配 HTTPS 证书**：项目已内置 ACME 自动申请（`https://acme-v02.api.letsencrypt.org/directory`），不用手动搞

---

## 八、其他「之前跑过」的东西

| 项目 | 地址 | 用途 |
|---|---|---|
| **GitHub 仓库** | `https://github.com/fx950217-lgtm/yubenzhe` | 源码 |
| **BSC 测试网 RPC** | `https://bsc-testnet-dataseed.bnbchain.org` | 链上功能 |
| **BSC 浏览器** | `https://testnet.bscscan.com` | 查交易 |
| **领测试币** | `https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/` | 测试用 tBNB |
| **AWS 云电脑客户端** | `https://clients.amazonworkspaces.com/` | 未来的云机 |
| **AWS 云电脑网页版** | `https://webclient.amazonworkspaces.com/` | 未来的云机 |
| **Let's Encrypt** | `https://acme-v02.api.letsencrypt.org/directory` | 免费 HTTPS |
| **Ollama 镜像（校验值）** | `ollama/ollama@sha256:684d8674b4315fa18f4f0e973a118ec2652ed96f67563277839985175858e0ba` | 服务器模型 |

---

## 九、动作清单（照这个顺序做）

| 序号 | 做什么 | 花多少 | 谁来做 |
|---|---|---|---|
| 1 | **买域名**（Cloudflare） | ~¥70/年 | 你，10 分钟 |
| 2 | 域名解析到 `66.42.56.29` | 免费 | 你，3 分钟 |
| 3 | **注册 Resend 邮箱服务** | 免费额度够用 | 你，10 分钟 |
| 4 | 把域名 + 邮箱填进服务器配置 | 免费 | Codex |
| 5 | **做 AI 安装脚本** | 开发成本 | Codex（任务书已附） |
| 6 | 让 Codex 把以上清单搬进「工作台 → 模型与工具」页 | 开发成本 | Codex |

**总计现金支出：一年不到 ¥200。**
