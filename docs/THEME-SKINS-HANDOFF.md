# 三皮肤视觉系统交接（WorkBuddy → Codex）

日期：2026-10-10 ・ 交付方：WorkBuddy 设计助手 ・ 接续方：Codex

---

## 0. 一句话摘要

三皮肤（白天 / 黑天 / 护眼）+ 国际蓝品牌色的**样式层与切换器已完成并验证**；
Codex 只需做「设置入口 UI（T1）」「资产页排版升级（T2）」「多端同步与验收（T3）」。

## 1. 已完成的改动（不要重做）

| 文件 | 状态 | 说明 |
|------|------|------|
| `tongban/src/theme-skins.css` | 新增 | 三皮肤 token 系统 + 品牌紫→蓝重映射 + 对比度修复。打包顺序最后，级联最高 |
| `tongban/src/theme-skins.js` | 新增 | 皮肤切换器。import 即自初始化；暴露 `window.YBZTheme = { THEMES, getTheme, setTheme, cycleTheme }`，切换时派发 `ybz:theme-changed` 事件，localStorage 键 `ybz-theme` |
| `tongban/src/app.js` | 改了 3 行 | 在 import 块末尾新增 `import './theme-skins.css'; import './theme-skins.js';`（带注释，**必须保持在所有 CSS 引入最后**） |

已验证：`node build.mjs` 构建通过；无头 Chrome 实测三皮肤在真实应用渲染正常
（截图存于 `WorkBuddy/2026-10-10-10-50-04/yubenzhe-audit/redesign/shots/real-*.png`）。
已知覆盖：`.rail .nav-item.active`（0-3-0 优先级）、`.layout`、`.account-gate` 系列硬编码。

## 2. 皮肤机制（30 秒版）

- `<html data-theme="light|dark|eyecare">` 切换三套 CSS 变量；组件样式零改动自动跟随
- 变量约定：`--green`=主蓝、`--lime`=选中/图标容器浅底、`--deep`=浅底上的深蓝字、
  `--paper/--paper-2/--bg`=三层表面、`--ink/--muted/--faint`=三级文字、`--line`=描边
- 兼容映射已内置：`--purple→var(--green)`、`--soc-*`、`--live-*`、`--mine-accent`、`--work-*`
- **新组件一律用变量，禁止新增硬编码颜色**；如遇旧硬编码漏网，在 `theme-skins.css`
  末尾的「品牌重映射」区补一条 var 映射，不要改组件文件

## 3. 剩余任务

### T1 · 设置入口（功能接入，优先）
在「我」页（`tongban/src/mine.js`，参照第 49 行 `row('security',…)` 的注册与路由方式）
新增「外观皮肤」入口，页面内放三枚选项（白天 ☀️ / 黑天 🌙 / 护眼 🍃）：
- 渲染当前值 `YBZTheme.getTheme()`，点击调 `YBZTheme.setTheme(id)`，即时生效
- 不需要确认按钮；切换后 toast 提示「已切换为 XX 皮肤」
- 验收：三皮肤点击即时切换、杀进程重进后保持

### T2 · 资产页排版升级（视觉，次优）
参照设计预览 `WorkBuddy/2026-10-10-10-50-04/yubenzhe-audit/redesign/yubenzhe-skins-preview.html`：
1. 总资产改为页面级大数字（≥48px、tabular-nums、无卡片框），下方紧跟涨幅胶囊与地址复制
2. 转账/收款/扫一扫/发红包改为无框圆形图标按钮（52px 圆 + 文字）
3. 「资产 / 账单」改为下划线分段切换，替代并排卡片
涉及 `platform-assets.js` / `wallet.js` 的视图结构，样式继续走变量。

### T3 · 多端同步与验收（按 AGENTS.md 第 11 条执行）
- 本轮交付原生版本时：`dist/` → `yubenzhe-desktop/web`、`tongban-android/www`、
  `yubenzhe-ios/App/Web`、`yubenzhe-deploy/public/frontend`，再分别构建安装包
- 雷电模拟器两个实例用同一 APK，皮肤随包生效，无需单独适配
- 真机验收三皮肤各跑一次：登录门 → 首页 → 聊天 → 我的

### T4 · 回归
- `node --test tests/*.test.mjs`
- `node scripts/check-project.mjs --allow-changes`（本次为有意修改，核对边界清单）

## 4. 验收标准（合并前自查）

- [ ] 三皮肤切换即时生效、持久保存、默认白天
- [ ] 任一皮肤下无白块/黑块残留（已知盲区：个别 `!important` 旧规则，按第 2 节机制补映射）
- [ ] 正文与次级文字对比度 ≥ 4.5:1
- [ ] 红包红与珊瑚角标在三皮肤下保持一致（语义色不换）
- [ ] 构建 + 测试 + 真机三端通过
