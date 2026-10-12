# Codex 任务 03：重建 MANIFEST 完整性基线

日期：2026-10-11
依据：`docs/V1.0-SCOPE-AND-EXECUTION-20261011.md` 3.3 节
性质：**单一任务，独立提交**（这个改动最好**单独一个 commit**，因为它是「基线」动作）

---

## 背景（给 Codex 的上下文）

项目根目录的 `MANIFEST.json` 是**防篡改 / 防泄密**的完整性快照，
`scripts/check-project.mjs` 会拿它逐文件比对 sha256。

**现状是坏的**：

| 项 | 值 |
|---|---|
| `MANIFEST.json` 里记录的 version | `0.9.0` |
| 实际代码版本 | `0.14.0-dev.7` |
| 实跑比对结果 | **127 项文件不一致** |
| 不带 `--allow-changes` 时 | **status: failed** |

**含义**：这道防线本来是「防止文件被偷换、防止私密文件混入」的，
现在因为清单是旧版本的，**在交接模式下必然 failed，等于保险失效**。

---

## 任务

### 1. 先存档旧基线（不要直接覆盖）

在覆盖之前，把当前 `MANIFEST.json` 复制为：

```
MANIFEST.0.9.0.json
```

放在项目根目录（与 `MANIFEST.json` 同级）。**不要删、不要改内容。**

### 2. 用当前源码重新生成基线

**先读 `scripts/check-project.mjs` 和生成基线的脚本**（仓库里应有一个生成入口，
可能是 `check-project.mjs` 的某个参数，或另一个脚本）。**看懂再动手，不要猜命令。**

关键要求：

- 生成的 `MANIFEST.json` 里 `version` 字段必须是 **`0.14.0-dev.7`**
- 文件清单**必须排除**：
  - `.git/`
  - 任何 `.env` / `.env.*`（保留 `.env.example`）
  - `node_modules/`
  - `reports/` 下的运行产物（如果原本就排除，保持；如果原本包含，**先问我**）
  - 任何 Key、数据库文件、`*.db` / `*.sqlite`
- 生成后**自查一遍**：grep 新 MANIFEST 里的路径，确认没有私密文件的路径被写进去

### 3. 验证

```bash
node scripts/check-project.mjs
```

**不带 `--allow-changes`**，期望输出 `status: passed`，且 `changedSourceFiles` 为空。

### 4. 加一个防再犯的检查（可选但建议）

在 CI（`.github/workflows/verify-latest.yml`）里，现在是带 `--allow-changes` 跑的吗？
如果是，把它改成**不带该参数**。

理由：带 `--allow-changes` 等于把这道检查变成「永远通过」，失去了意义。
但**注意**：如果改了之后 CI 会红，说明还有其他文件在漂移——先别提交，
把漂移清单发给我，我们确认是正常的（比如 CI 自己生成的产物）再调整排除规则。

---

## 验收标准

1. `MANIFEST.0.9.0.json` 存在，内容与改动前的 `MANIFEST.json` 一致
2. `node scripts/check-project.mjs`（不带参数）→ **status: passed**
3. 新 `MANIFEST.json` 的 `version` 是 `0.14.0-dev.7`
4. 新 `MANIFEST.json` 里**没有**任何 `.env` / Key / 数据库文件的路径
5. `node --test tests/*.test.mjs`（三个子项目）仍然全过

---

## 明确不要做的事

- ❌ 不要删掉旧基线
- ❌ 不要为了让检查通过而往排除规则里塞不该塞的东西（那是掩盖问题）
- ❌ 不要修改任何源码文件——这个 commit **只动 MANIFEST 相关文件**
- ❌ 不要顺手做别的清理（比如删死代码），那是另一个任务

---

## 顺带说明：有一个死代码任务，但不在本次

审计发现 `scripts/simulate-group-gifts-100.mjs` 仍 `import` 已被移除的
`yubenzhe-deploy/server/platform-assets.mjs`，跑不起来，
会让外部审计误以为项目还在做「平台托管红包」（已退役的高危业务）。

**处理方式建议：移到 `archive/` 目录或加 `.deprecated` 标记，不要直接删（保留审计痕迹）。**

但**这件事不要放在本任务里做**——它会改变文件清单，让基线重建变得不干净。
等基线重建完成后，单独开一个任务处理，那时基线再重建一次即可。
