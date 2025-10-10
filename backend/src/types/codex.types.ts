/**
 * Codex CLI 相關型別定義
 * 參考：vibe-kanban/shared/schemas/codex.json
 */

export enum SandboxMode {
  Auto = "auto",
  ReadOnly = "read-only",
  WorkspaceWrite = "workspace-write",
  DangerFullAccess = "danger-full-access",
}

export enum ReasoningEffort {
  Low = "low",
  Medium = "medium",
  High = "high",
}

export enum ReasoningSummary {
  Auto = "auto",
  Concise = "concise",
  Detailed = "detailed",
  None = "none",
}

export enum ReasoningSummaryFormat {
  None = "none",
  Experimental = "experimental",
}

export interface CodexConfig {
  // 沙盒模式
  sandbox?: SandboxMode;

  // 模型設定
  model?: string;
  model_reasoning_effort?: ReasoningEffort;
  model_reasoning_summary?: ReasoningSummary;
  model_reasoning_summary_format?: ReasoningSummaryFormat;

  // 其他設定
  oss?: boolean;
  profile?: string | null;
  base_instructions?: string | null;
  include_plan_tool?: boolean;
  include_apply_patch_tool?: boolean;
  append_prompt?: string | null;
}

export interface CodexExecuteParams {
  workingDir: string;
  prompt: string;
  config?: CodexConfig;
  conversationId?: string; // 用於續接對話
}

// JSON-RPC 相關型別

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

// Codex 事件型別（從 vibe-kanban normalize_logs.rs 參考）

export interface CodexEvent {
  msg: CodexEventType;
}

export type CodexEventType = { AgentMessageDelta: { delta: string } } | { AgentReasoningDelta: { delta: string } } | { ExecCommandBegin: { command: string; working_dir: string } } | { ExecCommandEnd: { command: string; exit_code: number; output?: string } } | { PatchApplyBegin: { path: string } } | { PatchApplyEnd: { path: string; success: boolean } } | { McpToolCallBegin: { tool_name: string; server_name: string } } | { McpToolCallEnd: { tool_name: string; success: boolean } } | { WebSearchBegin: { query: string } } | { WebSearchEnd: { query: string; results_count: number } } | { ViewImageToolCall: { path: string } } | { PlanUpdate: { todos: TodoItem[] } } | { StreamError: { error: string } } | { BackgroundEvent: { message: string } };

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// 統一訊息格式（參考 vibe-kanban）

export interface NormalizedEntry {
  timestamp?: Date;
  entry_type: NormalizedEntryType;
  content: string;
  metadata?: any;
}

export type NormalizedEntryType = "AssistantMessage" | "Thinking" | "SystemMessage" | "ErrorMessage" | { ToolUse: ToolUseInfo };

export interface ToolUseInfo {
  tool_name: string;
  action_type: ActionType;
  status: ToolStatus;
}

export type ActionType = { CommandRun: { command: string; result?: CommandRunResult } } | { FileEdit: { path: string; changes: FileChange[] } } | { FileRead: { path: string } } | { WebFetch: { url: string } } | { Tool: { tool_name: string; arguments: any; result?: any } } | { TodoManagement: { todos: TodoItem[]; operation: string } };

export interface CommandRunResult {
  exit_code: number;
  output?: string;
  error?: string;
}

export interface FileChange {
  line: number;
  old_content: string;
  new_content: string;
}

export enum ToolStatus {
  Created = "created",
  Success = "success",
  Failed = "failed",
}
