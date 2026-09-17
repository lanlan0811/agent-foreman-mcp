/**
 * 协议级测试：官方 SDK client 连接 in-memory transport 后的 server。
 * 断言 11 个工具可见、调用返回格式（文本 + meta 块 + structuredContent 双轨 / 参数校验错误）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, callTool, parseMeta, rmrf, type TestServer } from "../test-utils.js";
import { TOOL_DEFS } from "../../src/mcp/tools.js";
import { META_BLOCK_FIELDS } from "../../src/mcp/formatter.js";
import pkg from "../../package.json" with { type: "json" };

let ts: TestServer;

beforeAll(async () => {
  ts = await startTestServer();
}, 60_000);
afterAll(async () => {
  await ts?.close();
  if (ts) await rmrf(ts.home);
});

describe("服务版本", () => {
  it("MCP serverInfo.version 等于 package.json.version（单一版本源，S4）", async () => {
    const info = ts.client.getServerVersion()!;
    expect(info.name).toBe("agent-foreman-mcp");
    expect(info.version).toBe(pkg.version);
  });
});

describe("工具 annotations（S4/S6：直接断言真实 tools/list）", () => {
  it("read 类工具 readOnlyHint=true，write 类 false；cancel/rework destructiveHint=true", async () => {
    const tools = await ts.client.listTools();
    const byName = new Map(tools.tools.map((t) => [t.name, t]));
    // 读类
    for (const name of ["query_task", "list_tasks", "get_task_report", "get_profiles"]) {
      expect(byName.get(name)?.annotations?.readOnlyHint, `${name} readOnly`).toBe(true);
    }
    // 写类
    for (const name of ["run_task", "cancel_task", "rework_task", "continue_task", "verify_task"]) {
      const ann = byName.get(name)?.annotations;
      if (name === "verify_task") {
        expect(ann?.readOnlyHint).toBe(true); // read 能力
      } else {
        expect(ann?.readOnlyHint).toBe(false);
      }
    }
    // destructive
    expect(byName.get("cancel_task")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("rework_task")?.annotations?.destructiveHint).toBe(true);
    // openWorld：仅 run_task
    expect(byName.get("run_task")?.annotations?.openWorldHint).toBe(true);
    expect(byName.get("query_task")?.annotations?.openWorldHint).toBe(false);
  });
});

describe("工具面", () => {
  it("注册 11 个工具且名称与能力标注符合视觉验收计划", async () => {
    const tools = await ts.client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "approve_visual_baseline",
      "cancel_task",
      "continue_task",
      "get_profiles",
      "get_task_report",
      "list_tasks",
      "prepare_visual_baseline",
      "query_task",
      "rework_task",
      "run_task",
      "verify_task",
    ]);
    // 每个工具在 TOOL_DEFS 有声明
    for (const t of tools.tools) {
      const def = TOOL_DEFS.find((d) => d.name === t.name);
      expect(def, `工具 ${t.name} 缺声明`).toBeDefined();
      expect(def!.inputSchema).toBeDefined();
      expect(["read", "write", "execute", "network"]).toContain(def!.capability);
    }
  });

  it("continue_task 是需审批的写工具", () => {
    const def = TOOL_DEFS.find((d) => d.name === "continue_task");
    expect(def?.capability).toBe("write");
    expect(def?.requireApproval).toBe(true);
  });

  it("视觉基准工具公开有副作用与宿主审批元数据", async () => {
    const { tools } = await ts.client.listTools();
    for (const name of ["prepare_visual_baseline", "approve_visual_baseline"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations?.readOnlyHint).toBe(false);
      expect(tool?._meta?.requireApproval).toBe(true);
    }
    expect(tools.find((t) => t.name === "approve_visual_baseline")?.annotations?.destructiveHint).toBe(true);
  });

  it("get_profiles 返回文本 + 可解析 meta 块", async () => {
    const { text } = await callTool(ts.client, "get_profiles", {});
    const { meta } = parseMeta(text);
    expect(meta).not.toBeNull();
    expect(meta!.ok).toBe(true);
    expect(text).toContain("stub");
    expect(text).toContain("zcode");
    expect(text).toContain("driver=gui");
    expect(text).toContain("profileStatus=research");
  });

  it("list_tasks 空表也返回合法格式", async () => {
    const { text } = await callTool(ts.client, "list_tasks", {});
    const { meta } = parseMeta(text);
    expect(meta!.ok).toBe(true);
  });

  it("参数校验：run_task 缺 projectPath 时协议层放行，由语义层拒绝不支持的 agent", async () => {
    // 显式用 stub agent（startTestServer 已注入其 profile）：若依赖默认 agent=codex，
    // 断言会随「本机装了 codex / CI 没装」两条路径分叉，测试就不再跨平台确定。
    const res = await ts.client.callTool({
      name: "run_task",
      arguments: { agentId: "stub", task: "没有项目路径" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[]).map((c) => c.text).join("\n");
    // issue #12：projectPath 已可选——协议层必须放行（不再 -32602 / 参数不合法），
    // 由语义层说明「该 agent 需要 projectPath」，且绝不真的提交任务。
    expect(text).not.toMatch(/-32602|参数不合法|Invalid arguments|Input validation/i);
    expect(text).toMatch(/需要 projectPath/);
    expect(text).toMatch(/仅支持 ZCode/);
    expect(text).not.toMatch(/任务已提交/);
  });

  it("参数校验：不存在目录被拒绝", async () => {
    const res = await ts.client.callTool({
      name: "run_task",
      arguments: { projectPath: "D:/__definitely_not_exists__/x", task: "xx" },
    });
    expect(res.isError).toBe(true);
  });
});

describe("双轨返回契约（D7/M2：文本 + meta 块 + structuredContent）", () => {
  it("成功路径：文本含 meta 块，且 structuredContent 与 meta 同源", async () => {
    const { res, text } = await callTool(ts.client, "get_profiles", {});
    const { meta } = parseMeta(text);
    expect(meta).not.toBeNull();
    // 三要素之一：structuredContent 存在
    const sc = (res as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc, "成功路径必须返回 structuredContent").toBeDefined();
    // 同一 meta 对象双投递（单一事实来源）：字段逐一相等
    expect(sc).toEqual(meta);
  });

  it("错误路径：文本报错，且 structuredContent 至少含 ok:false 与 message", async () => {
    const { res, text } = await callTool(ts.client, "get_task_report", { taskId: "tsk_not_exist" });
    expect(res.isError).toBe(true);
    expect(text).toMatch(/Error:/);
    const sc = (res as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc, "错误路径同样必须返回 structuredContent").toBeDefined();
    expect(sc!.ok).toBe(false);
    expect(typeof sc!.message).toBe("string");
    expect(sc!.message).toBeTruthy();
  });

  it("handler 抛异常（server 层 catch 直返）也具备 structuredContent", async () => {
    // 用 schema 合法的参数触发 handler 内部异常（realpath 失败），走 server.ts 的 catch 分支。
    // 注意区分：**schema 级**非法参数由 SDK 在协议层拦截（JSON-RPC -32602，属协议错误，
    // 协议上不可能携带 structuredContent）；此处覆盖的是我们自己的 catch 错误路径。
    const res = await ts.client.callTool({
      name: "prepare_visual_baseline",
      arguments: { projectPath: "D:/__definitely_not_exists__/xyz" },
    });
    expect(res.isError).toBe(true);
    const sc = (res as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc, "server.ts catch 分支必须提供 structuredContent").toBeDefined();
    expect(sc!.ok).toBe(false);
    expect(typeof sc!.message).toBe("string");
    expect(sc!.message).toBeTruthy();
  });

  it("structuredContent 字段名契约：meta 块字段落在声明的稳定清单内（防改名）", async () => {
    const { text } = await callTool(ts.client, "get_profiles", {});
    const { meta } = parseMeta(text);
    expect(meta).not.toBeNull();
    const known = new Set<string>(META_BLOCK_FIELDS);
    const unknown = Object.keys(meta!).filter((k) => !known.has(k));
    // 新增字段必须同步登记进 META_BLOCK_FIELDS（顶层稳定、字段只增不改不换名）
    expect(unknown, `未登记的 meta 字段（请同步 META_BLOCK_FIELDS）: ${unknown.join(", ")}`).toEqual([]);
  });

  it("工具声明了 outputSchema（现代宿主可据此消费结构化返回）", async () => {
    const res = await ts.client.listTools();
    for (const tool of res.tools) {
      expect(tool.outputSchema, `工具 ${tool.name} 应声明 outputSchema`).toBeDefined();
      expect(typeof tool.outputSchema).toBe("object");
    }
  });
});
