2026-10-09 / 0.11.0 更新
已接入 GitHub 手动 macOS 构建流程，编译真实 iOS arm64 应用，执行 ad-hoc 签名与字节校验，输出 Dopamine rootless DEB。浅紫 UI、星环 B 与网页一致。设备安装结果以 ios-build-status.json 为准。原始说明中的“尚未构建”为历史状态。

愚笨者 iOS 工程与越狱安装源 · 0.11.0

当前事实
已准备独立 WKWebView 本地应用工程、iPhone/iPad 图标、JSON 系统文件导出、相机权限判断、后台遮罩和钱包锁定桥接、rootful/rootless DEB 打包器、带 GPG 签名的 APT 源生成器。
当前 Windows 本机无 Xcode；已使用 GitHub macOS 构建任务编译真实设备应用并生成 rootless DEB，签名和资源一致性已核验。设备安装状态见 ios-build-status.json；应用商店与完整设备功能验收尚未完成。脚本拒绝把网页 ZIP、假二进制或模拟器应用当安装包。
“通用”按 iPhone/iPad arm64、iOS 15.4 起设计；越狱设备分别使用 rootful / rootless 安装布局。不能覆盖所有系统、越狱工具、roothide 或已迁移 jbroot。最终兼容性须按实际设备测试。

先在 iPhone 使用
在 Safari 打开实际部署的 HTTPS 前台地址，点击分享 → 添加到主屏幕 → 名称“愚笨者”。不需要安装描述文件或越狱。主屏幕网页与原生 App 的本地数据可能独立，请先导出加密备份并保管助记词。服务器预览使用 BSC 测试网，不能收取主网资产。网站若有访问密码，需要先完成网站验证。

原生工程构建（有 Xcode 的 Mac）
1. 打开 Yubenzhe.xcodeproj。目标是 Yubenzhe，最低 iOS 15.4，bundle ID app.yubenzhe.wallet。首次正式注册前可按账户情况统一确定 bundle ID。
2. python3 scripts/sync-web.py --source ../tongban/dist
3. bash scripts/build-ios.sh
输出 build/DerivedData/Build/Products/Release-iphoneos/Yubenzhe.app；此时是未签名设备应用，不能直接在普通 iPhone 安装。
没有使用第三方 SDK，不需要 CocoaPods。用完整 Xcode 和 iPhoneOS SDK 构建；仅 CommandLineTools 不够。

已有越狱设备的两种安装包
在持有实际编译 .app 的 Mac 上，为该 .app 做本地 ad-hoc 签名：
codesign --force --sign - --timestamp=none --entitlements App/Preview.entitlements build/DerivedData/Build/Products/Release-iphoneos/Yubenzhe.app
然后分别运行：
python3 scripts/package-deb.py --app build/DerivedData/Build/Products/Release-iphoneos/Yubenzhe.app --scheme rootful
python3 scripts/package-deb.py --app build/DerivedData/Build/Products/Release-iphoneos/Yubenzhe.app --scheme rootless
rootful：iphoneos-arm，安装 /Applications/Yubenzhe.app。
rootless：iphoneos-arm64，安装 /var/jb/Applications/Yubenzhe.app。
均仅包含正常用户应用，使用 uicache 更新图标；没有越狱漏洞、全系统补丁或关闭设备保护。ad-hoc 签名不等于苹果开发者签名，能否启动由已有越狱环境决定，未声称自动兼容。卸载脚本不删除钱包数据。
打包器验证真实 arm64 iOS Mach-O、bundle ID、版本、代码签名、前端校验值，不会生成占位安装包。越狱预览签名仅声明本应用标识及同标识的必需独立数据容器，不申请全局文件、平台身份或关闭沙盒权限；正式开发者签名使用真实团队配置，不使用 Preview.entitlements。
0.10.0 build 11 修复初次安装未声明应用身份导致 WebKit 被系统拒绝启动的问题。网页进程最多自动重试一次，启动超过 25 秒或导航失败显示具体提示。

建立实际可添加的私有安装源
准备上一步真实 DEB、实际 HTTPS 域名与本地 GPG 源签名密钥（源密钥不写进工程，不放到公开目录）。执行：
python3 scripts/build-repo.py --packages packages --output repo --base-url 实际HTTPS安装源地址 --signing-key 本地GPG完整指纹
再把 repo 内容部署到对应 HTTPS 路径。源格式为 deb 实际HTTPS安装源地址 ./ 。根据包管理器支持方式导入并核对 repository-key.asc 的指纹。生成器要求非空真实包和签名，不广告空源；禁止在说明中伪造已经部署的地址。
当前 repo-template 只是等待真正 iOS 包的状态页，不是可安装源。当前使用用户已有越狱环境的 SSH 或包管理器安装 DEB，不要求描述文件。

以后切换正式开发者账户
使用同一原生工程，在 Xcode Signing & Capabilities 选择真实团队和可用应用标识，配置自动签名，Archive 后按正式账户渠道导出/上传。越狱 ad-hoc 签名和 DEB 不能直接上传 App Store，也不能作为正式更新的签名身份。
上架前需真机验收、真实服务边界/隐私披露/加密申报、应用图标和截图以及商店资料；钱包、托管、支付等服务仍按实际能力和目标市场独立审核，工程不代表已获得许可或审核通过。

安全和数据边界
App 只加载随包的七项前端资源，本机服务绑定 127.0.0.1:45931；资源路径白名单，其他路径/方法拒绝。固定端口保留相同本地存储源。端口占用时拒绝启动，不跳到不可信地址。服务不开放给局域网。ATS 仅为固定回环 IP 127.0.0.1 添加 HTTP 例外，不放开远程明文连接。
桥只接受主页面的 JSON 文件导出，文件名限定 .json，256 KiB 上限，先询问再显示系统文件保存窗口。用户取消返回 saved=false。文件写入失败不报成功。临时文件使用系统完整文件保护，并在回调后清理。
要求系统分配独立应用数据容器；若越狱环境仅提供全局未沙盒目录，App 拒绝启动钱包，不修改全局目录。独立容器的应用库/文档目录排除云备份；钱包恢复依靠用户自行保存的加密备份或助记词。原生 App 与网站不自动同步钱包。
仅允许用户主动打开 testnet.bscscan.com、docs.bnbchain.org、docs.ethers.org 的 HTTPS 外链。网页网络策略仅保留 BSC 测试网 RPC；没有主网切换、管理后台入口、任意本地文件读取桥或调试器入口。
相机仅允许可信本机页面并交由系统询问；麦克风和运动权限拒绝。iOS 截图不能以本工程可靠禁止；后台显示遮罩并通知网页锁钱包。真实相机、图库选择、剪贴板、文件保存与系统生命周期必须设备测试。

本地可执行检查
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/bridge.test.mjs
这些检查覆盖打包格式、Mach-O 平台拒绝逻辑、URL/源输入和 JS 桥行为，不等于 Swift 已编译或 iOS 已验收。

官方依据（2026-10-09查阅）
Theos rootless 目录和架构：https://theos.dev/docs/rootless
Sileo 开发者文档：https://developer.getsileo.app/
Apple WKWebView：https://developer.apple.com/documentation/webkit/wkwebview
Apple 相机权限：https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:)
Apple 系统文件导出：https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init(forexporting:ascopy:)
Xcode 系统要求：https://developer.apple.com/xcode/system-requirements
