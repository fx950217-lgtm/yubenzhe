# 愚笨者

熟人社交、测试网钱包和 AI 协作项目。当前网页与客户端源码为 **0.13.0 功能完善开发版**。朋友圈、账号安全、举报治理、消息补齐、AI 身份接入与浏览器通知正在进行本地开发验收，界面沿用 0.12.0 的简洁风格。0.12.0 参考微信官方 App Store 的消息列表与群聊截图，改为白色列表、浅灰背景和紫色重点操作；使用系统 sans-serif 字体与黑灰文字，主标题 18px、会话名称 17px、正文 16px。页面采用扁平分组列表、细分隔线、小圆角与简洁底部导航，减少大卡片、阴影和装饰文字。浅紫星环 B 应用图标保留，网络标识和说明仍只在钱包资产页显示。 独立账号、在线好友与群聊及标准钱包导入沿用既有服务；0.13.0 源码中的朋友圈接入独立社交库，平台余额、红包及未开放服务仍为体验功能。

[微信官方界面参考](https://apps.apple.com/cn/app/wechat/id414478124) · [打开网页版](https://66.42.56.29/) · [下载安装包](https://66.42.56.29/install.html)。

**0.13.0 当前状态：开发与验收中。** 当前源码为 0.13.0，Android versionCode 15、iOS build 16，处于本地开发与验收阶段；本版本尚未完成生产发布、原生包生成和各端安装。最终状态以对应版本的发布与验收 JSON 为准。0.12.1 及之前的部署、测试和安装结果仅作为历史基线；0.13.0 是多功能升级，发布前必须重新完成相关全量功能测试，不能把旧版结果计作本版已通过。

0.13.0 开发范围：真实账号朋友圈的文字/照片发布、好友或仅自己可见、分页、点赞、评论及删除；好友变化、双向拉黑与账号限制实时约束内容和图片读取，失败重试使用幂等标识。旧本机动态保留为明确标注的本机旧内容，不自动上传或发布；朋友圈只从“发现”进入，发现首页保留 AI 工作台与本机草稿，不再展示示例榜单、服务商和发币入口。

账号安全已加入主动生成的一次性恢复码、设备会话管理与账号注销：恢复码仅在生成时展示，服务器只保存哈希；恢复会重置 6 位密码并撤销旧会话，不解除平台封禁。注销需当前密码和明确文字确认，多人群主先转让；清理服务端自有内容与关系，保留占用 ID、账号墓碑及必要去正文审计记录。本机钱包、助记词和链上资产不随账号注销删除，账号恢复码不是钱包助记词。

消息新增连续游标补齐与缓存失效处理；双向拉黑限制私聊、好友申请与直接群邀请，共同群内容仍可能可见。举报和反馈持久保存，用户可查看自身处理进度；审核、禁言、暂停、恢复和内容移除由独立管理端/工具处理，消费者端不提供管理入口。云端 AI 已在源码中绑定产品账号的内部 UUID，保留原审批、免费额度和模型配置；变更数字 ID 不改变 AI 数据归属。账号注销后的 AI 清理通过有界幂等重试执行，取消任务并丢弃迟到输出；这部分已通过本地隔离测试，尚未部署或进行本版真实模型/手机验收。

浏览器消息通知已加入订阅、退订及服务端发送队列代码，仍需实际配置、浏览器权限与端到端验收；通知正文保持通用提醒。Web Push 不代表 Android/iOS/Windows 原生推送已接入，原生安装包不复制或注册 sw.js。隐私政策与用户条款纳入网页和三端本地静态资源；增加备份及健康检查脚本，是否实际启用按部署验收记录确认。钱包继续只开放 BSC 测试网；主网、托管资金、硬件钱包签名、端到端加密和商店发布不在本轮已完成范围。

当前已做朋友圈服务端 12 项检查及包含新 UI 的 43 项前端相关检查，覆盖主服务接入、权限撤销、分页、配额、幂等、账号切换和旧草稿隔离；这不是 0.13.0 全量验收，也不代表实际用户手机画面或完整实体设备功能已经验收。

0.13.0 前台与独立后台均会写入社交库和 AI 库。升级需同步核对两个服务的代码镜像和持久挂载；迁移备份、数据库恢复及回滚均须考虑并停止两个写入者。旧版“只更新或停止 frontend”的步骤仅是历史记录，不适用于本次功能升级。当前迁移不能直接交给旧版镜像读取；完整规则见 [部署与恢复说明](yubenzhe-deploy/README.txt)。

**0.12.1 历史验收：已完成发布、覆盖安装与启动检查。** 0.12.1 已部署并完成客户端覆盖安装和启动检查，Android versionCode 14、iOS build 15，源码提交 e54ff57e906ca650900112864210a1e130d54a47。新加坡前台已切换至 /opt/yubenzhe/releases/0.12.1，下载区 25 个文件 SHA-256 全部通过。Android 14 已安装启动；Windows 安装器退出码为 0，安装 ASAR 与构建产物一致且客户端已启动；iOS build 15 经 macOS workflow 37922714334 构建成功，0.12.1 DEB 安装成功，日志确认 page loaded / ready。

本轮通过 mine + discover 的 36 项相关网页测试、14 项布局检查、Android 5 项测试 / 85 条断言、Windows 23 项检查及 iOS 13 项 Python + 4 项桥接检查；在 360px / 1280px 两种尺寸额外确认“我”页面朋友圈入口为 0、“发现”入口为 1。未新增用户在手机上肉眼确认画面，完整实体设备功能验收仍未完成。0.12.0 的 270 项全量网页测试及安装验收保留为历史基线，不计为本轮全量重跑。 详细记录见 [0.12.1 验收记录](yubenzhe-deploy/reports/ui-0121-verification.json)。 最新实际状态见 [发布状态 JSON](tongban/releases/release-status.json) 和 [iOS 构建状态](yubenzhe-ios/ios-build-status.json)。

**0.12.0 历史验收：已部署并完成各客户端发布、覆盖安装与启动检查**；Android versionCode 13，iOS build 14。Android versionCode 13 已用原签名执行 -r 覆盖安装并启动（本轮 PID 2777）；Windows 0.12.0 安装器退出码为 0，安装 ASAR 与构建产物一致且进程运行；iOS build 14 的 0.12.0 DEB 已安装，启动日志包含 starting local service、page loaded、ready，手机本地 HTML/JS/CSS 均返回 200。 实际版本和检查范围见 [0.12.0 验收记录](yubenzhe-deploy/reports/ui-012-verification.json)、[发布状态 JSON](tongban/releases/release-status.json) 和 [iOS 构建状态](yubenzhe-ios/ios-build-status.json)。

新加坡 /opt/yubenzhe/releases/0.12.0 已部署，公网 HTTPS /healthz 返回 200 且版本为 0.12.0；网页 JS/CSS 与四端快照一致，下载区 21 个文件 SHA-256 全部通过。后台、代理和模型容器 ID 未变。

本轮通过网页 270 项测试、14 项手机/桌面布局检查（360px / 1280px）、20 项交互检查（320px / 390px）、Android 5 项测试 / 85 条断言、Windows 23 项检查、iOS 13 项 Python 检查及 macOS 工作流内 4 项桥接检查。未新增用户在手机上肉眼确认画面，完整实体设备功能验收仍未完成。发现只调整界面，业务能力与数据范围不变；账号和在线社交沿用现有服务，钱包仍仅支持 BSC 测试网。

0.11.1 历史验收：网页已部署；Android versionCode 12 已用原签名在模拟器覆盖升级，Windows 已在当前电脑覆盖安装启动，iOS build 13 已在 Dopamine iPhone X 安装并由日志确认 ready。该版本独立完成顶部 UI 14 项检查和相关网页测试 20 项，四端 app.js SHA-256 一致，下载区 17 个文件校验通过；未新增 iPhone 画面的用户确认，也未完成全部物理设备功能验收。见 [0.11.1 验收记录](yubenzhe-deploy/reports/ui-0111-verification.json)。这些记录不计为 0.12.0 的部署或安装验收。

0.11.0 历史验收：Android 原签名包已在模拟器覆盖升级；Windows 已在当前电脑安装启动；iOS build 12 已在 Dopamine iPhone X 安装，用户确认可见账号登录页。完整范围见 [0.11.0 验收记录](yubenzhe-deploy/reports/social-011-verification.json)。

先读 [项目上下文](PROJECT_CONTEXT.md) 和 [协作约定](AGENTS.md)。详细重建顺序保留在原始 [源码包说明](README.txt)。

代码源：[私有 GitHub 仓库](https://github.com/fx950217-lgtm/yubenzhe)。产品决策和交接索引：[云端资料中心](https://chatgpt.com/space/page_6ac8849de8908191aa82fc7c575142e8)。两者权限和内容分别管理；资料中心不会自动同步代码。服务器应用数据、访问凭证和数据库备份另行保存，不随 Git 克隆。

代码接入：0.13.0 当前改动尚在本地开发验收，提交与发布状态需以该版本记录确认。历史 0.12.1 源码已提交，提交为 `e54ff57e906ca650900112864210a1e130d54a47`；既有源码已推送到私有 GitHub，历史 0.12.0 构建源码提交为 `9c87fe4c345d1e726a5d9e5f40791a9795bc6f6a`，iOS macOS workflow `37922166794` 成功；307 个文件的核对属于最初交接记录，历史 0.11.1 构建源码提交为 `8aba0bcee1b7a6c1d41b42e1c0b5f49f2d5bb9c7`。用户已选择先使用 GitHub；Codex Cloud 环境尚未创建，下次继续配置时先指导手机身份验证器绑定。

[0.9.0 内部验收包下载](https://github.com/fx950217-lgtm/yubenzhe/releases/tag/v0.9.0)包含 Android APK、Windows 安装版和便携版、iOS 源码及校验清单。它是私有预发布，该 0.9.0 发布的 iOS 附件仅提供源码；当前 iOS 安装状态见上述新版记录。当前浏览器登录的 ChatGPT 账号无法打开原资料中心；查看本仓库中的说明不依赖该资料中心的访问权限。

| 目录 | 内容 |
| --- | --- |
| `tongban` | 手机网页、在线社交、测试网钱包、AI 工作台及测试 |
| `tongban-android` | Android 工程、Gradle wrapper、网页快照 |
| `yubenzhe-desktop` | Windows/Electron 工程、本地 Ollama 桥 |
| `yubenzhe-ios` | Swift 工程、macOS 构建与 DEB 打包；完整设备功能仍待验收 |
| `yubenzhe-deploy` | 独立服务器前台门禁、管理后台、SQLite、AI 服务与运维脚本 |
| `tongban-admin` | 仅保留重建管理界面所需的依赖清单、锁文件与图标 |

新设备开始

1. 登录同一 GitHub 账号 `fx950217-lgtm`，即可访问上述私有仓库；团队成员使用自己的获授权账号。
2. 要继续开发，在新设备克隆该仓库并用 Codex 打开 `yubenzhe` 文件夹。每次换设备前提交并推送要同步的代码，换设备后先同步已提交代码；未提交或未推送的改动不会自动同步。保持各子项目同级，并阅读根目录说明。
3. 准备 Node 24 与各 `package.json` 指定的 pnpm，在项目根运行 `node scripts/check-project.mjs --allow-changes`。它核对原始 0.9.0 快照的必需文件并允许已提交源码变更，检查、必须文件及禁带材料，不联网。
4. 在准备开发的子项目执行 `pnpm install --frozen-lockfile`，再运行该项目测试。网页使用 `pnpm test`、`pnpm build`。
5. 原生重建先构建 `tongban/dist`，再运行对应同步脚本；环境要求见各子项目 `README.txt`。Android 需要 JDK 21/SDK 36，iOS 需要完整 Xcode。
6. 重建服务器管理界面前，还需安装 `tongban-admin` 的锁定依赖。服务器运行与部署步骤见 `yubenzhe-deploy/README.txt`，不要复用示例口令。

这个目录包含可重建源码和部分网页快照，不含 SDK、依赖、安装包、线上数据、访问口令或签名密钥。源码修改后使用 `node scripts/check-project.mjs --allow-changes` 查看相对交接快照的差异。

网页与独立后台的云端开发准备建议

这只是已存在项目命令的准备清单，尚未在 Codex Cloud 环境执行。连接私有仓库后使用 Node 24、pnpm 11.19.0；依赖下载需要环境网络授权。无需为网页/后台任务安装 Android、iOS 或桌面打包工具链。

```sh
node scripts/check-project.mjs
pnpm --dir tongban install --frozen-lockfile
pnpm --dir tongban-admin install --frozen-lockfile
npm --prefix yubenzhe-deploy ci
pnpm --dir tongban test
pnpm --dir tongban build
pnpm --dir yubenzhe-deploy test
node yubenzhe-deploy/scripts/build-admin.mjs
```

`tongban-admin` 只供应管理 UI 依赖，不能在该精简目录运行旧站点的启动脚本。0.13.0 服务端新增锁定版本的 `web-push` 运行依赖；启动或测试前须执行上面的 `npm --prefix yubenzhe-deploy ci`，即使未配置推送也需要安装。提交应保留该目录的 `package-lock.json`；Dockerfile 已通过 `npm ci` 安装运行依赖。HTTP 测试需允许本机回环端口。这里不自动启动生产服务、连接服务器、配置模型或读取真实数据库。构建可能更新已保留的网页快照，提交前检查差异。
