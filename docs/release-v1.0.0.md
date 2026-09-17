# v1.0.0 发布说明

**发布日期**：2026-09-17 · **首个独立版本**

`agent-foreman-mcp` 是从 `tianshu-mcp v0.5.4` 代码库**独立分化**出来的全新项目：面向任意 MCP 宿主（Claude Desktop / Cursor / ZCode / Cline / Windsurf 等）的通用 AI-Agent 编排 MCP server，承担「调度 + 执行面 + 客观验收仪」，驱动外部 AI-Agent 完成「派活 → 验收 → 失败返修 → 再验收」闭环。

自 1.0.0 起，本项目独立演进；`tianshu-mcp` 作为另一个独立项目**并行继续维护**，两者互不依赖、互不读取对方数据。

---

## 一、这个版本带来什么

### 1. 面向任意 MCP 宿主的通用化

不再绑定特定宿主。凡支持 stdio 传输的 MCP 宿主都可接入：

```json
{
  "mcpServers": {
    "agent-foreman": {
      "command": "npx",
      "args": ["-y", "agent-foreman-mcp"]
    }
  }
}
```

各宿主的具体配置位置、环境变量与冒烟步骤见新增的 [宿主接入指南](host-integration.md)。

### 2. 双轨返回契约：文本 + MCP `structuredContent`

11 个工具在原有「人类可读文本 + meta 块」之外，**同时返回 MCP 标准 `structuredContent`**（同一份字段，单一事实来源），并声明宽松 `outputSchema`：

- 只认文本的旧式宿主：继续正则抽取 `---agent-foreman-meta---` 块；
- 现代宿主：直接消费结构化 JSON，无需解析文本。

**成功与错误路径均已覆盖**——错误路径统一为 `{ ok: false, message }`。

> 契约纪律：顶层字段名稳定、**只增不改不换名**（客户端会按 `outputSchema` 校验）。

### 3. 技能自装迁移到 Agents Skills 标准

自装目标从宿主专属目录改为 **`~/.agents/skills/agent-foreman-mcp/`**（[Agents Skills](https://agents.md) 开放标准，用户级）。安装幂等：内容一致跳过，不一致先备份 `.bak-<时间戳>` 再覆盖；失败仅告警、不阻断 server。

### 4. 旧备份兼容识别（不毁老用户回滚点）

Codex 状态备份改为新后缀 `.agent-foreman-backup.json`，**并识别旧后缀** `.tianshu-mcp-backup.json`——若磁盘上已存在旧备份（那是「任何工具动手之前」的干净快照），本项目**不会覆盖它、也不会另建新备份**，日志打印实际生效的那份路径。

---

## 二、相对 `tianshu-mcp@0.5.4` 的变更清单

### 破坏性变更（需相应调整）

| 维度 | 旧 | 新 |
|---|---|---|
| npm 包名 / bin | `tianshu-mcp` | **`agent-foreman-mcp`** |
| 数据目录 | `~/.tianshu-mcp` | **`~/.agent-foreman`** |
| 数据目录环境变量 | `TIANSHU_MCP_HOME` | **`AGENT_FOREMAN_HOME`** |
| 项目级验收配置 | `.tianshu-mcp/acceptance.json` | **`.agent-foreman/acceptance.json`** |
| meta 块标记 | `---tianshu-mcp-meta---` | **`---agent-foreman-meta---`** |
| Codex 修复计划默认目录 | `.zcode/plans` | **`.agent-foreman/plans`** |
| Codex GUI profile 目录 | `…/tianshu-mcp/codex-gui/profile` | **`…/agent-foreman/codex-gui/profile`** |
| 技能名 / 安装目标 | `tianshu-mcp` → `~/.rivet/skills/` | **`agent-foreman-mcp` → `~/.agents/skills/`** |
| 关闭技能自装（env） | `TIANSHU_MCP_NO_SKILL_INSTALL` | **`AGENT_FOREMAN_NO_SKILL_INSTALL`** |
| 真实浏览器测试开关 | `TIANSHU_VISUAL_BROWSER_TEST` | **`AGENT_FOREMAN_VISUAL_BROWSER_TEST`** |
| 视觉证据输出目录 | `TIANSHU_VISUAL_EVIDENCE` / `..._REPORT_EVIDENCE` | **`AGENT_FOREMAN_VISUAL_EVIDENCE` / `..._REPORT_EVIDENCE`** |
| SVG 资产 | `assets/tianshu-mcp-*.svg` | **`assets/agent-foreman-*.svg`** |

### 新增

- MCP `structuredContent` 双轨返回 + 工具 `outputSchema`（含错误路径）。
- 旧备份后缀兼容识别（见上文）。
- [宿主接入指南](host-integration.md)（中英双语）。
- 测试支持：`skillSelfInstall()` 可注入 `sourceDir` / `destDir`，用于隔离验证。

### 移除

- **Gitee 集成整体移除**：删除 `scripts/gitee-release.mjs`、release.yml 的 Gitee 步骤与 `GITEE_TOKEN` 逻辑、release-body 的 `gitee` 分支、全部镜像引用。本项目为单远程（GitHub）仓库。
- 前身项目的历史文档（v0.x 发布说明、真机验收记录、证据目录、历史修复计划）——归属 tianshu-mcp 仓库。
- README 中的里程碑演进史。

### 加固

- `@modelcontextprotocol/sdk` 依赖下限由 `^1.15.0` 抬到 **`^1.30.0`**：确保 `structuredContent` 与 `outputSchema` 能力确实可用，避免「声明了 schema 却因解析到旧版静默失效」。
- 根级配置（`.gitignore` / `.npmignore` / `eslint.config.js`）同步为 `.agent-foreman`。
- 源码、注释、文案、测试夹具、spawn 内部传递变量与 PowerShell 子脚本字符串成对去品牌化。

---

## 三、从 tianshu-mcp 切换过来

四项**用户可见**的行为变化：

1. **数据目录不共享**：`~/.tianshu-mcp` 下的任务历史、项目登记、agent profiles 与配置**不会被读取、也不会迁移**。本项目从 `~/.agent-foreman` 全新开始。
2. **项目级验收配置需重建**：本项目只读 `<项目>/.agent-foreman/acceptance.json`。已有项目需把配置复制到新路径。
3. **Codex 需重新登录**：GUI profile 目录变更（该目录承载登录态），首次运行需重新登录 Codex。
4. **Codex 状态备份后缀变更**：改新后缀并兼容识别旧后缀（见上文）——**旧备份不会被覆盖**，仍可按旧文件回滚。

---

## 四、兼容性

| 项 | 状态 |
|---|---|
| 11 个工具的名称 / 参数 / 语义 | **不变**（API 面稳定，仅增强返回） |
| `MetaBlockFields` 既有字段名 | **不变**（只增不改） |
| `agentId` 取值（`codex` / `zcode` / `traework` / `stub`） | **不变** |
| `--no-skill-install` 开关 | **不变** |
| CLI 子命令族（`visual ...`） | **不变** |
| stdio 契约（stdout 仅 JSON-RPC） | **不变** |
| Windows / macOS / Linux 支持 | **不变** |

---

## 五、验证

- 本地门禁：`typecheck` / `lint`（0 warning）/ `test` **661 passed / 12 skipped（68 文件）** / `build` / `check:stdio` 6 场景全过 / `pack:check`。
- 其中 12 项 skipped 为真实浏览器用例，需 `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`；CI 的 `visual-browser` job 在 ubuntu / windows / macos-15-intel / macos-15 × Node 20/22/24 上全跑。
- CI：三平台构建测试矩阵 + 视觉矩阵 + npm tarball 内容检查**全部通过**。

---

## 六、安装

```bash
npm i -g agent-foreman-mcp
# 或免安装
npx -y agent-foreman-mcp
```

接入你的宿主：见 [宿主接入指南](host-integration.md)。

---

## 七、发布信息

| 项 | 链接 |
|---|---|
| GitHub Release | <https://github.com/lanlan0811/agent-foreman-mcp/releases/tag/v1.0.0> |
| npm | <https://www.npmjs.com/package/agent-foreman-mcp/v/1.0.0> |
| 发布产物 | `agent-foreman-mcp-1.0.0.tgz`（附于 Release 页） |
| 发布提交 | `1e56647`（tag `v1.0.0`） |
| CI | 三平台构建测试矩阵 + 视觉矩阵 + tarball 内容检查全部通过 |

发布后核验（实测）：

- `npm view agent-foreman-mcp version` → `1.0.0`；
- `npx -y agent-foreman-mcp` 拉起连通 → 握手 `serverInfo = {name: agent-foreman-mcp, version: 1.0.0}`，列出 11 个工具，`get_profiles` 返回文本 meta 块 + `structuredContent`，stdout 无非协议内容；
- 旧包 `tianshu-mcp` 仍为 `0.5.4`（未发布、未 deprecate）。

> **首次发版说明**：`v1.0.0` 是本仓库首个 tag，故 Release 的 Full Changelog 回退为 `commits/v1.0.0` 链接（无上一版本可比较）；自 v1.0.1 起恢复 `compare/v1.0.0...v1.0.1` 形式。
