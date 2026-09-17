# 宿主接入指南（host-integration.md）

[English](host-integration.en.md)

本 MCP server（`agent-foreman-mcp`）是标准 **MCP stdio server**（TypeScript + 官方 `@modelcontextprotocol/sdk`），**不绑定任何特定宿主**。任何支持 stdio 传输的 MCP 宿主接入后，会话里都会出现 11 个工具，用来驱动外部 AI-Agent 完成「派活 → 验收 → 失败返修 → 再验收」闭环。

> **工具名前缀**：宿主通常把工具暴露为 `mcp__<server-id>__<tool>`，其中 `<server-id>` 是**你在宿主配置里给这个 server 起的名字**（下文示例统一用 `agent-foreman`）。本文档用不带前缀的短名（`run_task`）指代工具，实际调用请以宿主显示的名称为准。

## 0. 前置

- Node.js ≥ 20。
- 一个希望被驱动的外部 agent（Codex 桌面端 / TraeWork / ZCode 桌面端）已安装；或先只用 `get_profiles` 验证连通。
- 首次启动会自动创建数据目录（默认 `~/.agent-foreman`，可用环境变量覆盖见 §3）。

## 1. 通用接入（任何宿主的 `mcpServers` 配置）

绝大多数宿主都接受同一种 JSON 片段（键名可能叫 `mcpServers` / `mcp.servers` / `servers`，视宿主而定）：

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

本地开发（未发布 / 改了源码）时指向构建产物：

```json
{
  "mcpServers": {
    "agent-foreman": {
      "command": "node",
      "args": ["/absolute/path/to/agent-foreman-mcp/dist/index.js"]
    }
  }
}
```

Windows 若 `npx` 不在 PATH 上，用 `"command": "npx.cmd"`。

## 2. 各宿主对应位置

| 宿主 | 配置位置 | 备注 |
|---|---|---|
| **Claude Desktop** | `claude_desktop_config.json`（macOS：`~/Library/Application Support/Claude/`；Windows：`%APPDATA%\Claude\`）的 `mcpServers` | 改后需重启应用 |
| **Cursor** | 项目内 `.cursor/mcp.json` 或全局 `~/.cursor/mcp.json` 的 `mcpServers` | 支持按项目启用 |
| **Cline / Windsurf / VS Code 系** | 各自 MCP 设置面板；粘贴 §1 的 JSON 片段 | 面板字段名可能为 Command / Args |
| **ZCode** | 宿主 MCP 配置的 `mcpServers`；传输方式选 `stdio（本地进程）` | 与上述片段一致 |
| **通用 CLI 宿主** | 任意接受 `command` + `args` 的地方 | 只要宿主走 stdio 即可 |

> 各宿主版本迭代较快，界面路径可能变化；**判断接入成功的唯一标准是 §4 的冒烟结果**，而非某个菜单在哪。

## 3. 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `AGENT_FOREMAN_HOME` | 数据目录（任务历史、项目登记、agent profiles、config.json） | `~/.agent-foreman` |
| `AGENT_FOREMAN_NO_SKILL_INSTALL=1` | 关闭启动时的技能自装 | 未设置（即开启自装） |

命令行开关：`--no-skill-install` 与上面的环境变量等价。

**技能自装说明**：server 启动时会把自己的编排技能幂等同步到 **`~/.agents/skills/agent-foreman-mcp/`**（Agents Skills 开放标准，用户级）。内容 hash 一致则跳过，不一致会先把旧版备份为 `.bak-<时间戳>` 再覆盖。该目录**由 `os.homedir()` 决定，不受 `AGENT_FOREMAN_HOME` 影响**。失败只告警、不阻断 server 启动。

## 4. 冒烟步骤（接入是否成功）

1. 重启宿主，确认 server 状态为已连接。
2. 让宿主列出工具 → 应能看到 **11 个**：`run_task`、`continue_task`、`query_task`、`list_tasks`、`get_task_report`、`verify_task`、`rework_task`、`cancel_task`、`get_profiles`、`prepare_visual_baseline`、`approve_visual_baseline`。
3. 调用 `get_profiles`（只读、无需审批）→ 返回本机各 agent 的适配与可执行探测结果。
   - 返回文本末尾带 `---agent-foreman-meta---` 结构化块；现代宿主还会同时收到 MCP 标准 `structuredContent`（同一份字段，二者选一消费即可）。
4. 若 `get_profiles` 报某 agent 不可用，先按提示确认该 agent 已安装并能在本机手动打开。

## 5. 首次派活

拿到 11 个工具后，典型调用顺序：

1. `get_profiles` → 确认目标 agent 可用。
2. `run_task(projectPath=<绝对路径>, task=<任务书>, agentId=codex, model=<面板实际模型名>, autoVerify=true, autoFixRounds=5)` → 立即返回 `taskId`（**异步契约，不要当同步调用等结果**）。
3. `query_task(taskId)` 每 ~8 秒轮询到终态。
4. `get_task_report(taskId)` 读验收报告与变更清单。

细节（参数语义、终态解读、错误码、视觉验收）见仓库 `skills/agent-foreman-mcp/SKILL.md` 与 `usage-examples.md`——它们也会被自装到上面提到的技能目录。

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| 工具面里看不到 11 个工具 | 宿主未连上。查宿主日志；确认 `command`/`args` 可执行（手动跑一次 `npx -y agent-foreman-mcp` 看是否报错） |
| 日志出现技能安装失败告警 | 非致命，server 仍可用。检查 `~/.agents/skills/` 是否可写；或用 `AGENT_FOREMAN_NO_SKILL_INSTALL=1` 关闭自装 |
| 不想污染用户目录 / 做隔离测试 | 同时设置 `AGENT_FOREMAN_HOME` **和** 进程级 `HOME`/`USERPROFILE`（技能目录只认后者） |
| 换了机器后 agent 探测结果不同 | `get_profiles` 是实机探测结果，跨机器不同属正常 |
| 从 `agent-foreman-mcp` 切换过来 | 旧数据目录 `~/.agent-foreman` 与本项目无关、**不会被读取**；项目级验收配置需在 `.agent-foreman/acceptance.json` 重建。详见 README 的「渊源与切换」 |

## 7. 数据与安全边界

- server 只通过 **stdio** 与宿主通信；**stdout 仅承载 JSON-RPC**，日志一律走 stderr。
- 写/执行类工具（`run_task`、`cancel_task`、`rework_task`、`continue_task`、`prepare_visual_baseline`、`approve_visual_baseline`）带需要审批的标注，但**审批控制由宿主实施**——标注本身不构成安全边界。
- 验收命令来自白名单式配置、按 argv 分词执行，不做 shell 注入。
- server 不读取、不转发任何 agent 密钥（各 agent 的登录态由各自自持）。
