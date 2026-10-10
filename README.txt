愚笨者 · 当前源码入口

需求版本：V0.2
本轮整理版本：0.14.0-dev.3 / 本地 M0 开发版

先读 README.md，再读 PROJECT_CONTEXT.md、AGENTS.md 和对应子项目 README。
当前需求：docs/requirements-v0.2.txt
需求变更：docs/V02-REQUIREMENTS-CHANGELOG.txt
实施与验收：docs/V02-IMPLEMENTATION.txt
运行与迁移：docs/M0-RUNBOOK.txt

源码包含 AI 工作台、服务积分、产品账号与社交、自托管测试网钱包、独立管理服务及各端构建工程。平台托管余额与内部资产划转已经退出当前产品。
GitHub CI 已验证源码 f11f4c1：前端 336/336、后端 207/207、合约 23/23 通过，网页与管理端构建成功。23 项构建文件 SHA-256 校验通过，0.14.0-dev.3 已在本机 localhost:18914 运行，原有账号、聊天及任务在升级后完整保留。线上与原生客户端仍为 0.13.0，未生成新版原生包或部署服务器。
代码位于公开 GitHub 仓库的 codex/m0-local-test 分支；main 和历史元数据保留。本轮清理约 1985 MiB 旧安装包/缓存，本机有备份。详见实施记录。

使用 Node 24；按子项目锁文件安装依赖。子项目必须保持同级。网页先测试、构建；需要交付原生时，再同步资源并按各平台说明编译和验收。管理 UI 依赖来自 tongban-admin，部署说明见 yubenzhe-deploy/README.txt。

运行数据库、聊天、账号、钱包、密钥与备份不是缓存。升级现有数据库须先停写、备份并隔离演练；不可用删除数据库或改写历史迁移替代升级。
入口文档仅保留当前说明，已有历史审计元数据继续保留；旧版本也可通过 Git 历史追溯。Android Gradle wrapper JAR 与 Windows build/icon.ico 是必要构建输入，不应当作缓存删除。
