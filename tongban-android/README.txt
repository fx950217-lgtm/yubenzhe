愚笨者 Android 原生源码

当前交付方式
Git 只保留原生源码、工程配置、锁文件和必需图标，不保留 www 与 android/app/src/main/assets/public 中的旧网页副本。当前功能以 ../docs/requirements-v0.2.txt 和 ../docs/V02-IMPLEMENTATION.txt 为准。
本次未编译、签名或安装新的 APK，也未完成 V0.2 Android 真机验收。package.json 与 Gradle 的 0.13.0 / versionCode 15 是保留的历史包装配置，不是最新网页发行版本。下次正式打包前须同步提高版本号并重新验收；旧安装状态可从 Git 历史追溯。

构建前准备
Node 24、pnpm 11.19.0、JDK 21、Android SDK 36。工程锁定 AGP 8.13.0、Gradle 8.14.3、minSdk 24、compile/targetSdk 36；WebView 最低 105。先分别在 ../tongban 和本目录安装锁定依赖：pnpm install --frozen-lockfile。
在本目录执行 pnpm sync：先构建当前 tongban 网页，再检查 dist/build-info.json 的版本并复制九项网页资源及 webview-unavailable.html，最后执行 Capacitor sync android。
执行 pnpm test 前须已完成同步并配置 JAVA_HOME。它包含网页快照一致性与 JVM 原生策略检查。
pnpm android:debug 或 pnpm android:release 均先执行同步，再编译。直接在 android 下调用 Gradle 会绕过网页准备，不能作为本项目的发布流程。
release 默认无发行签名。签名资料、local.properties、SDK、缓存与 APK 均不提交 Git。

资源与更新边界
web:copy 仅复制已有且版本匹配的 ../tongban/dist；web:prepare 会先重建网页。两者不编译、安装或发布 APK。
固定清单：index.html、app.js、app.css、icon.png、icon.svg、manifest.webmanifest、apple-touch-icon.png、privacy.html、terms.html；加 native-assets/webview-unavailable.html。
不复制 sw.js、安装页、downloads、管理后台或凭据。已安装应用不会随网页源码提交自动更新。
包名 app.tongban.wallet.demo、原生 bridge、安全配置与图标保留。既有应用数据和钱包不会因源码清理被删除。

原生安全约束
仅加载本地 https://localhost 网页；关闭调试、明文、混合内容、备份与设备迁移。只声明互联网和相机权限，相机由用户主动发起并获得系统许可。FLAG_SECURE 保护截图和最近任务预览。
JSON 导出使用系统保存窗口；取消返回 saved:false，写失败拒绝，内容上限 256 KiB；不暴露任意路径或通用文件访问。
导航与网络维持原生固定白名单；钱包仅 BSC 测试网。原生推送、商店发布、主网资金与硬件钱包直连未完成。
发布前仍须真机验收扫码、图片选择、键盘/安全边距、返回、后台钱包锁定、加密备份恢复及升级保留数据。
