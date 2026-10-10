# 愚笨者

AI 工作台、熟人社交与自托管测试网钱包。当前需求基线为 **V0.2**，本轮整理版本为 **0.14.0-dev.3 / 本地 M0 开发版**。

工作台支持目标、计划、积分预算、文件任务执行及成果预览下载；社交包含账号、好友、群聊、朋友圈与服务商/赏金申请；钱包独立创建或导入密钥，直接链上收发。POINT 是不可转让的服务积分。平台托管余额、充值提现、内部资产划转与资产榜已退役。

**最新版已在本机 [localhost:18914](http://localhost:18914/) 运行。** [GitHub CI](https://github.com/fx950217-lgtm/yubenzhe/actions/runs/38052669120) 验证源码 `f11f4c1`：前端 336/336、后端 207/207、合约 23/23 通过，网页与管理端构建成功。下载构建文件 23 项 SHA-256 校验通过，本地账号、聊天与任务数据在升级后完整保留；工作台、积分与用量、个人中心已在浏览器确认。详细范围见 [实施记录](docs/V02-IMPLEMENTATION.txt)。本轮仅更新本机，线上与原生客户端仍为 0.13.0。

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

代码源：[公开 GitHub 仓库的当前开发分支](https://github.com/fx950217-lgtm/yubenzhe/tree/codex/m0-local-test)，分支为 `codex/m0-local-test`。主线大规模变更和历史审计批量删除被自动审核拒绝，`main` 与历史元数据保留。本轮已清理约 1985 MiB 旧安装包和缓存，本机保留备份；访问凭据、钱包密钥、运行数据库、备份、依赖缓存和安装包不进入 Git。
