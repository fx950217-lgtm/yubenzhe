愚笨者 · 当前源码入口

需求版本：V0.2
本轮整理版本：0.14.0-dev.3 / 本地 M0 开发版

先读 README.md，再读 PROJECT_CONTEXT.md、AGENTS.md 和对应子项目 README。
当前需求：docs/requirements-v0.2.txt
需求变更：docs/V02-REQUIREMENTS-CHANGELOG.txt
实施与验收：docs/V02-IMPLEMENTATION.txt
运行与迁移：docs/M0-RUNBOOK.txt

源码包含 AI 工作台、服务积分、产品账号与社交、自托管测试网钱包、独立管理服务及各端构建工程。平台托管余额与内部资产划转已经退出当前产品。
本轮整理前已通过后端 207 项、可运行前端 220 项及合约 23 项；11 个前端测试文件与网页构建此前受阻。当前构建、预览和交付状态见实施记录，不能据版本号推断已部署或原生安装完成。

使用 Node 24；按子项目锁文件安装依赖。子项目必须保持同级。网页先测试、构建；需要交付原生时，再同步资源并按各平台说明编译和验收。管理 UI 依赖来自 tongban-admin，部署说明见 yubenzhe-deploy/README.txt。

运行数据库、聊天、账号、钱包、密钥与备份不是缓存。升级现有数据库须先停写、备份并隔离演练；不可用删除数据库或改写历史迁移替代升级。
仅保留当前源码与必要构建输入；旧版本记录由 Git 历史追溯。Android Gradle wrapper JAR 与 Windows build/icon.ico 是必要构建输入，不应当作缓存删除。
