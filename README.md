# 愚笨者

熟人社交、测试网钱包和 AI 协作项目。当前网页与客户端源码为 **0.12.0 简洁界面版**。0.12.0 参考微信官方 App Store 的消息列表与群聊截图，改为白色列表、浅灰背景和紫色重点操作；使用系统 sans-serif 字体与黑灰文字，主标题 18px、会话名称 17px、正文 16px。页面采用扁平分组列表、细分隔线、小圆角与简洁底部导航，减少大卡片、阴影和装饰文字。浅紫星环 B 应用图标保留，网络标识和说明仍只在钱包资产页显示。 独立账号、在线好友与群聊及标准钱包导入沿用 0.11.0；发现、平台余额和红包仍为体验功能。

[微信官方界面参考](https://apps.apple.com/cn/app/wechat/id414478124) · [打开网页版](https://66.42.56.29/) · [下载安装包](https://66.42.56.29/install.html)。

**0.12.0 已部署并完成各客户端发布、覆盖安装与启动检查**；Android versionCode 13，iOS build 14。Android versionCode 13 已用原签名执行 -r 覆盖安装并启动（本轮 PID 2777）；Windows 0.12.0 安装器退出码为 0，安装 ASAR 与构建产物一致且进程运行；iOS build 14 的 0.12.0 DEB 已安装，启动日志包含 starting local service、page loaded、ready，手机本地 HTML/JS/CSS 均返回 200。 实际版本和检查范围见 [0.12.0 验收记录](yubenzhe-deploy/reports/ui-012-verification.json)、[发布状态 JSON](tongban/releases/release-status.json) 和 [iOS 构建状态](yubenzhe-ios/ios-build-status.json)。

新加坡 /opt/yubenzhe/releases/0.12.0 已部署，公网 HTTPS /healthz 返回 200 且版本为 0.12.0；网页 JS/CSS 与四端快照一致，下载区 21 个文件 SHA-256 全部通过。后台、代理和模型容器 ID 未变。

本轮通过网页 270 项测试、14 项手机/桌面布局检查（360px / 1280px）、20 项交互检查（320px / 390px）、Android 5 项测试 / 85 条断言、Windows 23 项检查、iOS 13 项 Python 检查及 macOS 工作流内 4 项桥接检查。未新增用户在手机上肉眼确认画面，完整实体设备功能验收仍未完成。发现只调整界面，业务能力与数据范围不变；账号和在线社交沿用现有服务，钱包仍仅支持 BSC 测试网。

0.11.1 历史验收：网页已部署；Android versionCode 12 已用原签名在模拟器覆盖升级，Windows 已在当前电脑覆盖安装启动，iOS build 13 已在 Dopamine iPhone X 安装并由日志确认 ready。该版本独立完成顶部 UI 14 项检查和相关网页测试 20 项，四端 app.js SHA-256 一致，下载区 17 个文件校验通过；未新增 iPhone 画面的用户确认，也未完成全部物理设备功能验收。见 [0.11.1 验收记录](yubenzhe-deploy/reports/ui-0111-verification.json)。这些记录不计为 0.12.0 的部署或安装验收。

0.11.0 历史验收：Android 原签名包已在模拟器覆盖升级；Windows 已在当前电脑安装启动；iOS build 12 已在 Dopamine iPhone X 安装，用户确认可见账号登录页。完整范围见 [0.11.0 验收记录](yubenzhe-deploy/reports/social-011-verification.json)。

先读 [项目上下文](PROJECT_CONTEXT.md) 和 [协作约定](AGENTS.md)。详细重建顺序保留在原始 [源码包说明](README.txt)。

代码源：[私有 GitHub 仓库](https://github.com/fx950217-lgtm/yubenzhe)。产品决策和交接索引：[云端资料中心](https://chatgpt.com/space/page_6ac8849de8908191aa82fc7c575142e8)。两者权限和内容分别管理；资料中心不会自动同步代码。服务器应用数据、访问凭证和数据库备份另行保存，不随 Git 克隆。

代码接入：既有源码已推送到私有 GitHub，本轮 0.12.0 构建源码提交为 `9c87fe4c345d1e726a5d9e5f40791a9795bc6f6a`，iOS macOS workflow `37922166794` 成功；307 个文件的核对属于最初交接记录，历史 0.11.1 构建源码提交为 `8aba0bcee1b7a6c1d41b42e1c0b5f49f2d5bb9c7`。用户已选择先使用 GitHub；Codex Cloud 环境尚未创建，下次继续配置时先指导手机身份验证器绑定。

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
pnpm --dir tongban test
pnpm --dir tongban build
pnpm --dir yubenzhe-deploy test
node yubenzhe-deploy/scripts/build-admin.mjs
```

`tongban-admin` 只供应管理 UI 依赖，不能在该精简目录运行旧站点的启动脚本。独立后台运行时代码使用 Node 内置模块，无额外服务端依赖；其 HTTP 测试需允许本机回环端口。这里不自动启动生产服务、连接服务器、配置模型或读取真实数据库。构建可能更新已保留的网页快照，提交前检查差异。
