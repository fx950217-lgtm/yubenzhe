# 海外部署与云电脑配置

适用：0.14.0-dev.8；核对日期：2026-10-11。本轮是后端准备版，不是实际云电脑交付版。

## 产品与区域

产品不在中国境内上架、不向中国境内提供服务。服务端资源全部部署海外，首选美国；不使用任何 cn- 开头的 AWS 区域。设置区域只是配置，不能迁移已运行的数据或主机。本轮没有迁移服务器；最后已确认的公网服务仍在新加坡，版本 dev.7。

| 区域代码 | 位置 | 角色 | 用途 |
|---|---|---|---|
| us-west-2 | 美国俄勒冈 | 主力 | 后端与云电脑主区，默认 |
| us-east-1 | 美国北弗吉尼亚 | 冗余 | 另行设计恢复、复制及故障切换 |
| ap-northeast-1 | 东京 | 亚太 | 亚太用户接入候选 |
| ap-southeast-1 | 新加坡 | 亚太 | 现有服务器所在地、亚太候选 |
| eu-west-1 | 爱尔兰 | 欧洲 | 欧洲候选 |

以上为应用配置允许区域，不代表已经购买资源、跨区同步，或每个套餐在所有区域都已可用。

云电脑统一采用 DCV。AWS 已于 2026-07-31 停止接纳 PCoIP WorkSpaces Personal 新客户，并计划于 2027-10-31 停止该协议服务；本项目不新增 PCoIP 路线。[AWS 官方说明](https://docs.aws.amazon.com/workspaces/latest/adminguide/workspaces-pcoip-end-of-support.html)

Windows/macOS 使用官方客户端。Android/iOS 路线采用官方 Web Access/PWA 候选，不能把旧移动原生客户端当作已支持 DCV。Web Access 需要管理员启用，手机输入、剪贴板、前后台切换与文件下载尚待实体设备验收。本版返回 mobileVerified=false。[Web Access 官方说明](https://docs.aws.amazon.com/workspaces/latest/userguide/amazon-workspaces-web-access.html)；[协议能力对照](https://docs.aws.amazon.com/workspaces/latest/userguide/supported-features.html)。

## 地址配置与证据

配置只由操作者的部署环境或构建环境提供，不接受聊天内容、任务输出、URL 查询参数或本地存储改写服务地址。前端变量不得放密钥。

| 地址/区域 | 环境变量 | 默认与生效方式 | 实现/验证 |
|---|---|---|---|
| 后端区域 | DEPLOY_REGION / AWS_REGION | us-west-2；重启进程 | server/deployment-config.mjs、deployment-config.test.mjs |
| 云电脑区域 | DESKTOP_REGION / AWS_REGION | us-west-2；重启 | desktop-config.mjs、desktop-provider.test.mjs |
| 云模型 | AI_BASE_URL + AI_ALLOWED_HOSTS | https://api.deepseek.com/v1；默认提供商仍 disabled | deployment-config.mjs 传输映射；地址、重定向及允许主机测试 |
| 服务端 Ollama | OLLAMA_BASE_URL + OLLAMA_ALLOWED_HOSTS | http://ollama:11434；仅内部服务 | 同上；独立于设备本机模型 |
| BSC 测试网 RPC | BSC_TESTNET_RPC_URLS | 两个官方公共节点的 JSON 数组 | 后端 CSP、前端构建配置；保持 chainId=97 与原签名逻辑 |
| 产品服务器 | YBZ_PREVIEW_ORIGIN | 示例沿用 https://66.42.56.29；部署时必须显式设定 | compose.public/internal、Caddy；前端/原生重新构建 |
| 区块浏览器 | BSC_TESTNET_EXPLORER_URL | https://testnet.bscscan.com | tongban/src/deployment-config.js |
| 水龙头说明 | BSC_TESTNET_FAUCET_URL | https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/ | 同上 |
| 本机模型下载 | OLLAMA_DOWNLOAD_URL | https://ollama.com/download | 同上，并同步原生外链策略 |
| 真实邮件 | EMAIL_ENDPOINT | 默认未配置；必须显式配置 HTTPS 地址 | 已有 account-mail.mjs / MAIL-DELIVERY.txt，不沿用模拟邮箱到正式环境 |
| 官方云电脑入口 | DESKTOP_CLIENT_URLS_JSON | 官方 clients.amazonworkspaces.com / webclient.amazonworkspaces.com | desktop-config.mjs；仅允许官方域名以防钓鱼 |
| ACME 证书服务 | ACME_DIRECTORY | Let's Encrypt 官方目录 | Caddyfile.public、compose.public.yaml |
| 前台/管理端入口 | FRONT_ORIGIN、ADMIN_ORIGIN | 本地回环示例；正式使用 HTTPS | 已有服务端 Host/Origin 校验 |

build.mjs 将公开配置编入 JS，并同步生成 CSP、public-deployment.json 和 app-policy.txt。scripts/configure-native-endpoints.mjs 从同一次网页构建生成 Windows deployment.cjs 与 Android DeploymentConfig.java；各自 copy-web 自动调用。iOS sync-web 将 app-policy.txt 打包，Swift 读取它作为响应策略；缺失时拒绝网络资源。iOS 改动未在 Xcode 编译。

开发机模型 http://127.0.0.1:11434、原生本地 Origin、内部监听/反代回环地址保持固定，这是设备信任边界，不是境内第三方服务。AI 旧适配器里的原始基地址作为兼容映射标识保留；正式启动已通过环境配置的传输层映射。源码中仍有默认地址、生成配置、官方说明/仓库链接及安全允许域名常量；不能把扫描结果描述为“没有任何 URL 字面量”。上述运营服务端点均有覆盖入口，指定的境内服务商扫描零命中。

DeepSeek 的默认域名不证明模型处理位置在美国；运营前需要单独确认供应商数据处理地点，必要时选用允许的海外兼容端点或部署在自有海外主机上的 Ollama。区块链公共 RPC 的实际路由/处理地点也需运营核验。

## 云电脑骨架的边界

DESKTOP_PROVIDER 默认 disabled。可配置 DESKTOP_REGION、DESKTOP_CREDENTIALS_FILE（权限受限 JSON 文件）和 DESKTOP_CRED_KEY（32 字节、Base64 或 64 位十六进制）。Compose 的 secrets/desktop 挂载到 /run/ybz-desktop。密钥需单独保存；缺失拒绝写密码，错误密钥不能解密。不要把密钥放进源码、报告或前端。

本轮没有 @aws-sdk、实际 API 调用、资源购买或真实 worker；填写凭据也不会启用不存在的适配器。只有测试代码以内存注入传输对象执行合成场景。disabled 时 capabilities 可读且 available=false，业务接口在通过门禁/账号校验后返回 503 DESKTOP_UNCONFIGURED，未登录依然 401。

新增迁移 016，只追加而不改写已应用校验和。3 张业务表外增加审计表；状态增加 terminating 与 unknown，以区分请求已发出和资源真正终止，防止网络不明时重购。计价字段可为空且 billingEnabled=false，不扣真实资金。

API 同时提供 /api/desktop 与 /api/social/desktop。后者适配现有网页 Cookie 路径；前者使用产品 Bearer 会话。开通、查看凭据、改密、注销需要动作专属的一次性强验证，恢复保护期不能操作。操作 proof 绑定设备、参数与版本；凭据 GET 用 X-Desktop-Proof，不能把证明放在 URL。客户端须先通过已有 passkey 强验证流程取得 purpose=desktopProofPurpose(...) 的证明。本轮未新增云电脑 UI、原生证明头桥接或设备授权卡。

用户独立使用的目标是拿到注册码、用户名、密码、目录和官方入口后，用官方客户端/Web 直接登录，不依赖 YBZ 的桌面中转。现在没有真实云电脑可以交付凭据；API 和加密存储已具备相应接口。实际改密还需对接所选目录的密码机制；账号注销必须先核实所有云资源终止。不能仅更新本地密码或删除数据库行就称云端操作成功。

## 后续实际接入顺序

1. 在 AWS 官方网站注册账号，完成账号验证，启用 MFA；建立受限 IAM 角色与预算提醒。
2. 在 us-west-2 选择 WorkSpaces、目录/VPC/子网和 DCV bundle，确认账号配额与报价。basic/standard/power/graphics 目前只是内部规格枚举，尚未映射已购买 bundle。
3. 单独实现真实适配器、异步状态核对与失败补偿；核验目录改密及资源终止。不把本轮测试传输对象用于生产。
4. 由获授权的操作者开一台测试资源，完成 Windows/macOS 和真实手机 Web/PWA 的登录、输入、断线恢复、改密与注销验收，再接入 App 的设备授权卡。
5. 正式部署前停止 frontend/admin 两个数据库写入者，成套备份、隔离升级演练、HTTPS/门禁检查，再切换入口。旧程序不能直接读取不兼容的新库回滚。

本轮没有注册、购买或申请云服务，也没有修改公网资源。
