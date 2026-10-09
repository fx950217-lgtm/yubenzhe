愚笨者 Windows 客户端 0.11.0

用途
独立安装的 Windows x64 桌面客户端。本轮是供团队查看最终界面与服务器联调的内部验收版本，尚未公开上线或提交 Microsoft Store。
钱包仍仅连接 BSC 测试网；账号、好友、群聊及图片随账号同步；朋友圈、红包和平台余额仍为本机体验，不支持真实托管资金。

安装
优先运行 yubenzhe-0.11.0-windows-x64-setup.exe。安装到当前用户目录，无需管理员权限。
免安装版解压 ZIP 后运行 Yubenzhe.exe。不要仅从 ZIP 中拖出单个 EXE，其余运行文件也必须保留。
支持 Windows 10/11 64 位电脑。此构建无 Windows 代码签名证书；请先核对下载来源及 SHA256，并遵循系统安全提示，不要关闭安全防护。
本轮已完成编译、签名状态/安全边界核验及 21 项测试；已在当前 Windows 电脑安装并启动，安装资源与构建一致。相机、文件导出和本地模型运行仍需完整设备验收。

数据与使用
钱包密钥和发现草稿保存在当前 Windows 用户的应用数据中；账号、好友和消息通过固定 HTTPS 社交 API 同步。
卸载器保留应用数据，避免误删备份；自行删除应用数据前请先保存加密钱包备份。
窗口切到后台、最小化、电脑锁屏或休眠时，前端收到锁定事件。摄像头只用于用户发起的扫码，须经过明确授权，不开放麦克风。
JSON 导出使用系统保存窗口；点击取消不会显示保存成功。图片导入通过浏览器系统文件选择完成。
客户端不包含后台管理入口，助记词、钱包密码和私钥不上传；账号登录密码通过 HTTPS 验证，聊天记录存储在社交服务器。
仅内置已打包的网页资产。后续服务器域名更改不会自动改变钱包或同步数据。

开发与复现
固定依赖版本见 package.json 与 pnpm-lock.yaml。
1. pnpm install --frozen-lockfile --ignore-scripts
2. 在 ../tongban 生成最新网页 dist。
3. pnpm sync:web
4. pnpm test
5. pnpm build:win
构建程序从 Electron 官方发布下载 Windows 运行时和 NSIS 工具。不会发布到第三方商店或自动上传。
web-assets-verification.json 记录打包前端文件 SHA256，release-verification.json 记录安装包校验和与验收范围。

原生接口
window.YubenzheDesktop.platform = 'windows'
window.YubenzheDesktop.version = '0.11.0'
saveJson({filename, mimeType:'application/json', content}) -> Promise<{saved:boolean, method:'desktop'}>
onBackground(callback) -> unsubscribe 函数
接口没有任意文件读写、命令执行、process、Node.js 或 Electron 对象。

正式发布仍需
Windows 真机完成扫码、加密备份保存/恢复、窗口锁定、离线重启与升级回归。
确定运营主体后办理 Windows 代码签名身份；Microsoft Store 提交需对应开发者账户及商店资料。
真实资产/托管功能必须另行完成后端、安全与运营验收；不能通过隐藏文案把演示数据视为正式资金。

官方资料
https://www.electronjs.org/docs/latest/tutorial/security
https://www.electronjs.org/docs/latest/api/session
https://www.electron.build/v26/docs/targets/

0.9 AI 工作台
Windows 本地 AI 需要用户安装官方 Ollama 并自行下载一个本地模型。客户端只访问本机 127.0.0.1:11434，不能指定其他服务器，不自动下载模型、运行命令或安装软件。可以读取已安装本地模型、主动生成文本和取消任务；离开窗口会取消未完成本地任务。云端模型或 remote 模型不在本地入口运行。
网页版 AI 申请与任务记录由独立服务器保存，须由管理员审核开通；安装版不直接连接该私有服务，也不与网页版自动同步。
