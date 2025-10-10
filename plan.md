 Codex 整合設計

  - 把 CodexService 裡原本用 npx @openai/codex app-server 的流程，改成使用 @openai/codex-sdk 的 CodexExec。讓 SDK 負責跨
    平台的 binary 與 JSONL 溝通，我們只保留與 ProcessManager 相同的介面：啟動、事件轉播、中斷。
  - 將 SDK 發出的事件（item.started、item.completed 等）轉成現有的 NormalizedEntry，沿用目前的訊息正規化邏輯，讓前端不需
    要知道來源是 Claude 還是 Codex。
  - 在 CodexService 內維持對話狀態：startConversation 對應 SDK 的 startThread，sendFollowUp 對應 thread.run；若已有
    thread ID，就用 resumeThread 續接。
  - 把 CodexConfig 轉成 SDK 的 ThreadOptions（模型、沙箱模式、工作目錄等），並保留 append prompt、plan/apply patch 等選
    項在每次 run 前預處理。
  - 中斷流程透過 SDK 底層的 child process kill，並發出 processExit、error 事件，讓 SessionService 的既有處理邏輯可以
    重用。
  - 更新文件與設定，註明改採 @openai/codex-sdk，並指出安裝後不必再仰賴全域 npx 執行 Codex。