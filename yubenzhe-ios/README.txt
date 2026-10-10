愚笨者 iOS 原生源码

当前交付方式
Git 保留 Swift 工程、固定本机资源服务器、桥接、图标和打包脚本，不保留 App/Web 旧网页副本与 web-snapshot.json。旧 ios-build-status.json 作为历史验收证据保留，不代表当前源码已打包或安装。最新需求与实现状态见 ../docs/requirements-v0.2.txt 和 ../docs/V02-IMPLEMENTATION.txt。
本次未构建、签名或安装新 iOS 包，也没有触发 GitHub 工作流。Info.plist、Xcode 工程、校验器及 DEB 打包中的 0.13.0 / build 16 是历史包装配置，不是当前网页发布；下次原生发行前须统一提高并重新验收。旧安装记录可从 Git 历史追溯。

构建与生成
需要 macOS、完整 Xcode 与 iPhoneOS SDK，以及 Node 24、pnpm 11.19.0、Python 3.10+。先在 ../tongban 执行 pnpm install --frozen-lockfile。
在 ../tongban 执行 pnpm build 后，在本目录运行 python3 scripts/sync-web.py。同步器检查 dist/build-info.json 的版本与当前 consumer package.json 一致，白名单复制九项网页资源并重新生成 web-snapshot.json。
本地构建入口 bash scripts/build-ios.sh 会重新构建网页、同步资源后运行 Xcode，防止从 Git 中旧网页快照出包。生成的是未签名 iOS 设备 App，不会安装或发布。
.github/workflows/ios-preview.yml 仅手动触发：检出源码、安装锁定网页依赖、构建网页、生成快照、运行检查，再编译、ad-hoc 签名和产生 rootless 预览 DEB。普通 Git push 不会触发打包。
工作流和本地构建结果必须单独核对，不能把源码提交或检查通过称为实际设备可用。

本地检查
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/bridge.test.mjs
这些检查覆盖打包格式、Mach-O 平台与身份、原生策略和 JS 桥，不代表 Swift 编译、真机安装或交互验收完成。

打包与发布
实际设备 App 需有效签名；越狱预览可使用现有受限 Preview.entitlements 做 ad-hoc 签名，再运行 python3 scripts/package-deb.py --app 实际编译的.app路径 --scheme rootless。验包器检查真实 arm64 iOS Mach-O、身份、版本、签名与网页哈希，拒绝占位包。
普通 iPhone 的安装和 App Store 发布需要正式 Apple 开发者配置及审核；越狱 DEB 不是 App Store 安装包。不要将本次源码整理当作原生发布。
私钥、签名材料、DEB、IPA、build、packages 和 repo 均不提交。源仓库生成脚本只在明确提供实际包、HTTPS 地址与签名时使用，不把 repo-template 当作已经可安装的源。

资源与安全边界
九项白名单是 index.html、app.js、app.css、icon.png、icon.svg、manifest.webmanifest、apple-touch-icon.png、privacy.html、terms.html；不复制 sw.js、downloads、安装页、后台或凭据。
本机资源服务器保持 127.0.0.1:45931 固定源与路径白名单；ATS 只允许固定回环例外。桥只接受可信主页面的 JSON 文件导出，最大 256 KiB，系统窗口取消或写失败不会报成功。
独立应用容器、排除云备份、后台遮罩及钱包锁定不变。此次清理只影响源码树生成副本，不碰连接手机或应用数据。
仅测试网；无主网、任意文件桥或调试器入口。相机、相册、文件导出、后台恢复和钱包恢复仍须真机验证，原生推送未接入。
