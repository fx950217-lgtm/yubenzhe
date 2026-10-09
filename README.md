# 愚笨者

熟人社交、测试网钱包和 AI 协作项目。当前交接基线为 **0.9.0，受限验收阶段**。

先读 [项目上下文](PROJECT_CONTEXT.md) 和 [协作约定](AGENTS.md)。详细重建顺序保留在原始 [源码包说明](README.txt)。

代码源：[私有 GitHub 仓库](https://github.com/fx950217-lgtm/yubenzhe)。产品决策和交接索引：[云端资料中心](https://chatgpt.com/space/page_6ac8849de8908191aa82fc7c575142e8)。两者权限和内容分别管理；资料中心不会自动同步代码。服务器应用数据、访问凭证和数据库备份另行保存，不随 Git 克隆。

当前接入状态：源码已推送到私有 GitHub，并核对远端提交及 307 个文件。用户已选择先使用 GitHub；Codex Cloud 环境尚未创建，下次继续配置时先指导手机身份验证器绑定。

[0.9.0 内部验收包下载](https://github.com/fx950217-lgtm/yubenzhe/releases/tag/v0.9.0)包含 Android APK、Windows 安装版和便携版、iOS 源码及校验清单。它是私有预发布，iOS 尚无可安装版本。当前浏览器登录的 ChatGPT 账号无法打开原资料中心；查看本仓库中的说明不依赖该资料中心的访问权限。

| 目录 | 内容 |
| --- | --- |
| `tongban` | 手机网页、社交演示、测试网钱包、AI 工作台及测试 |
| `tongban-android` | Android 工程、Gradle wrapper、网页快照 |
| `yubenzhe-desktop` | Windows/Electron 工程、本地 Ollama 桥 |
| `yubenzhe-ios` | iOS 源码；仍需 Xcode 编译和设备验证 |
| `yubenzhe-deploy` | 独立服务器前台门禁、管理后台、SQLite、AI 服务与运维脚本 |
| `tongban-admin` | 仅保留重建管理界面所需的依赖清单、锁文件与图标 |

新设备开始

1. 登录同一 GitHub 账号 `fx950217-lgtm`，即可访问上述私有仓库；团队成员使用自己的获授权账号。
2. 要继续开发，在新设备克隆该仓库并用 Codex 打开 `yubenzhe` 文件夹。每次换设备前提交并推送要同步的代码，换设备后先同步已提交代码；未提交或未推送的改动不会自动同步。保持各子项目同级，并阅读根目录说明。
3. 准备 Node 24 与各 `package.json` 指定的 pnpm，在项目根运行 `node scripts/check-project.mjs`。它核对原快照哈希、必须文件及禁带材料，不联网。
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
