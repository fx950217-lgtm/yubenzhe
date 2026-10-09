愚笨者 Windows 客户端 0.12.1

0.12.1 仅移除“我”页面中重复的朋友圈入口，朋友圈统一保留在“发现”。其他界面沿用 0.12.0 的白灰背景、紫色强调、系统 sans-serif 黑灰字体、扁平列表与简洁底栏；浅紫星环 B 应用图标不变。
0.12.1 已部署并完成客户端覆盖安装和启动检查，Android versionCode 14、iOS build 15，源码提交 e54ff57e906ca650900112864210a1e130d54a47。新加坡前台已切换至 /opt/yubenzhe/releases/0.12.1，下载区 25 个文件 SHA-256 全部通过。Android 14 已安装启动；Windows 安装器退出码为 0，安装 ASAR 与构建产物一致且客户端已启动；iOS build 15 经 macOS workflow 37922714334 构建成功，0.12.1 DEB 安装成功，日志确认 page loaded / ready。
本轮通过 mine + discover 的 36 项相关网页测试、14 项布局检查、Android 5 项测试 / 85 条断言、Windows 23 项检查及 iOS 13 项 Python + 4 项桥接检查；在 360px / 1280px 两种尺寸额外确认“我”页面朋友圈入口为 0、“发现”入口为 1。未新增用户在手机上肉眼确认画面，完整实体设备功能验收仍未完成。0.12.0 的 270 项全量网页测试及安装验收保留为历史基线，不计为本轮全量重跑。 详细记录见 ../yubenzhe-deploy/reports/ui-0121-verification.json。 实际发布范围见 release-verification.json 和 ../tongban/releases/release-status.json。
本次只调整入口展示，不改变朋友圈业务、账号服务或钱包能力。

0.12.0 历史安装与验收

0.12.0 参考微信官方 App Store 的消息列表与群聊截图，改为白色列表、浅灰背景和紫色重点操作；使用系统 sans-serif 字体与黑灰文字，主标题 18px、会话名称 17px、正文 16px。页面采用扁平分组列表、细分隔线、小圆角与简洁底部导航，减少大卡片、阴影和装饰文字。浅紫星环 B 应用图标保留，网络标识和说明仍只在钱包资产页显示。
界面参考：https://apps.apple.com/cn/app/wechat/id414478124 。
0.12.0 Windows 安装版与 ZIP 版已发布，当前电脑已完成覆盖安装：安装器退出码为 0，安装 ASAR 与构建产物一致，客户端进程运行。网页 JS/CSS 与四端快照一致，下载区 21 个文件 SHA-256 全部通过；构建源码提交 9c87fe4c345d1e726a5d9e5f40791a9795bc6f6a。实际资源校验和安装结果见 release-verification.json、../tongban/releases/release-status.json 与 ../yubenzhe-deploy/reports/ui-012-verification.json。
本轮通过网页 270 项测试、14 项手机/桌面布局检查（360px / 1280px）、20 项交互检查（320px / 390px）、Android 5 项测试 / 85 条断言、Windows 23 项检查、iOS 13 项 Python 检查及 macOS 工作流内 4 项桥接检查。未新增用户在手机上肉眼确认画面，完整实体设备功能验收仍未完成。发现只调整界面，业务能力与数据范围不变；账号和在线社交沿用现有服务，钱包仍仅支持 BSC 测试网。

0.11.1 历史安装与验收

0.11.1 已在当前 Windows 电脑覆盖安装：安装器退出码为 0，安装 ASAR 与构建产物 SHA-256 一致，新客户端进程运行。打包网页 app.js 与其余三端快照一致；共享网页的顶部 UI 14 项检查及相关测试 20 项通过。完整设备功能仍未全部验收，实际范围见 release-verification.json、../tongban/releases/release-status.json 和 ../yubenzhe-deploy/reports/ui-0111-verification.json。
本次仅同步顶部 UI：移除全局 B /“愚笨者”品牌行及重复页标题，各页面保留自己的标题、搜索和“＋”等操作；BSC 测试网标识及说明按钮仅在钱包资产页。应用图标保持浅紫星环 B。

用途
独立安装的 Windows x64 桌面客户端。本轮为公开体验版本，未上架 Microsoft Store。
钱包仍仅连接 BSC 测试网；账号、好友、群聊及图片随账号同步；朋友圈、红包和平台余额仍为本机体验，不支持真实托管资金。

安装
优先运行已发布并完成校验的 yubenzhe-0.12.1-windows-x64-setup.exe；本机已覆盖安装并启动，0.12.0 保留为上一版安装记录。下载文件以发布状态 JSON 中的对应版本及 SHA-256 清单为准。安装到当前用户目录，无需管理员权限。
免安装版解压 ZIP 后运行 Yubenzhe.exe。不要仅从 ZIP 中拖出单个 EXE，其余运行文件也必须保留。
支持 Windows 10/11 64 位电脑。此构建无 Windows 代码签名证书；请先核对下载来源及 SHA256，并遵循系统安全提示，不要关闭安全防护。
0.11.0 历史验收已完成编译、签名状态/安全边界核验及 23 项测试，并在当前 Windows 电脑安装启动，安装资源与当时构建一致。相机、文件导出和本地模型运行仍需完整设备验收。

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
window.YubenzheDesktop.version = '0.12.1'
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
