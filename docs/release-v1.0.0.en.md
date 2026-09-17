# v1.0.0 Release Notes

**Release date**: 2026-09-17 · **First standalone release**

`agent-foreman-mcp` is a brand-new project **split off independently** from the `tianshu-mcp v0.5.4` codebase: a general-purpose AI-Agent orchestration MCP server for any MCP host (Claude Desktop / Cursor / ZCode / Cline / Windsurf, …). It acts as the scheduler, execution surface and objective acceptance gate, driving external AI agents through the "dispatch → verify → rework on failure → re-verify" loop.

From 1.0.0 onward this project evolves independently, while `tianshu-mcp` continues to be **maintained in parallel** as a separate project. The two do not depend on each other and never read each other's data.

---

## 1. What this release brings

### 1.1 Generalisation to any MCP host

No longer tied to a specific host. Any MCP host supporting the stdio transport can connect:

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

See the new [Host Integration Guide](host-integration.en.md) for per-host config locations, environment variables and smoke steps.

### 1.2 Dual-track return contract: text + MCP `structuredContent`

Beyond the existing "human-readable text + meta block", all 11 tools now **also return the MCP-standard `structuredContent`** (the same fields from a single source of truth) and declare a loose `outputSchema`:

- Legacy text-only hosts keep regexing the `---agent-foreman-meta---` block;
- Modern hosts consume the structured JSON directly, with no text parsing.

**Success and error paths are both covered** — error paths uniformly return `{ ok: false, message }`.

> Contract discipline: top-level field names are stable and **add-only** (clients validate against `outputSchema`).

### 1.3 Skill self-install moves to the Agents Skills standard

The install target changed from a host-specific directory to **`~/.agents/skills/agent-foreman-mcp/`** (the [Agents Skills](https://agents.md) open standard, user level). Installation is idempotent: matching content is skipped; otherwise the old version is backed up as `.bak-<timestamp>` before overwriting. Failures only warn and never block the server.

### 1.4 Legacy backup suffix recognised (your rollback point is preserved)

The Codex state backup now uses the new suffix `.agent-foreman-backup.json` **and still recognizes** the legacy `.tianshu-mcp-backup.json` — if an old backup exists on disk (the clean snapshot from before any tool touched the file), this project **will not overwrite it or create a new backup**, and the log prints whichever path is actually in effect.

---

## 2. Changes relative to `tianshu-mcp@0.5.4`

### Breaking changes (adjust accordingly)

| Dimension | Old | New |
|---|---|---|
| npm package / bin | `tianshu-mcp` | **`agent-foreman-mcp`** |
| Data directory | `~/.tianshu-mcp` | **`~/.agent-foreman`** |
| Data directory env var | `TIANSHU_MCP_HOME` | **`AGENT_FOREMAN_HOME`** |
| Project acceptance config | `.tianshu-mcp/acceptance.json` | **`.agent-foreman/acceptance.json`** |
| Meta block marker | `---tianshu-mcp-meta---` | **`---agent-foreman-meta---`** |
| Default Codex repair-plan dir | `.zcode/plans` | **`.agent-foreman/plans`** |
| Codex GUI profile dir | `…/tianshu-mcp/codex-gui/profile` | **`…/agent-foreman/codex-gui/profile`** |
| Skill name / install target | `tianshu-mcp` → `~/.rivet/skills/` | **`agent-foreman-mcp` → `~/.agents/skills/`** |
| Disable skill install (env) | `TIANSHU_MCP_NO_SKILL_INSTALL` | **`AGENT_FOREMAN_NO_SKILL_INSTALL`** |
| Real-browser test switch | `TIANSHU_VISUAL_BROWSER_TEST` | **`AGENT_FOREMAN_VISUAL_BROWSER_TEST`** |
| Visual evidence output dir | `TIANSHU_VISUAL_EVIDENCE` / `..._REPORT_EVIDENCE` | **`AGENT_FOREMAN_VISUAL_EVIDENCE` / `..._REPORT_EVIDENCE`** |
| SVG assets | `assets/tianshu-mcp-*.svg` | **`assets/agent-foreman-*.svg`** |

### Added

- MCP `structuredContent` dual-track returns plus tool `outputSchema` (including error paths).
- Legacy backup suffix recognition (see above).
- [Host Integration Guide](host-integration.en.md) (bilingual).
- Test support: `skillSelfInstall()` accepts injected `sourceDir` / `destDir` for isolated verification.

### Removed

- **Gitee integration removed entirely**: deleted `scripts/gitee-release.mjs`, the Gitee steps and `GITEE_TOKEN` logic in release.yml, the `gitee` branch in release-body, and all mirror references. This project is a single-remote (GitHub) repository.
- The predecessor project's historical documents (v0.x release notes, real-hardware records, evidence directories, historical fix plans) — they belong to the tianshu-mcp repository.
- The milestone narrative from the README.

### Hardened

- **SDK dependency floor raised** from `^1.15.0` to **`^1.30.0`**, guaranteeing that `structuredContent` and `outputSchema` are actually available and avoiding "schema declared but silently ineffective because an older version resolved".
- Root-level config (`.gitignore` / `.npmignore` / `eslint.config.js`) synced to `.agent-foreman`.
- Source, comments, copy, test fixtures, the internal spawn-passing variables and the PowerShell sub-script strings de-branded in pairs.

---

## 3. Migrating from tianshu-mcp

Four **user-visible** behaviour changes:

1. **The data directory is not shared**: task history, project registry, agent profiles and configuration under `~/.tianshu-mcp` are **neither read nor migrated**. This project starts fresh from `~/.agent-foreman`.
2. **Project-level acceptance config must be recreated**: this project reads only `<project>/.agent-foreman/acceptance.json`. Existing projects must copy their config to the new path.
3. **Codex must be signed in again**: the GUI profile directory changed, and that directory carries login state.
4. **The Codex state backup suffix changed**: the new suffix is used while the legacy suffix is still recognized (see above) — **the old backup is never overwritten**, so you can still roll back from the old file.

---

## 4. Compatibility

| Item | Status |
|---|---|
| Names / arguments / semantics of the 11 tools | **Unchanged** (stable API surface, returns only enhanced) |
| Existing `MetaBlockFields` field names | **Unchanged** (add-only) |
| `agentId` values (`codex` / `zcode` / `traework` / `stub`) | **Unchanged** |
| `--no-skill-install` switch | **Unchanged** |
| CLI subcommand family (`visual ...`) | **Unchanged** |
| stdio contract (stdout carries JSON-RPC only) | **Unchanged** |
| Windows / macOS / Linux support | **Unchanged** |

---

## 5. Verification

- Local gates: `typecheck` / `lint` (0 warnings) / `test` **661 passed / 12 skipped (68 files)** / `build` / `check:stdio` all 6 scenarios / `pack:check`.
- Of those, 12 skipped are real-browser tests requiring `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`; the CI `visual-browser` job runs them fully across ubuntu / windows / macos-15-intel / macos-15 × Node 20/22/24.
- CI: the three-platform build/test matrix, the visual matrix and the npm tarball content check **all pass**.

---

## 6. Install

```bash
npm i -g agent-foreman-mcp
# or run without installing
npx -y agent-foreman-mcp
```

To connect your host, see the [Host Integration Guide](host-integration.en.md).
