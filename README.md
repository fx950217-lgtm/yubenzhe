# 愚笨者

熟人社交、测试网钱包和 AI 协作项目。当前交接基线为 **0.9.0，受限验收阶段**。

先读 [项目上下文](PROJECT_CONTEXT.md) 和 [协作约定](AGENTS.md)。详细重建顺序保留在原始 [源码包说明](README.txt)。

代码源：[私有 GitHub 仓库](https://github.com/fx950217-lgtm/yubenzhe)。产品决策和交接索引：[云端资料中心](https://chatgpt.com/space/page_6ac8849de8908191aa82fc7c575142e8)。两者权限和内容分别管理；资料中心不会自动同步代码。服务器应用数据、访问凭证和数据库备份另行保存，不随 Git 克隆。

当前接入状态：私有远端已创建，正在准备首次本地提交。源码上传由主任务完成后核对远端提交；Codex Cloud 环境尚未建立。

| 目录 | 内容 |
| --- | --- |
| `tongban` | 手机网页、社交演示、测试网钱包、AI 工作台及测试 |
| `tongban-android` | Android 工程、Gradle wrapper、网页快照 |
| `yubenzhe-desktop` | Windows/Electron 工程、本地 Ollama 桥 |
| `yubenzhe-ios` | iOS 源码；仍需 Xcode 编译和设备验证 |
| `yubenzhe-deploy` | 独立服务器前台门禁、管理后台、SQLite、AI 服务与运维脚本 |
| `tongban-admin` | 仅保留重建管理界面所需的依赖清单、锁文件与图标 |

新设备开始

1. 获得私有仓库访问权限并完成本机 Git 认证；首次上传验收完成后，运行 `git clone https://github.com/fx950217-lgtm/yubenzhe.git`。
2. 在 Codex 中打开克隆得到的 `yubenzhe` 文件夹作为项目，并阅读根目录说明。保持各子项目同级；不要只打开或搬走其中一份源码。
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
