# Windows 云电脑桌面图标补齐报告

- **日期**：2026-10-12
- **机器**：`ybz-win-sg` / `45.77.247.167` / Windows Server 2022 Standard / 新加坡
- **远程通道**：WinRM 5985（NTLM）
- **操作性质**：新增桌面图标（纯新增，未删除、未改动任何已装软件）

---

## 一、问题原因（为什么会「不在桌面」）

| 软件 | 为什么桌面上没有 |
|---|---|
| Chrome / Firefox / Edge | 快捷方式在**公共桌面**（`C:\Users\Public\Desktop`），但 Windows Server 2022 默认**不显示公共桌面图标** |
| ChatGPT | 同上，在公共桌面 |
| Claude Code / Codex / WorkBuddy | ⚠️ **它们本来就没有桌面图标** —— 是 npm 装的**命令行工具**（`claude.cmd` / `codex.cmd` / `workbuddy.cmd`），只存在于 `AppData\Roaming\npm\` 目录 |
| VSCode | 快捷方式在公共桌面，同样被隐藏 |
| Python / Node / Git | 装的时候就没建桌面快捷方式 |

**一句话**：一半是「被系统藏起来了」，一半是「本来就没有，得自己造」。

---

## 二、做了什么

### 1. 让公共桌面图标显示出来

改了注册表 `HKCU:\...\Explorer\HideDesktopIcons\NewStartPanel`，
把「此电脑」「回收站」「浏览器」「用户文件夹」四项的隐藏标记清除为 0。

→ 效果：Chrome、Firefox、ChatGPT、VSCode 的图标**自动出现**（它们本来就躺在公共桌面）。

### 2. 给 3 个 AI 命令行工具造了「双击可跑」的启动器

因为 CLI 工具没法直接做快捷方式（双击 `.cmd` 会一闪而过），
所以每个都包了一层 `.cmd` 启动器，双击后：
- 开一个命令行窗口（UTF-8 编码，中文不乱码）
- 打印标题 + **登录命令提示**（比如 `claude login`）
- 自动进入工具（`pushd` 到用户目录，退出时 `pause` 停住不闪退）

生成的文件：
- `Claude Code.cmd`
- `Codex CLI.cmd`
- `WorkBuddy CLI.cmd`

### 3. 补了 4 个开发工具的桌面快捷方式

| 图标 | 指向 |
|---|---|
| `Visual Studio Code.lnk` | `C:\Program Files\Microsoft VS Code\Code.exe` |
| `Python 3.15.lnk` | `cmd /k C:\Python315\python.exe`（打开就是 Python 交互窗口） |
| `Node.js.lnk` | `cmd /k C:\Program Files\nodejs\node.exe` |
| `Git Bash.lnk` | `C:\Program Files\Git\bin\bash.exe --login -i` |

### 4. 发送 Shell 刷新信号

调 `SHChangeNotify` → 图标**立刻出现**，不用重新登录 RDP。

---

## 三、最终桌面（已实测）

```
ChatGPT.lnk               ← AI（桌面版客户端）
Claude Code.cmd           ← AI（命令行，新增）
Codex CLI.cmd             ← AI（命令行，新增）
WorkBuddy CLI.cmd         ← AI（命令行，新增）
Google Chrome.lnk         ← 浏览器
Firefox.lnk               ← 浏览器
Microsoft Edge.lnk        ← 浏览器
Visual Studio Code.lnk    ← 开发
Python 3.15.lnk           ← 开发（新增）
Node.js.lnk               ← 开发（新增）
Git Bash.lnk              ← 开发（新增）
```

**共 11 个**，覆盖了您列的全部四类。

---

## 四、实测验证结果（全部 PASS）

```
claude   : 2.1.296 (Claude Code)
codex    : codex-cli 0.162.1
wb       : 1.0.0
node     : C:\Program Files\nodejs\node.exe
git      : C:\Program Files\Git\cmd\git.exe
python   : Python 3.15.0

LNK 目标校验：
  Git Bash.lnk            -> True
  Microsoft Edge.lnk      -> True
  Node.js.lnk             -> True
  Python 3.15.lnk         -> True
  Visual Studio Code.lnk  -> True
```

---

## 五、下一步需要您做的

**3 个 AI 命令行工具要登录一次才能用**（凭据我不代填，请自己操作）：

| 双击 | 然后敲 |
|---|---|
| `Claude Code.cmd` | `claude login` → 浏览器里登录 Anthropic 账号 |
| `Codex CLI.cmd` | `codex login` → 浏览器里登录 OpenAI 账号 |
| `WorkBuddy CLI.cmd` | `workbuddy` → 按提示登录 |

**ChatGPT 桌面版**：双击 `ChatGPT.lnk`，直接登录即可。

---

## 六、技术备注（给以后复用）

1. **Windows 桌面 = 用户桌面 + 公共桌面**，Explorer 会合并显示，但公共桌面图标默认可能被隐藏
2. **CLI 工具做快捷方式没用** —— 必须包一层 `.cmd` + `pause`，否则闪退
3. **`.cmd` 文件必须 GBK 编码**写入（`[System.Text.Encoding]::Default`），UTF-8 会导致乱码/语法错
4. **PowerShell 脚本内容必须纯 ASCII** —— 含中文会被 PS 5.1 按 GBK 误解析
5. **base64 分块上传上限 400 字符/块** —— 3000 字符会报「命令行太长」
6. **`SHChangeNotify(0x08000000, 0x1000, 0, 0)`** 可免重启刷新桌面
