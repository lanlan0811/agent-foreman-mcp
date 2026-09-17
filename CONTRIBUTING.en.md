# Contributing to agent-foreman-mcp

Thanks for your interest in contributing. This guide covers the development environment, engineering
conventions, and the submission workflow.

Chinese version: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 1. Prerequisites

| Item | Requirement |
|---|---|
| Node.js | ≥ 20 (CI covers 20 / 22 / 24) |
| Package manager | npm (the repo ships `package-lock.json`) |
| OS | Windows / macOS / Linux (CI three-platform matrix) |
| Git | Used by baseline analysis and for committing |

## 2. Local development

```bash
git clone https://github.com/lanlan0811/agent-foreman-mcp.git
cd agent-foreman-mcp
npm ci                # install from the lockfile
npm run build         # sync-version + tsc → dist/
npm test              # vitest (unit + integration + protocol)
```

Common scripts:

| Command | Purpose |
|---|---|
| `npm run build` | Sync the version (`scripts/sync-version.mjs`) and compile into `dist/` |
| `npm run dev` | Run `src/index.ts` directly through `tsx` (stdio server) |
| `npm test` | Full test suite (vitest run; real-browser tests are skipped by default) |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | `tsc --noEmit` type check |
| `npm run lint` | ESLint with `--max-warnings 0` (zero tolerance) |
| `npm run check:stdio` | Strict stdio protocol check (runs the built `dist`) |
| `npm run check:stdio:src` | Same, but through `tsx` against the source entry (no build needed) |
| `npm run format` | Prettier formatting for `src` and `test` |
| `npm run pack:check` | `npm pack --dry-run` to inspect the published contents |

**Real-browser tests** are skipped by default (`AGENT_FOREMAN_VISUAL_BROWSER_TEST !== "1"`). To reproduce visual acceptance locally:

```bash
AGENT_FOREMAN_VISUAL_BROWSER_TEST=1 npx vitest run visual --maxWorkers=1
```

## 3. Required before committing (same as CI)

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run check:stdio
```

`check:stdio` captures the full stdout/stderr byte stream from a real subprocess and validates each scenario:
stdout may contain only newline-delimited, valid MCP JSON-RPC messages (request/response IDs checked against the
official schema). A blank line, a non-JSON line, a parser error or a stray fragment left at exit fails it. It covers
six scenarios: first start, second start with matching skills, `--no-skill-install`, a corrupt config.json, logs
while a stub task runs, and a clean EOF shutdown.

CI checks two more things, so watch for them locally too:

1. **No unexpected tracked diff after the build**: `npm run build` rewrites `src/version.generated.ts`; when you change
   the version that file must be committed together with `package.json`, otherwise CI's
   "No unexpected tracked diff after build" step fails.
2. **Tarball contents and installed-package protocol**: CI installs the generated tarball into a clean consumer
   directory, dynamically reads the installed bin and reuses `scripts/check-stdio.mjs` for protocol validation
   (the consumer installs no dev dependencies).

## 4. Engineering conventions

- **Language**: code comments, logs, error copy and documents are in Chinese; user-facing documents must be
  **bilingual in two files** (`X.md` and `X.en.md`).
- **No hardcoding**: machine paths, usernames and ports all come from profiles, configuration or placeholders
  (e.g. `{LOCALAPPDATA}`, `{HOME}`); code contributes only discovery rules and defaults.
- **Cross-platform**: anything touching paths, processes or signals must consider both Windows and POSIX
  (CI's three-platform matrix verifies this).
- **SVG for icons**: **emoji must never be used as an icon** (the same goes for status markers — use text instead).
- **stdout carries MCP protocol only**: runtime code under `src/**` must not call `console.log/info/debug`; logs go
  through `src/util/log.ts` to stderr (`console.error`). ESLint's `no-console` enforces this, and
  `npm run check:stdio` catches new output with a real process.
- **The return contract is add-only**: results carry both the text meta block and `structuredContent`, and field names
  are **stable and add-only**. A new meta field must be registered in `META_BLOCK_FIELDS`
  (`src/mcp/formatter.ts`) — protocol tests assert that no unregistered field appears.
- **Zero lint warnings**: `npm run lint` runs with `--max-warnings 0`.
- **Tests**: new features and bug fixes should ship with tests; pure functions get unit tests, while orchestration and
  protocol work goes through integration or protocol tests.
- **External input**: always validated through zod (`src/config/schema.ts`).

## 5. Code structure tour

```text
src/
├── index.ts              entry (stdio / visual CLI dispatch)
├── server.ts             assembly: config/logging/manager/engine/registry/tool registration/skill self-install
├── config/               zod schemas plus data-home read/write (hot reload)
├── mcp/                  tool registry, handlers, context, result formatting (dual track: text meta block + structuredContent)
├── tasks/                task state machine, queue, concurrency gate, event-stream persistence
├── loop/                 per-task orchestration (rework loop) and repair-plan generation
├── agents/               adapter abstraction, registry, spawn wrapper, built-in profiles, GUI instance lifecycle
│   ├── codex/            Codex desktop GUI (MSIX discovery/COM activation/CDP/selectors/liveness/registration)
│   ├── zcode/            ZCode GUI (discovery/CDP/project binding/model/recovery/references)
│   └── traework/         TraeWork GUI (CDP client/selectors/UI/constrained computer-use)
├── verify/               acceptance engine (command checks + code analysis + git baseline + reports)
├── visual/               visual acceptance (capture/compare/two-stage baselines/rule freezing/content validation/CLI)
└── util/                 logging, paths, files, timeouts, etc.
```

Test layers:

| Layer | Location | Notes |
|---|---|---|
| Unit | `test/unit/` | Pure functions and component logic (including isolated skill-install verification) |
| Integration | `test/integration/` | The stub agent's three plays run the full task loop, covering dispatch/acceptance/rework/cancel/timeout |
| Protocol | `test/protocol/` | Official SDK in-memory client asserting the tool surface, the dual-track return contract and argument validation |
| Real browser | `test/integration/visual-*.test.ts` | Requires `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`; skipped by default, but CI's `visual-browser` job runs them all |
| Real process | `scripts/check-stdio.mjs` | Strict stdio gate: real subprocess byte stream, stdout may carry valid MCP messages only |
| Real-machine probes | `scripts/probe-{codex,zcode,traework}.mjs` | Require the real desktop apps; **not run in CI** |

> **When changing the project-level directory convention**, `test/test-utils.ts` and
> `test/stub-agent/stub-agent.mjs` are the two files that touch everything.

## 6. Commits and branches

- **Commit on `main` only**; do not create other branches.
- **Commit messages are in Chinese**, preferably `type: summary` with type one of
  `feat` / `fix` / `docs` / `chore` / `test` / `refactor`.
- **One feature, one commit**, with all gates green before committing.
- Push to `origin` (the GitHub primary). This project has no mirror repository.

```bash
git add .
git commit -m "feat: add xxx"
git push origin main
```

## 7. Versioning and releases

- Versions follow Semantic Versioning. To release:
  1. change `version` in `package.json`;
  2. refresh `package-lock.json` with `npm install --package-lock-only`;
  3. run `npm run build` to sync `src/version.generated.ts`;
  4. commit and push;
  5. create and push a tag (e.g. `v1.0.0`) → the `Release` workflow validates
     `tag == package.json == tarball`, requires a successful CI run for the same SHA, composes the body from the
     bilingual release notes and then **publishes directly** (`draft: false`);
  6. `npm publish --registry=https://registry.npmjs.org --access public`.
- Before releasing you **must** have `docs/release-v<version>.md` and `.en.md` in place — `release.yml` fails
  outright when a document is missing.
- Record every change in [CHANGELOG.en.md](CHANGELOG.en.md) (and the Chinese
  [CHANGELOG.md](CHANGELOG.md)).
- The complete release process lives in [docs/npm-publish-guide.en.md](docs/npm-publish-guide.en.md).

## 8. Adding an external AI agent

In most cases **no code change is needed** — add a profile to `agent-profiles.json` in the data home:

1. Consult the field reference in [docs/agent-profiles.en.md](docs/agent-profiles.en.md);
2. CLI agents: set `command` / `argsTemplate` / `promptMode` / `cwd`;
   GUI agents: set `driver: "gui"` plus the `gui` block;
3. Only if the output parsing carries special semantics (e.g. a non-zero exit code that still means success)
   implement an `AgentAdapter` and register it;
4. Self-check the executable discovery with `get_profiles`, then run one real task to acceptance.

## 9. Reporting issues

- Bugs / feature requests: use the repository issue templates (`.github/ISSUE_TEMPLATE/`).
- Security vulnerabilities: **do not** open a public issue; report privately following
  [SECURITY.en.md](SECURITY.en.md).

## 10. Code of conduct

By participating you agree to abide by [CODE_OF_CONDUCT.en.md](CODE_OF_CONDUCT.en.md).
