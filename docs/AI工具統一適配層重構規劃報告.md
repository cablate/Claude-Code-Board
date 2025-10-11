# Claude-Code-Board - AI工具統一適配層重構 規劃報告

## 專案現況分析

### **技術棧**
- **後端**: Node.js + TypeScript + Express + SQLite + Socket.IO
- **前端**: React + TypeScript + Vite + Material-UI + Zustand
- **進程管理**: spawn + child_process + readline
- **串流處理**: 自定義 StreamProcessor + UnifiedStreamProcessor
- **資料庫**: SQLite3 + Knex.js ORM

### **架構模式**
- **分層架構**: Controller → Service → Repository → Database
- **事件驅動**: EventEmitter 為核心的進程通訊
- **串流處理**: 即時訊息串流 + 緩衝累積策略
- **模組化設計**: 各 Service 獨立職責分工

### **相關現有功能**
- **ProcessManager.ts**: 核心進程管理，高度綁定 ClaudeCode `npx` 呼叫
- **UnifiedStreamProcessor.ts**: 統一串流處理器，專門解析 Claude stream-json 格式
- **SessionService.ts**: Session 生命週期管理，依賴 ProcessManager
- **StreamProcessor.ts**: 舊版串流處理器（向後相容）

### **現有模式**
- **進程啟動**: `npx @anthropic-ai/claude-code@latest --output-format=stream-json`
- **訊息解析**: 專門處理 Claude 的 JSON 流格式（message_start, message_delta, tool_use 等）
- **事件傳播**: ProcessManager → SessionService → WebSocket → Frontend
- **狀態管理**: Session 狀態與進程狀態雙重追蹤

## 需求分析

### **任務類型**: 重構
### **核心需求**: 將 ClaudeCode 專用架構重構為統一、可擴充、前端無感知的 AI 工具適配層
### **複雜度評估**: XL （涉及核心架構變更、多模組協調、介面標準化）

## 規劃假設與驗證點

### **技術棧假設**
- 保持 Node.js + TypeScript 技術棧不變
- 前端與後端透過 WebSocket + REST API 通訊模式不變
- SQLite 資料庫儲存訊息、Session、配置等資料

### **架構假設**
- 現有的 Controller → Service → Repository 分層架構可延續
- EventEmitter 事件驅動模式適合多 AI 工具的統一事件處理
- Socket.IO 前端通訊機制可重用

### **資料流假設**
- 前端請求格式保持不變（CreateSessionRequest、SendMessage）
- 後端響應格式統一（ClaudeStreamMessage 介面可擴展為通用 AIStreamMessage）
- WebSocket 事件類型保持前端相容性

### **需人工驗證**
- [ ] 確認是否需要同時支援 CLI 工具（npx）和 API 呼叫兩種方式
- [ ] 確認新增 AI 工具的優先順序（Codex、Gemini、Copilot）
- [ ] 確認是否需要保留舊版 StreamProcessor 的相容性
- [ ] 確認前端是否需要知道當前使用的 AI 工具類型（顯示不同圖示等）

## 實作策略

### **建議方案**: 適配器模式 + 工廠模式的統一架構
1. **創建 AI 工具適配器介面** - 標準化不同 AI 工具的行為
2. **重構 ProcessManager** - 轉為 AI 工具管理器，支援多種工具切換
3. **統一訊息格式** - 將 ClaudeStreamMessage 抽象為通用 AIStreamMessage
4. **實作工具工廠** - 根據配置動態創建對應的 AI 工具實例
5. **保持前端透明** - 前端 API 和事件格式維持不變

### **主要影響檔案**
```
backend/src/
├── interfaces/
│   ├── IAITool.ts                    # AI工具統一介面
│   ├── IAIStreamProcessor.ts         # 串流處理統一介面
│   └── IAIMessage.ts                 # 通用訊息介面
├── adapters/
│   ├── ClaudeCodeAdapter.ts          # ClaudeCode適配器
│   ├── CodexAdapter.ts               # Codex適配器 (待實作)
│   ├── GeminiAdapter.ts              # Gemini適配器 (待實作)
│   └── CopilotAdapter.ts             # Copilot適配器 (待實作)
├── factories/
│   └── AIToolFactory.ts              # AI工具工廠
├── processors/
│   ├── UniversalStreamProcessor.ts   # 通用串流處理器
│   └── StreamAdapterRegistry.ts      # 串流適配器註冊表
├── services/
│   ├── ProcessManager.ts             # 重構為AIToolManager
│   ├── SessionService.ts             # 更新以支援多工具
│   └── AIConfigService.ts            # AI工具配置管理
└── types/
    ├── ai-tool.types.ts              # AI工具相關類型
    └── universal-message.types.ts    # 通用訊息類型
```

### **整合考量**
- **向下相容**: 保持現有 ClaudeCode 功能完全正常
- **配置驅動**: 透過配置檔案控制使用哪個 AI 工具
- **熱切換**: 支援 Session 級別的 AI 工具切換
- **錯誤隔離**: 單一 AI 工具故障不影響其他工具

### **架構影響**
- ProcessManager 轉為 AIToolManager，負責工具選擇和生命週期
- 新增適配器層，封裝各 AI 工具的特定行為
- 擴展 ClaudeStreamMessage 為 AIStreamMessage，支援更多訊息類型
- 配置層新增 AI 工具選擇和參數設定

## 風險評估

### **技術風險**
- **串流格式差異**: 不同 AI 工具的輸出格式可能差異很大
- **工具呼叫方式**: CLI vs API vs SDK 的整合複雜度
- **狀態同步**: 多工具間的狀態管理複雜性
- **效能影響**: 適配層可能增加額外的處理開銷

### **相容性風險**
- **前端相容**: 需確保前端零感知，現有功能不受影響
- **資料庫相容**: Session 和 Message 資料結構需向下相容
- **配置相容**: 現有的 ClaudeCode 配置需平滑遷移

### **效能影響**
- **訊息轉換開銷**: 適配層的訊息格式轉換
- **工具切換成本**: 不同工具間切換的初始化時間
- **記憶體佔用**: 多工具適配器同時載入的記憶體使用

### **依賴變更**
- **新增依賴**: 各 AI 工具的 SDK 或 CLI 工具
- **版本管理**: 不同 AI 工具版本的相容性維護
- **環境配置**: 各 AI 工具的 API Key 和環境設定

## 跨模組協調建議

### **影響模組**
- **Core Layer**: ProcessManager, SessionService, UnifiedStreamProcessor
- **Adapter Layer**: 新增的各種 AI 工具適配器
- **Interface Layer**: REST API, WebSocket 事件處理
- **Data Layer**: 資料庫 Schema 可能需要擴展
- **Config Layer**: 系統配置管理

### **協調順序**
1. **第一階段**: 建立介面和抽象層（IAITool, AIStreamMessage）
2. **第二階段**: 實作 ClaudeCode 適配器，保持現有功能
3. **第三階段**: 重構 ProcessManager 為 AIToolManager
4. **第四階段**: 實作其他 AI 工具適配器
5. **第五階段**: 整合測試和效能最佳化

### **接口契約**
```typescript
interface IAITool {
  start(session: Session): Promise<number>
  sendMessage(sessionId: string, content: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  getStatus(sessionId: string): ProcessStatus
}

interface AIStreamMessage {
  sessionId: string
  type: 'assistant' | 'user' | 'system' | 'tool_use' | 'thinking' | 'error'
  content: string
  timestamp: Date
  metadata?: {
    toolName?: string
    aiProvider?: 'claude' | 'codex' | 'gemini' | 'copilot'
    originalFormat?: any
  }
}
```

### **測試協調**
- **單元測試**: 各適配器獨立測試
- **整合測試**: AI 工具切換和狀態同步測試
- **回歸測試**: 確保 ClaudeCode 現有功能不受影響
- **效能測試**: 適配層開銷和多工具併發測試

## 給開發 Agent 的具體指引

### **【整合點】**
- `backend/src/services/ProcessManager.ts` - 重構為 AIToolManager
- `backend/src/services/SessionService.ts` - 更新建構函式以接受 AI 工具選擇
- `backend/src/types/process.types.ts` - 擴展為支援多 AI 工具
- `frontend/src/stores/sessionStore.ts` - 如需要可增加 AI 工具選擇功能

### **【參考實作】**
- `UnifiedStreamProcessor.ts` - 訊息處理和事件發送模式
- `StreamProcessor.ts` - 進程管理和錯誤處理策略
- `SessionService.ts` - Service 層的事件協調模式
- 現有的 Repository 模式 - 資料存取層的抽象方式

### **【行為契約】**
- 前端 API 格式完全不變，保持透明性
- WebSocket 事件類型維持相容，可擴展 metadata
- 資料庫 Schema 向下相容，可新增欄位但不修改現有
- 所有適配器必須實作 IAITool 介面的完整方法
- 錯誤處理統一透過 EventEmitter 向上傳播

### **【禁止事項】**
- 不可修改前端現有的 API 呼叫方式
- 不可移除現有的 ClaudeCode 相關功能
- 不可更改現有 Session 和 Message 的資料結構
- 不可破壞現有的事件監聽器設定
- 不可移除現有的配置選項

### **【測試策略】**
- 先確保 ClaudeCode 適配器與原有功能 100% 相容
- 建立 Mock AI 工具適配器進行介面測試
- 實作 E2E 測試確保前端完全無感知
- 效能基準測試確保適配層開銷可接受

## 關鍵問題 [UNCERTAIN]

1. **AI 工具選擇機制** - 是要在 Session 層級選擇，還是系統層級預設？
2. **工具鑑權方式** - 不同 AI 工具的 API Key 管理策略？
3. **串流格式差異** - 如何處理不支援串流的 AI 工具？
4. **並發限制** - 每個 AI 工具的並發 Session 數量限制？
5. **容錯策略** - AI 工具無法使用時的降級策略？
6. **費用追蹤** - 是否需要追蹤各 AI 工具的使用量和費用？

---

規劃完成時間: 2025-10-11 22:15 | 規劃 Agent: Planning-Agent