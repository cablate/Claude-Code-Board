# Claude Code Board

> ## ⚠️ 公告：本專案已停止維護
>
> 此儲存庫已歸檔，將不再接收更新、錯誤修復或新功能。
>
> **本專案採用 MIT 授權釋出** — 你可以自由 fork、修改、散布，並用於任何目的（包括商業用途），完全沒有限制。歡迎自由取用！
>
> 🌐 **Landing Page:** [https://cc-board.cablate.com](https://cc-board.cablate.com)

<div align="center">

![Claude Code Board](assets/banner.png)

**為 Claude Code CLI 設計的綜合性 Session 管理系統，具備先進的工作流程功能**

**📖 Language / 語言:** [English](README.md) | [繁體中文](README-zh-TW.md)

**⚠️ 重要：** [請先閱讀免責聲明](#️-免責聲明) | **🚀 快速開始：** [安裝步驟](#安裝) | **📖 使用指南：** [操作說明](#-使用指南)

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Maintenance](https://img.shields.io/badge/維護中%3F-否-red.svg)]()
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#requirements)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)](https://nodejs.org/)

</div>

## 🌟 概述

Claude Code Board 是一個強大的網頁版管理系統，專為使用 Claude Code CLI 的開發者設計。它提供直觀的介面來同時管理多個 AI 編程對話，具備工作流程自動化、基於 Agent 的提示管理和智能專案組織等先進功能。

![Session List Management](assets/SessionList.png)
*主控制台展示多個活躍 Session 的狀態和管理界面*

## 🆚 為什麼選擇 Claude Code Board 而不是直接使用 CLI？

### 增強的 CLI 體驗
Claude Code CLI 在單一專注的編程對話中表現優異。然而，在管理具有多個上下文的複雜專案時，一些額外的功能變得非常有價值：
- **並發開發** - 同時處理多個功能或專案
- **Session 組織** - 根據專案目標和開發階段組織對話
- **Agent 工作流程** - 簡化不同 AI 專業化之間的切換
- **視覺化管理** - 網頁介面提供更好的 Session 概覽和導航


### 工作流程比較

**傳統 CLI 工作流程** 😤
```
1. 打開專案目錄
2. 啟動 cmd/terminal 視窗
3. 輸入 Claude Code CLI 命令
4. 輸入命令並等待完成
5. 多專案時：尋找對應的終端視窗
6. 難以同時在同一專案中執行多個對話
```

**Claude Code Board 工作流程** 🚀
```
1. 直接在網頁介面創建新對話
2. 一鍵選擇專案目錄和 Agent
3. 輕鬆為同一專案啟動多個對話
4. 跨對話延續：在前對話基礎上建構新任務
5. 任務完成時收到明確通知
6. 直觀介面：一目了然所有對話狀態
7. 即時切換：點擊即可進入任何對話
8. 並發管理：無縫處理多個專案
```

## ✨ 主要功能

### 🎯 核心 Session 管理
- **多 Session 支援** - 同時執行和管理多個 Claude Code 實例
- **即時聊天介面** - WebSocket 驅動的無縫對話體驗
- **智能狀態追蹤** - 自動監控 Session 狀態（閒置、處理中、完成、錯誤）
- **Session 恢復** - 保留完整上下文的對話恢復功能
- **快速 Session 啟動** - 基於現有對話創建新 Session，具備智能預填功能

### 🤖 進階 AI 工作流程
- **Agent 整合** - 從 `.claude/agents` 目錄動態載入 Claude agents
- **工作流程階段** - 預配置的開發階段（代碼審查、除錯、功能開發）
- **智能訊息增強** - 自動注入 Agent 指令以確保行為一致性
- **自訂提示模板** - 常見開發任務的快速啟動模板

### 📊 專案組織
- **工作項目** - 在專案特定的工作項目下組織 Session
- **專案分類** - 使用專案和主題標籤對 Session 進行分類
- **工作區路徑整合** - 自動工作目錄管理
- **開發環境整合** - 與 dev.md 和專案文件深度整合

### 🎨 現代化 UI/UX
- **響應式佈局** - 針對桌面和平板檢視優化
- **即時通知** - Windows Toast 通知 Session 事件
- **訊息過濾** - 針對不同訊息類型的進階過濾系統

## 🚀 快速開始

### 系統需求

- **作業系統**：Windows 10/11
- **Node.js**：22.12.0 或更高版本
- **Claude Code CLI**：已全域安裝的最新版本
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

### 安裝

1. **複製儲存庫**
   ```bash
   git clone https://github.com/yourusername/claude-code-board.git
   cd claude-code-board
   ```

2. **安裝相依套件**
   ```bash
   # 安裝根目錄相依套件
   npm install

   # 安裝後端相依套件
   cd backend && npm install

   # 安裝前端相依套件
   cd ../frontend && npm install
   ```

3. **快速啟動**
   ```bash
   # 選項 1：使用提供的批次檔案（Windows）
   start.bat

   # 選項 2：手動啟動
   npm run dev:backend   # 終端 1
   npm run dev:frontend  # 終端 2
   ```

4. **存取應用程式**
   - 前端：`http://localhost:5173`
   - 後端 API：`http://localhost:3001`

![Welcome Interface](assets/Demo1.png)
*初次啟動後的歡迎界面*

## 🎯 使用指南

### 創建你的第一個 Session

![Session Creation Wizard](assets/CreateSession.png)
*Session 創建嚮導界面，支援快速模板和預設配置*

1. **基本設定**
   - 從主儀表板點擊「New Session」
   - 為你的編程任務輸入描述性名稱
   - 選擇或輸入專案的工作目錄

2. **進階配置**
   - 選擇專業化 AI 行為的 **Workflow Stage**
   - 連結到 **Work Item** 進行專案組織
   - 選擇領域專業的 **Agent**

3. **快速模板**
   - 使用預定義的常見任務模板：
     - 🔍 代碼審查
     - 🐛 錯誤修復
     - ✨ 功能開發
     - 📝 文件撰寫

### 使用 Agents

![Agent Configuration](assets/EditWorkStageAgent.png)
*Workflow Stage 與 Agent 配置界面*

1. **Agent 設定**
   - 在設定中配置你的 Claude agents 目錄
   - Agents 自動從 `~/.claude/agents/` 載入
   - 創建引用特定 agents 的工作流程階段

2. **動態 Agent 載入**
   - Agents 按需為每條訊息載入
   - 避免靜態提示包含的 token 浪費
   - 在整個對話中保持行為一致性

### 訊息管理

![Message Filter Interface](assets/SessionDetail.png)
*訊息過濾和管理界面*

- **過濾**：隱藏/顯示不同訊息類型（user、assistant、tool_use、thinking）
- **匯出**：下載對話歷史為 JSON 格式
- **即時更新**：查看生成中的回應
- **搜尋**：在對話歷史中尋找特定訊息

### 專案組織

![Project Organization](assets/WorkItem.png)
*專案分類和工作項目組織界面*

- **工作項目**：將相關 Session 歸類到專案任務下
- **分類**：使用專案和主題標籤對 Session 進行標記
- **工作區整合**：自動路徑偵測和繼承
- **快速啟動**：基於現有 Session 啟動新對話

## 🔧 配置

### 環境變數

在 `backend/` 和 `frontend/` 目錄中創建 `.env` 檔案：

**後端 (.env)**
```env
PORT=3001
NODE_ENV=development
DATABASE_PATH=./database/claude_code_board.db
SOCKET_PORT=3001
```

**前端 (.env)**
```env
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
```

### Agent 配置

1. **設定 Claude Agents 目錄**
   - 預設位置：`~/.claude/agents/`
   - 在應用程式設定中配置路徑
   - 為每個 agent 創建包含指令的 `.md` 檔案

2. **Agent 檔案結構**
   ```
   ~/.claude/agents/
   ├── code-reviewer.md     # 代碼審查專家
   ├── debugger.md          # 錯誤修復專家
   ├── architect.md         # 系統設計顧問
   └── documenter.md        # 文件撰寫專家
   ```

### 工作流程階段

![Workflow Stage Configuration](assets/WorkStage.png)
*Workflow Stage 編輯界面展示 Agent 選擇和自訂提示*

![Agent Configuration](assets/Agent.png)
*Agent 管理和配置界面*

- **自訂提示**：定義階段特定的系統提示
- **Agent 引用**：將階段連結到特定的 Claude agents
- **建議任務**：為每個階段提供任務模板
- **顏色編碼**：使用自訂顏色進行視覺組織


## ⚠️ 免責聲明

**重要資安聲明**

此工具僅供**個人電腦使用**，**不適用於線上部署**。應用程式除了基礎的硬編碼登入之外，**沒有任何資安防護**。

**主要資安限制：**
- 無資料傳輸加密
- 無安全認證系統
- 無輸入驗證或清理機制
- 無常見網路漏洞防護
- 無存取控制機制
- 資料庫和檔案系統可直接存取

**責任免除聲明：**
本專案的作者和貢獻者對於使用此軟體可能造成的任何損害、損失或資安漏洞**概不負責**。包括但不限於：
- 智慧財產或創作內容的損失
- 金錢財產損失或損害
- 資料外洩或未授權存取
- 系統入侵或惡意軟體感染
- 任何其他直接或間接損害

**使用此軟體即表示您確認：**
- 您完全承擔使用風險
- 您了解資安限制
- 您僅會在安全的個人電腦上使用
- 您不會部署在公開或共享網路上
- 您承擔所有後果的完全責任

## 📝 授權

本專案採用 MIT 授權 - 詳情請見 [LICENSE](LICENSE) 檔案。

## 🤝 支援

### 取得協助

- 📚 **文件**：查看此 README 和內聯代碼文件
- 🐛 **錯誤回報**：在 GitHub 上建立 issue
- 💡 **功能請求**：在 GitHub Discussions 中討論

---

<div align="center">

**用 ❤️ 為熱愛 AI 驅動編程的開發者而建**

[⭐ 為此儲存庫加星](https://github.com/yourusername/claude-code-board) • [🐛 回報問題](https://github.com/yourusername/claude-code-board/issues) • [💡 請求功能](https://github.com/yourusername/claude-code-board/issues)

</div>