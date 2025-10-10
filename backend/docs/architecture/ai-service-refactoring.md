# AI 服務架構重構分析報告 by Sonnet3.5

## 目前架構分析

### 1. 現有元件職責

#### ProcessManager

- 主要負責管理 Claude Code 進程
- 處理進程生命週期(啟動、停止、中斷)
- 管理工作目錄與會話
- 處理訊息傳遞與事件發送
- 健康檢查與資源管理

#### UnifiedStreamProcessor

- 處理 Claude Code 的串流輸出
- 統一訊息處理與格式化
- 工具使用追蹤
- 訊息緩存與儲存

#### CodexService (新增)

- 處理 OpenAI Codex 相關功能
- 獨立的訊息處理邏輯
- 不同的介面與行為模式

### 2. 主要問題

1. **一致性缺失**

   - Claude Code 和 Codex 有不同的處理邏輯
   - 缺乏統一的介面規範
   - 事件處理機制不一致

2. **耦合度過高**

   - ProcessManager 與 Claude Code 緊密耦合
   - 難以擴展支援新的 AI 服務

3. **職責混亂**
   - ProcessManager 承擔過多責任
   - 缺乏明確的分層結構

## 建議架構

### 1. 核心抽象層

```typescript
// IAIProvider 介面
interface IAIProvider {
  initialize(): Promise<void>;
  sendMessage(sessionId: string, content: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
}

// IStreamProcessor 介面
interface IStreamProcessor {
  processMessage(message: any): void;
  handleToolUse(toolUse: any): void;
  cleanup(sessionId: string): void;
}

// SessionManager 介面
interface ISessionManager {
  createSession(options: SessionOptions): Promise<Session>;
  getSession(sessionId: string): Promise<Session>;
  updateSession(session: Session): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
```

### 2. 重構後的架構層次

```
src/
├── core/
│   ├── interfaces/         # 核心介面定義
│   ├── types/             # 共用類型定義
│   └── events/            # 事件定義
├── providers/
│   ├── base/              # 基礎提供者類別
│   ├── claude/            # Claude 相關實作
│   └── codex/            # Codex 相關實作
├── processors/
│   ├── base/             # 基礎處理器類別
│   ├── stream/           # 串流處理相關
│   └── tool/            # 工具處理相關
└── services/
    ├── session/          # 會話管理
    └── metrics/          # 監控指標
```

### 3. 改進建議

#### 3.1 建立統一的 Provider 系統

```typescript
// base/BaseAIProvider.ts
abstract class BaseAIProvider implements IAIProvider {
  protected sessionManager: ISessionManager;
  protected streamProcessor: IStreamProcessor;

  abstract initialize(): Promise<void>;
  abstract sendMessage(sessionId: string, content: string): Promise<void>;

  // 共用實作
  async interrupt(sessionId: string): Promise<void> {
    // 通用中斷邏輯
  }
}

// claude/ClaudeProvider.ts
class ClaudeProvider extends BaseAIProvider {
  async initialize(): Promise<void> {
    // Claude 特定初始化
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    // Claude 特定訊息處理
  }
}

// codex/CodexProvider.ts
class CodexProvider extends BaseAIProvider {
  async initialize(): Promise<void> {
    // Codex 特定初始化
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    // Codex 特定訊息處理
  }
}
```

#### 3.2 統一的串流處理

```typescript
// processors/base/BaseStreamProcessor.ts
abstract class BaseStreamProcessor implements IStreamProcessor {
  protected messageBuffer: MessageBuffer;

  abstract processMessage(message: any): void;

  // 共用的工具處理邏輯
  handleToolUse(toolUse: any): void {
    // 通用工具使用處理
  }
}
```

#### 3.3 會話管理優化

```typescript
// services/session/SessionManager.ts
class SessionManager implements ISessionManager {
  private sessions: Map<string, Session>;
  private provider: IAIProvider;

  async createSession(options: SessionOptions): Promise<Session> {
    const session = new Session(options);
    session.setProvider(this.provider);
    await this.sessions.set(session.id, session);
    return session;
  }

  // 其他會話管理方法
}
```

### 4. 遷移策略

1. **階段性實施**

   - 首先建立核心介面
   - 逐步將現有功能遷移到新架構
   - 保持向後兼容性

2. **優先順序**

   - 建立基礎抽象層
   - 實作共用元件
   - 遷移 Claude 相關功能
   - 整合 Codex 功能

3. **測試策略**
   - 為每個抽象層建立測試
   - 確保介面一致性
   - 驗證行為相容性

### 5. 預期效益

1. **更好的可維護性**

   - 清晰的職責分離
   - 統一的介面規範
   - 降低耦合度

2. **擴展性提升**

   - 容易添加新的 AI 提供者
   - 彈性的處理器架構
   - 統一的事件系統

3. **一致的使用體驗**
   - 統一的介面操作
   - 一致的事件處理
   - 標準化的錯誤處理

### 6. 注意事項

1. **相容性維護**

   - 確保現有功能不受影響
   - 提供平滑的遷移路徑

2. **效能考慮**

   - 抽象層不應影響效能
   - 保持串流處理效率

3. **錯誤處理**
   - 統一的錯誤處理機制
   - 明確的錯誤類型定義

## 結論

這個改進方案將建立一個更加統一和可維護的系統架構，使得不同的 AI 服務可以以一致的方式整合和使用。透過清晰的分層和介面設計，系統將更容易擴展和維護，同時確保使用者體驗的一致性。建議根據實際需求和資源狀況，逐步實施這些改變。
