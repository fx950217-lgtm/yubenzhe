# 愚笨者 · YBZ

AI 工作台、熟人社交与自托管测试网钱包。当前需求基线为 **V0.2**，当前界面版本为 **0.14.0-dev.5 / 本地 M0 开发版**。

工作台支持目标、计划、积分预算、文件任务执行及成果预览下载；社交包含账号、好友、群聊、朋友圈与服务商/赏金申请；钱包独立创建或导入密钥，直接链上收发。POINT 是不可转让的服务积分。平台托管余额、充值提现、内部资产划转与资产榜已退役。

dev.5 验证状态：前端全量 404/404、消费者网页及独立管理端构建通过；已核对桌面与 390px 手机五页、三皮肤、云机/收藏/通讯录/近期任务路径和工作台默认落地，本地 healthz 与 build-info 均为 0.14.0-dev.5。 本轮记录见 [品牌 UI 验证报告](yubenzhe-deploy/reports/brand-ui-verification.json)，本机入口为 [localhost:18914](http://localhost:18914/)。

历史 dev.4：前端全量 356/356 通过，本地消费者网页和管理端构建成功；浏览器已验证电脑及 390px 手机个人页、业务返回和收藏/历史草稿往返，备份重启后 healthz、build-info 确认 dev.4。该轮没有新迁移，业务数据保留。更早 [GitHub CI](https://github.com/fx950217-lgtm/yubenzhe/actions/runs/38052669120) 的 `f11f4c1`、后端 207/207、合约 23/23 仅为历史基线，不能当作 dev.5 重测。详细范围见 [实施记录](docs/V02-IMPLEMENTATION.txt)。线上与原生客户端仍为 0.13.0。

中文名：愚笨者；全球英文主名：YBZ。品牌主张：技能交给 AI，判断留给自己。英文：Let AI do the doing. You do the deciding. 三要素固定为：思维——知道要什么、为什么；决策——定方向、做取舍、担结果；创造性——把不相干的东西连起来。

五 Tab 固定顺序：工作台 → 消息 → 钱包 → 发现 → 我的；工作台为默认落地页和第一主任务。工作台首页呈现深色 Hero、品牌主张、积分卡、任务入口与近期动态；具体模板仍进入工作流广场查看，赏金、服务商、活跃榜、趣味币与积分归工作台。通讯录从消息进入。发现仅保留朋友圈、认识新朋友、收藏；我的仅保留账号、设置、云机、关于，个人资料与登录管理归账号，外观、安全、帮助和安装归设置，云机指向工作台设备页。 聊天模式保留免费云端模型、本机模型两个入口。收藏支持本机文字/链接，历史草稿继续保留；旧 mine/points 与收藏来源兼容。最新 UI 约定覆盖需求原文旧页面结构，技术需求与业务边界不变。

钱包卡下固定显示“密钥保存在你自己的设备上，平台不托管、不接触你的资金。”；积分卡下固定显示“积分不可转让、不可提现，仅可用于消耗站内服务。”。交易手续费优先使用链上回执实际数值，没有回执时明确标注预估或未提供；“手续费 $0.01”仅为明确标注的版式示例，不能作为真实交易固定报价。

## 从这里开始

- [当前需求与验收标准](docs/requirements-v0.2.txt)：22 章、51 项有效验收。
- [需求变更映射](docs/V02-REQUIREMENTS-CHANGELOG.txt)：V0.1 到 V0.2 的调整依据。
- [当前实施与验证状态](docs/V02-IMPLEMENTATION.txt)：已完成、待验证和未接入能力。
- [本地运行与升级手册](docs/M0-RUNBOOK.txt)：依赖、隔离状态目录、启动和数据迁移。
- [项目上下文](PROJECT_CONTEXT.md) · [协作约定](AGENTS.md) · [合约说明](contracts/README.md)。

## 工程目录

| 目录 | 内容 |
| --- | --- |
| `tongban` | 消费者网页、三皮肤、钱包与前端测试 |
| `yubenzhe-deploy` | 产品账号、社交、积分、工作台、独立管理端、SQLite 与运维 |
| `contracts` | 未部署的一次性链上分发合约与本地测试 |
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

当前 M0 不发送真实邮件、不收费，不接真实云电脑、通用多 AI 编排或分佣。链上分发合约未部署、未接钱包、未独立审计；积分兑资产、积分兑 Gas 与 Gas 代付关闭。自托管钱包仅开放 BSC 测试网，不支持所有链或所有冷钱包硬件。

代码源：[公开 GitHub 仓库的当前开发分支](https://github.com/fx950217-lgtm/yubenzhe/tree/codex/m0-local-test)，分支为 `codex/m0-local-test`。主线大规模变更和历史审计批量删除被自动审核拒绝，`main` 与历史元数据保留。上一轮已清理约 1985 MiB 旧安装包和缓存，本机保留备份；访问凭据、钱包密钥、运行数据库、备份、依赖缓存和安装包不进入 Git。
