0.12.0 简洁界面已部署并完成客户端安装检查

0.12.0 参考微信官方 App Store 的消息列表与群聊截图，改为白色列表、浅灰背景和紫色重点操作；使用系统 sans-serif 字体与黑灰文字，主标题 18px、会话名称 17px、正文 16px。页面采用扁平分组列表、细分隔线、小圆角与简洁底部导航，减少大卡片、阴影和装饰文字。浅紫星环 B 应用图标保留，网络标识和说明仍只在钱包资产页显示。
界面参考：https://apps.apple.com/cn/app/wechat/id414478124 。
0.12.0 已使用前台镜像 yubenzhe-public:0.12.0 发布。新加坡 /opt/yubenzhe/releases/0.12.0 已部署，公网 HTTPS /healthz 返回 200 且版本为 0.12.0；网页 JS/CSS 与四端快照一致，下载区 21 个文件 SHA-256 全部通过。后台、代理和模型容器 ID 未变。
Android versionCode 13 已用原签名执行 -r 覆盖安装并启动（本轮 PID 2777）；Windows 0.12.0 安装器退出码为 0，安装 ASAR 与构建产物一致且进程运行；iOS build 14 的 0.12.0 DEB 已安装，启动日志包含 starting local service、page loaded、ready，手机本地 HTML/JS/CSS 均返回 200。
构建源码提交 9c87fe4c345d1e726a5d9e5f40791a9795bc6f6a，iOS macOS workflow 37922166794 成功。 实际范围见 reports/ui-012-verification.json、../tongban/releases/release-status.json 和各平台验收 JSON。
本轮通过网页 270 项测试、14 项手机/桌面布局检查（360px / 1280px）、20 项交互检查（320px / 390px）、Android 5 项测试 / 85 条断言、Windows 23 项检查、iOS 13 项 Python 检查及 macOS 工作流内 4 项桥接检查。未新增用户在手机上肉眼确认画面，完整实体设备功能验收仍未完成。发现只调整界面，业务能力与数据范围不变；账号和在线社交沿用现有服务，钱包仍仅支持 BSC 测试网。 不改变账号 API、数据库或既有持久目录；本轮只更新消费者 frontend，后台、代理、模型、凭证和用户数据保留。

0.11.1 历史部署与安装验收

本次仅调整消费者顶部 UI：移除全局 B /“愚笨者”品牌行和重复页标题，非资产页保留自己的标题、搜索和“＋”等操作；BSC 测试网标识及说明按钮仅在钱包资产页。浅紫星环 B 应用图标保留，不改变账号 API、钱包网络或持久数据路径。
0.11.1 发布目录 /opt/yubenzhe/releases/0.11.1，公网 /healthz 返回 200 且版本正确；网页 app.js 与 Android、Windows、iOS 快照 SHA-256 一致，下载区 17 个文件校验通过。后台、代理和 Ollama 容器 ID 未变。
Android 原签名包已在模拟器覆盖安装为 0.11.1 / code 12 并启动；Windows 安装器退出码 0，安装 ASAR 与产物校验一致且新进程运行；iOS build 13 已安装，启动日志 ready，手机本地 index/js/css 均返回 200。本轮未新增 iPhone 画面的用户确认，完整物理设备功能验收仍未完成。
本轮顶部 UI 14 项检查、相关网页测试 20 项、Android 5 项测试 / 85 条断言及 iOS 13 项 Python 检查通过。源码提交 8aba0bcee1b7a6c1d41b42e1c0b5f49f2d5bb9c7，iOS macOS workflow 37919888198 成功；实际记录见 reports/ui-0111-verification.json、../tongban/releases/release-status.json 和各平台验收 JSON。以下 0.11.0 记录仅说明历史验收，不计为 0.11.1 全量重跑。

0.11.0 历史现网验收：0.11.0 已部署至 /opt/yubenzhe/releases/0.11.0，frontend 健康；后台、Ollama 和 Caddy 保持原容器。Linux 服务端50项通过，下载文件SHA-256全部一致。既有持久目录直接位于 /opt/yubenzhe 下，只有新增 social-state 位于 /opt/yubenzhe/shared 下。完整记录见 reports/social-011-verification.json。

0.11.0 账号与多人消息更新

/api/social 使用独立产品账号会话，不复用 AI 验收身份或合成后台。网页会话为 HttpOnly / SameSite=Strict Cookie；固定原生来源使用 bearer。账号、ID 保留表、好友、群、消息和图片保存于独立 social-state/social.sqlite，目录 uid1000 / 0700，数据库0600；不存储钱包密钥。此数据库不可复制到 state 或 ai-state。
发布需要新增持久目录 /opt/yubenzhe/shared/social-state，在新版本目录链接 social-state；只更新 frontend 容器。保留 .env、AI/admin、Ollama、Caddy 和旧版目录。新服务无自动生成合成账号，测试只使用临时隔离库。
在线备份：docker compose exec frontend node scripts/backup.mjs /social/social.sqlite /social/backup-YYYYMMDD-HHMM.sqlite。备份成功后转移到既有受保护备份目录并保留0600。恢复前仅停止本项目 frontend 写入，备份现库，校验备份后再人工恢复；禁止自动重建或清空。升级不能修改已应用迁移的 checksum。
安全与能力边界：6位密码按用户产品要求，服务端 scrypt 加盐及持久限速；ID唯一且保留靓号/曾用ID。群创建和消息发送幂等；成员权限、邀请后历史可见性、私密图片鉴权、密码轮换撤销旧会话均有回归。头像为可分享随机资源URL，只返回图片，替换/删除撤销旧URL。聊天没有端到端加密、推送通知或自助注销。单实例 SQLite 不支持无协调多副本。

以下为历史发布及原始部署说明，以本节和本次发布记录为准。

2026-10-09 更新：前台 0.10.0 已在 https://66.42.56.29 公开提供浅紫界面与 Android 下载；AI/API、管理后台保留身份验证。生产账号体系未接入。
当前前台发布目录 /opt/yubenzhe/releases/0.10.0，镜像 yubenzhe-public:0.10.0；后台和模型保留原容器。发布前已对两套 SQLite 在线备份，完整性检查通过。Linux Node 24 后端验收 22/22。
构建网页并 stage 后，使用 compose.yaml + compose.public.yaml 构建、仅更新 frontend（up -d --no-deps frontend）。Caddy IP 证书数据持久保留；不要重新创建账号、数据库或模型状态。旧 0.9.0 目录和镜像保留回滚。

以下为原始 0.9.0 受限验收搭建说明，默认门禁行为仍保留；PUBLIC_FRONTEND=true 仅开放前台静态资源。

愚笨者 0.9.0 · 受限服务器验收部署包

状态与范围
这是一套可运行的独立 Node 24 服务，不是静态假后台。后台直接复用既有管理核心与 SQL 结构，以 SQLite WAL 持久保存状态及审计；通过单次 SQLite 事务复现 D1 batch 的原子性。旧 Cloudflare Worker、D1 数据库和站点不被修改或删除。本包不复制其云端数据库；这是新的隔离验收库。
部署前须由负责前端的人员执行 stage-frontend.mjs，放入已完成的愚笨者 0.9.0 网页构建。没有构建文件则不得部署占位前台。
首次登录后台仍需明确点击“初始化 1,000 位模拟用户”。这些是固定合成样本，不是新增真实用户或真实并发压测。处理操作写入旧合成业务数据库。AI 工作台另有真实持久化数据库与模型适配服务，是否能运行取决于模型配置、连接验证和审批开通。产品用户注册、多人社交、托管充值提现、真实红包、发币与资金结算服务尚未接通。不能据此称正式上线或收取真实资产。

服务隔离
frontend 提供受限网页和 /api/ai 工作台申请、任务接口，仅访问本验收身份拥有的数据；/api/admin 路径被拒绝。
admin 提供独立页面及数据库 API，仅一个预配置验收账号可访问。所有者 ID 固定于认证文件，不接受浏览器或 oai-* HTTP 头传入身份。前台没有后台导航或入口；两个服务有不同会话 Cookie 和访问口令。
口令用 scrypt 加随机盐保存；登录后使用随机、HttpOnly、SameSite=Strict 会话 Cookie，有效期 1 小时。HTTPS 时设置 Secure。重启使会话失效，不删除数据库。修改操作还必须通过 Origin 校验。每个来源 15 分钟内最多 10 次失败登录，默认仅通过 SSH 隧道接入。

本地准备（从本目录执行，Node 24.x）
1. node scripts/build-admin.mjs ../tongban ../tongban-admin
   只在开发机器重建管理页面；服务器运行时无 npm 依赖，已包含编译结果。
2. node scripts/stage-frontend.mjs /绝对路径/已构建的网页dist
3. node --test tests/*.test.mjs
4. 将本包放在服务器独立目录，例如 /opt/yubenzhe-acceptance/releases/0.9.0。
   不使用旧项目工作目录，不覆盖现有反代、容器、数据库或端口。

准备访问凭证（只在目标独立目录操作，不通过命令行参数传密码）
mkdir -p secrets state backups ai-state
chmod 700 secrets state backups ai-state
在交互终端用隐藏输入读取一个至少16位的新口令，再通过stdin生成文件。例如 bash：
read -r -s -p 'Admin acceptance password: ' YBZ_ADMIN_PASSWORD
printf '%s' "$YBZ_ADMIN_PASSWORD" | node scripts/create-auth.mjs owner secrets/admin.json acceptance-owner
unset YBZ_ADMIN_PASSWORD
read -r -s -p 'Frontend acceptance password: ' YBZ_FRONT_PASSWORD
printf '%s' "$YBZ_FRONT_PASSWORD" | node scripts/create-auth.mjs reviewer secrets/frontend.json acceptance-reviewer
unset YBZ_FRONT_PASSWORD
脚本拒绝覆盖已有文件；不会打印密码。认证文件禁止加入归档、Git、网页或镜像。密码轮换需要保持原 userId 不变；更改 userId 将被已绑定的数据库拒绝。恢复/轮换前保留已有认证配置。不要创建预置简单密码。
Docker镜像以uid1000运行。仅对本部署目录下这些新建目录与认证文件设置所有权：
sudo chown -R 1000:1000 secrets state backups ai-state
不要把此命令作用于 /opt 或任何已有项目根目录。

Ubuntu24.04 受限启动
先只读确认服务器现有服务、docker compose ls、端口占用、磁盘空间。新项目名称固定为 yubenzhe-acceptance，不使用旧项目名称。
cp .env.example .env
如18808/18809已占用，在.env内选择其它未用端口，同时修改PUBLIC_ORIGIN及后续SSH本地端口。浏览器须使用精确配置的来源地址。
sh scripts/preflight.sh
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:18808/healthz
curl --fail http://127.0.0.1:18809/healthz
默认只绑定服务器127.0.0.1，不开放新的公网业务端口，不改防火墙，不申请付费实例。Docker构建基础镜像标签为node:24-bookworm-slim；远程构建后记录实际镜像ID/digest，回滚以该镜像ID为准。本地未运行Docker时不能把Compose模板称为已经在Ubuntu验收。

从个人电脑验收
ssh -N -L 18808:127.0.0.1:18808 -L 18809:127.0.0.1:18809 <已有SSH用户>@<已确认新加坡服务器>
前台：http://127.0.0.1:18808
后台：http://127.0.0.1:18809
分别登录各自验收账号。SSH连接信息通过已有安全渠道管理，本包不保存IP、SSH密钥或密码。
检查前台品牌、功能入口、测试网说明，后台初始化后用户总数1000、操作状态、审计、退出登录后接口拒绝访问。测试记录更改后重启admin确认仍保留。AI 申请可在前台提交并在独立后台审核，使用单独真实记录。不要把健康检查、AI 工作台接通或旧合成数据误认为社交、托管资金业务也已经接通。

可选独立域名与TLS（默认不启用）
仅在明确提供两个独立域名和允许访问的运营者IP/CIDR后，参考 ops/Caddyfile.acceptance.example 将两个站点片段加入现有反代。不得覆盖或重启无关站点配置。先确认80/443当前由谁占用；若由现有Nginx/Caddy管理，使用其既有发布流程，不能再启动抢端口的Caddy。
将FRONT_ORIGIN、ADMIN_ORIGIN改成对应https来源后重建服务会话；后台与前台使用不同子域。Caddy会提供TLS，片段在登录验证之外增加IP白名单。变更前先用caddy validate校验合并配置，再按现有运维方式reload。缺少域名或白名单时保持SSH隧道即可。

数据库备份
在线SQLite备份通过SQLite backup API生成一致快照并执行integrity_check，禁止只复制正在运行中的.sqlite主文件而遗漏WAL。
docker compose exec admin node scripts/backup.mjs /data/acceptance.sqlite /backups/acceptance-YYYYMMDD-HHMM.sqlite
工作台独立库还须另外备份：docker compose exec admin node scripts/backup.mjs /workspace/workspaces.sqlite /backups/workspaces-YYYYMMDD-HHMM.sqlite。该库包含任务文字、模型输出和审计；恢复前停止 frontend 与 admin 两个写入者。目标文件必须不存在。旧管理库备份包含合成管理记录和审计，不含资金私钥；访问凭证单独保管。首次部署、每次升级前备份；验收期间有操作的日期至少备份一次。使用系统已有调度方式安排，不自行创建全局cron覆盖他人任务。

回滚与恢复
发布前记录当前镜像ID、.env、部署包校验清单与数据库备份路径。升级只操作本compose项目；本包首版SQL迁移有checksum校验，已有版本脚本变化会拒绝启动，绝不自动删除表重建。
代码回滚：将RELEASE_TAG改为保留的上一个镜像标签，docker compose up -d --no-build；不删除state/ai-state/backups。
数据库恢复只在明确选择备份后进行：先停止本项目admin服务，另外备份当前库，使用SQLite integrity_check确认目标备份有效，将现有acceptance.sqlite及同名-wal/-shm一起移到独立带时间戳的保留目录，再复制已校验备份为state/acceptance.sqlite，设0600/uid1000，启动admin并查验用户总数和审计。不可对旧项目数据执行这些步骤。
禁止 docker system prune、docker compose down -v、删除旧库、重置旧网站或一键清空服务器。

认证和数据限制
这是服务器验收访问账号，不是产品用户注册/登录系统。团队角色仅预留；后台资金操作仍硬拒绝，账务只有TEST整数样本。前台链上能力仍固定BSC测试网，钱包数据留在各客户端本机；迁移网站来源地址不会自动搬迁浏览器localStorage。旧网页、安卓和新域名各自保管自己的本机钱包与演示记录。
本包提供真实 AI 工作台存储与模型适配接口，默认模型禁用；OpenAI 或受限内网 Ollama 配置并审核后才执行真实推理。没有多人聊天消息服务、托管签名、主网开关、资产代付或支付通道，不接收真实资金。完整配置、免费验收额度、备份、取消和API说明见 AI-OPERATIONS.txt。

运维资源
两个容器默认内存上限192MiB/384MiB，日志单文件10MiB、各保留3份；数据单实例SQLite，不支持横向多副本。AI 工作台使用另一个共享 SQLite 文件，不能按无协调多副本方式扩容。可选 Ollama 容器限制1CPU/1536MiB且没有公开端口；仅适合少量验收任务，1000样本不构成真实并发容量保证。健康检查只证明进程/数据库可读取，不证明外部BSC网络在线。服务器总资源需由现有项目负责人确认余量。

依据
Node24 SQLite接口：https://nodejs.org/docs/latest-v24.x/api/sqlite.html
Docker Compose端口/网络：https://docs.docker.com/compose/how-tos/networking/
Caddy反代：https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
历史版本已由主任务部署至用户指定的新加坡服务器，记录见 reports/yubenzhe-singapore-verification.json。0.9.0 的现场部署与模型结果须以本次主任务的新增验收记录为准，不能用历史记录替代。
安装文件独立放在 public/frontend/downloads，并只读挂载到前台；这些大文件不打入 Docker 镜像，更新下载不需要重建镜像。代码部署归档与源码 ZIP 不含大型安装文件，恢复服务时需要另行放回已校验的 APK/EXE/ZIP。
