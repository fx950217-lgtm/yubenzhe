愚笨者 Android 原生源码

当前交付方式
Git 只保留原生源码、工程配置、锁文件和必需图标，不保留 www 与 android/app/src/main/assets/public 中的旧网页副本。当前功能以 ../docs/requirements-v0.2.txt 和 ../docs/V02-IMPLEMENTATION.txt 为准。
当前原生版本以 package.json 和 android/app/build.gradle 为准。公开版本使用个人账号登录，保留内部预览模式的独立校验；最终签名包、同步资源摘要和模拟器验证以本轮交付报告为准，不把编译成功视为 Android 真机验收。

构建前准备
Node 24、pnpm 11.19.0、JDK 21、Android SDK 36。工程锁定 AGP 8.13.0、Gradle 8.14.3、minSdk 24、compile/targetSdk 36；WebView 最低 105。先分别在 ../tongban 和本目录安装锁定依赖：pnpm install --frozen-lockfile。
在本目录执行 pnpm sync：先构建当前 tongban 网页，再检查 dist/build-info.json 的版本并复制九项网页资源及 webview-unavailable.html，最后执行 Capacitor sync android。
执行 pnpm test 前须已完成同步并配置 JAVA_HOME。它包含网页快照一致性与 JVM 原生策略检查。
pnpm android:debug 或 pnpm android:release 均先执行同步，再编译。直接在 android 下调用 Gradle 会绕过网页准备，不能作为本项目的发布流程。
release 默认无发行签名。签名资料、local.properties、SDK、缓存与 APK 均不提交 Git。

资源与更新边界
web:copy 仅复制已有且同时匹配网页源码与原生 package.json 版本的 ../tongban/dist；web:prepare 会先重建网页。两者不编译、安装或发布 APK。
固定清单：index.html、app.js、app.css、icon.png、icon.svg、manifest.webmanifest、apple-touch-icon.png、privacy.html、terms.html；加 native-assets/webview-unavailable.html。
不复制 sw.js、安装页、downloads、管理后台或凭据。已安装应用不会随网页源码提交自动更新。
正式 applicationId 为 app.yubenzhe.mobile；旧包名为 app.tongban.wallet.demo。Java namespace 仍保留 app.tongban.wallet.demo，原生 bridge、安全配置与图标保留。
新包名会与旧应用并存，不能覆盖安装旧包，也不会自动继承旧包中的账号会话、收藏或加密钱包，即使用原签名也一样。请保留旧应用，不要先卸载或清除数据；先在旧应用导出加密备份、确认能够在新版恢复后，再自行决定是否移除旧应用。不要把助记词、私钥或钱包备份交给平台。

原生安全约束
仅加载本地 https://localhost 网页；关闭调试、明文、混合内容、备份与设备迁移。只声明互联网和相机权限，相机由用户主动发起并获得系统许可。FLAG_SECURE 保护截图和最近任务预览。
钱包 JSON 导出使用系统保存窗口；取消返回 saved:false，写失败拒绝，内容上限 256 KiB。工作台 SaveArtifact.save({filename,mimeType,bodyBase64}) 另支持 UTF-8 的 txt/csv/md/json 交付结果，上限 16 MiB，校验扩展名、类型、文件名和 UTF-8 编码；只写入用户通过系统窗口选择的 content URI，不暴露任意路径或通用文件访问。
固定连接 https://66.42.56.29。公开模式不需要外层访问密码，产品身份使用本人登录后的本机 Bearer 会话，不打包凭据。保留的内部预览模式仅将外层 ybz_front_session Cookie 留在原生内存，退出或进程结束即清除。原生忽略 ybz_social Cookie，包括退出后迟到的响应。仅转发 /api/social/* 与只读 /api/chain-preview/config，正文最多 1 MiB、响应最多 16 MiB，拒绝跳转及任意目标地址，不向网页返回 Cookie。
新插件仅通过 Capacitor 主 frame、https://localhost 白名单的现代 WebMessage bridge 使用；移除旧全 frame Java 接口。缺少现代 WebMessage 支持的 WebView 失败关闭，请升级 WebView。相同包名和签名的后续覆盖升级可保留该应用的数据；本次改包名不具备自动迁移能力，更新时禁止卸载旧应用或清除数据。
导航与网络维持原生固定白名单；钱包仅 BSC 测试网。原生推送、商店发布、主网资金与硬件钱包直连未完成。
发布前仍须真机验收扫码、图片选择、键盘/安全边距、返回、后台钱包锁定、加密备份恢复及升级保留数据。

本轮内部验收（2026-10-11）
0.14.0-dev.7 / versionCode 16 已编译、使用原有证书签名，并在原 LDPlayer Android 14 模拟器以覆盖升级方式安装。原安装时间和产品会话保留，未卸载或清除数据。最终 APK 的九项网页资源与冻结网页构建逐字节一致；8 项 Node/JVM 检查通过（85 项原生导航/文档策略、64 项访问会话策略、35 项交付文件策略断言）。
已通过真实应用交互验证内部登录、测试邮箱账号、任务计划/预算/完成/积分返还，以及 TXT 成果系统保存。最终重签后的包再次验证启动门禁与内部登录。未读取或操作既有钱包密钥和资金；此结果不代替真机扫码、图片、键盘、后台钱包锁定、备份恢复等专项验收。
交付目录中的 android-validation.json 保存最终 APK 摘要、证书、各网页资源摘要和验收范围，不包含内部访问密码或签名秘密。
