# ⛔ 已作废：装机工具包 + 资源卡密（设备/服务器出租）

日期：2026-10-12
状态：**❌ 全文作废，不要发给 Codex**

---

## 作废原因

用户于 2026-10-12 明确指示：

> **「不做租赁，只做链接。积分删除，平台无任何收费项目。」**

本文件的核心内容（B 块「资源卡密 / 设备出租 / 服务器出租」）**与上述指示直接冲突**，因此：

| 本文件的内容 | 处置 |
|---|---|
| **B 块：资源卡密（设备/服务器出租）** | ❌ **整体作废**，不再开发 |
| **`022-resource-rentals.sql` 建表方案** | ❌ **不执行** |
| **「出租 / 租赁 / 卡密 / 兑换凭证」全部设计** | ❌ **不执行** |
| **A 块：装机工具包（五类软件清单）** | ✅ **保留**，已并入 `CODEX-TASK-LINKS-ONLY-AND-ZERO-FEE-20261012.md` 第三节 |

**➡️ 新的任务书在这里：`CODEX-TASK-LINKS-ONLY-AND-ZERO-FEE-20261012.md`**
**➡️ 配套一页简报：`LINKS-ONLY-AND-ZERO-FEE-BRIEF-20261012.md`**

---

## 本文件里仍然有效的参考信息（仅作历史记录）

以下内容不涉及租赁，记录在此备查：

### 1. 已完成的功能核验（当时实跑结果）

| 产出 | 结果 |
|---|---|
| `server/ai-channel.mjs`（19.8KB） | ✅ 存在 |
| `server/ai-channel-files.mjs`（7.1KB） | ✅ 存在 |
| `device-bridge/ai-channel.mjs`（16.1KB） | ✅ 存在 |
| `device-bridge/codex-runner.mjs`（12.4KB） | ✅ 存在 |
| `migrations/021-ai-channel.sql` | ✅ 存在 |
| `tongban/src/ai-channel-chat.js`（16.7KB） | ✅ 存在 |
| 后端 4 个测试文件 | ✅ 58/58 全过 |
| 前端 3 个测试文件 | ✅ 19/19 全过 |

### 2. 安全参数（已核对正确）

```js
// codex-runner.mjs 第 41 行
['-a','on-request','exec','--json','--ignore-user-config','--ephemeral',
 '--sandbox','workspace-write', ...--disable 各 feature, '--skip-git-repo-check',
 '--cd',workspace,'-']
```
- ✅ `workspace-write`（不是 `danger-full-access`）
- ✅ prompt 走 **stdin**（手机不能指定 exe / cwd / shell / 参数）
- ✅ 文件走**端到端加密**，服务端只中转密文
- ✅ 数据库**不存 prompt / 输出全文**（`021` 注释明确写了）

### 3. ⚠️ 作废时被放弃的法律风险分析（保留备查）

原文档第 3.1 节分析了「把服务器密钥打包成卡密出租」的法律风险，引用了：
> 「任何单位和个人不得非法买卖、**出租、出借**……互联网账号等。」

**➡️ 现在用户决定「不做租赁」，这条风险自动消除。不需要再讨论。**

---

## 一句话

> **本文件关于「出租/租赁/卡密」的全部内容作废。装机工具包部分已转新文件。**
