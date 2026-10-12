# 愚笨者 · YBZ

2026-10-13 RELEASE-READY 最终发布：0.14.0-dev.15 已部署到 https://66.42.56.29/，前后台同为 release-ready-r3（产品源码 a7f169c），按用户选择使用公开注册＋个人密码，随机10位ID、新密码12–128字符、旧PIN兼容、公开OTP关闭。A→B→C→D 已分别提交；B四步引导/系统主题/骨架/本机地址簿、Android和Windows安装包完成。后端672、前端817、原生108通过；公网五个自动化账号并发与429、真实双账号社交、Android模拟器→已安装Windows Codex→真实文件及回复、Windows群→AI→返回群已验证。切换前停止frontend/admin并暂停定时任务，三库成套备份及隔离恢复通过；12账号（含原6个）保全，切换后原个人会话和配对仍有效。仅此YBZ主机获准更新，未碰另四台/主网/付费资源。实体安卓、五名真人与真实链上支付未在本轮验收；新Android包名不能继承旧钱包，保留旧应用并先备份恢复核对。31项逐条证据及边界以 docs/RELEASE-READY-FINAL-20261013.txt 为准，安装包SHA以 docs/RELEASE-READY-PACKAGES-20261013.json 为准。下文是历史记录，不能覆盖本段。

2026-10-13 发布准备：已按用户选择完成“公开注册＋个人密码”代码，随机ID、各自独立会话，公开测试验证码禁用。A版本dev.14；后端649、前端743通过；正在执行停写成套备份、隔离恢复与公网升级，尚未交付新安装包。随后按B功能→C打包→D并发验收继续。最新状态见[发布准备进度](docs/RELEASE-READY-STATUS-20261013.txt)。下方等待认证选择的记录已被本次明确选择替代。

2026-10-13 发布准备进行中：A 已补公开资料隔离、历史归档核验和三库隔离升级演练工具；公网仍为 dev.10，未迁移、未更新安装包。公开显示测试验证码与独立账号安全冲突，正在等待用户重新选择登录方式。后端全量629通过，后补线上旧迁移前缀用例后的升级/备份专项24通过。详细状态及31项待验清单见 [发布准备进度](docs/RELEASE-READY-STATUS-20261013.txt)，不是全项完成报告。以下保留旧轮次记录。

2026-10-13 细节打磨进行中（仍基于 dev.13）：A 已提交 aea2238，多钱包本机 AES-256-GCM、旧库兼容及钱包入口整理已验证；B1 未读红点与 B5 长按/右键菜单已实现。当前前端731、后端605通过；A消费者钱包本地EVM1通过，另有历史群EVM积分旧fixture失败，不能称全闭环重验完成。启动 node tongban/build.mjs 后 node scripts/start-detail-review.mjs，localhost:18938，独立 ../ybz-detail-review-20261013。B2/B3/B4 等待用户明确 R5 普通聊天存储范围与连续迁移编号；D/C 未做，不跳过顺序。任务正文54而汇总56，报告保留两候选未确认。详见 docs/DETAIL-POLISH-ACCEPTANCE-20261013.txt。未连接任何服务器、未部署/push/原生打包，旧18936与数据保留；本轮没有 SQL 迁移。以下均为历史状态。

2026-10-12 **0.14.0-dev.13 本地审核版**：已按 [UI 与功能任务书](docs/CODEX-TASK-UI-AND-FEATURES-20261012.md) 完成 U0→U5、F1→F4、T1→T2，逐批提交。消息首页、三皮肤、讨论组 AI 备注、私聊与人工决策续作、关键通知均有实际代码与验证。默认消息；五 Tab 为消息→发现→中央工作台→钱包→我的。

启动：`node tongban/build.mjs`，再执行 `node scripts/start-ui-review.mjs`；审核 [localhost:18936](http://localhost:18936/?v=0.14.0-dev.13#messages)。使用独立 `../ybz-ui-review-20261012` 数据；旧18934预览已停，旧库未升级。最终前端678、后端603、桌面79、合约40、本地钱包EVM1项通过。完整变更、逐批结果、缺失配置、未完成项及回滚见 [总验证报告](docs/UI-FEATURES-ACCEPTANCE-20261012.txt) 和 [逐文件清单](docs/UI-FEATURES-FILE-CHANGES-20261012.txt)。

本轮没有连接或部署服务器、没有 push、没有更新原生安装包。浏览器决策验收使用明确标注的合成执行器，真实写入本地文件；真实模型、真机、实际 Web Push 和公网链上完整闭环仍待配置与验证。`public/frontend` 已刷新至dev.13，历史internal资料完整保留；本地staging不等于上线。

以下为上一轮及历史交付记录，不能覆盖上方本轮结论。

2026-10-12 **0.14.0-dev.12 本地审核版**：已按 [MASTER P0→P7](docs/MASTER-ULTIMATE-REVISION-20261012.md) 实施并逐批提交，代码与本机验收结果见 [本轮验收](docs/ULTIMATE-REVISION-ACCEPTANCE-20261012.txt)。本轮方针为平台零收费、删除积分、设备只连接/远控/AI任务/文件收发。AI＋社交、AI＋钱包、社交＋区块链三个闭环保留，用户批准与链上付款核验不因移除积分而取消。未连接或修改服务器，不启用主网或实际Gas代付。

下方为历次交付证据，提及积分预算、旧版本或公网状态的段落不再代表本轮功能，也不应作为部署依据。既有用户库未经本轮升级；023迁移只在隔离测试库演练，实际升级必须先归档并验证。

本机启动：`node tongban/build.mjs` 后 `node scripts/start-ultimate-review.mjs`，访问 [localhost:18934](http://localhost:18934/)。Windows dev.12 安装包已构建并核对资源/安全配置，尚未安装或上传；Android/iOS 未更新。前端 581、后端 530、桌面 78、合约 40、消费者钱包本地 EVM 1 项通过。群 AI 每轮手动批准，单机最多 3 任务；原生工具/模型使用合成测试，真实多 AI、云机与公网测试网完整闭环仍待验收。

## 历史交付记录

当前本地审核版 **0.14.0-dev.11（2026-10-12）**：新增 Windows 安装器、电脑机器码配对、统一设备列表、本人设备消息入口和能力标注；五类装机清单齐全。旧配对文件和云电脑后端保留。安装器已经本机安装并验证启动，机器码真实 HTTP 安全检查通过；真实云机、实体手机和完整安装版 AI/文件/远控往返仍待验收。没有部署任何服务器，也没有更新 Android/iOS。审阅地址 [localhost:18930](http://localhost:18930/#workbench/devices)，详细结果见 [电脑版与设备配对验收](docs/YBZ-DESKTOP-DEVICE-CODE-ACCEPTANCE-20261012.txt)。下方“当前版本”和“未更新原生包”等内容保留为历史记录。

2026-10-12 新增设备 AI 通道：工作台 → 我的设备 → 和它聊天，可通过原账号和设备配对向本机 Codex 派任务并接收回复，支持端点加密的临时文件中转。真实本机文字往返已验证；云电脑本人登录、可信 HTTPS 中转和物理手机验收仍待完成。严格区分 CLI 回复结束与用户目标完成。启动与逐项证据见 [AI 通道验收记录](docs/YBZ-AI-CHANNEL-ACCEPTANCE-20261012.txt) 和 [电脑连接器说明](yubenzhe-deploy/device-bridge/AI-CHANNEL-START.md)。本次未发布生产、未更新原生包。

2026-10-12 群协作基线：保留 AI＋社交、AI＋钱包、社交＋区块链三条主线，新增群协作批准、真实文件成果、验收与本人签名的测试网付款/回执流程。群技术联测使用真实 HTTP、实际钱包及本地 EVM，模型为测试替身；设备 Codex 文字验收不代表群模型与公网测试网闭环已完成。此次未迁移原用户库。运行 `node scripts/start-group-review.mjs` 可在独立 localhost:18926 审核；先运行 `node tongban/build.mjs` 构建。详情见 [群协作实施记录](docs/YBZ-GROUP-LOOP-IMPLEMENTATION-20261012.txt)。下方旧版本状态为历史记录。

AI 工作台、熟人社交与自托管测试网钱包。当前需求基线为 **V0.2**，当前界面版本为 **0.14.0-dev.6 / 公网网页内部预览**。

工作台支持目标、计划、积分预算、文件任务执行及成果预览下载；社交包含账号、好友、群聊、朋友圈与服务商/赏金申请；钱包独立创建或导入密钥，直接链上收发。POINT 是不可转让的服务积分。平台托管余额、充值提现、内部资产划转与资产榜已退役。

2026-10-11，公网网页已切换至 0.14.0-dev.6 内部预览：https://66.42.56.29/，healthz 的 stage 为 internal-preview。前端 419/419、后端 219/219、合约 38/38，共 676 项测试通过（含真实钱包签名的本地 EVM 联测）；服务器 Ollama qwen3:0.6b 实测返回连接正常。公网未登录时静态页面与 PDF 显示门禁，产品 API 返回 401；登录门禁后可读取网页、build-info、只读链配置与 PDF，旧 /api/ai/* 入口返回 404。

内部预览需要先通过共享外层门禁，再使用独立产品账号。模拟邮箱仅允许 .test 保留域（如 tester@example.test），验证码只在已通过门禁的页面显示，不发送真实邮件；共享门禁与测试邮件不等于真实多租户邮箱认证，同一测试邮箱不应存放需对其他受邀者保密的数据。旧真实邮箱不能用模拟码接管；旧 ID＋密码和恢复码流程保留。

本轮交付仅为网页内部预览。Android、iOS、Windows 旧原生包仍为 0.13.0，未重打包，且不支持新增外层门禁；不能据网页验收声称原生已更新。

历史 dev.5 验证状态：前端全量 404/404、消费者网页及独立管理端构建通过；已核对桌面与 390px 手机五页、三皮肤、云机/收藏/通讯录/近期任务路径和工作台默认落地，本地 healthz 与 build-info 均为 0.14.0-dev.5。 该轮记录见 [品牌 UI 验证报告](yubenzhe-deploy/reports/brand-ui-verification.json)，本机入口为 [localhost:18914](http://localhost:18914/)。

历史 dev.4：前端全量 356/356 通过，本地消费者网页和管理端构建成功；浏览器已验证电脑及 390px 手机个人页、业务返回和收藏/历史草稿往返，备份重启后 healthz、build-info 确认 dev.4。该轮没有新迁移，业务数据保留。更早 [GitHub CI](https://github.com/fx950217-lgtm/yubenzhe/actions/runs/38052669120) 的 `f11f4c1`、后端 207/207、合约 23/23 仅为历史基线，不能当作当前版本重测。详细范围见 [实施记录](docs/V02-IMPLEMENTATION.txt)。当前公网及原生状态以上方 dev.6 说明为准。

中文名：愚笨者；全球英文主名：YBZ。品牌主张：技能交给 AI，判断留给自己。英文：Let AI do the doing. You do the deciding. 三要素固定为：思维——知道要什么、为什么；决策——定方向、做取舍、担结果；创造性——把不相干的东西连起来。

五 Tab 固定顺序：工作台 → 消息 → 钱包 → 发现 → 我的；工作台为默认落地页和第一主任务。工作台首页呈现深色 Hero、品牌主张、积分卡、任务入口与近期动态；具体模板仍进入工作流广场查看，赏金、服务商、活跃榜、趣味币与积分归工作台。通讯录从消息进入。发现仅保留朋友圈、认识新朋友、收藏；我的仅保留账号、设置、云机、关于，个人资料与登录管理归账号，外观、安全、帮助和安装归设置，云机指向工作台设备页。 聊天模式保留免费云端模型、本机模型两个入口。收藏支持本机文字/链接，历史草稿继续保留；旧 mine/points 与收藏来源兼容。最新 UI 约定覆盖需求原文旧页面结构，技术需求与业务边界不变。

钱包卡下固定显示“密钥保存在你自己的设备上，平台不托管、不接触你的资金。”；积分卡下固定显示“积分不可转让、不可提现，仅可用于消耗站内服务。”。交易手续费优先使用链上回执实际数值，没有回执时明确标注预估或未提供；“手续费 $0.01”仅为明确标注的版式示例，不能作为真实交易固定报价。

## 从这里开始

- [当前需求与验收标准](docs/requirements-v0.2.txt)：22 章、51 项有效验收。
- [需求变更映射](docs/V02-REQUIREMENTS-CHANGELOG.txt)：V0.1 到 V0.2 的调整依据。
- [当前实施与验证状态](docs/V02-IMPLEMENTATION.txt)：已完成、待验证和未接入能力。
- [本地运行与升级手册](docs/M0-RUNBOOK.txt)：依赖、隔离状态目录、启动和数据迁移。
- [公网内部预览手册](docs/INTERNAL-PREVIEW-RUNBOOK.txt)：门禁、测试账号边界、运维与成套回滚。
- [项目上下文](PROJECT_CONTEXT.md) · [协作约定](AGENTS.md) · [合约说明](contracts/README.md)。

## 工程目录

| 目录 | 内容 |
| --- | --- |
| `tongban` | 消费者网页、三皮肤、钱包与前端测试 |
| `yubenzhe-deploy` | 产品账号、社交、设备 AI、人工决策、工作台、独立管理端、SQLite 与运维 |
| `contracts` | 已部署至 BSC 测试网的一次性链上分发合约、本地测试与链上验收记录 |
| `tongban-android` | Android 工程 |
| `yubenzhe-ios` | iOS 工程，需要完整 Xcode 的 Mac |
| `yubenzhe-desktop` | Windows/Electron 工程与本地 Ollama 桥 |
| `tongban-admin` | 管理 UI 所需锁定依赖与源组件 |

## 开发

使用 Node.js 24 和子项目指定的包管理器。保持子项目同级；`tongban` 名称兼容既有构建路径及应用标识。

```sh
pnpm --dir tongban install --frozen-lockfile
npm --prefix yubenzhe-deploy ci
pnpm --dir tongban test
npm --prefix yubenzhe-deploy test
pnpm --dir tongban build
node scripts/check-project.mjs --allow-changes
```

启动前按运行手册明确独立的 `M0_STATE_DIR`，再执行 `npm --prefix yubenzhe-deploy run dev:m0`。默认状态路径可能已有用户记录，不要以清缓存为由删除它。网页构建成功后再按对应工程说明同步原生资源，构建成功不等于真机验收。

本地 M0 与公网内部预览都不发送真实邮件、不收费，不接真实云电脑、通用多 AI 编排或分佣；公网原有 Ollama 单模型连接已实测正常，不等于通用自动化已接通。BSC 测试网（chainId 97）已完成真实钱包验收：2 笔部署及 approve、fund、原生 tBNB 转账、claim、refund 共 7 笔交易全部成功，均至少 3 次确认并完成主链区块一致性核验。10003 YBZt 供资后，A 领取 5001.5 YBZt，B 未领的 5001.5 YBZt 到期退回发起者；remaining、allowance、contractToken 均为 0，金额守恒。服务器链配置已启用；样例活动已结束，仅供审核，不能继续领取。合约地址与交易详见内部预览运行手册；验收报告：yubenzhe-deploy/reports/internal-chain-acceptance.json。区块浏览器源码验证尚未提交，可复现的 standard JSON 已提供。主网、真实收费、Gas 代付和积分兑资产仍关闭。自托管钱包仅开放 BSC 测试网，不支持所有链或所有冷钱包硬件。

代码源：[公开 GitHub 仓库的当前开发分支](https://github.com/fx950217-lgtm/yubenzhe/tree/codex/m0-local-test)，分支为 `codex/m0-local-test`。主线大规模变更和历史审计批量删除被自动审核拒绝，`main` 与历史元数据保留。上一轮已清理约 1985 MiB 旧安装包和缓存，本机保留备份；访问凭据、钱包密钥、运行数据库、备份、依赖缓存和安装包不进入 Git。
