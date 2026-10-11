愚笨者产品服务与独立管理端
需求基线 V0.2 · 当前网页服务版本 0.14.0-dev.6 / 公网内部预览

当前入口
../docs/requirements-v0.2.txt：产品与有效验收标准。
../docs/V02-IMPLEMENTATION.txt：实际实施和测试状态。
../docs/M0-RUNBOOK.txt：本地 M0 启动、积分流程与迁移。
../docs/INTERNAL-PREVIEW-RUNBOOK.txt：公网内部预览配置、验收与回滚。

2026-10-11，公网网页已切换至 0.14.0-dev.6 内部预览：https://66.42.56.29/，healthz 的 stage 为 internal-preview。前端 419/419、后端 219/219、合约 38/38，共 676 项测试通过（含真实钱包签名的本地 EVM 联测）；服务器 Ollama qwen3:0.6b 实测返回连接正常。公网未登录时静态页面与 PDF 显示门禁，产品 API 返回 401；登录门禁后可读取网页、build-info、只读链配置与 PDF，旧 /api/ai/* 入口返回 404。
公网内部预览需要先通过共享外层门禁，再使用独立产品账号。模拟邮箱仅允许 .test 保留域（如 tester@example.test），验证码只在已通过门禁的页面显示，不发送真实邮件；共享门禁与测试邮件不等于真实多租户邮箱认证，同一测试邮箱不应存放需对其他受邀者保密的数据。旧真实邮箱不能用模拟码接管；旧 ID＋密码和恢复码流程保留。
本轮交付仅为网页内部预览。Android、iOS、Windows 旧原生包仍为 0.13.0，未重打包，且不支持新增外层门禁；不能据网页验收声称原生已更新。
BSC 测试网（chainId 97）已完成真实钱包验收：2 笔部署及 approve、fund、原生 tBNB 转账、claim、refund 共 7 笔交易全部成功，均至少 3 次确认并完成主链区块一致性核验。10003 YBZt 供资后，A 领取 5001.5 YBZt，B 未领的 5001.5 YBZt 到期退回发起者；remaining、allowance、contractToken 均为 0，金额守恒。服务器链配置已启用；样例活动已结束，仅供审核，不能继续领取。合约地址与交易详见内部预览运行手册；验收报告：reports/internal-chain-acceptance.json。区块浏览器源码验证尚未提交，可复现的 standard JSON 已提供。

历史 dev.4 前端全量 356/356 通过，本地消费者网页与管理端构建成功；网页和服务已更新，备份重启后 18914 的 healthz 与 build-info 均确认 0.14.0-dev.4。浏览器验证电脑/390px 手机个人页、业务返回及收藏→历史草稿→刷新→收藏→个人中心。无新数据库迁移，业务数据保留；证据见 reports/ui-entry-simplification.json。该历史轮次后台业务与合约未改、未重测；上一轮 f11f4c1 的 GitHub CI 38052669120、后端 207/207 和合约 23/23 仅为历史基线。管理端构建成功不等于完整管理交互验收。该历史轮次没有生成新版原生包或部署服务器；当前状态见上方 dev.6 说明。公开 GitHub 当前分支为 codex/m0-local-test，main 未更新。

历史 dev.5 验证状态：前端全量 404/404、消费者网页及独立管理端构建通过；已核对桌面与 390px 手机五页、三皮肤、云机/收藏/通讯录/近期任务路径和工作台默认落地，本地 healthz 与 build-info 均为 0.14.0-dev.5。
YBZ 品牌 UI 已按最新命名规范重做，五 Tab 顺序为工作台、消息、钱包、发现、我的。无新数据库迁移；既有本地数据已用 SQLite backup API 备份并通过完整性检查后保留重启。详情见 reports/brand-ui-verification.json。该历史轮次线上与原生包未更新。

架构与功能边界
Node 24 + SQLite；frontend 提供消费者网页、/api/social 和产品 AI 接口，拒绝 /api/admin；admin 使用独立入口与会话。管理 UI 源码在 ui，依赖来自相邻 tongban-admin。
产品账号使用独立会话；社交、账号、积分及工作任务保留用户归属、幂等、状态版本和权限检查。更改公开 ID 不改变内部 UUID。钱包密钥不进入数据库、AI 输入或日志。
M0 仅回环可用，模拟邮箱只本机显示验证码，不发真实邮件；本地启动脚本默认禁用模型。公网内部预览为另一个模式，保留已配置的 Ollama qwen3:0.6b，不等于规则式工作流已接入通用 AI。文件任务按 POINT 预算预留与完成步骤核销，积分不可转让、提现或兑换资产/Gas，不开放客户端奖励写入。
旧 BAL/内部红包运行模块退出，相关产品 API 返回 410；旧管理账务和平台接入申请的读取、审批及重放同样关闭，初始化样本不再生成这些业务。链上分发已有本地钱包签名联测，测试代币与 Equal 合约已部署至 BSC 测试网并取得至少 3 次确认；服务器只读链配置已启用。approve、fund、原生 tBNB 转账、claim、refund 已确认且金额守恒，样例活动已结束、不能继续领取；无有效配置时仍拒绝发起分发签名或扣积分。
服务商、赏金及发行申请保留产品账号流程与独立管理审核；任务完成不等于付款，申请通过不等于链上发行。后台合成样本不能当作真实注册用户或并发验收。

开发命令
使用 Node 24；本目录执行 npm ci 后再运行 npm test 或 npm start。依赖由 package-lock.json 锁定，即使未配置推送也不可跳过安装。
从仓库根构建网页及管理界面：
  pnpm --dir tongban install --frozen-lockfile
  pnpm --dir tongban-admin install --frozen-lockfile
  pnpm --dir tongban build
  node yubenzhe-deploy/scripts/build-admin.mjs
  node yubenzhe-deploy/scripts/stage-frontend.mjs tongban/dist
stage 会重建 public/frontend。构建内部预览镜像前，须从仓库外 output/yubenzhe-internal-preview-0.14.0-dev.6/internal 副本重新复制内部商业计划、品宣 PDF/TXT 与 index.html 到 public/frontend/internal；核对文件与链接后才构建镜像，部署后分别验证未登录门禁和登录后可读。该 output 位于本任务 git-2 目录，不在代码仓库；这些内部资料不提交公开 Git，具体绝对路径见 ../docs/INTERNAL-PREVIEW-RUNBOOK.txt 第七节。
启动本地 M0 前按运行手册明确独立 M0_STATE_DIR 和端口，再执行 npm --prefix yubenzhe-deploy run dev:m0。不要默认触及已有用户状态，也不要用旧网页配新后端。

数据库与迁移
state 保存独立管理样本与审计；ai-state 保存模型工作区/任务；social-state 保存产品身份、社交、积分及文件工作流。三者不是可互换的身份或资产来源。运行数据和 backups、retired-v01 均不进入 Git。
已应用的迁移和校验和不可改写。014 增加积分；015 先确认旧资产全部符合 SIM 标识/测试网/模拟地址，再对 19 张旧表生成离线 JSON 归档和 SHA-256 校验，成功才删除旧表、触发器和资产榜偏好。非 SIM 或归档失败就拒绝升级，不清库、不伪装 SIM、不自动兑换积分。归档仅为旧测试审计，不是运行时余额服务。
隔离演练后，已有本地用户库已完成 11→13 项迁移：19 张旧 SIM 表 68 行先归档并校验，65 张保留表数据哈希不变，7 账号、4 消息和 6 工作任务保留。证据见 reports/v02-local-upgrade.json。迁移前备份外置于工作空间 work/yubenzhe-m0-backups/pre-2026-10-10T12-37-58-220Z，不进入 Git。用户打开积分页时获得的一次 1000 POINT 是本地欢迎分，不是旧资产兑换。后续升级仍须先停写、备份和隔离演练。

备份、恢复与部署
2026-10-11 已完成隔离演练和最终停双服务升级，upgrade-verify 核对保留旧记录不变，三库完整性正常。备份目录 /opt/yubenzhe/backups/pre-internal-cutover-20261011T004550Z，发布目录 /opt/yubenzhe/releases/0.14.0-dev.6；ops/current 与 ops/image 已切换，定时任务已恢复。详细步骤与回滚限制见 ../docs/INTERNAL-PREVIEW-RUNBOOK.txt。
frontend/admin 都可能写 social-state 和 ai-state。升级、成套恢复与回滚必须核对两个服务的实际镜像、环境和持久挂载，不能只切换版本标签或只停止 frontend。
SQLite 在线备份用 scripts/backup.mjs 的 backup API，并检查完整性、外键及 SHA-256；不能只复制运行中的 .sqlite 主文件而忽略 WAL。逐库在线备份不能保证跨库同一业务时刻；迁移回滚点需停止本项目写入者后成套备份，再到隔离目录恢复验证。
先启动一个当前版本服务完成迁移并验证，再启动另一个相同版本服务。升级后的库不能交给不支持迁移的旧镜像。回滚前另备份当前数据，选用匹配且验证过的整套备份，明确新增数据处置并重新落实已注销账号删除要求。不能靠删除表、重建空库或篡改校验和恢复。
保留既有持久目录布局；不要因路径缺失自动初始化空库。Linux 应用 uid/gid 为 1000:1000，数据目录 0700、库和凭据 0600。备份源目录需允许 SQLite 创建 WAL 辅助文件，数据库连接仍只读；不要扩大到无关项目权限。
ops/production 的 current 与 image 引用在切换时必须指向已核对的发布目录和镜像。自动备份、健康检查模板要在目标环境单独核验；健康接口正常不等于备份新鲜、恢复成功或端到端功能通过。

凭据与访问
配置参考 .env.example，但实际口令、模型凭据、邮箱秘密和签名材料单独保管，禁止加入源码或镜像。create-auth.mjs 从标准输入读取口令，拒绝覆盖已有文件；轮换应保留原 userId，不能新建身份替代原数据库所有者。
当前 INTERNAL_PREVIEW 仅在 frontend 启用，要求 HTTPS、PUBLIC_FRONTEND=false、M0_SIMULATION=false 及持久 OTP 秘密。静态、PDF/TXT、安装下载与全部产品 API 都先验证外层会话；WebSocket 没有开放传输，升级请求拒绝。产品 AI 走 /api/social/ai 按内部 UUID 隔离，旧共享身份 /api/ai/* 在内测返回 404，admin 管理端保持独立会话。/healthz 只公开状态和版本。保持同源与 Origin 校验、独立管理员认证及限速。代理、端口和 TLS 变更仅作用于用户授权的目标服务，不覆盖无关项目。
本地开发默认不公开部署、不购买服务、不发送邮件、不收费或接主网资金。商店上架、真实推送、异地恢复、外部告警及生产服务商接入仍需独立验收。旧版本发布记录由 Git 历史追溯。
