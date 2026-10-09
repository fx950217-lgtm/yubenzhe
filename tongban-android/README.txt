愚笨者 Android 工程 · 0.11.0（versionCode 11）

这是安装到 Android 的早期测试客户端，不是应用商店发行版。
当前发布包名 app.tongban.wallet.demo，沿用用户提供的原签名，可覆盖升级 0.9.0 并保留数据。也可通过 previewApplicationId 构建单独的测试包。
支持 Android 7.0 / API 24 及以上；Android System WebView / Chrome 需105及以上。
目前没有在 Android 实机上验收相机、键盘、系统保存窗口或后台恢复。

范围
链上功能固定 BSC 测试网与 tBNB，没有主网、真实资金或托管资金服务。
账号、好友和群消息已连接独立服务器；朋友圈、发现和红包仍是本机体验。
应用只装载打包的本地网页；消费者只访问独立账号/社交 API，私有管理后台保持隔离。
不会自动更新、自动收费、开机启动或请求安装其他应用。

原生接口
window.Capacitor.Plugins.SaveDocument.save({filename, mimeType:'application/json', content})
返回 {saved:true} 仅表示系统选择的文件已完整写入；取消返回 {saved:false}。
无可用保存器、无效内容或写入失败会 reject。上限256 KiB UTF-8。
filename须为ASCII安全的.json文件名，不接受路径、URI或任意MIME。
content须为完整JSON对象；系统 ACTION_CREATE_DOCUMENT 决定保存位置。
不会申请存储权限，不暴露目录、文件路径或URI，不长期保存文件授权。
如果第三方文件提供器在写入时失败，可能留下未完成文件，请重新保存并核对。
原生App插件8.1.2用于前后台事件、返回键和最小化；消费者网页负责锁定钱包。
Capacitor原生注入提供 Plugins.Name；单独的native-bridge没有registerPlugin函数。

安全配置
备份、云备份及设备迁移均禁用，应用数据不会通过Android自动备份导出。
清除应用数据或卸载会删除本机钱包与发现体验数据，务必自己保留恢复资料。
仅声明INTERNET和CAMERA；相机需点击后本次确认及Android系统授权。
不请求麦克风、定位、通知、广泛存储权限；WebView未知权限默认拒绝。
相册使用系统选择器；FileProvider只提供应用专属Pictures目录。
所有构建关闭WebView调试；release额外显式debuggable=false。
禁用明文和混合内容；系统TLS信任不添加自签证书或用户证书绕过。
WebView页面仅https://localhost；网络请求只允许固定两个BSC测试网RPC及 https://66.42.56.29/api/social/；头像仅接受固定头像资源路径。
仅用户点击的testnet.bscscan.com、docs.bnbchain.org、docs.ethers.org、docs.ollama.com，以及ollama.com/download精确下载页可转系统浏览器。
禁止file/intent/javascript等外部跳转与通用文件桥接路径。
全窗口启用FLAG_SECURE，禁止截屏、录屏与不安全显示，并保护最近应用预览。
因此测试者不能截取应用画面；这不会妨碍应用内选择图片。各厂商最近任务行为仍须实机验证。

构建（由主任务提供便携工具链）
Node >=22；JDK21；Android SDK36。AGP默认使用build-tools35.0.0，签名核验工具为36.0.0。
模板使用AGP8.13.0、Gradle8.14.3、minSdk24、compile/targetSdk36。
Capacitor core/android/cli均8.5.3，App插件8.1.2；pnpm-lock.yaml已锁定。
pnpm install --frozen-lockfile --ignore-scripts
node scripts/copy-web.mjs
node node_modules/@capacitor/cli/bin/capacitor sync android
node --test tests/*.test.mjs
cd android
./gradlew assembleRelease
release默认没有发行签名；需要主任务使用独立测试密钥签署和核验APK。
签名密钥、密码、SDK local.properties均不可打进源代码包或网页。
没有开发者账户、生产签名、商店提交或公开上架。

网页更新
copy-web仅复制../tongban/dist的index.html、app.js、app.css、icon.png、icon.svg、manifest.webmanifest、apple-touch-icon.png，
并加本工程的webview-unavailable.html；不会复制install.html、downloads、APK、后台或账户文件。
复制后须运行cap sync android，再重新构建签名；不会远程热更新已安装客户端。
SystemBars采用官方CSS Insets，网页应使用--safe-area-inset-*与env()回退。

发布前原生验证
1. 检查合并manifest与APK：仅互联网/相机，备份关闭，debuggable=false，未混入downloads或私密文件。
2. 在Android实机测试：相机取消/允许/关闭、图片选择、键盘与安全边距、返回及后台钱包锁定。
3. 导出加密钱包：取消无成功提示，确认保存后能用原密码解析，写失败必须报错。
4. 验证恶意外链/文件URI/混合内容/音频权限被拒绝，测试网RPC可用且不是主网。
5. 先保存恢复资料，再测试升级与数据保留；不得关闭设备安全保护或把测试签名当生产签名。

官方依据（2026-10-08核对）
https://capacitorjs.com/docs/updating/8-0
https://capacitorjs.com/docs/android/custom-code
https://capacitorjs.com/docs/apis/system-bars
https://developer.android.com/training/data-storage/shared/documents-files

0.9 AI 入口
安卓仅显示设备能力说明与本机草稿功能。电脑本地模型需在 Windows 版使用，安卓不会连接电脑端口或自动下载模型。云端工作区通过受限网页版申请并由管理员审核；安卓安装包不绕过网站认证直接连接云端服务。不会向模型发送钱包密钥、助记词或密码。

0.10.0 验证：网页 218 项用例（最终版本断言已单独复测）、Android 4 项测试及 55 条原生策略断言通过；release 编译、v2/v3 签名、模拟器安装和启动通过。截图受 FLAG_SECURE 保护，视觉检查在浏览器完成；未完成实体手机验收。
