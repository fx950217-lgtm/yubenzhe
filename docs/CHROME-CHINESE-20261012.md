# Google Chrome 界面中文化报告

- **日期**：2026-10-12
- **机器**：`ybz-win-sg` / `45.77.247.167`（Windows Server 2022 / 新加坡）
- **目标**：把 Chrome 界面语言从英文改为简体中文

---

## 一、结果（✅ 已用浏览器引擎实测确认）

```
Chrome 内部语言环境报告：
  navLang    : zh-CN
  navLangs   : ["zh-CN","zh"]
  icuLocale  : zh-CN        <-- 决定界面语言的就是这个
```

**`icuLocale = zh-CN` 意味着 Chrome 渲染引擎实际在用简体中文** ——
不是「配置文件里写了」，而是浏览器真的以中文运行。

---

## 二、改之前的状态

| 项目 | 原值 |
|---|---|
| Chrome `Preferences.app_locale` | （空） |
| Chrome `Preferences.selected_languages` | `en-US,en` |
| Chrome `Local State` 的 `intl` 块 | **完全不存在** |
| 系统区域 `CurrentCulture` | `en-US` |
| 系统 `InstallLanguage` | `0409`（英文） |

**为什么原来是英文**：`Local State` 里连 `intl` 配置块都没有，
Chrome 首次运行时直接跟随系统语言 → 系统是英文 → 界面英文。

---

## 三、改了哪些地方

### 1. `Local State` → `intl`
```json
{
  "intl": {
    "app_locale": "zh-CN",
    "selected_languages": "zh-CN,zh,en-US,en",
    "accept_languages": "zh-CN,zh,en-US,en",
    "requested_language": "zh-CN",
    "country": "CN",
    "spellcheck_dictionaries": ["zh-CN"]
  }
}
```

### 2. `Default\Preferences` → `intl`（**这个才是关键**）
```json
{
  "intl": {
    "app_locale": "zh-CN",
    "selected_languages": "zh-CN,zh,en-US,en"
  }
}
```

> ⚠️ **踩坑记录**：一开始我只改了 `Local State`，结果不生效。
> 实测发现 **Chrome 判断界面语言看的是 `Preferences → intl.app_locale`**，
> `Local State` 只在首次运行时播种用。必须两个都改。

### 3. 桌面快捷方式加 `--lang=zh-CN`
```
C:\Users\Public\Desktop\Google Chrome.lnk
  → 参数: --lang=zh-CN
```
这是「保险」：即使 Chrome 某次把配置重写了，命令行参数仍是最高优先级。

### 4. 备份
所有被改的文件都做了带时间戳的备份：
```
Local State.bak-20261012-005255
Preferences.bak-20261012-005737
```

---

## 四、验证过程（我做了三层验证）

| 层级 | 方法 | 结果 |
|---|---|---|
| 1. 配置层 | 回读 JSON 文件 | `app_locale = zh-CN` ✅ |
| 2. 进程层 | 查 Chrome 启动命令行 | 含 `--lang=zh-CN` ✅ |
| 3. **引擎层** | **CDP 协议读 `icuLocale`** | **`zh-CN`** ✅ |

第 3 层是最硬的证据 —— 通过 Chrome DevTools Protocol 直接问浏览器
「你现在是什么语言」，答案 `zh-CN`。

---

## 五、⚠️ 一个必须说明的乌龙

排查过程中我截了一张图，看到**任务栏和开始菜单是中文（繁体）**，
一度以为「系统语言被改了」。

**实际是误判**：
- 那个计划任务跑在了**错误会话**上，抓到的是宿主机（用户本机）的画面，
  **不是远程云电脑**
- 复查后确认：**云电脑的系统语言仍然是 `en-US`**（`InstallLanguage = 0409`）

**所以现在的状态是**：
```
✅ Chrome 界面      = 简体中文（zh-CN）
⚠️ Windows 系统界面 = 英文（en-US）
```

**如果您希望连 Windows 系统界面也变成中文**，那是另一件事 ——
需要装中文语言包并切换显示语言，我可以做，但**需要重启机器**。

---

## 六、您现在看到的

打开 Chrome，界面（菜单、设置、右键菜单）应该是**简体中文**。

**如果还是英文**，按这个顺序检查：
1. 完全关掉 Chrome（任务管理器里确认没有残留进程）
2. 重新双击桌面 Chrome 图标
3. 还不行的话，进 `chrome://settings/languages` 手动把「中文（简体）」拖到第一位

---

## 七、技术备注（以后复用）

1. **Chrome 界面语言的优先级**：
   `--lang` 命令行参数 > `Preferences.intl.app_locale` > `Local State.intl.app_locale` > 系统语言
2. **写 JSON 必须 UTF-8 无 BOM** —— 有 BOM 会导致 Chrome 读取失败
3. **改配置前必须关掉 Chrome** —— 否则它退出时会把文件覆盖回去
4. **`zh-CN.pak` 语言包 Chrome 自带**（519 KB，在 `Application\<version>\locales\`），不用下载
5. **CDP 读语言的方法**：
   ```
   chrome --remote-debugging-port=9555 --remote-allow-origins=*
   然后连 /json/list 拿 webSocketDebuggerUrl，
   发 Runtime.evaluate:
     Intl.DateTimeFormat().resolvedOptions().locale
   ```
   ⚠️ 必须加 `--remote-allow-origins=*`，否则 WebSocket 被 403 拒绝
6. **WinRM 里无法截屏**（Session 0 无桌面），`CopyFromScreen` 报 "handle is invalid"
