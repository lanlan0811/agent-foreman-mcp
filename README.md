<div align="center">

<img src="./assets/agent-foreman-banner.svg" alt="agent-foreman-mcp" width="100%">

<img src="./assets/agent-foreman-icon.svg" alt="agent-foreman-mcp 图标" width="132" height="132">

# agent-foreman-mcp

**面向任意 MCP 宿主的通用 AI-Agent 编排 MCP server**

由你选择的 MCP 宿主（Claude Desktop / Cursor / ZCode / Cline / Windsurf 等）接入，作为标准 MCP server，调度外部 AI-Agent（Codex 桌面端、TraeWork / TRAE SOLO CN、ZCode 均经 CDP 驱动桌面 UI）完成 **项目开发 → 验收 → 失败返修 → 再验收** 的闭环。

视觉验收（含可选 AI 内容校验）：[中文指南](docs/visual-acceptance.md) · [验证状态](docs/visual-validation.md)

<br/>

[![CI](https://github.com/lanlan0811/agent-foreman-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lanlan0811/agent-foreman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/agent-foreman-mcp.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/agent-foreman-mcp)
[![npm downloads](https://img.shields.io/npm/dm/agent-foreman-mcp.svg?color=cb3837)](https://www.npmjs.com/package/agent-foreman-mcp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.30-6f42c1.svg)](https://github.com/modelcontextprotocol/sdk)

[English](README.en.md) · **简体中文**

</div>

---

## 这是什么

**宿主**（任何 MCP 宿主）是指挥；本 MCP server 是**调度层 + 执行面 + 客观验收仪**；外部 AI-Agent（Codex / TraeWork / ZCode GUI）是执行开发的「工人」。server 本身**不绑定任何特定宿主**——凡支持 stdio 传输的 MCP 宿主都可接入，接入方式见 [宿主接入指南](docs/host-integration.md)。

- **11 个 MCP 工具**：`run_task / continue_task / query_task / list_tasks / get_task_report / cancel_task / verify_task / rework_task / get_profiles`，外加视觉验收的 `prepare_visual_baseline / approve_visual_baseline`。
- **双轨返回**：结果同时以「人类可读文本 + `---agent-foreman-meta---` JSON 块」与 MCP 标准 `structuredContent` 投递，同一份字段、单一事实来源。旧式宿主可正则抽取文本块，现代宿主可直接消费结构化字段；工具已声明 `outputSchema`，字段名稳定且**只增不改**。
- **异步契约**：`run_task` 秒回 `taskId`，长任务用 `query_task` 轮询（长任务不卡 `tools/call`）。
- **客观验收**：自动命令检查（typecheck/lint/test/build，缺则跳过 + 技术栈推导）+ 程序化代码分析（变更清单/diffstat/TODO·debugger·密钥形态等可疑标记），全部相对 **git 基线**，不自动 commit/stash。验收引擎 **fail-closed**：测试命令退出码为 0 但输出显示零用例时判失败；git 项目默认要求相对动工前基线产生变更（纯分析任务可在 `.agent-foreman/acceptance.json` 设 `"requireChanges": false` 显式关闭）。
- **验收并行度**：命令检查默认**有界并行**（`verifyConcurrency`，默认 2、范围 1–4）。检查项之间有顺序依赖时（后续检查读取 build 产物、带 `--fix`、共享缓存目录）请设 `1` 完全退化为串行；项目级 `.agent-foreman/acceptance.json` 可覆盖，server 级在 `config.json`。报告与日志格式不变（结果按声明顺序返回）。
- **失败返修闭环**：自动返修（`autoFixRounds`）+ 手动 `rework_task`；验收失败时自动生成修复计划文件（默认落在项目内 `.agent-foreman/plans/`）并回填给 agent；轮次用尽 → `needs_attention` 等宿主裁决。
- **执行面**：`driver: "gui"` 由显式 adapter 驱动桌面 UI（Codex / TraeWork / ZCode 各自使用隔离的 CDP 流程）；`driver: "spawn"` 走外部 CLI 子进程。
- **无项目派发（ZCode）**：`run_task` 的 `projectPath` 可省略——ZCode 在 `default` 工作区承接任务，不登记/导入项目、不采集 Git 基线、不执行项目验收（结果以 `verificationNotApplicable: "no_project"` 结构化标注，`verify_task`/`get_task_report` 返回不适用说明）。配套 `allowCreateProject: false` 可在目标目录未登记时于任何导入副作用之前停止派发。详见 [ZCode CDP 适配器](docs/zcode-cdp.md)。
- **调度纪律**：每项目串行队列 + 全局并发上限（默认 2，可配）。
- **可选 AI 内容校验（默认关闭）**：校验图片或页面截图**内容**是否符合你显式声明的期望描述。判定完全**委托给你自备的本地命令**（MCP 不读取、不存储、不转发任何密钥，也不内置模型客户端），默认**仅告警**、逐规则可升级为致败；采样多数票 + 任务级缓存防抖，票不集中或低于置信度阈值判 `uncertain`（永不阻塞、不触发返修）。配置与命令契约见 [视觉验收](docs/visual-acceptance.md)。
- **不碰密钥**：各 agent 用自己的登录态；本 server 不保存/转发任何 API key。可选 AI 内容校验同样不引入凭证管理——判定命令自己管密钥（见 [SECURITY.md](SECURITY.md)）。
- **可扩展**：新 agent = 一个 profile（数据）+（如需）一个 adapter 文件，零改编排核心。
- **想理解内部结构**：见 [ARCHITECTURE.md](ARCHITECTURE.md)（分层模型、模块边界、状态机、验收流水线、扩展点与已知缺口）。

## 快速开始

### 前置条件

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20（CI 覆盖 20 / 22 / 24） |
| 包管理器 | npm（仓库含 `package-lock.json`） |
| 操作系统 | Windows / macOS / Linux（CI 三平台矩阵验证） |

被驱动的 agent 需按需自行安装：Codex 桌面端 / TraeWork（TRAE SOLO CN）/ ZCode 桌面端（GUI 驱动），或 codex CLI（无头路径，见下）。**本 server 不需要它们的任何密钥**。

### 安装 npm 包

```bash
npm i -g agent-foreman-mcp
# 或免安装直接用
npx -y agent-foreman-mcp
```

### 接入你的宿主

在宿主的 MCP 配置里加一段 stdio server（键名视宿主而定，通常为 `mcpServers`）：

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

各宿主（Claude Desktop / Cursor / ZCode / Cline / Windsurf）的具体配置位置、环境变量、冒烟步骤与常见问题，见 **[宿主接入指南](docs/host-integration.md)**。

### 从源码构建

```bash
npm ci
npm run build          # 产出 dist/
node dist/index.js     # 以 stdio 启动（由宿主拉起，通常无需手动运行）
```

开发与门禁命令：`npm run dev`、`npm run typecheck`、`npm run lint`、`npm test`、`npm run check:stdio`（严格校验 stdout 只承载 MCP 协议消息）。

### 数据目录

默认 `~/.agent-foreman`（可用环境变量 `AGENT_FOREMAN_HOME` 覆盖），首次启动自动创建。项目级验收配置放在**项目内** `<项目>/.agent-foreman/acceptance.json`。

## 工具面（11 个）

| 工具 | 能力 / 审批 | 作用 |
|---|---|---|
| `run_task` | write + 审批 | 派活（可带自动验收/自动返修），异步返回 `taskId` |
| `continue_task` | write + 审批 | 恢复 `needs_user` 的原会话 |
| `query_task` | read | 轮询状态 / 进度 / 日志尾 |
| `list_tasks` | read | 历史任务过滤列表 |
| `get_task_report` | read | 某轮验收报告全文（`report.md`） |
| `cancel_task` | write + 审批 | 取消运行中任务：CLI agent kill 进程树；GUI agent 经 CDP 点击停止并在 `gui.cancelWaitMs`（默认 15s）内有界等待 GUI 空闲，未确认停止时终态明示 |
| `verify_task` | read | 对任务/项目路径做一次验收（不改源码） |
| `rework_task` | write + 审批 | 手动返修（把失败报告喂回同一 agent） |
| `get_profiles` | read | 查看 agent 适配与可执行探测结果 |
| `prepare_visual_baseline` | write + 审批 | 截图或导入参考图，生成待审阅候选和摘要 |
| `approve_visual_baseline` | write + 审批 | 用户审阅后校验摘要并写入基准与审批记录 |

> **返回值双轨**：人类可读文本 + `---agent-foreman-meta---` JSON 块（便于宿主正则抽取），同时以 MCP 标准 `structuredContent` 返回同一份字段（现代宿主直接消费）。错误路径同样提供 `structuredContent`（至少含 `ok:false` 与 `message`）。

> **审批由宿主实施**：上表的「write + 审批」是暴露给宿主的标注（`_meta.requireApproval` / `annotations`），**标注本身不是安全边界**——实际授权控制必须由宿主提供。

> **路径安全闸门**：`projectPath` 在提交时校验——必须绝对路径、目录必须存在、符号链接经 realpath 归一（回执明示解析来源）；主目录本身与系统/根级目录直接拒绝，防止 worker 写权限覆盖整棵系统子树；git 仓库有未提交变更时回执附带共处警示。

> **无项目派发**（ZCode 专用）：省略 `projectPath` 时任务在 ZCode 的 `default` 工作区运行，跳过项目登记、Git 基线、项目快照、项目锁与项目验收（终态标注 `not_applicable: no_project`）。`allowCreateProject=false` 可禁止自动导入未登记的项目。详见 [docs/zcode-cdp.md](docs/zcode-cdp.md)。

## 日志与 stdio 契约

本 server 是标准 MCP **stdio server**，严格遵守传输契约：

- **stdout 只承载 MCP JSON-RPC 消息**。任何诊断日志都不会写入 stdout——否则会破坏 JSON-RPC 流，导致严格客户端握手或工具调用失败。
- **所有级别日志（DEBUG/INFO/WARN/ERROR）写入 stderr**，同时追加到数据目录下的 `logs/server.log`（UTF-8，ISO 时间戳，含级别标签）。
- 因此 **stderr 里出现 `INFO`/`WARN` 不代表服务器出错**；它是正常诊断信息。只有启动失败（`agent-foreman-mcp 启动失败:`）才是致命错误，并会以非 0 退出码结束。

数据目录默认 `~/.agent-foreman`（可用 `AGENT_FOREMAN_HOME` 覆盖），日志文件位于 `<数据目录>/logs/server.log`。排查连接问题时以 `server.log` 为准；不要因为 stderr 有输出就判定 server 异常。

## 技能自装

server 启动时会把自带的编排技能幂等同步到 **`~/.agents/skills/agent-foreman-mcp/`**（Agents Skills 开放标准，用户级）：

- 内容 hash 一致 → 跳过；不一致 → 先把旧版备份为 `.bak-<时间戳>` 再覆盖；
- 安装失败**只告警、不阻断** server；
- 该目录由 `os.homedir()` 决定，**不受 `AGENT_FOREMAN_HOME` 影响**；
- 可用 `--no-skill-install` 或 `AGENT_FOREMAN_NO_SKILL_INSTALL=1` 关闭。

技能文档（SKILL.md / usage-examples.md）以仓库 `skills/agent-foreman-mcp/` 为准，涵盖工具面、任务书模板、meta 字段全表、错误码速查与返修提示语模板。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/host-integration.md](docs/host-integration.md) | **宿主接入指南**：通用 `mcpServers` 配置、各宿主位置、环境变量、冒烟步骤、FAQ |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **架构说明**：分层模型与模块边界、启动装配、数据目录、状态机、验收与返修流水线、Agent 驱动层契约、GUI 实例生命周期、跨平台策略、安全红线、扩展点、已知缺口 |
| [HANDOFF.md](HANDOFF.md) | 项目交接文档：当前状态快照、架构导览、硬性红线、已知限制、接手建议 |
| [docs/agent-profiles.md](docs/agent-profiles.md) | agent profiles 字段说明 + 真实机器样例 |
| [docs/adapter-matrix.md](docs/adapter-matrix.md) | 各 Agent 能力调研矩阵（Codex / ZCode / TraeWork / 扩展位） |
| [docs/acceptance-config.md](docs/acceptance-config.md) | 项目级验收配置（`.agent-foreman/acceptance.json`）写法 |
| [docs/visual-acceptance.md](docs/visual-acceptance.md) | 视觉验收：截图对比、图片规格、基准批准与冻结、AI 内容校验 |
| [docs/visual-validation.md](docs/visual-validation.md) | 视觉验收的验证口径与覆盖边界（以 CI 矩阵为事实来源） |
| [docs/codex-gui-cdp.md](docs/codex-gui-cdp.md) | Codex 桌面端 GUI 驱动：MSIX COM 激活、CDP 接管、选择器、运行检测、验收返修 |
| [docs/traework-cdp.md](docs/traework-cdp.md) | TraeWork GUI 驱动（CDP）：原理、配置、模式切换、选择器、安全红线 |
| [docs/zcode-cdp.md](docs/zcode-cdp.md) | ZCode GUI 驱动：安装探测、精确项目/模型、完全访问、暂停继续、验收返修 |
| [docs/npm-publish-guide.md](docs/npm-publish-guide.md) | 发布流程（门禁、版本、凭据、发布后核验、GitHub Release） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发环境、工程规范、提交与发布流程、如何新增 agent |
| [SECURITY.md](SECURITY.md) | 安全模型（凭证零管理 / 命令白名单 / 进程与桌面自动化边界）与私密报告渠道 |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | 贡献者行为准则 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更日志 |
| [LICENSE](LICENSE) | Apache License 2.0（详细说明见下节） |

## Agent 适配现状

| agentId | driver / adapter | status | 说明 |
|---|---|---|---|
| `codex` | `gui` / `codex-gui` | **ready**（macOS 为 `research`） | Codex 桌面端 GUI（Windows：MSIX COM 激活 + CDP；macOS：spawn .app + CDP）；支持 `model`/`reasoningLevel`/`planDoc`/`designSystem`；等待用户确认、取消与重派护栏均已真机验证。Windows 真机已验证；macOS 基本闭环已真机验证，取消/返修矩阵补齐前保持 `research` |
| `zcode` | `gui` / `zcode-gui` | **research** | CDP GUI adapter 已实现且 Windows 真机闭环通过；支持模型菜单、项目绑定与回读加固、无项目派发与 `allowCreateProject`；macOS 基本闭环已真机验证，取消/返修/新建项目矩阵补齐前保持 `research` |
| `traework` | `gui` / `traework-gui` | **ready** | CDP 驱动 TRAE SOLO CN 桌面 UI；三种面板模式真机验证通过 |
| `stub` | `spawn` | 仅测试 | `test/stub-agent/stub-agent.mjs` 三剧本（good / fix-on-first / never） |

> 新增 agent 通常只需加一个 profile，详见 [docs/agent-profiles.md](docs/agent-profiles.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 无头路径：codex-cli（用户 profile）

内置 `codex` 走桌面端 GUI 驱动。若不想依赖 GUI 自动化，**codex CLI 无头模式**可用——无需改 server 代码，在数据目录加一个 `driver=spawn` 的用户 profile 即可。

前置条件：

- codex CLI（`npm i -g @openai/codex`）。请保持最新：旧版签名证书曾被吊销，macOS Gatekeeper 会直接 SIGKILL（`Killed: 9`）。
- 已 `codex login`（复用 `~/.codex` 登录态）。

`~/.agent-foreman/agent-profiles.json`：

```json
{
  "profiles": {
    "codex-cli": {
      "displayName": "Codex CLI (OpenAI 无头)",
      "type": "cli",
      "driver": "spawn",
      "status": "ready",
      "command": null,
      "argsTemplate": ["exec", "<prompt:arg>", "--skip-git-repo-check", "--sandbox", "workspace-write"],
      "promptMode": "arg",
      "cwd": "task",
      "env": {},
      "timeoutMs": 1800000,
      "killTree": "taskkill",
      "authNote": "复用 ~/.codex 登录态；勿与 --approve-for-me 同用（实测互斥）",
      "executableDiscovery": {
        "dirs": ["/opt/homebrew/bin", "/usr/local/bin"],
        "fileNames": ["codex"],
        "fallbackCommand": "codex"
      }
    }
  }
}
```

用法与内置 agent 一致：

```text
run_task(projectPath=/path/to/项目, agentId=codex-cli, task="任务书", autoVerify=true, autoFixRounds=2)
```

行为与限制：

- `get_profiles` 会列出 `codex-cli` 并探测 PATH 上的 `codex` 可执行。
- `model` 参数对 spawn agent 不生效——CLI 使用 `~/.codex/config.toml` 的默认模型；要锁模型可在 `argsTemplate` 追加 `"-m", "<模型名>"`。
- 写入被 `workspace-write` 沙箱限制在项目目录内；POSIX 下取消/超时自动对进程组 SIGTERM→SIGKILL（`killTree` 值在非 Windows 平台被忽略）。

## 推荐用法

> "在项目 D:\xxx 用 codex 实现『任务』。先跑 run_task(autoVerify:true, autoFixRounds:2)，完成后用 query_task 看结果；若报告显示 needs_attention，把 get_task_report 的失败项摘要作为 feedback 调 rework_task 再验一轮；全部通过后向我汇报 changedFiles 与 diffstat。"

> "在项目 D:\xxx 用 traework、mode=Code 实现『任务』；它会先切到 Code 模式再绑定项目，然后发任务、自动验收，失败自动生成修复计划并返修。"

## 渊源与切换

**渊源**：本项目源自 **tianshu-mcp v0.5.4**（Apache-2.0）**独立分化**，自 1.0.0 起独立演进。两者是**并行维护的两个独立项目**：tianshu-mcp 的历史（发布记录、真机验收、里程碑叙事）归属其自身仓库，本仓库不保留、不复述；两个项目互不依赖、互不读取对方数据。

**从 tianshu-mcp 切换过来的用户须知**（四项用户可见的行为变化）：

1. **数据目录不共享**：本项目的默认数据目录是 `~/.agent-foreman`（环境变量 `AGENT_FOREMAN_HOME`）。原 `~/.tianshu-mcp` 下的任务历史、项目登记、agent profiles 与配置**不会被读取、也不会迁移**——本项目从全新目录开始。
2. **项目级验收配置需重建**：本项目只读 `<项目>/.agent-foreman/acceptance.json`，**不读取** `.tianshu-mcp/acceptance.json`。已有项目需把配置复制到新路径（`.agent-foreman/`）。
3. **Codex GUI profile 目录变更**：Codex 桌面端的专属浏览器 profile 目录从 `…/tianshu-mcp/codex-gui/profile` 改为 `…/agent-foreman/codex-gui/profile`（Windows 在 `%LOCALAPPDATA%` 下，macOS 在 `~/.agent-foreman/` 下）。该目录承载登录态，因此**首次运行需要重新登录 Codex**。
4. **Codex 状态备份后缀变更**：登记项目前的备份文件后缀改为 `.agent-foreman-backup.json`，**并兼容识别旧后缀** `.tianshu-mcp-backup.json`——若磁盘上已存在旧备份（那是「任何工具动手之前」的干净快照），本项目**不会覆盖它、也不会另建新备份**，日志会打印实际生效的那份路径。因此仍可按旧文件回滚。

其余对外契约相对 tianshu-mcp v0.5.4 的变化（新包名、`structuredContent` 双轨返回、技能自装目录迁移到 `~/.agents/skills/`、移除 Gitee 集成等），见 [CHANGELOG.md](CHANGELOG.md)。

## 开源协作

- **主仓库**：<https://github.com/lanlan0811/agent-foreman-mcp>（GitHub）
- **问题反馈**：Bug / 功能请求走仓库 Issue 模板；安全漏洞请按 [SECURITY.md](SECURITY.md) 私密报告，**不要**开公开 Issue。

### 贡献者

感谢为本项目做出贡献的社区成员（按首次参与顺序排列）。其中部分成员在项目的前身 tianshu-mcp 时期参与贡献，其贡献随代码一并承继：

<table>
  <tr>
    <td align="center"><a href="https://github.com/liuchsong"><img src="https://github.com/liuchsong.png" width="72" height="72" alt="liuchsong" /><br /><sub>liuchsong</sub></a></td>
    <td align="center"><a href="https://github.com/a13612745638"><img src="https://github.com/a13612745638.png" width="72" height="72" alt="a13612745638" /><br /><sub>a13612745638</sub></a></td>
    <td align="center"><a href="https://github.com/king195547"><img src="https://github.com/king195547.png" width="72" height="72" alt="king195547" /><br /><sub>king195547</sub></a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/zhaoxc857"><img src="https://github.com/zhaoxc857.png" width="72" height="72" alt="zhaoxc857" /><br /><sub>zhaoxc857</sub></a></td>
    <td align="center"><a href="https://github.com/jian-in"><img src="https://github.com/jian-in.png" width="72" height="72" alt="jian-in" /><br /><sub>jian-in</sub></a></td>
    <td align="center"><a href="https://github.com/huiliyi37"><img src="https://github.com/huiliyi37.png" width="72" height="72" alt="huiliyi37" /><br /><sub>huiliyi37</sub></a></td>
  </tr>
</table>

## 许可

本项目以 **Apache License 2.0** 发布，完整法律文本见 [LICENSE](LICENSE)。版权归 agent-foreman-mcp 贡献者所有（Copyright 2026 agent-foreman-mcp contributors）。

本项目源自 tianshu-mcp（Apache-2.0）独立分化；依 Apache-2.0 要求，原始版权、许可与免责声明随 LICENSE 一并保留。

### 授予你的权利

- **商业使用**：可在商业产品与服务中使用；
- **修改**：可自由修改源码；
- **分发**：可再分发原始或修改后的版本；
- **私用**：可在组织内部私有使用；
- **专利使用**：贡献者授予你实施其贡献所涉专利的许可（受下述终止条款约束）。

### 你必须履行的义务

1. **保留声明**：分发时须随附 LICENSE 全文，并保留其中的版权、许可与免责声明；
2. **标注修改**：若修改了文件，须在修改的文件中附带显著的「已修改」声明；
3. **保留 NOTICE**：若原作品含 NOTICE 文件，分发时须保留其内容（本项目当前**无** NOTICE 文件）；
4. **不得附加限制**：不得对本许可授予的权利附加额外限制。

### 明确不授予 / 授权终止

- **商标**：本许可**不授予**任何商标、商号或服务标记的使用权；
- **专利终止**：若你对本项目或其贡献者发起专利诉讼（包括交叉诉讼与反诉），本许可授予你的专利授权**自动终止**。

### 免责声明

软件按 **「现状」** 提供，不附带任何明示或暗示的担保，包括但不限于适销性、特定用途适用性和非侵权担保。在任何情况下，作者或版权持有人均不对因软件、软件的使用或其他交易而产生的任何索赔、损害或其他责任负责（无论是在合同诉讼、侵权诉讼还是其他诉讼中）。

### 第三方依赖许可

运行时依赖主要为 **MIT / ISC / Apache-2.0** 许可，与 Apache-2.0 兼容：

| 依赖 | 许可 | 用途 |
|---|---|---|
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/sdk) | MIT | MCP 协议实现 |
| [`zod`](https://github.com/colinhacks/zod) | MIT | 外部输入校验 |
| [`cross-spawn`](https://github.com/moxystudio/node-cross-spawn) | MIT | 跨平台子进程 |
| [`puppeteer-core`](https://github.com/puppeteer/puppeteer) / [`@puppeteer/browsers`](https://github.com/puppeteer/puppeteer) | Apache-2.0 | GUI 驱动与受管浏览器 |
| [`pixelmatch`](https://github.com/mapbox/pixelmatch) | ISC | 视觉像素比对 |

开发依赖（TypeScript、ESLint、Prettier、Vitest、Vite、tsx 等）各自遵循其开源许可，且不随 npm 发布产物分发。

### 与安全边界的关系

本 MCP **不保存、不读取、不转发**任何 AI-Agent 的 API key 或登录态（详见 [SECURITY.md](SECURITY.md)）。许可条款不改变这一设计边界。
