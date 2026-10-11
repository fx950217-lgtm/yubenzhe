愚笨者 Windows 内部客户端 0.14.0-dev.7

已生成 x64 NSIS 与 ZIP 并在本机覆盖安装。安装前本机数据已在仓库外备份；应用 appId、yubenzhe://app 源和 persist:yubenzhe 分区保持原值，不清理用户钱包/收藏。最终 ASAR 与源码和消费者网页逐字节核对，33 项桌面自动测试通过，实际 Windows 启动显示内测入口。完整登录后 UI、摄像头、本地 Ollama、钱包恢复需独立设备验收；没有 Authenticode 证书、商店发布或原生推送。

访问：原生内部门禁桥只允许固定 HTTPS 服务器及产品路径；外层Cookie仅在内存，产品身份使用已有Bearer。不会嵌入账号密码、跳转任意主机或共享浏览器Cookie。进程退出需重新输入内测凭据，产品本机数据继续保留。
文件：加密JSON备份保留256KiB专用保存规则；工作台交付另用16MiB以内UTF-8的TXT/CSV/MD/JSON系统保存对话框，取消不报成功。

构建：Node24、pnpm11.19.0；依赖按锁安装。先构建 ../tongban，再 node scripts/copy-web.mjs 同步已经冻结的9个网页资源；不复制admin、sw、安装页、凭据或下载。pnpm build:win生成NSIS/ZIP，node scripts/verify-release.cjs核对ASAR、原生代码、Fuses和SHA256。安全资源路由只允许固定资产，app.js/app.css带版本参数须与包版本完全一致。

Git仅保存源码、锁文件、必要图标及脱敏报告；web、dist、凭据、签名、钱包/数据库、安装包和备份在仓库外保管。release-verification.json只证明对应打包内容，运行UI/安装证据见本轮交付目录windows-validation.json及../docs/DEV7-RELEASE-ACCEPTANCE.txt。
