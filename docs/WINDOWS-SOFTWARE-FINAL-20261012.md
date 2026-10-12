# Windows 云电脑软件安装完成报告

- **日期**：2026-10-12
- **机器**：`ybz-win-sg` / `45.77.247.167`（Windows Server 2022 / 2核4G / 新加坡）
- **方式**：WinRM（5985 / NTLM）远程自动化，全程无人值守

---

## 一、最终桌面（7 个，已实测）

| 图标 | 类型 | 状态 |
|---|---|---|
| `ChatGPT.lnk` | AI 桌面客户端 | ✅ v1.1.0，10.1 MB |
| `Claude Code.cmd` | AI 命令行 | ✅ 2.1.296 |
| `Codex.cmd` | AI 命令行 | ✅ codex-cli 0.162.1 |
| `WorkBuddy.cmd` | AI 命令行 | ✅ 1.0.0 |
| `Google Chrome.lnk` | 浏览器 | ✅ |
| `Firefox.lnk` | 浏览器 | ✅ |
| `Microsoft Edge.lnk` | 浏览器 | ✅ 系统自带 |

**三个 AI 命令行工具的启动器**：双击 → 弹出窗口 → 显示登录命令提示 → 自动进入工具。

---

## 二、实测验证输出

```
===== 1. ChatGPT 桌面版 =====
  path    : C:\Program Files\ChatGPT\ChatGPT.exe
  version : 1.1.0
  size    : 10.1 MB

===== 2. 三个 AI 命令行工具（实测版本） =====
Codex        codex-cli 0.162.1
Claude Code  2.1.296 (Claude Code)
WorkBuddy    1.0.0

===== 3. 桌面启动器文件检查 =====
Claude Code.cmd        445 bytes  head=@echo off chcp 936 >
Codex.cmd              449 bytes  head=@echo off chcp 936 >
WorkBuddy.cmd          441 bytes  head=@echo off chcp 936 >
```

---

## 三、这次做了什么（与上次的区别）

### 上次的问题
桌面上塞了 11 个图标，包含了 `Python 3.15` / `Node.js` / `Git Bash` / `VSCode` 等
**用户根本没要求、也看不懂**的开发工具快捷方式 → 用户原话「乱七八糟」「用户体验一点都没有」。

### 这次的调整
1. **新增** `ChatGPT.lnk`（之前只有开始菜单里有，桌面没有，用户找不到）
2. **重命名**启动器：`Codex CLI.cmd` → `Codex.cmd`（更短）
3. **删除**用户没要的：`Git Bash.lnk`、`Node.js.lnk`、`Python 3.15.lnk`、`Visual Studio Code.lnk`
4. **删除**重复项：`Microsoft Edge.lnk`（公共桌面已有一份）

**结果：从 11 个精简到 7 个，只留 AI + 浏览器。**

> 注：Python / Node / Git / VSCode **软件本身都还在**，只是不在桌面显示 ——
> 它们可以在开始菜单找到，命令行也照常能用。删的只是桌面图标。

---

## 四、⚠️ 关于「清理掉，只要 win」的重要澄清

用户的指令是「清理掉，只要 win」，但经查：
**没有可清理的 Linux 机器了。**

| IP | 标签 | 系统 | 能否删 |
|---|---|---|---|
| `45.76.163.5` | LoveMart Vietnam | Ubuntu 24.04 | ❌ **lovemart.love 生产机** |
| `202.182.103.202` | Yuqi Platform Test | Ubuntu 24.04 | ❌ 在禁改清单 |
| `66.42.56.29` | Yubenzhe Singapore | Ubuntu 24.04 | ❌ 在禁改清单 |
| `45.77.247.167` | **ybz-win-sg** | **Windows 2022** | ✅ 但这是要留下的 |

**昨天那台 Linux 测试机（`ybz-ai-tools-sg`）已经在上次操作中销毁。**

→ **本次未执行任何销毁操作。** 4 台机器保持原状。

**已向用户说明：若要删那 3 台老机器，会导致 lovemart.love 下线，需明确二次确认。**

---

## 五、待用户完成

**三个 AI 工具需要登录一次**（账号密码我不代填）：

| 双击 | 然后敲 |
|---|---|
| `ChatGPT.lnk` | 直接登录 |
| `Claude Code.cmd` | `claude login` |
| `Codex.cmd` | `codex login` |
| `WorkBuddy.cmd` | `workbuddy` |

登录状态探测：
```
codex 配置目录 (\.codex)     : 存在
claude 配置目录 (\.claude)   : 存在
workbuddy 配置目录            : 不存在（还没登录过）
```
