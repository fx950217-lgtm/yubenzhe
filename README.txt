愚笨者 0.9.0 · 综合源码包

用途：重新构建网页、Android、iOS、Windows 客户端及独立服务器验收后台。
所有子目录须保持同级。保留 tongban 命名是为了兼容构建脚本与既有 Android 应用标识，不代表旧品牌。

目录
tongban：消费者网页源码、锁文件、构建脚本与回归测试。
tongban-android：Capacitor Android 原生工程、Gradle wrapper 与本地网页快照。
yubenzhe-ios：Swift/WKWebView 工程、Xcode 项目、iOS 打包/安装源脚本及网页快照。
yubenzhe-desktop：Electron Windows 工程、锁文件、测试、打包图标及网页快照。
yubenzhe-deploy：独立 Node 24 + SQLite 管理 API、前台访问门禁、后台 UI、迁移、Docker Compose 与运维脚本。
tongban-admin：仅供重建管理 UI 的依赖清单、锁文件及 favicon；不是另一个已部署后台。

重建顺序
1. 准备 Node 24、对应项目 packageManager 指定的 pnpm；分别安装 tongban、tongban-android、yubenzhe-desktop 和 tongban-admin 的锁定依赖（pnpm install --frozen-lockfile）。不要跨目录共用 node_modules。
2. 在 tongban 运行 pnpm test、pnpm build，生成 dist。
3. Android：准备 JDK 21、Android SDK API 36/build-tools 36.0.0；按项目 README 配置本机 SDK 路径，再运行 pnpm sync 与 pnpm android:debug。发布版本必须用自己保管的签名密钥签名，包内不含任何签名凭证。
4. Windows：在 yubenzhe-desktop 运行 pnpm sync:web、pnpm test、pnpm build:win。保留 build/icon.ico 是必须的打包输入，不是构建产物。
5. iOS：需要有完整 Xcode/iPhoneOS SDK 的 Mac；按 yubenzhe-ios/README.txt 同步网页、编译及签名。本源码快照不包含已经编译的 iOS 应用，也不声称已经在 iPhone 真机验收。
6. 在 yubenzhe-deploy 运行 node scripts/build-admin.mjs、node scripts/stage-frontend.mjs ../tongban/dist，然后 node --test tests/acceptance.test.mjs。按该目录 README.txt 创建新的私密访问凭证与空 state/backups 目录，复核环境后启动独立 Compose。不得覆盖服务器上的其他项目。

安装下载说明
此源码包排除了所有 APK、EXE、ZIP、DEB、IPA 及下载目录。网页 releases 中只保留文本说明；安装链接必须在独立构建并校验相应安装包后重新配置。iOS repo-template 是状态说明页，不是已存在可安装包的 APT 源。
web 快照供原生工程重建参考；修改前端后必须按各项目脚本重新同步，不能混用不同版本资源。

访问与资金边界
部署设计为独立前台/后台端口、受限验收认证；管理后台没有消费者入口。SQLite 测试数据需显式初始化，1,000 位用户均为合成样本，不是真实注册用户。
AI 工作区申请与任务通过独立数据库真实保存；云端推理仅在模型已配置并验证后开放，当前免费验收。Windows 已包含本地 Ollama 桥。iOS 工程保留上一版来源说明，本轮没有编译新 iOS 安装包。
链上钱包仅连接 BSC 测试网；本机社交、平台余额与红包是演示/预览，不包含真实多人聊天服务、正式充值提现或真实资金托管后台。源码和构建结果不代表已上架应用商店。

排除内容
没有 node_modules、Git/平台状态、工具链缓存、构建输出、SDK/JDK、运行数据库、备份、私密 .env、登录凭证、local.properties、签名密钥或嵌套安装包。
唯一 JAR 是 Android 标准 Gradle wrapper；唯一 build 目录文件是 Windows 打包必需的 icon.ico。
测试中有明确的合成测试口令，仅用于自动化用例，不是服务器访问凭证。实际部署必须重新创建凭证。

MANIFEST.json 记录每个纳入文件的 SHA-256。各子项目 README 说明其真实能力与局限。
