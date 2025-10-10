import { v4 as uuidv4 } from "uuid";
import { MessageRepository } from "../repositories/MessageRepository";
import { SessionRepository } from "../repositories/SessionRepository";
import { io } from "../server";
import { CreateSessionRequest, Session, SessionStatus } from "../types/session.types";
import { logger } from "../utils/logger";
import { agentPromptService } from "./AgentPromptService";
import { ClaudeCodeProvider } from "./ClaudeCodeProvider";
import { CodexService } from "./CodexService";
import { IAIProvider } from "../core/interfaces/IAIProvider";
import { CodexConfig } from "../types/codex.types";

export class SessionService {
  private claudeCodeProvider: ClaudeCodeProvider;
  private sessionRepository: SessionRepository;
  private messageRepository: MessageRepository;
  private codexService: CodexService;

  // Provider 映射表，根據 cliType 選擇對應的 provider
  private providers: Map<string, IAIProvider> = new Map();

  constructor(claudeCodeProvider?: ClaudeCodeProvider) {
    // 使用傳入的 ClaudeCodeProvider 實例，或者建立新的（向後相容）
    if (claudeCodeProvider) {
      this.claudeCodeProvider = claudeCodeProvider;
      logger.info("Using shared ClaudeCodeProvider instance");
    } else {
      this.claudeCodeProvider = new ClaudeCodeProvider(true);
      logger.info("ClaudeCodeProvider initialized (npx mode)");
    }

    this.sessionRepository = new SessionRepository();
    this.messageRepository = new MessageRepository();
    this.codexService = new CodexService();

    // 註冊 providers 到映射表
    this.providers.set('claude-code', this.claudeCodeProvider);
    this.providers.set('codex', this.codexService);

    // 設置統一的事件監聽
    this.setupProviderEventListeners();
  }

  async initialize(): Promise<void> {
    logger.info("SessionService initialization started");

    // 初始化所有 providers
    await this.claudeCodeProvider.initialize();
    await this.codexService.initialize();
  }

  /**
   * 統一的 Provider 事件監聽設置
   * 所有 provider 都使用相同的事件處理邏輯
   */
  private setupProviderEventListeners(): void {
    // 為每個 provider 設置相同的事件監聽
    this.providers.forEach((provider, cliType) => {
      logger.info(`Setting up event listeners for ${cliType} provider`);

      // 訊息事件 - 統一處理
      provider.on('message', async (messageData: any) => {
        try {
          // 轉發給前端（已經是標準化的 ClaudeStreamMessage 格式）
          io.emit('message', messageData);
        } catch (error) {
          logger.error(`Failed to handle ${cliType} message:`, error);
        }
      });

      // 狀態更新事件
      provider.on('statusUpdate', async (data: { sessionId: string; status: string }) => {
        try {
          // 轉發狀態更新到前端
          io.emit('statusUpdate', data);
        } catch (error) {
          logger.error(`Failed to handle ${cliType} status update:`, error);
        }
      });

      // 進程開始事件
      provider.on('processStarted', async (data: { sessionId: string; pid?: number }) => {
        try {
          // 轉發進程開始事件到前端
          io.emit('processStarted', data);
        } catch (error) {
          logger.error(`Failed to handle ${cliType} process started:`, error);
        }
      });

      // 進程結束事件 - 統一處理
      provider.on('processExit', async (data: { sessionId: string; code: number; usage?: any }) => {
        try {
          const session = await this.sessionRepository.findById(data.sessionId);
          if (session) {
            // 只有在執行失敗時才更新狀態為 ERROR
            // 正常執行完成時，狀態應該保持 IDLE（已在 Provider 中處理）
            if (data.code !== 0) {
              session.status = SessionStatus.ERROR;
              session.error = `Process exited with code ${data.code}`;
              session.updatedAt = new Date();
              await this.sessionRepository.update(session);
            }
          }

          // 轉發進程結束事件到前端
          io.emit('processExit', data);
        } catch (error) {
          logger.error(`Failed to handle ${cliType} process exit:`, error);
        }
      });

      // 會話 ID 事件
      provider.on('sessionId', async (data: { sessionId: string; claudeSessionId: string }) => {
        try {
          // 更新 session 的 claudeSessionId
          const session = await this.sessionRepository.findById(data.sessionId);
          if (session) {
            session.claudeSessionId = data.claudeSessionId;
            await this.sessionRepository.update(session);
            logger.info(`Updated Claude session ID for ${data.sessionId}: ${data.claudeSessionId}`);
          }
        } catch (error) {
          logger.error(`Failed to update Claude session ID for ${cliType}:`, error);
        }
      });

      // 錯誤事件 - 統一處理
      provider.on('error', async (errorData: { sessionId: string; error: string; errorType?: string }) => {
        try {
          const session = await this.sessionRepository.findById(errorData.sessionId);
          if (session) {
            session.status = SessionStatus.ERROR;
            session.error = errorData.error;
            session.updatedAt = new Date();
            await this.sessionRepository.update(session);
          }

          // 轉發錯誤事件到前端
          io.emit('error', errorData);
        } catch (error) {
          logger.error(`Failed to handle ${cliType} error:`, error);
        }
      });
    });
  }

  /**
   * 根據 session 的 cliType 獲取對應的 provider
   */
  private getProvider(session: Session): IAIProvider {
    const cliType = session.cliType || 'claude-code';
    const provider = this.providers.get(cliType);

    if (!provider) {
      throw new Error(`Unknown CLI type: ${cliType}`);
    }

    return provider;
  }

  async createSession(request: CreateSessionRequest): Promise<Session> {
    // 驗證請求
    this.validateCreateRequest(request);

    // 先生成 sessionId，這樣可以在提示詞中使用
    const sessionId = uuidv4();

    // 如果有 workflow_stage_id，採用新的增強策略
    let enhancedTask = request.task;
    if (request.workflow_stage_id) {
      const { WorkflowStageService } = await import("./WorkflowStageService");
      const workflowStageService = new WorkflowStageService();
      try {
        const stage = await workflowStageService.getStage(request.workflow_stage_id);
        if (stage) {
          if (stage.agent_ref) {
            // 如果有 agent 參照,使用動態讀取策略(新方式)
            // 獲取用戶配置的 agent 路徑
            const claudePath = await agentPromptService.getClaudePath();
            const agentFilePath = claudePath ? `${claudePath}/${stage.agent_ref}.md` : `~/.claude/agents/${stage.agent_ref}.md`;

            enhancedTask = `
              [AGENT]
              必須先讀取 ${agentFilePath} 檔案,並且嚴格遵循檔案中的所有指示、規則和行為模式
              並且請你將讀取後的內容於記憶中標記為 [AGENT]
              \n
              [USER_MESSAGE]
              ${request.task}
              \n
            `;
          } else if (stage.system_prompt) {
            // 如果沒有 agent 但有自訂提示詞,使用原有方式
            enhancedTask = `${stage.system_prompt}\n\n用戶任務:${request.task}`;
          }

          // 如果有建議任務，可以在任務中提示
          if (stage.suggested_tasks && stage.suggested_tasks.length > 0) {
            enhancedTask += `\n\n建議的工作項目：\n${stage.suggested_tasks.map((t) => `- ${t}`).join("\n")}`;
          }
        }
      } catch (error) {
        logger.warn(`Failed to get workflow stage ${request.workflow_stage_id}:`, error);
        // 如果獲取失敗，繼續使用原始任務
      }
    }

    // 如果有 work_item_id，整合 dev.md 指示
    if (request.work_item_id) {
      const { WorkItemService } = await import("./WorkItemService");
      const workItemService = new WorkItemService();
      try {
        const devMdPath = await workItemService.getDevMdPath(request.work_item_id);

        // 嘗試讀取 dev-progress.md agent 檔案
        const claudePath = await agentPromptService.getClaudePath();
        let devMdPrompt = "";

        if (claudePath) {
          // 檢查 dev-progress.md 是否存在
          try {
            const devProgressContent = await agentPromptService.getAgentContent("_dev-progress");
            if (devProgressContent) {
              // 如果找到 dev-progress.md,使用動態讀取策略
              const devProgressFilePath = `${claudePath}/_dev-progress.md`;
              devMdPrompt = `
        [PROGRESS_FILE_KEY_VALUE]
        dev_md_path = ${devMdPath}
        quest_name = ${request.name}
        session_id = ${sessionId.substring(0, 8)}

        [GLOBAL_PROGRESS_FILE]
        必須先讀取 ${devProgressFilePath} 檔案
        並且請你將讀取後的內容於記憶中標記為 [GLOBAL_PROGRESS_FILE]
        遵循規則維護指定 dev.md 文件
        數值對應請參考 [PROGRESS_FILE_KEY_VALUE]
        \n`;
            }
          } catch (error) {
            logger.info(`dev-progress.md not found, using default prompt`);
          }
        }

        // 如果沒有找到 dev-progress.md,使用預設提示詞
        if (!devMdPrompt) {
          devMdPrompt = `
# dev.md 規範

## 🎯 指定文件

* 唯一目標路徑：${devMdPath}

---

## ⚙️ 操作規則

1. 每次執行都 **在文件末尾新增一個段落**
2. 段落標題為 [${request.name}]-{${sessionId.substring(0, 8)}} 組成
3. 以最精簡的文字來表達最必要且充分的訊息量

---

## 🧱 段落示意

\`\`\`markdown
## [${request.name}]-{${sessionId.substring(0, 8)}}
| 欄位 | 內容 |
|------|------|
| **任務** | ≤15字 |
| **完成** | - 項目（每項≤10字） |
| **產出** | - /絕對路徑 |
| **摘要** | ≤40字，1句 |
| **待辦** | - [ ] 項目 |
---
\`\`\`

---

## 🚫 禁止事項

* 編輯非指定路徑之 dev.md、建立、修改或覆蓋任何其他 dev.md
* 變動 {{quest_name}} 為其他名稱
* 使用相對路徑於「產出」欄位
* 刪除或覆蓋已存在段落
* 僅在對話展示內容而不寫入檔案

---

## 📦 補充

* 所有重要產出檔案須存於 \`/docs/\` 並於「產出」中紀錄絕對路徑。
* 每個段落代表一次任務執行記錄。
`;
        }

        enhancedTask = devMdPrompt + enhancedTask;
      } catch (error) {
        logger.warn(`Failed to get dev.md path for work item ${request.work_item_id}:`, error);
        // 如果獲取失敗，繼續不影響 Session 建立
      }
    }

    // 建立 Session，使用預先生成的 sessionId
    const session: Session = {
      sessionId: sessionId, // 使用預先生成的 sessionId
      name: request.name,
      workingDir: request.workingDir,
      task: enhancedTask,
      status: SessionStatus.PROCESSING,
      continueChat: request.continueChat || false,
      previousSessionId: request.previousSessionId,
      dangerouslySkipPermissions: request.dangerouslySkipPermissions || false,
      workflow_stage_id: request.workflow_stage_id,
      work_item_id: request.work_item_id,
      cliType: request.cliType || 'claude-code',
      codexConfig: request.codexConfig,
      lastUserMessage: undefined, // 初始時沒有用戶對話訊息
      messageCount: 0, // 初始對話計數為 0
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 儲存 Session
    await this.sessionRepository.save(session);

    try {
      // 獲取對應的 provider
      const provider = this.getProvider(session);

      logger.info(`Starting ${session.cliType} session for ${sessionId}`);
      await provider.startSession(session);

      // 獲取虛擬 processId（用於相容性）
      session.processId = Date.now();

      // 更新 Session 狀態 - 如果有初始任務，保持 PROCESSING 狀態
      // 只有在沒有初始任務時才設為 IDLE
      if (!session.task) {
        session.status = SessionStatus.IDLE;
      }
      session.updatedAt = new Date();

      await this.sessionRepository.update(session);

      // 獲取該 session 的專案和標籤資訊（新創建的通常為空，但保持 API 一致性）
      const [projects, tags] = await Promise.all([this.sessionRepository.getSessionProjects(session.sessionId), this.sessionRepository.getSessionTags(session.sessionId)]);

      session.projects = projects;
      session.tags = tags;

      // 如果有 workflow_stage_id，獲取完整的 stage 資訊
      if (session.workflow_stage_id) {
        const { WorkflowStageService } = await import("./WorkflowStageService");
        const workflowStageService = new WorkflowStageService();
        try {
          const stage = await workflowStageService.getStage(session.workflow_stage_id);
          if (stage) {
            session.workflow_stage = {
              stage_id: stage.stage_id,
              name: stage.name,
              color: stage.color,
              icon: stage.icon,
              system_prompt: stage.system_prompt,
              temperature: stage.temperature,
              suggested_tasks: stage.suggested_tasks,
            };
          }
        } catch (error) {
          logger.warn(`Failed to get workflow stage for new session ${session.sessionId}:`, error);
        }
      }

      // 如果有 work_item_id，自動更新 Work Item 狀態
      if (request.work_item_id) {
        try {
          const { WorkItemService } = await import("./WorkItemService");
          const workItemService = new WorkItemService();

          // 檢查 Work Item 是否存在
          const workItem = await workItemService.getWorkItem(request.work_item_id);
          if (workItem) {
            // 如果 Work Item 狀態還在 planning，更新為 in_progress
            if (workItem.status === "planning") {
              await workItemService.updateWorkItem(request.work_item_id, {
                status: "in_progress" as any,
              });
            }
          }
        } catch (error) {
          logger.warn(`Failed to update work item ${request.work_item_id} for new session:`, error);
          // 不要因為 Work Item 更新失敗而阻止 Session 創建
        }
      }

      return session;
    } catch (error) {
      // 如果啟動失敗，更新狀態
      session.status = SessionStatus.ERROR;
      session.error = error instanceof Error ? error.message : "Unknown error";
      session.updatedAt = new Date();

      await this.sessionRepository.update(session);

      throw error;
    }
  }

  async listSessions(): Promise<Session[]> {
    const sessions = await this.sessionRepository.findAll();

    // 如果沒有 sessions，直接返回
    if (sessions.length === 0) {
      return sessions;
    }

    // 獲取所有 session IDs
    const sessionIds = sessions.map((s) => s.sessionId);

    // 批量獲取專案和標籤資訊
    const [projectsMap, tagsMap] = await Promise.all([this.sessionRepository.getSessionsProjects(sessionIds), this.sessionRepository.getSessionsTags(sessionIds)]);

    // 獲取 WorkflowStageService 來載入階段資訊
    const { WorkflowStageService } = await import("./WorkflowStageService");
    const workflowStageService = new WorkflowStageService();

    // 將專案、標籤和工作流程階段資訊附加到每個 session
    for (const session of sessions) {
      session.projects = projectsMap.get(session.sessionId) || [];
      session.tags = tagsMap.get(session.sessionId) || [];

      // 獲取 workflow stage 資訊
      if (session.workflow_stage_id) {
        try {
          const stage = await workflowStageService.getStage(session.workflow_stage_id);
          if (stage) {
            session.workflow_stage = {
              stage_id: stage.stage_id,
              name: stage.name,
              color: stage.color,
              icon: stage.icon,
              system_prompt: stage.system_prompt,
              temperature: stage.temperature,
              suggested_tasks: stage.suggested_tasks,
            };
          }
        } catch (error) {
          logger.warn(`Failed to get workflow stage for session ${session.sessionId}:`, error);
        }
      }
    }

    return sessions;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const session = await this.sessionRepository.findById(sessionId);

    if (!session) {
      return null;
    }

    // 獲取該 session 的專案和標籤資訊
    const [projects, tags] = await Promise.all([this.sessionRepository.getSessionProjects(sessionId), this.sessionRepository.getSessionTags(sessionId)]);

    session.projects = projects;
    session.tags = tags;

    // 獲取 workflow stage 資訊
    if (session.workflow_stage_id) {
      const { WorkflowStageService } = await import("./WorkflowStageService");
      const workflowStageService = new WorkflowStageService();
      try {
        const stage = await workflowStageService.getStage(session.workflow_stage_id);
        if (stage) {
          session.workflow_stage = {
            stage_id: stage.stage_id,
            name: stage.name,
            color: stage.color,
            icon: stage.icon,
            system_prompt: stage.system_prompt,
            temperature: stage.temperature,
            suggested_tasks: stage.suggested_tasks,
          };
        }
      } catch (error) {
        logger.warn(`Failed to get workflow stage for session ${sessionId}:`, error);
      }
    }

    return session;
  }

  async completeSession(sessionId: string): Promise<Session | null> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      return null;
    }

    // 只有 IDLE 或 ERROR 狀態的 session 可以被標記為完成
    if (session.status !== SessionStatus.IDLE && session.status !== SessionStatus.ERROR) {
      throw new ValidationError("Session must be idle or in error state to complete", "INVALID_STATUS");
    }

    // 停止進程（如果有的話）
    if (session.processId) {
      const provider = this.getProvider(session);
      await provider.stop(sessionId);
    }

    // Update session
    session.status = SessionStatus.COMPLETED;
    session.completedAt = new Date();
    session.updatedAt = new Date();
    session.error = null; // 清除錯誤訊息

    await this.sessionRepository.update(session);

    // 獲取該 session 的專案和標籤資訊
    const [projects, tags] = await Promise.all([this.sessionRepository.getSessionProjects(sessionId), this.sessionRepository.getSessionTags(sessionId)]);

    session.projects = projects;
    session.tags = tags;

    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    // 不能刪除正在處理中的 session
    if (session.status === SessionStatus.PROCESSING) {
      throw new ValidationError("Cannot delete a session that is currently processing", "SESSION_STILL_PROCESSING");
    }

    // 如果有進程在運行，先停止它
    if (session.processId && session.status === SessionStatus.IDLE) {
      try {
        const provider = this.getProvider(session);
        await provider.stop(sessionId);
      } catch (error) {
        logger.warn(`Failed to stop process before deletion:`, error);
      }
    }

    await this.sessionRepository.delete(sessionId);
  }

  async sendMessage(sessionId: string, content: string): Promise<any> {
    logger.info(`=== SessionService.sendMessage START ===`);
    logger.info(`SessionId: ${sessionId}`);
    logger.info(`Content: ${content?.slice(0, 100)}`);

    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    logger.info(`Session found:`, { sessionId: session.sessionId, status: session.status });

    // 允許 IDLE、COMPLETED、ERROR 狀態的 Session 發送訊息
    // 不允許 PROCESSING 狀態（避免衝突）
    if (session.status === SessionStatus.PROCESSING) {
      throw new ValidationError("Session is currently processing another message", "SESSION_BUSY");
    }

    // 如果是 INTERRUPTED 狀態，也不允許發送訊息（需要先恢復）
    if (session.status === SessionStatus.INTERRUPTED) {
      throw new ValidationError("Session is interrupted, please resume first", "SESSION_INTERRUPTED");
    }

    try {
      // 增強用戶訊息（如果 session 關聯到有 agent 的 workflow stage）
      let enhancedContent = content;
      if (session.workflow_stage_id) {
        const { WorkflowStageService } = await import("./WorkflowStageService");
        const workflowStageService = new WorkflowStageService();
        try {
          const stage = await workflowStageService.getStage(session.workflow_stage_id);
          if (stage && stage.agent_ref) {
            // 如果有 agent 參照,增強用戶訊息要求 Claude 讀取 agent 檔案
            // 獲取用戶配置的 agent 路徑
            // const claudePath = await agentPromptService.getClaudePath();
            // const agentFilePath = claudePath ? `${claudePath}/${stage.agent_ref}.md` : `~/.claude/agents/${stage.agent_ref}.md`;

            enhancedContent =
              // `
              // [AGENT]
              // 必須先讀取 ${agentFilePath} 檔案,並且嚴格遵循檔案中的所有指示、規則和行為模式
              // \n
              `
              [CRITICAL]
              若有，請同樣要嚴格遵循 [GLOBAL_PROGRESS_FILE] 與 [AGENT] 的所有規則。
              \n
              [USER_MESSAGE]
              ${content}
            `;
            logger.info(`Enhanced user message with agent reference: ${stage.agent_ref}`);
          }
        } catch (error) {
          logger.warn(`Failed to enhance message with workflow stage agent:`, error);
          // 如果增強失敗，繼續使用原始訊息
        }
      }

      // 如果 Session 是 COMPLETED 或 ERROR 狀態，需要重新啟動進程
      const needsRestart = session.status === SessionStatus.COMPLETED || session.status === SessionStatus.ERROR;

      // 發送訊息前，先更新 session 狀態為 PROCESSING 並清除舊錯誤
      session.status = SessionStatus.PROCESSING;
      session.error = null; // 清除舊錯誤訊息
      session.lastUserMessage = content; // 更新最後用戶訊息
      session.messageCount = (session.messageCount || 0) + 1; // 增加訊息計數
      session.updatedAt = new Date();
      await this.sessionRepository.update(session);
      logger.info(`Session status updated to PROCESSING, needsRestart: ${needsRestart}`);

      // 廣播 session 更新到前端
      const updateData = {
        sessionId: sessionId,
        lastUserMessage: session.lastUserMessage,
        messageCount: session.messageCount,
        updatedAt: session.updatedAt,
      };
      logger.info("=== 發送 session_updated WebSocket 事件 ===", updateData);
      io.emit("session_updated", updateData);

      // 如果需要重新啟動進程，先啟動它
      if (needsRestart) {
        logger.info(`Restarting process for session ${sessionId}...`);

        // 清除 task 避免重複執行原始任務
        const sessionForRestart = { ...session, task: "" };

        // 重新啟動對話
        const provider = this.getProvider(session);
        await provider.startSession(sessionForRestart);
        session.processId = Date.now();
      }

      // 根據 cliType 發送訊息到對應的 provider
      logger.info(`Sending message via ${session.cliType}...`);
      const provider = this.getProvider(session);
      await provider.sendMessage(sessionId, enhancedContent);
      logger.info(`Message sent successfully`);

      // 返回剛保存的用戶訊息
      logger.info(`Fetching recent messages...`);
      // 獲取更多最近訊息，因為可能有 assistant 訊息在用戶訊息之後
      const messages = await this.messageRepository.getRecentMessages(sessionId, 10);

      const userMessage = messages.find((msg) => msg.type === "user" && msg.content === enhancedContent);
      logger.info(`Looking for user message with content: "${enhancedContent?.slice(0, 100)}"`);
      logger.info(`Found user message:`, userMessage);

      if (!userMessage) {
        logger.warn(
          `User message not found! Available messages:`,
          messages.map((m) => ({ type: m.type, content: m.content?.slice(0, 50), timestamp: m.timestamp }))
        );
      }

      return userMessage;
    } catch (error) {
      logger.error(`SessionService.sendMessage error:`, error);
      // 如果進程發送失敗，更新 session 狀態
      session.status = SessionStatus.ERROR;
      session.error = error instanceof Error ? error.message : "Unknown error";
      session.updatedAt = new Date();
      await this.sessionRepository.update(session);

      throw error;
    }
  }

  async getMessages(sessionId: string, page: number = 1, limit: number = 50): Promise<any> {
    logger.info(`=== SessionService.getMessages START ===`);
    logger.info(`SessionId: ${sessionId}, Page: ${page}, Limit: ${limit}`);

    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    logger.info(`Session found, calling MessageRepository.findBySessionId...`);
    const result = await this.messageRepository.findBySessionId(sessionId, page, limit);

    return result;
  }

  async saveAssistantMessage(sessionId: string, content: string): Promise<any> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    return await this.messageRepository.save({
      sessionId,
      type: "assistant",
      content,
    });
  }

  async getRecentMessages(sessionId: string, count: number = 10): Promise<any[]> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    return await this.messageRepository.getRecentMessages(sessionId, count);
  }

  async exportSessionConversation(sessionId: string, format: "json" | "markdown" | "csv" = "json"): Promise<string> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    return await this.messageRepository.exportSessionConversation(sessionId, format);
  }

  async interruptSession(sessionId: string): Promise<Session> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    if (session.status !== SessionStatus.PROCESSING) {
      throw new ValidationError("Session is not processing", "INVALID_STATUS");
    }

    try {
      // 根據 cliType 發送中斷信號到對應的 provider
      const provider = this.getProvider(session);
      await provider.interrupt(sessionId);

      // 中斷後保持在 IDLE 狀態，並清除錯誤訊息
      session.status = SessionStatus.IDLE;
      session.error = null; // 清除錯誤訊息
      session.updatedAt = new Date();

      await this.sessionRepository.update(session);

      // 獲取該 session 的專案和標籤資訊
      const [projects, tags] = await Promise.all([this.sessionRepository.getSessionProjects(sessionId), this.sessionRepository.getSessionTags(sessionId)]);

      session.projects = projects;
      session.tags = tags;

      return session;
    } catch (error) {
      session.status = SessionStatus.ERROR;
      session.error = error instanceof Error ? error.message : "Unknown error";
      session.updatedAt = new Date();
      await this.sessionRepository.update(session);

      throw error;
    }
  }

  async resumeSession(sessionId: string): Promise<Session> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    if (session.status !== SessionStatus.INTERRUPTED) {
      throw new ValidationError("Session is not interrupted", "INVALID_STATUS");
    }

    // 檢查進程是否仍在運行
    const processInfo = this.claudeCodeProvider.getProcessInfo(sessionId);
    if (!processInfo) {
      throw new ValidationError("Process not found for session", "PROCESS_NOT_FOUND");
    }

    // 恢復會話只需要更新狀態，進程會自動處理
    session.status = SessionStatus.IDLE;
    session.updatedAt = new Date();

    await this.sessionRepository.update(session);

    // 獲取該 session 的專案和標籤資訊
    const [projects, tags] = await Promise.all([this.sessionRepository.getSessionProjects(sessionId), this.sessionRepository.getSessionTags(sessionId)]);

    session.projects = projects;
    session.tags = tags;

    return session;
  }

  // 新增方法：獲取進程資訊
  async getProcessInfo(sessionId: string): Promise<any> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    const processInfo = this.claudeCodeProvider.getProcessInfo(sessionId);
    const metrics = await this.claudeCodeProvider.getProcessMetrics(sessionId);

    return {
      processInfo,
      metrics,
      isActive: !!processInfo,
    };
  }

  // 新增方法：獲取所有活躍進程統計
  async getSystemStats(): Promise<any> {
    const allProcessInfo = this.claudeCodeProvider.getAllProcessInfo();
    const activeCount = this.claudeCodeProvider.getActiveProcessCount();

    return {
      totalProcesses: activeCount,
      processes: allProcessInfo,
      systemStatus: activeCount > 0 ? "active" : "idle",
    };
  }

  private validateCreateRequest(request: CreateSessionRequest): void {
    if (!request.name) {
      throw new ValidationError("name is required", "VALIDATION_ERROR");
    }
    if (!request.workingDir) {
      throw new ValidationError("workingDir is required", "VALIDATION_ERROR");
    }
    if (!request.task) {
      throw new ValidationError("task is required", "VALIDATION_ERROR");
    }
  }

  async reorderSessions(status: SessionStatus, sessionIds: string[]): Promise<void> {
    // Update sort order for each session
    for (let i = 0; i < sessionIds.length; i++) {
      await this.sessionRepository.updateSortOrder(sessionIds[i], i);
    }

    logger.info(`Reordered ${sessionIds.length} sessions for status ${status}`);
  }

  // Work Item 相關方法
  async associateWithWorkItem(sessionId: string, workItemId: string): Promise<Session> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    // 更新 session 的 work_item_id
    session.work_item_id = workItemId;
    session.updatedAt = new Date();
    await this.sessionRepository.update(session);

    // 同時更新 Work Item 狀態
    try {
      const { WorkItemService } = await import("./WorkItemService");
      const workItemService = new WorkItemService();

      const workItem = await workItemService.getWorkItem(workItemId);
      if (workItem && workItem.status === "planning") {
        await workItemService.updateWorkItem(workItemId, {
          status: "in_progress" as any,
        });
      }
    } catch (error) {
      logger.warn(`Failed to update work item ${workItemId}:`, error);
    }

    return session;
  }

  async disassociateFromWorkItem(sessionId: string): Promise<Session> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new ValidationError("Session not found", "SESSION_NOT_FOUND");
    }

    // 清除 session 的 work_item_id
    session.work_item_id = undefined;
    session.updatedAt = new Date();
    await this.sessionRepository.update(session);

    return session;
  }

  async getSessionsByWorkItem(workItemId: string): Promise<Session[]> {
    const sessions = await this.sessionRepository.findAll();

    // 過濾出屬於該 Work Item 的 Sessions
    const workItemSessions = sessions.filter((s) => s.work_item_id === workItemId);

    if (workItemSessions.length === 0) {
      return workItemSessions;
    }

    // 獲取所有 session IDs
    const sessionIds = workItemSessions.map((s) => s.sessionId);

    // 批量獲取專案和標籤資訊
    const [projectsMap, tagsMap] = await Promise.all([this.sessionRepository.getSessionsProjects(sessionIds), this.sessionRepository.getSessionsTags(sessionIds)]);

    // 獲取 WorkflowStageService 來載入階段資訊
    const { WorkflowStageService } = await import("./WorkflowStageService");
    const workflowStageService = new WorkflowStageService();

    // 將專案、標籤和工作流程階段資訊附加到每個 session
    for (const session of workItemSessions) {
      session.projects = projectsMap.get(session.sessionId) || [];
      session.tags = tagsMap.get(session.sessionId) || [];

      // 獲取 workflow stage 資訊
      if (session.workflow_stage_id) {
        try {
          const stage = await workflowStageService.getStage(session.workflow_stage_id);
          if (stage) {
            session.workflow_stage = {
              stage_id: stage.stage_id,
              name: stage.name,
              color: stage.color,
              icon: stage.icon,
              system_prompt: stage.system_prompt,
              temperature: stage.temperature,
              suggested_tasks: stage.suggested_tasks,
            };
          }
        } catch (error) {
          logger.warn(`Failed to get workflow stage for session ${session.sessionId}:`, error);
        }
      }
    }

    return workItemSessions;
  }
}

// 自訂錯誤類別
export class ValidationError extends Error {
  statusCode: number = 400;
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ValidationError";
  }
}
