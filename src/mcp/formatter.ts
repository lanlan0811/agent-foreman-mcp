/**
 * formatter：统一结果文本 + ---agent-foreman-meta--- JSON 块拼装（开发计划 §5）。
 * meta 块固定以 ---agent-foreman-meta--- 起止行包裹，MCP 宿主可正则抽取。
 * ToolResult 使用 type alias（带隐式索引签名），以匹配官方 SDK 的 CallToolResult。
 */
import { z } from "zod";
import type { TaskMeta } from "../tasks/task.js";

export interface MetaBlockFields {
  ok: boolean;
  taskId?: string;
  status?: string;
  agentId?: string;
  projectPath?: string;
  /** GUI 类 agent 使用的模型（traework） */
  model?: string;
  /** GUI 类 agent 使用的面板模式（traework：Work/Code/Design） */
  mode?: string;
  round?: number;
  checks?: { name: string; passed: boolean; durationMs: number }[];
  changedFiles?: string[];
  diffstat?: string;
  reportFiles?: { md?: string; json?: string };
  logFile?: string;
  message: string;
  errorType?: string;
  cancelReason?: string;
  cancelRequestedAt?: string;
  abortSource?: string;
  finishedAt?: string;
  reportRound?: number;
  verificationSource?: string;
  latestVerificationVerdict?: string;
  agentEndReason?: string;
  keptInstance?: boolean;
  needsUserKind?: string;
  pendingQuestion?: string;
  zcodeSessionId?: string;
  boundProjectPath?: string;
  modelProvider?: string;
  permissionMode?: string;
  progressSummary?: string;
  lastRunSignal?: string;
}

/**
 * MetaBlockFields 的字段名清单（单一事实来源，供协议测试显式断言与文档对齐）。
 * 契约纪律：结构化返回的**顶层必须保持稳定、字段只增不改不换名**——一旦声明
 * outputSchema，客户端会按其校验，改名字段即等于破坏已发布的返回契约。
 */
export const META_BLOCK_FIELDS = [  "ok",
  "taskId",
  "status",
  "agentId",
  "projectPath",
  "model",
  "mode",
  "round",
  "checks",
  "changedFiles",
  "diffstat",
  "reportFiles",
  "logFile",
  "message",
  "errorType",
  "cancelReason",
  "cancelRequestedAt",
  "abortSource",
  "finishedAt",
  "reportRound",
  "verificationSource",
  "latestVerificationVerdict",
  "agentEndReason",
  "keptInstance",
  "needsUserKind",
  "pendingQuestion",
  "zcodeSessionId",
  "boundProjectPath",
  "modelProvider",
  "permissionMode",
  "progressSummary",
  "lastRunSignal",
] as const;

/**
 * 工具 outputSchema（宽松形状：字段**全部可选**，不设必填）。
 *
 * 设计理由（M2/D7）：声明 outputSchema 后客户端会按其校验 structuredContent，
 * 不符即拒绝。契约纪律要求「顶层对象稳定、字段只增不改不换名」，因此这里只声明
 * 已知字段为**可选**，并允许 passthrough 承载未来新增字段与视觉基准类工具的自由
 * 结果对象（{ ok, message, result }），避免加字段即破坏兼容。
 */
export const TOOL_OUTPUT_SHAPE = {
  ok: z.boolean().optional(),
  taskId: z.string().optional(),
  status: z.string().optional(),
  agentId: z.string().optional(),
  projectPath: z.string().optional(),
  model: z.string().optional(),
  mode: z.string().optional(),
  round: z.number().optional(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), durationMs: z.number() })).optional(),
  changedFiles: z.array(z.string()).optional(),
  diffstat: z.string().optional(),
  reportFiles: z.object({ md: z.string().optional(), json: z.string().optional() }).optional(),
  logFile: z.string().optional(),
  message: z.string().optional(),
  errorType: z.string().optional(),
  cancelReason: z.string().optional(),
  cancelRequestedAt: z.string().optional(),
  abortSource: z.string().optional(),
  finishedAt: z.string().optional(),
  reportRound: z.number().optional(),
  verificationSource: z.string().optional(),
  latestVerificationVerdict: z.string().optional(),
  agentEndReason: z.string().optional(),
  keptInstance: z.boolean().optional(),
  needsUserKind: z.string().optional(),
  pendingQuestion: z.string().optional(),
  zcodeSessionId: z.string().optional(),
  boundProjectPath: z.string().optional(),
  modelProvider: z.string().optional(),
  permissionMode: z.string().optional(),
  progressSummary: z.string().optional(),
  lastRunSignal: z.string().optional(),
  result: z.unknown().optional(),
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /**
   * MCP 标准结构化返回（双轨契约，D7）：与 meta 块同源（同一对象双投递）。
   * 规范要求必须是 JSON 对象；声明 outputSchema 后客户端会按其校验。
   */
  structuredContent?: Record<string, unknown>;
};

export function textResult(
  text: string,
  isError = false,
  structuredContent?: Record<string, unknown>,
): ToolResult {
  return { content: [{ type: "text", text }], isError, structuredContent };
}

/** 错误路径：结构化返回至少含 ok:false 与 message（M2 契约要求） */
export function errorResult(msg: string): ToolResult {
  return textResult(`Error: ${msg}`, true, { ok: false, message: msg });
}

/** 摘要文本 + meta 块，返回 ToolResult；同一 meta 对象同时作为 structuredContent 投递 */
export function formatToolResult(text: string, meta: MetaBlockFields): ToolResult {
  const block = `---agent-foreman-meta---\n${JSON.stringify(meta, null, 2)}\n---agent-foreman-meta---`;
  return textResult(`${text}\n${block}`, false, meta as unknown as Record<string, unknown>);
}

export function metaFromTask(meta: TaskMeta, extra?: Partial<MetaBlockFields>): MetaBlockFields {
  const ok = meta.status === "succeeded";
  return {
    ok,
    taskId: meta.taskId,
    status: meta.status,
    agentId: meta.agentId,
    projectPath: meta.projectPath,
    model: meta.model,
    mode: meta.mode,
    round: meta.roundsUsed,
    changedFiles: meta.changedFiles,
    diffstat: meta.diffstat,
    reportFiles:
      meta.reportMd || meta.reportJson ? { md: meta.reportMd, json: meta.reportJson } : undefined,
    logFile: meta.logFile,
    message: meta.lastMessage ?? "",
    errorType: meta.errorType ?? undefined,
    cancelReason: meta.cancelReason,
    cancelRequestedAt: meta.cancelRequestedAt,
    abortSource: meta.abortSource,
    finishedAt: meta.finishedAt,
    reportRound: meta.reportRound,
    verificationSource: meta.verificationSource,
    latestVerificationVerdict: meta.latestVerificationVerdict,
    agentEndReason: meta.agentEndReason,
    keptInstance: meta.keptInstance,
    needsUserKind: meta.needsUserKind,
    pendingQuestion: meta.pendingQuestion,
    zcodeSessionId: meta.zcodeSessionId,
    boundProjectPath: meta.boundProjectPath,
    modelProvider: meta.modelProvider,
    permissionMode: meta.permissionMode,
    progressSummary: meta.progressSummary,
    lastRunSignal: meta.lastRunSignal,
    ...extra,
  };
}

/** 从一行 agent log 取尾部（供 query_task） */
export async function readLogTail(logFile: string, tailLines: number): Promise<string> {
  const { readTextSafe } = await import("../util/fs.js");
  const text = (await readTextSafe(logFile)) ?? "";
  const lines = text.split("\n");
  if (lines.length <= tailLines) return text;
  return lines.slice(-tailLines).join("\n");
}
