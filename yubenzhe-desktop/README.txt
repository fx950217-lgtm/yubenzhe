愚笨者 Windows 原生源码

当前交付方式
Git 只保留 Electron 主进程、受限桥接、配置、锁文件和 build/icon.ico，不保留 web 中的旧网页副本。旧 release-verification.json 作为历史验收证据保留，不代表本次已产生新安装包。当前功能以 ../docs/requirements-v0.2.txt 和 ../docs/V02-IMPLEMENTATION.txt 为准。
本次未重新打包或安装 Windows 客户端。package.json 和原生桥中的 0.13.0 是历史包装版本，不是最新网页发行版本；下次原生发行前须统一调整并重新验收。旧安装记录可从 Git 历史追溯。

开发与构建
使用 Node 24、pnpm 11.19.0。先分别在 ../tongban 和本目录执行 pnpm install --frozen-lockfile；按 Electron 官方安装要求完成运行时依赖准备。
pnpm sync:web 会重新构建 tongban，再生成本地 web 与 web-assets-verification.json。pnpm copy:web 只复制已经构建且 build-info.json 版本匹配的 dist。
pnpm test 检查主进程、桥接和本机 AI 边界，不代表已编译安装包。
pnpm build:win 先重新准备网页，再生成 Windows x64 NSIS 与 ZIP；不会自动上传或安装。
构建后执行 node scripts/verify-release.cjs，核对 ASAR 网页与当前 dist、原生代码、安全 Fuses、安装包和校验和。生成 release-verification.json 与 dist/SHA256SUMS.txt；这些文件只属于对应实际构建；仓库保留的历史 release-verification.json 不代表当前源码的验收结果。
实际发行需统一 wrapper 版本、源版本、签名与设备验收；此源码整理不声明最新原生包已经存在。

资源与数据边界
仅复制九个白名单应用网页文件；sw.js、安装页、下载包、管理后台与凭据不会进入原生资源。
web、dist 与 web-assets-verification.json 都是可再生输出；旧 release-verification.json 保留为历史证据。build/icon.ico 是打包输入，不能按缓存删除。
本次清理不碰已安装应用或其用户数据；卸载器原有保留数据行为不变。钱包资料仍需用户保留自己的加密备份或助记词。

安全与能力
Electron 隔离、沙箱、固定本地源、受限 JSON 保存桥和导航白名单保持不变。取消保存不报成功；最小化、后台、锁屏和休眠触发钱包锁定。摄像头须主动授权，麦克风不开放。
本地 AI 仅连接 127.0.0.1:11434 的既有 Ollama；不自动安装模型或连接任意远端服务。云端功能按当前后端能力返回，未配置服务不伪造成功。
钱包仅 BSC 测试网；无 Windows 正式代码签名、商店上架或原生推送。完整扫码、导出恢复、本地模型、离线重启及升级仍需实际设备验收。
