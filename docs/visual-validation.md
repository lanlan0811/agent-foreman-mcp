# 视觉验收验证状态（visual-validation.md）

[English](visual-validation.en.md)

本文档说明**视觉验收能力的验证口径**：哪些部分由 CI 持续验证、哪些需要真机人工确认、当前覆盖边界在哪。

> 历史上按机器/日期留存的原始证据文件（含截图与日志）已不属于本仓库——本仓库自 1.0.0 起以**可复现的 CI 矩阵**作为验证事实来源，而非一次性的人工记录。

## 一、验证事实来源：CI visual-browser 矩阵

真实浏览器与图像验收在 CI 上按平台 × Node 版本矩阵执行（`.github/workflows/ci.yml` 的 `visual-browser` job）：

| 维度 | 取值 |
|---|---|
| 操作系统 | `ubuntu-latest`、`windows-latest`、`macos-15-intel`、`macos-15` |
| Node | 20、22、24 |
| 开关 | `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1` |
| 用例 | `npx vitest run visual --maxWorkers=1` |

该 job 还额外做两件事，确保**分发包**（而非仅源码）也能通过视觉验收：

1. **固定版本浏览器安装**：通过 `node dist/index.js visual browser install` 安装受管浏览器；
2. **生产 tarball 消费者验收**：`npm pack` → 装进干净目录 → 由 `scripts/check-visual-consumer.mjs` 拉起并对真实项目做视觉验收。

本地复算同一套用例：

```bash
AGENT_FOREMAN_VISUAL_BROWSER_TEST=1 npx vitest run visual --maxWorkers=1
```

未设置 `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1` 时，这些用例会被**跳过**（不计入失败），因此在普通 `npm test` 中不出现——这是有意设计，避免无浏览器环境误报。

## 二、覆盖的能力

CI 矩阵中的真实浏览器用例覆盖：

- 受管浏览器安装与启动（含 Linux 沙箱所需的 AppArmor 配置）；
- 真实页面捕获与截图落盘；
- 像素比对（`pixelmatch`）与差异图产出；
- 基线候选准备 → 用户批准 → 冻结的完整流程；
- 视觉阻塞（缺基准、页面不可达、资源被策略拦截）不触发 agent 返修、`rework_task` 先重新验收的语义；
- 离线 HTML 报告产出（并排 / 叠加 / 区域定位）。

## 三、平台注意事项

| 平台 | 注意事项 |
|---|---|
| **Linux (Ubuntu)** | Chrome 沙箱需要 user namespace。CI 中通过写入 AppArmor profile（`agent-foreman-visual-chrome`）放行；自建环境若遇启动失败，先确认该前置 |
| **Windows** | 受管浏览器与 `visual browser install` 已验证；注意 PATH 中 node/npx 可用 |
| **macOS** | 与 Intel / Apple Silicon 均覆盖；`/tmp` 的真实路径为 `/private/tmp`（涉及路径比较时以 realpath 为准） |

## 四、已知限制

- **真机 GUI 驱动不在本矩阵覆盖范围内**：视觉验收的浏览器侧由 CI 覆盖，但 Codex / TraeWork / ZCode 的 **GUI 驱动**（CDP 控制桌面端）需要真实安装与登录，无法在 CI 上跑；这部分以本机人工验证为准，见 `docs/codex-gui-cdp.md`、`docs/traework-cdp.md`、`docs/zcode-cdp.md`。
- **视觉验收依赖可复现的渲染**：字体、缩放、动画与异步加载会造成像素抖动。遇到不稳定的用例，优先缩小检查区域或固定动画，而不是放宽阈值（后者会掩盖真实缺陷）。
- **AI 内容校验（`visual.contents[]` / `pages[].content`）默认仅告警**：其结论依赖用户自备的本地判定命令，MCP 不内置模型客户端，因此只由 `blocking: true` 的规则致败。
- **基准必须由用户审阅批准**：自动化流程只能生成候选，不能自行批准（`VISUAL_INTEGRITY` 会检出绕过尝试）。

## 五、维护指引

- 新增视觉能力时，**同时**在 CI 矩阵用例中加覆盖；只写代码不加用例不算完成。
- 修改视觉用例的开关或环境变量名时，需同步 `.github/workflows/ci.yml` 与相关脚本两侧，否则矩阵会静默跳过（表现为"绿但没跑"）。
- 本文件只描述**验证口径与边界**；具体配置写法见 `docs/visual-acceptance.md`。
