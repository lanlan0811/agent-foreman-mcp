# Security Policy

Chinese version: [SECURITY.md](SECURITY.md)

## Supported versions

Security fixes target the latest release only. Please upgrade before reporting an issue.

| Version | Supported |
|---|---|
| 1.x (latest) | Supported |
| Earlier versions | Not supported |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues.**

Use GitHub's private vulnerability reporting channel:

1. Open <https://github.com/lanlan0811/agent-foreman-mcp/security/advisories/new>
2. Or, in the repository, go to **Security → Advisories → Report a vulnerability**.

Please include as much of the following as you can:

- the affected version (`npm view agent-foreman-mcp version`, or `package.json`);
- reproduction steps (a minimal config/command that reproduces it);
- an impact assessment (what can be read, what can be written, whether local access is required);
- mitigation suggestions if you have any.

**Expected response**: acknowledgement within 7 days, and a fix or mitigation plan within 30 days. Once a fix is
released, credit is given in the release notes and [CHANGELOG.en.md](CHANGELOG.en.md) (say so if you prefer to
stay anonymous).

## Security model (this project's design boundaries)

Understanding these boundaries helps decide whether something is "by design".

### 1. Zero credential management

- This MCP **never stores, reads or forwards** any external AI agent's API key or login state.
- Each agent uses its own login state (for example Codex uses `~/.codex`; TraeWork / ZCode use their desktop login).
- GUI drivers operate the UI over CDP only and **never touch** credential files.
- **AI content validation (optional, off by default) likewise introduces no credential management**: the MCP reads
  no keys, implements no model/vendor HTTP client and ships no built-in agent CLI presets. The judgement is fully
  **delegated to a local command the user declares**, which uses its own login state or keys. The MCP does exactly
  three things: fill arguments from the template, spawn that command (`shell:false` with a structured argv), and
  parse the JSON on the last stdout line.

**The limits of enforcement for data egress (please read this plainly)**:

- Whether an image leaves the machine **depends on the behaviour of the user-supplied command**; the MCP cannot
  intercept this at the system level.
- The MCP's enforcement exists only at the **contract layer**: `allowRemote` defaults to `false`, so a rule that was
  not explicitly cleared per-rule is **forbidden** from using the byte-egress placeholder `<image:base64:file>` in
  `argsTemplate` (the schema rejects that configuration outright rather than warning at runtime).
- `agent-foreman-mcp visual doctor` lists each rule's `allowRemote` declaration for manual review.
- Users must therefore confirm their command's actual behaviour themselves; the MCP makes no vague promise here.

### 2. A narrow command-execution surface

- Acceptance commands come from **whitelist-style structured configuration** (`name` plus `cmd` as an argv array);
  **no shell string is ever concatenated** and `shell: true` is not used.
- Commands run inside the **target project directory**, bounded by `verifyCommandTimeoutMs`.
- The user-supplied command for AI content validation likewise runs with `shell:false` and a structured argv,
  bounded by `visual.content.timeoutMs` with process-tree termination. Declared environment variables are referenced
  as `{ childVariableName: hostEnvironmentVariableName }`; a missing variable blocks the whole round, and the MCP
  itself never reads that variable's contents.
- Task artifacts (logs, reports, repair plans) are written only into the task data directory and the project's
  `.agent-foreman/`.

### 3. Paths and processes

- Path arguments must be **absolute and must exist**, and are normalized through `realpath` to remove symlink
  ambiguity.
- **Path gate**: the home directory itself and system/root-level directories (`/`, `/etc`, `/usr`, `/var`, `/tmp`,
  `/Users`, `C:\`, `C:\Windows`, `C:\Users`, `C:\Program Files`, …) are rejected outright; only exact roots are
  blocked, and their subdirectories work normally.
- Subprocesses use `windowsHide` and stdio pipes; termination is process-tree based (Windows `taskkill`; POSIX
  process group SIGTERM→SIGKILL).
- Environment-variable placeholders (`{HOME}`, `{LOCALAPPDATA}`, …) expand case-insensitively to avoid
  cross-platform drift.

### 4. GUI driver boundaries (shared by all three adapters)

- **Reuse the user's existing instance by default; never start a second one.**
- **Never kill by process tree blindly**: ownership is verified (debug port plus process name) before terminating,
  and termination is abandoned with a warning when that cannot be confirmed.
- TraeWork's release action uses **no `/T`**; Codex stops only the managed instance it started with a dedicated
  `user-data-dir`.
- A running ZCode that is alive but opened no CDP port only triggers `needs_user(close_existing_instance)` and is
  **never closed automatically**; on timeout or disconnect the window is kept and no stop click is sent.
- Paths handed to GUI processes always use the native platform form.
- Window mode is governed by `gui.windowMode`; a manually opened default instance is **never touched**.

### 5. Desktop automation allow-list

Built-in native automation may drive **only** the folder-selection dialog that this module opened for this run and
whose owning process can be verified (window title plus host process double check). Every other window (browser,
terminal, editor, system dialog) is rejected with `COMPUTER_USE_DENIED`.

### 6. CDP connection boundary

- CDP connects to the **local loopback only** (`127.0.0.1`), and both the page identity and the process owning the
  debug port are verified, so it cannot attach to someone else's instance.
- It never reads, copies, decrypts or prints the host application's login data, keys or credentials.
- It never calls undocumented internal protocols bundled inside the host application.

### 7. Permission approval

`requireApproval` on a tool is **metadata published to the host**; it is not a security boundary in itself.

| Class | Tools | `requireApproval` |
|---|---|---|
| Write / execute | `run_task`, `cancel_task`, `rework_task`, `continue_task`, `prepare_visual_baseline`, `approve_visual_baseline` | `true` |
| Read / query / verify | `query_task`, `list_tasks`, `get_task_report`, `verify_task`, `get_profiles` | `false` |

> Tools also declare `readOnlyHint` / `destructiveHint` / `openWorldHint` through MCP `annotations`.
> **Actual authorization control must come from the host** — the annotations are not a security boundary.

### 8. Visual baseline integrity

- A baseline can only be written by `approve_visual_baseline` **after user review**, and must carry
  `expectedDigest` and `approvalNote`.
- Before writing, the **three-way digest** is verified (candidate + existing baseline + config) to prevent
  substitution in between.
- **The automatic rework path is forbidden from calling the approval entry point.**
- Config or baseline modified during a task → `VISUAL_INTEGRITY`, preventing an agent from weakening the acceptance
  rules to force a pass.

### 9. Code protection

- A git baseline (HEAD plus dirty state) is captured before work starts, and reports compute changes against it.
- There is **no automatic** commit / stash / rollback; any rollback is the user's decision based on the report.
- The Codex state backup uses "create only when absent" anti-overwrite semantics and still recognizes the legacy
  brand suffix, preserving the user's original rollback point.

## Dependencies and supply chain

Runtime dependencies (shipped in the published artifact):

| Dependency | License | Purpose |
|---|---|---|
| `@modelcontextprotocol/sdk` | MIT | MCP protocol implementation |
| `zod` | MIT | External input validation |
| `cross-spawn` | MIT | Cross-platform child processes |
| `puppeteer-core` / `@puppeteer/browsers` | Apache-2.0 | GUI driving and the managed browser |
| `pixelmatch` | ISC | Visual pixel comparison |
| `sharp` (optional) | Apache-2.0 | Image processing (a missing install blocks the visual module explicitly, with no silent degradation) |

- `npm audit` should report no known vulnerabilities before committing; CI runs typecheck, lint, tests and build
  on Ubuntu / Windows / macOS × Node 20/22/24.
- The published artifact is content-checked via `npm pack` (it must contain `dist/`, `skills/`, both READMEs,
  LICENSE and `assets/`).

## Out of scope

- The behaviour and vulnerabilities of the external AI agents themselves (report those to their vendors).
- Sensitive values a user puts into a profile's `env` (a local-risk field that is never written to task logs).
- The behaviour of the user-supplied AI content judging command itself (including whether it sends images
  off-machine).
- Privilege escalation caused by a user manually granting excessive system permissions.
