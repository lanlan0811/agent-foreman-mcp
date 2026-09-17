# Changelog

All notable changes to `agent-foreman-mcp` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Chinese version: [CHANGELOG.md](CHANGELOG.md)

> **Note on scope**: this file starts at `1.0.0`. The project descends from `tianshu-mcp v0.5.4`
> (Apache-2.0) as an independent fork; **all v0.x history belongs to the tianshu-mcp repository**
> and is not retold here.

---

## [1.0.0] - 2026-09-17

The first release after the independent split. The main contract and engineering changes relative
to the source baseline `tianshu-mcp@0.5.4` are listed below.

### Changed (BREAKING)

- **New npm package and bin**: `tianshu-mcp` → **`agent-foreman-mcp`** (package name, `bin` command and all
  `package.json` metadata). Hosts must be reconfigured: `npx -y agent-foreman-mcp`.
- **Data directory moved**: `~/.tianshu-mcp` → **`~/.agent-foreman`**; environment variable `TIANSHU_MCP_HOME` →
  **`AGENT_FOREMAN_HOME`**. The old directory is **neither read nor migrated** (the two projects never read each
  other's data).
- **Project-level acceptance config path**: `.tianshu-mcp/acceptance.json` → **`.agent-foreman/acceptance.json`**.
  The old path is **not read**; projects migrating from tianshu-mcp must recreate their config at the new path.
- **Meta block marker**: `---tianshu-mcp-meta---` → **`---agent-foreman-meta---`**. Hosts that regex the old marker
  must update (or switch to the structured return described below and skip text parsing entirely).
- **Default Codex repair-plan directory**: `.zcode/plans` → **`.agent-foreman/plans`** (`gui.fixPlanDir`, still
  overridable per profile).
- **Codex GUI-specific profile directory changed**: `…/tianshu-mcp/codex-gui/profile` →
  `…/agent-foreman/codex-gui/profile` (under `%LOCALAPPDATA%` on Windows, under `~/.agent-foreman/` on macOS).
  That directory carries login state, so **the first run requires signing in to Codex again**.
- **Skill self-install target moved**: `~/.rivet/skills/tianshu-mcp/` → **`~/.agents/skills/agent-foreman-mcp/`**
  (adopting the [Agents Skills](https://agents.md) open standard, user level); no host-specific directory is used
  any more.
- **Skill name and source directory**: `skills/tianshu-mcp/` → `skills/agent-foreman-mcp/`.
- **Environment variable to disable skill install**: `TIANSHU_MCP_NO_SKILL_INSTALL` →
  `AGENT_FOREMAN_NO_SKILL_INSTALL` (the `--no-skill-install` switch is unchanged).
- **Visual real-browser test switch**: `TIANSHU_VISUAL_BROWSER_TEST` → `AGENT_FOREMAN_VISUAL_BROWSER_TEST`; the
  evidence output variables follow as `AGENT_FOREMAN_VISUAL_EVIDENCE` / `AGENT_FOREMAN_VISUAL_REPORT_EVIDENCE`.
- **SVG assets renamed**: `assets/tianshu-mcp-{banner,icon}.svg` → `assets/agent-foreman-{banner,icon}.svg`,
  with de-branded content.

### Added

- **Dual-track return contract (MCP `structuredContent`)**: in addition to the existing "text + meta block",
  all 11 tools now also return the MCP-standard **`structuredContent`** (the same fields from a single source of
  truth) and declare a loose `outputSchema` (all fields optional with passthrough). Modern hosts can consume the
  structured JSON directly without regex parsing. **Success and error paths are both covered**: error paths
  uniformly return `{ ok: false, message }`.
  - Contract discipline: top-level field names are stable and **add-only** (clients validate against
    `outputSchema`). `META_BLOCK_FIELDS` is the single source of truth for field names, and protocol tests assert
    that no unregistered field appears.
  - Visual-baseline tools return a free-form result wrapped in the envelope `{ ok, message, result }`;
    `get_task_report` keeps the report text on the text track while supplying `reportRound` / `reportFiles` on the
    structured side.
- **Legacy backup suffix recognition (D13 option A)**: the Codex state backup now uses the new suffix
  `.agent-foreman-backup.json` **and still recognizes** the legacy `.tianshu-mcp-backup.json` — when an old backup
  exists, no new backup is created or overwritten, preserving the user's clean rollback point from before any tool
  touched the file. The log prints the **actually effective** path. This is the only intentionally retained legacy
  brand literal in the repository (centralized in a named constant with a comment explaining why).
- **Host integration guide**: new [docs/host-integration.md](docs/host-integration.md) / `.en.md`, covering any MCP
  host (Claude Desktop / Cursor / ZCode / Cline / Windsurf and a generic stdio fragment).
- **Test support for isolated verification**: `skillSelfInstall()` accepts injected `sourceDir` / `destDir` so
  tests can verify installation and idempotency without polluting a real `~/.agents/`.

### Removed

- **Gitee integration removed entirely**: deleted `scripts/gitee-release.mjs`, the Gitee release steps and
  `GITEE_TOKEN` logic in release.yml, the `gitee` host branch in `scripts/release-body.mjs`, and all Gitee mirror
  references in docs and the README. This project is a single-remote (GitHub) repository.
- **Predecessor project's historical documents removed** (they belong to the tianshu-mcp repository and are not
  kept here): v0.x release notes, real-hardware acceptance/remediation records, evidence directories, historical
  fix plans.
- **Milestone narrative removed from the README**, replaced by independent-project documentation.

### Fixed / Hardened

- **SDK dependency floor tightened**: `@modelcontextprotocol/sdk` raised from `^1.15.0` to `^1.30.0`, guaranteeing
  that `structuredContent` and `outputSchema` are actually available and avoiding "schema declared but silently
  ineffective because an older version resolved".
- **Root-level config synced**: the data-directory exclusions in `.gitignore` / `.npmignore` / `eslint.config.js`
  now use `.agent-foreman`.
- **Full de-branding of code and tests**: source, comments, copy, test fixtures, the internal spawn-passing
  variables (`*_FOLDER` / `*_PIDS` / `DIALOG_*`) and the PowerShell sub-script strings were renamed in pairs,
  keeping the GUI drivers' implicit contract consistent.

### Compatibility

| Item | Status |
|---|---|
| Names / arguments / semantics of the 11 tools | **Unchanged** (stable API surface, returns only enhanced) |
| Existing `MetaBlockFields` field names | **Unchanged** (add-only) |
| `agentId` values (`codex` / `zcode` / `traework` / `stub`) | **Unchanged** |
| `--no-skill-install` switch | **Unchanged** |
| CLI subcommand family (`visual ...`) | **Unchanged** |
| stdio contract (stdout carries JSON-RPC only) | **Unchanged** |
| Windows / macOS / Linux support | **Unchanged** |

### Verification

- Gates: typecheck / lint (0 warnings) / test **661 passed / 12 skipped (68 files)** / build / `check:stdio`
  6 scenarios / `pack:check`.
- Of those, 12 skipped are real-browser tests requiring `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`; the CI
  `visual-browser` job runs them fully across ubuntu / windows / macos-15-intel / macos-15 × Node 20/22/24.

[1.0.0]: https://github.com/lanlan0811/agent-foreman-mcp/releases/tag/v1.0.0
