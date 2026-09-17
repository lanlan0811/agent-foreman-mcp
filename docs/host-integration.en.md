# Host Integration Guide (host-integration.md)

[中文](host-integration.md)

This MCP server (`agent-foreman-mcp`) is a standard **MCP stdio server** (TypeScript + the official `@modelcontextprotocol/sdk`) and is **not tied to any particular host**. Once any host that supports the stdio transport connects to it, 11 tools appear in the session, driving external AI agents through the "dispatch → verify → rework on failure → re-verify" loop.

> **Tool name prefix**: hosts usually expose tools as `mcp__<server-id>__<tool>`, where `<server-id>` is **the name you gave this server in your host configuration** (the examples below use `agent-foreman`). This document refers to tools by their short names (`run_task`); use whatever your host actually displays.

## 0. Prerequisites

- Node.js ≥ 20.
- An external agent you want to drive (Codex desktop / TraeWork / ZCode desktop) installed; or just verify connectivity with `get_profiles` first.
- The data directory is created automatically on first start (default `~/.agent-foreman`; see §3 for overrides).

## 1. Generic setup (any host's `mcpServers` config)

Most hosts accept the same JSON fragment (the key may be named `mcpServers` / `mcp.servers` / `servers`, depending on the host):

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

For local development (unpublished / modified source), point at the build output:

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

On Windows, if `npx` is not on `PATH`, use `"command": "npx.cmd"`.

## 2. Where each host keeps this

| Host | Config location | Notes |
|---|---|---|
| **Claude Desktop** | `mcpServers` in `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`) | Restart the app after editing |
| **Cursor** | `mcpServers` in the project's `.cursor/mcp.json` or the global `~/.cursor/mcp.json` | Can be enabled per project |
| **Cline / Windsurf / VS Code family** | The host's own MCP settings panel; paste the §1 JSON fragment | Panel fields may be named Command / Args |
| **ZCode** | `mcpServers` in the host MCP config; choose transport `stdio (local process)` | Same fragment as above |
| **Generic CLI hosts** | Anywhere that accepts `command` + `args` | Any stdio host works |

> Host UIs change quickly and menu paths may differ; **the only reliable sign of success is the smoke result in §4**, not where a menu item lives.

## 3. Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `AGENT_FOREMAN_HOME` | Data directory (task history, project registry, agent profiles, config.json) | `~/.agent-foreman` |
| `AGENT_FOREMAN_NO_SKILL_INSTALL=1` | Disable skill self-install at startup | unset (self-install enabled) |

Command-line switch: `--no-skill-install` is equivalent to the variable above.

**About skill self-install**: on startup the server idempotently syncs its own orchestration skill into **`~/.agents/skills/agent-foreman-mcp/`** (the Agents Skills open standard, user level). If the content hash matches it skips; otherwise it backs up the old version as `.bak-<timestamp>` before overwriting. That directory is resolved from `os.homedir()` and is **not affected by `AGENT_FOREMAN_HOME`**. Failures only warn and never block server startup.

## 4. Smoke steps (did the connection work?)

1. Restart the host and confirm the server shows as connected.
2. Ask the host to list tools → you should see **11**: `run_task`, `continue_task`, `query_task`, `list_tasks`, `get_task_report`, `verify_task`, `rework_task`, `cancel_task`, `get_profiles`, `prepare_visual_baseline`, `approve_visual_baseline`.
3. Call `get_profiles` (read-only, no approval needed) → it returns each agent's adapter status and executable probe results for this machine.
   - The returned text ends with a `---agent-foreman-meta---` structured block; modern hosts additionally receive the MCP-standard `structuredContent` (the same fields — consume whichever you prefer).
4. If `get_profiles` reports an agent as unavailable, first confirm that agent is installed and can be opened manually on this machine.

## 5. First dispatch

With the 11 tools available, the typical order is:

1. `get_profiles` → confirm the target agent is available.
2. `run_task(projectPath=<absolute path>, task=<task brief>, agentId=codex, model=<the model name shown in the panel>, autoVerify=true, autoFixRounds=5)` → returns a `taskId` immediately (**asynchronous contract — do not treat it as a blocking call**).
3. `query_task(taskId)` every ~8 seconds until a terminal state.
4. `get_task_report(taskId)` to read the acceptance report and the change list.

For details (argument semantics, terminal-state handling, error codes, visual acceptance), see `skills/agent-foreman-mcp/SKILL.md` and `usage-examples.md` in the repository — they are also installed into the skill directory mentioned above.

## 6. Troubleshooting

| Symptom | What to do |
|---|---|
| The 11 tools are not visible | The host did not connect. Check host logs; verify `command`/`args` are executable (run `npx -y agent-foreman-mcp` manually and watch for errors) |
| A skill-install failure warning in the logs | Not fatal — the server still works. Check that `~/.agents/skills/` is writable, or disable with `AGENT_FOREMAN_NO_SKILL_INSTALL=1` |
| Want to avoid touching user directories / test in isolation | Set `AGENT_FOREMAN_HOME` **and** a process-level `HOME`/`USERPROFILE` (the skill directory only follows the latter) |
| Agent probe results differ on another machine | `get_profiles` reflects real probes on the local machine; differences across machines are expected |
| Migrating from `agent-foreman-mcp` | The old data directory `~/.agent-foreman` is unrelated to this project and is **never read**; project-level acceptance config must be recreated at `.agent-foreman/acceptance.json`. See the "Origin and migration" section of the README |

## 7. Data and security boundaries

- The server talks to the host over **stdio only**; **stdout carries JSON-RPC exclusively** and all logs go to stderr.
- Write/execute tools (`run_task`, `cancel_task`, `rework_task`, `continue_task`, `prepare_visual_baseline`, `approve_visual_baseline`) are annotated as needing approval, but **approval enforcement is up to the host** — the annotation is not a security boundary by itself.
- Acceptance commands come from whitelist-style configuration and are executed as an argv split, never through shell injection.
- The server does not read or forward any agent credentials (each agent owns its own login state).
