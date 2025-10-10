# Codex CLI 整合計畫

## 概述

本文件記錄如何在 Claude Code Board 系統中整合 OpenAI Codex CLI，參考 vibe-kanban 專案的實作方式。

## 參考專案分析：vibe-kanban

### Codex CLI 執行方式

**基礎命令：**
```bash
npx -y @openai/codex@0.46.0 app-server
```

**通訊協定：** JSON-RPC over stdin/stdout

### Codex 配置參數

根據 `vibe-kanban/crates/executors/src/executors/codex.rs` 和 `shared/schemas/codex.json`：

| 參數 | 類型 | 說明 | 可選值 |
|------|------|------|--------|
| `append_prompt` | string | 附加到提示詞的額外文字 | - |
| `sandbox` | enum | 沙盒模式 | `auto`, `read-only`, `workspace-write`, `danger-full-access` |
| `oss` | boolean | 是否使用開源模式 | true/false |
| `model` | string | 指定模型 | - |
| `model_reasoning_effort` | enum | 推理努力程度 | `low`, `medium`, `high` |
| `model_reasoning_summary` | enum | 推理摘要風格 | `auto`, `concise`, `detailed`, `none` |
| `model_reasoning_summary_format` | enum | 推理摘要格式 | `none`, `experimental` |
| `profile` | string | 使用的設定檔 | - |
| `base_instructions` | string | 基礎指令 | - |
| `include_plan_tool` | boolean | 是否包含規劃工具 | true/false |
| `include_apply_patch_tool` | boolean | 是否包含補丁套用工具 | true/false |

### Codex 執行流程

```
1. 建立 Process (shell)
   ↓
2. 執行 npx @openai/codex app-server
   ↓
3. 透過 stdin 發送 JSON-RPC 請求
   - initialize()
   - new_conversation(params)
   - add_conversation_listener()
   - send_user_message()
   ↓
4. 監聽 stdout 接收 JSON-RPC 回應
   - 解析事件 (codex/event)
   - 即時串流輸出
   ↓
5. Follow-up 支援
   - 使用 resume_conversation()
   - 透過 rollout file 恢復對話
```

### Session 管理

**新對話：**
```rust
client.new_conversation(NewConversationParams {
    model: Option<String>,
    profile: Option<String>,
    cwd: Some(working_dir),
    sandbox: Option<SandboxMode>,
    base_instructions: Option<String>,
    // ...
})
```

**續接對話：**
```rust
client.resume_conversation(rollout_path, overrides)
```

## 訊息統一化機制

### 核心問題

多種 CLI 工具（Claude Code, Codex, Gemini, Cursor 等）輸出格式各異，如何統一處理？

### Vibe-Kanban 的解決方案

#### 1. 統一訊息格式：NormalizedEntry

```typescript
interface NormalizedEntry {
  timestamp?: DateTime;
  entry_type: NormalizedEntryType;
  content: string;
  metadata?: any;
}
```

#### 2. 統一訊息類型：NormalizedEntryType

```typescript
enum NormalizedEntryType {
  AssistantMessage,      // AI 回覆訊息
  Thinking,              // AI 思考過程
  SystemMessage,         // 系統訊息
  ErrorMessage,          // 錯誤訊息
  ToolUse {              // 工具使用
    tool_name: string,
    action_type: ActionType,
    status: ToolStatus
  }
}
```

#### 3. 統一動作類型：ActionType

```typescript
enum ActionType {
  CommandRun {           // 執行命令
    command: string,
    result?: CommandRunResult
  },
  FileEdit {             // 編輯檔案
    path: string,
    changes: FileChange[]
  },
  FileRead {             // 讀取檔案
    path: string
  },
  WebFetch {             // 網路請求
    url: string
  },
  Tool {                 // MCP 工具呼叫
    tool_name: string,
    arguments: any,
    result?: ToolResult
  },
  TodoManagement {       // 待辦事項管理
    todos: TodoItem[],
    operation: string
  }
}
```

#### 4. 工具狀態：ToolStatus

```typescript
enum ToolStatus {
  Created,     // 已建立
  Success,     // 成功
  Failed       // 失敗
}
```

### Codex 訊息轉換範例

**原始 Codex 事件 → NormalizedEntry 轉換：**

| Codex 事件 | 轉換為 |
|-----------|--------|
| `AgentMessageDelta` | `AssistantMessage` |
| `AgentReasoningDelta` | `Thinking` |
| `ExecCommandBegin/End` | `ToolUse::CommandRun` |
| `PatchApplyBegin/End` | `ToolUse::FileEdit` |
| `McpToolCallBegin/End` | `ToolUse::Tool` |
| `WebSearchBegin/End` | `ToolUse::WebFetch` |
| `ViewImageToolCall` | `ToolUse::FileRead` |
| `PlanUpdate` | `ToolUse::TodoManagement` |
| `StreamError` | `ErrorMessage` |
| `BackgroundEvent` | `SystemMessage` |

### 轉換機制

```rust
// Rust 實作概念
trait ToNormalizedEntry {
    fn to_normalized_entry(&self) -> NormalizedEntry;
}

// 每個 CLI 特定的狀態都實作此 trait
impl ToNormalizedEntry for CommandState {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "bash".to_string(),
                action_type: ActionType::CommandRun {
                    command: self.command.clone(),
                    result: Some(self.build_result())
                },
                status: self.status.clone()
            },
            content: format!("`{}`", self.command),
            metadata: None
        }
    }
}
```

### normalize_logs 處理流程

```
1. 監聽 stdout/stderr 串流
   ↓
2. 逐行解析原始輸出
   ↓
3. 根據 CLI 類型識別訊息格式
   - Codex: JSON-RPC notification
   - Claude Code: SSE 格式
   - 其他: 各自特定格式
   ↓
4. 提取事件資料
   ↓
5. 轉換為 NormalizedEntry
   ↓
6. 推送到 MsgStore
   ↓
7. 透過 SSE 傳送到前端
```

### 前端統一處理

前端只需處理 `NormalizedEntry`，完全不用關心原始 CLI 的差異：

```typescript
// 前端只需要這樣處理
eventSource.onmessage = (event) => {
  const entry: NormalizedEntry = JSON.parse(event.data);

  switch (entry.entry_type) {
    case 'AssistantMessage':
      renderAssistantMessage(entry.content);
      break;
    case 'ToolUse':
      renderToolUse(entry.entry_type.tool_name, entry.entry_type.action_type);
      break;
    // ...
  }
};
```

## 整合方案設計

### 階段一：資料庫設計

**擴充 sessions 表：**

```sql
ALTER TABLE sessions ADD COLUMN cli_type TEXT DEFAULT 'claude-code';
-- cli_type: 'claude-code' | 'codex'

-- Codex 特定參數（JSON 格式）
ALTER TABLE sessions ADD COLUMN codex_config TEXT;
-- 儲存格式：
{
  "sandbox": "auto",
  "model": "gpt-4",
  "model_reasoning_effort": "medium",
  "oss": false,
  "profile": null,
  "base_instructions": null
}
```

### 階段二：後端架構

**1. 建立 CodexService**

```typescript
// backend/src/services/CodexService.ts
class CodexService {
  async executeCodex(params: {
    workingDir: string;
    prompt: string;
    config?: CodexConfig;
  }): Promise<ChildProcess> {
    // 建立 npx codex app-server 指令
    // 透過 JSON-RPC 通訊
    // 返回 process
  }

  async followUp(sessionId: string, prompt: string): Promise<ChildProcess> {
    // 使用 resume_conversation
  }
}
```

**2. 統一訊息格式層**

```typescript
// backend/src/services/MessageNormalizer.ts
interface NormalizedMessage {
  timestamp?: Date;
  type: 'assistant' | 'thinking' | 'system' | 'error' | 'tool';
  content: string;
  toolInfo?: {
    name: string;
    action: ActionType;
    status: 'created' | 'success' | 'failed';
  };
}

class CodexNormalizer {
  normalize(rawMessage: string): NormalizedMessage | null {
    // 解析 Codex JSON-RPC 事件
    // 轉換為 NormalizedMessage
  }
}

class ClaudeCodeNormalizer {
  normalize(rawMessage: string): NormalizedMessage | null {
    // 解析 Claude Code 輸出
    // 轉換為 NormalizedMessage
  }
}
```

**3. 統一執行器介面**

```typescript
// backend/src/services/ExecutorService.ts
interface CLIExecutor {
  execute(params: ExecuteParams): Promise<ChildProcess>;
  followUp(sessionId: string, prompt: string): Promise<ChildProcess>;
  normalize(rawMessage: string): NormalizedMessage | null;
}

class ClaudeCodeExecutor implements CLIExecutor { ... }
class CodexExecutor implements CLIExecutor { ... }

class ExecutorService {
  getExecutor(cliType: 'claude-code' | 'codex'): CLIExecutor {
    return cliType === 'codex'
      ? new CodexExecutor()
      : new ClaudeCodeExecutor();
  }
}
```

### 階段三：前端整合

**1. 擴充 CreateSessionModal**

```typescript
// 加入 CLI 類型選擇
<select name="cli_type">
  <option value="claude-code">Claude Code</option>
  <option value="codex">OpenAI Codex</option>
</select>

// 條件式顯示參數設定
{cliType === 'codex' && (
  <CodexConfigPanel
    config={codexConfig}
    onChange={setCodexConfig}
  />
)}
```

**2. 建立 CodexConfigPanel**

```typescript
// frontend/src/components/Session/CodexConfigPanel.tsx
interface CodexConfigPanelProps {
  config: CodexConfig;
  onChange: (config: CodexConfig) => void;
}

// 提供 UI 設定：
// - Sandbox 模式
// - Model 選擇
// - Reasoning effort
// - 其他進階選項
```

**3. 前端訊息處理統一化**

```typescript
// frontend/src/components/Session/SessionOutput.tsx
function renderNormalizedMessage(message: NormalizedMessage) {
  switch (message.type) {
    case 'assistant':
      return <AssistantMessage content={message.content} />;
    case 'thinking':
      return <ThinkingBlock content={message.content} />;
    case 'tool':
      return <ToolExecution info={message.toolInfo} />;
    case 'error':
      return <ErrorMessage content={message.content} />;
    case 'system':
      return <SystemMessage content={message.content} />;
  }
}
```

### 階段四：API 設計

**建立 Session（支援 CLI 類型）**

```
POST /api/sessions
{
  "name": "測試任務",
  "workingDir": "/path/to/project",
  "task": "實作功能",
  "cli_type": "codex",
  "codex_config": {
    "sandbox": "workspace-write",
    "model": "gpt-4",
    "model_reasoning_effort": "high"
  }
}
```

**輸出串流（統一格式）**

```
GET /api/sessions/:id/stream
Server-Sent Events:

data: {"type":"assistant","content":"開始分析...","timestamp":"..."}

data: {"type":"tool","content":"執行命令","toolInfo":{"name":"bash","action":{"type":"command_run","command":"ls -la"},"status":"created"}}

data: {"type":"tool","content":"執行命令","toolInfo":{"name":"bash","status":"success"}}
```

## 實作優先順序

### Phase 1: 基礎整合（必要）
1. ✅ 資料庫 schema 擴充（cli_type, codex_config）
2. ✅ 建立 CodexService 基本執行功能
3. ✅ 前端加入 CLI 類型選擇器
4. ✅ 基本的訊息輸出（不轉換，原始顯示）

### Phase 2: 訊息統一化（重要）
1. ✅ 定義 NormalizedMessage 介面
2. ✅ 實作 CodexNormalizer
3. ✅ 重構 ClaudeCodeService 使用統一格式
4. ✅ 前端改用統一格式渲染

### Phase 3: 完整參數支援（優化）
1. ⬜ CodexConfigPanel UI
2. ⬜ 參數驗證與預設值
3. ⬜ 參數說明與文件

### Phase 4: 進階功能（未來）
1. ⬜ Follow-up 對話支援
2. ⬜ Session fork 功能
3. ⬜ MCP 工具整合
4. ⬜ 多 CLI 效能比較

## 技術細節

### Codex JSON-RPC 通訊範例

**Initialize:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

**New Conversation:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "newConversation",
  "params": {
    "cwd": "/path/to/project",
    "model": "gpt-4",
    "sandbox": "workspace-write"
  }
}
```

**Send Message:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "sendUserMessage",
  "params": {
    "conversationId": "abc-123",
    "message": "請幫我實作登入功能"
  }
}
```

**Events (Notification):**
```json
{
  "jsonrpc": "2.0",
  "method": "codex/event",
  "params": {
    "msg": {
      "AgentMessageDelta": {
        "delta": "我將幫你實作..."
      }
    }
  }
}
```

### 錯誤處理

1. **CLI 不存在**
   - 檢查 `npx @openai/codex` 是否可用
   - 前端顯示安裝指引

2. **參數驗證**
   - Sandbox 模式限制
   - Model 可用性檢查

3. **通訊錯誤**
   - JSON-RPC 解析失敗
   - stdin/stdout 斷線處理

4. **Session 恢復失敗**
   - Rollout file 不存在
   - 降級為新對話

## 參考資料

- Vibe-Kanban Codex 實作：`F:\_Program\OwnProject\_My_AI\_Claude-Code-Board\vibe-kanban\crates\executors\src\executors\codex.rs`
- Codex Schema：`F:\_Program\OwnProject\_My_AI\_Claude-Code-Board\vibe-kanban\shared\schemas\codex.json`
- Normalize Logs：`F:\_Program\OwnProject\_My_AI\_Claude-Code-Board\vibe-kanban\crates\executors\src\executors\codex\normalize_logs.rs`
- OpenAI Codex 官方文件：https://github.com/openai/codex

## 總結

透過參考 vibe-kanban 的實作，我們的整合策略是：

1. **統一訊息格式**：所有 CLI 輸出轉換為 `NormalizedMessage`
2. **執行器模式**：每個 CLI 實作統一的 `CLIExecutor` 介面
3. **前端不知情**：前端只處理統一格式，完全不管使用哪個 CLI
4. **漸進式整合**：先基礎功能，再逐步完善參數與進階功能

這樣的架構設計讓我們可以：
- ✅ 輕鬆加入新的 CLI 工具
- ✅ 前端程式碼保持簡潔
- ✅ 測試與維護更容易
- ✅ 使用者體驗一致
