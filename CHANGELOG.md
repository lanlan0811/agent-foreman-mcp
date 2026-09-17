# 更新日志（CHANGELOG）

本文件记录 `agent-foreman-mcp` 的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

英文版：[CHANGELOG.en.md](CHANGELOG.en.md)

> **起笔说明**：本文件自 `1.0.0` 起笔。本项目源自 `tianshu-mcp v0.5.4`（Apache-2.0）独立分化，
> **v0.x 的全部历史条目归属 tianshu-mcp 仓库**，不在本仓库复述。

---

## [1.0.0] - 2026-09-17

独立分化后的首个版本。相对源基线 `tianshu-mcp@0.5.4`，对外契约与工程形态的主要变化如下。

### 变更（BREAKING）

- **新的 npm 包与 bin**：`tianshu-mcp` → **`agent-foreman-mcp`**（包名、`bin` 命令、`package.json` 全部元数据）。
  升级需重新配置宿主：`npx -y agent-foreman-mcp`。
- **数据目录迁移**：`~/.tianshu-mcp` → **`~/.agent-foreman`**；环境变量 `TIANSHU_MCP_HOME` → **`AGENT_FOREMAN_HOME`**。
  **旧目录不会被读取，也不会迁移**（两个项目互不读取对方数据）。
- **项目级验收配置路径**：`.tianshu-mcp/acceptance.json` → **`.agent-foreman/acceptance.json`**。
  **不读取旧路径**；从 tianshu-mcp 切换的项目需在新路径重建配置。
- **meta 块标记**：`---tianshu-mcp-meta---` → **`---agent-foreman-meta---`**。依赖旧标记做正则抽取的宿主需同步更新
  （或改用下文的结构化返回，无需解析文本）。
- **Codex 修复计划默认目录**：`.zcode/plans` → **`.agent-foreman/plans`**（`gui.fixPlanDir`，profile 仍可覆盖）。
- **Codex GUI 专属 profile 目录变更**：`…/tianshu-mcp/codex-gui/profile` → `…/agent-foreman/codex-gui/profile`
  （Windows 在 `%LOCALAPPDATA%` 下，macOS 在 `~/.agent-foreman/` 下）。该目录承载登录态，**首次运行需重新登录 Codex**。
- **技能自装目标迁移**：`~/.rivet/skills/tianshu-mcp/` → **`~/.agents/skills/agent-foreman-mcp/`**
  （采用 [Agents Skills](https://agents.md) 开放标准，用户级），不再使用任何宿主专属目录。
- **技能名与源目录**：`skills/tianshu-mcp/` → `skills/agent-foreman-mcp/`。
- **关闭技能自装的环境变量**：`TIANSHU_MCP_NO_SKILL_INSTALL` → `AGENT_FOREMAN_NO_SKILL_INSTALL`
  （`--no-skill-install` 开关不变）。
- **视觉真实浏览器测试开关**：`TIANSHU_VISUAL_BROWSER_TEST` → `AGENT_FOREMAN_VISUAL_BROWSER_TEST`；
  证据输出目录变量同步为 `AGENT_FOREMAN_VISUAL_EVIDENCE` / `AGENT_FOREMAN_VISUAL_REPORT_EVIDENCE`。
- **SVG 资产更名**：`assets/tianshu-mcp-{banner,icon}.svg` → `assets/agent-foreman-{banner,icon}.svg`，内容去品牌化。

### 新增

- **双轨返回契约（MCP `structuredContent`）**：11 个工具在原有「文本 + meta 块」之外，**同时返回 MCP 标准
  `structuredContent`**（同一份字段，单一事实来源），并声明宽松 `outputSchema`（字段全可选 + passthrough）。
  现代宿主可直接消费结构化 JSON，无需正则解析文本。**成功与错误路径均覆盖**：错误路径统一为
  `{ ok: false, message }`。
  - 契约纪律：顶层字段名稳定，**只增不改不换名**（客户端按 `outputSchema` 校验）。`META_BLOCK_FIELDS` 为字段名单一事实来源，协议测试断言无未登记字段。
  - 视觉基准类工具返回自由结果对象，统一信封为 `{ ok, message, result }`；`get_task_report` 的文本轨仍为报告原文，
    结构化侧给出 `reportRound` / `reportFiles`。
- **旧备份后缀兼容识别（D13 方案 A）**：Codex 状态备份改新后缀 `.agent-foreman-backup.json`，**并识别旧后缀**
  `.tianshu-mcp-backup.json`——旧备份存在时不新建、不覆盖，保住用户「任何工具动手之前」的干净回滚点。
  备份日志打印**实际生效**的路径。这是本仓库唯一有意保留的旧品牌字面量（集中为命名常量并注释理由）。
- **宿主接入指南**：新增 [docs/host-integration.md](docs/host-integration.md) / `.en.md`，面向任意 MCP 宿主
  （Claude Desktop / Cursor / ZCode / Cline / Windsurf 与通用 stdio 片段）。
- **一键隔离验证的测试支撑**：`skillSelfInstall()` 支持注入 `sourceDir` / `destDir`，便于测试在不污染真实
  `~/.agents/` 的前提下验证安装与幂等。

### 移除

- **Gitee 集成整体移除**：删除 `scripts/gitee-release.mjs`、release.yml 的 Gitee 发行版步骤与 `GITEE_TOKEN`
  相关逻辑、`scripts/release-body.mjs` 的 `gitee` host 分支、文档与 README 中的 Gitee 镜像引用。本项目为单远程
  （GitHub）仓库。
- **前身项目的历史文档移除**（归属 tianshu-mcp 仓库，本仓库不保留）：v0.x 发布说明、真机验收/整改记录、
  证据目录、历史修复计划等。
- **README 中的里程碑演进史移除**：改为独立项目叙事。

### 修复 / 加固

- **SDK 依赖下限收紧**：`@modelcontextprotocol/sdk` 由 `^1.15.0` 抬到 `^1.30.0`，确保 `structuredContent` 与
  `outputSchema` 能力确实可用，避免「声明了 schema 却因解析到旧版静默失效」。
- **仓库根级配置同步**：`.gitignore` / `.npmignore` / `eslint.config.js` 中的数据目录排除项改为 `.agent-foreman`。
- **代码与测试全量去品牌化**：源码、注释、文案、测试夹具、spawn 内部传递变量（`*_FOLDER` / `*_PIDS` /
  `DIALOG_*`）与 PowerShell 子脚本字符串成对改名；GUI 驱动的隐式契约保持一致。

### 兼容性说明

| 项 | 状态 |
|---|---|
| 11 个工具的名称 / 参数 / 语义 | **不变**（API 面稳定，仅增强返回） |
| `MetaBlockFields` 既有字段名 | **不变**（只增不改） |
| `agentId` 取值（`codex` / `zcode` / `traework` / `stub`） | **不变** |
| `--no-skill-install` 开关 | **不变** |
| CLI 子命令族（`visual ...`） | **不变** |
| stdio 契约（stdout 仅 JSON-RPC） | **不变** |
| Windows / macOS / Linux 支持 | **不变** |

### 验证

- 门禁：typecheck / lint（0 warning）/ test **661 passed / 12 skipped（68 文件）** / build / `check:stdio` 6 场景 / `pack:check`。
- 其中 12 项 skipped 为真实浏览器用例，需 `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`；CI 的 `visual-browser` job 在
  ubuntu / windows / macos-15-intel / macos-15 × Node 20/22/24 上全跑。

[1.0.0]: https://github.com/lanlan0811/agent-foreman-mcp/releases/tag/v1.0.0
