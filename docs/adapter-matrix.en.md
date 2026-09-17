# Agent Capability Matrix (adapter-matrix.en.md)

[中文](adapter-matrix.md)

This document records **the research conclusions and current state of external AI-agent integration routes**.
It pairs with [agent-profiles.en.md](agent-profiles.en.md): this file answers "why is this agent integrated this
way", while that one answers "how do I write the profile fields".

## Integration principles

1. **Official interfaces first**: when an official headless CLI/API exists, use `driver: "spawn"`.
2. **A GUI route must be strictly verifiable**: an Electron desktop product is driven through an isolated GUI adapter
   (CDP) only when **product, process, project and session** are all verifiable.
3. **No undocumented internal protocols**, no pty hacks, no unverified generic GUI automation.
4. **Login state never lands in this server**: each agent uses its own login state; this MCP never reads, stores or
   forwards credentials.

## Summary matrix

| Agent | Interface | driver / adapter | status | Executable discovery | Login | Task/file read-back |
|---|---|---|---|---|---|---|
| **Codex desktop** | MSIX store package + **CDP GUI driver** | `gui` / `codex-gui` | **ready** (`research` on darwin) | Appx query first, disk scan as fallback | Reuses the `~/.codex` login (managed instances get a dedicated profile) | Replies extracted from the DOM; project files written by Codex itself |
| **ZCode desktop** | Electron + **CDP GUI driver** | `gui` / `zcode-gui` | **research** | Desktop-app path probing; runtime data is never treated as an entry point | Reuses the ZCode desktop login | Extracted from the DOM; supports project-less dispatch |
| **TraeWork / TRAE SOLO CN** | Desktop IDE + **CDP GUI driver** | `gui` / `traework-gui` | **ready** | No headless CLI; drives the chat UI via `--remote-debugging-port` | Reuses the TraeWork desktop login | Replies extracted from the DOM; project files written by TraeWork itself |
| **codex-cli** (user-defined) | Official CLI | `spawn` | user-defined | `PATH` / `executableDiscovery` | Reuses `~/.codex` | Judged by exit code |
| **stub** (tests) | Local script | `spawn` | tests only | Test-injected profile | None | Fixed plays |

`status` semantics: `ready` = the loop is verified on this platform; `research` = implemented but the matrix is not
covered (**still executable**); `unsupported` = explicitly unsupported.

## Why all three GUI agents must go through CDP

| Constraint | Explanation |
|---|---|
| **No headless CLI** | Neither TraeWork nor ZCode ships any agent-driving subcommand (per-agent evidence below). |
| **Requests encrypted inside the client** | TraeWork's agent requests are TDE-encrypted at the TTNet layer and cannot be constructed outside the client → driving the full client is the only viable path. |
| **MSIX cannot be launched directly** | The Codex desktop app is an MSIX store package and a GUI host cannot `CreateProcess` it → COM activation plus a dedicated `user-data-dir` is required. |

## Codex desktop (`codex-gui`, status `ready`)

The Codex desktop app ships a kernel CLI, yet **the built-in adapter takes the GUI route**:

- **GUI route (built-in)**: same entry point the user uses daily, with full model / reasoning-level / project-binding
  capability; it needs MSIX COM activation plus a dedicated `user-data-dir` before a CDP port will open.
- **Headless route (user-defined profile)**: when you would rather not depend on GUI automation, add a
  `driver: "spawn"` profile in the data home to go through `codex exec`. See the "Headless path: codex-cli" section
  of the [README](../README.en.md).

> With `codex exec`, note that `--sandbox` and `--approve-for-me` are **mutually exclusive**; for non-interactive
> automation `--sandbox workspace-write` suffices (approval output reads never in practice). `-C/--cd` sets the
> working root and pairs with `cwd: "task"` as a double safeguard; `--json` emits JSONL events and
> `-o/--output-last-message` captures the final message.

GUI-route details (MSIX discovery, COM activation, CDP, selectors, liveness) are in
[codex-gui-cdp.en.md](codex-gui-cdp.en.md).

## ZCode desktop (`zcode-gui`, status `research`)

**Conclusion: the headless route is unsupported; the GUI route is implemented.**

Evidence (headless route only):

- The install directory is a standard Electron layout (`ZCode.exe` + `resources/app.asar`) with no `cli.js`,
  headless launcher or `cli.exe`.
- `resources/tools/` bundles only `cua-helper` (computer-use), `ripgrep`, `ugrep` and similar internal helpers —
  no agent-driving command.
- The application's runtime data directory (sessions plus config) **is not an executable entry point** — discovery
  must exclude it rather than mistaking a data file for a CLI.
- No `zcode` command exists on `%PATH%` or in the npm global prefix.

The built-in adapter therefore drives the desktop UI over CDP, supporting `needs_user` / `continue_task` and
automatic acceptance/rework. Implementation and pitfalls are in [zcode-cdp.en.md](zcode-cdp.en.md).

> `status` stays `research` because the Windows loop is complete while the cancel / rework / new-project matrix is
> not covered on darwin.

## TraeWork / TRAE SOLO CN (`traework-gui`, status `ready`)

**Conclusion: there is indeed no headless CLI — but the CDP GUI route works, is implemented and verified on real
hardware.**

Headless-route evidence:

- The app is Electron (product.json `name: TRAE SOLO CN`) and the CLIs it exposes are only VS Code family commands
  (`open`, `serve-web`, `install-extension`, `list-extensions`, `tunnel`, `command`, …) — **no headless agent-driving
  subcommand at all**.
- Searching the whole install directory finds no standalone agent CLI binary.
- The `byted-solo.builtin-mcp` extension is an **MCP client** extension (for connecting MCP servers inside the IDE),
  which is an IDE-side capability and **not a headless interface this server can call externally**.

GUI route (integrated):

- Connection: `TRAE SOLO CN.exe --remote-debugging-port=<port>` → `GET /json` to obtain the page WebSocket.
- Measured selectors: chat input, new task, task list, mode switcher, model dropdown, project folder dropdown.
- Project registration: when the dropdown misses, the path is written through the native Windows dialog.
- End to end: `run_task(agentId="traework", model=..., autoVerify=true)` drove it to create a file and passed
  acceptance.

**Why not connect over HTTP directly**: agent requests are TDE-encrypted at the TTNet layer and cannot be constructed
outside the client; driving the full client over CDP is the only viable path.

Implementation and pitfalls: [traework-cdp.en.md](traework-cdp.en.md).

## Adding a new agent (three steps)

1. **Add a profile in the data home** (see [agent-profiles.en.md](agent-profiles.en.md)); when the defaults suffice
   this means **zero code**.
2. **Implement an `AgentAdapter` when custom output parsing is needed** (e.g. a non-zero exit code that still means
   success, or JSON results to parse) and `registry.register(id, adapter)`.
3. **Verify**: self-check executable discovery with `get_profiles`, then run one stub or real-machine smoke task
   through to a passing acceptance.

### Candidate evaluation checklist

Before integrating a new agent, confirm each item:

| Question | If "no" |
|---|---|
| Does it have an official headless CLI/API? | Take the GUI route, subject to the four factors below |
| Can the GUI route verify **product identity** (window/page identity)? | Do not integrate |
| Can it verify **process ownership** (the process owning the debug port)? | Do not integrate |
| Can it verify **project binding** (a full-path criterion)? | Do not integrate |
| Can it verify **session/run state** (run signal, completion marker)? | Do not integrate |

If any of the four factors cannot be verified strictly, do not integrate — it is better to omit an adapter than to
build one that could misoperate a real workspace.

## Platform status

| Agent | Windows | macOS | Notes |
|---|---|---|---|
| `codex` | `ready` | `research` | The basic macOS loop is verified on real hardware; the cancel/rework matrix is not covered |
| `zcode` | `research` | `research` | The basic loop is verified on both; cancel/rework/new-project is not covered |
| `traework` | `ready` | Not integrated (fail-closed) | Native dialog driving has not been measured on macOS |
| `stub` | Tests only | Tests only | Not part of the real-machine matrix |
