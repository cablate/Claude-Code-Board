import { type Codex } from "@openai/codex-sdk";
import { BaseAIProvider } from "../core/interfaces/IAIProvider";
import { ActionType, CodexExecuteParams } from "../types/codex.types";
import { ClaudeStreamMessage, ProcessStatus, ProcessInfo } from "../types/process.types";
import { Session, SessionStatus } from "../types/session.types";
import { MessageRepository } from "../repositories/MessageRepository";
import { SessionRepository } from "../repositories/SessionRepository";
import { logger } from "../utils/logger";
import { getNotificationService } from "./NotificationService";

export class CodexService extends BaseAIProvider {
  private codex: Codex;
  private threads: Map<string, any> = new Map(); // sessionId -> Thread
  private conversationIds: Map<string, string> = new Map();
  private messageRepository: MessageRepository;
  private sessionRepository: SessionRepository;

  // 模擬 ProcessManager 的進程資訊管理
  private processInfo: Map<string, ProcessInfo> = new Map();

  constructor() {
    super();
    this.codex = {} as Codex; // 先初始化為空物件，稍後在 init() 中設定
    this.messageRepository = new MessageRepository();
    this.sessionRepository = new SessionRepository();
  }

  getType(): 'codex' {
    return 'codex';
  }

  isSessionActive(sessionId: string): boolean {
    return this.threads.has(sessionId);
  }

  async initialize(): Promise<void> {
    // ✅ 用動態 import
    //@ts-ignore
    const { createCodex } = await import("../utils/codexBridge.mjs");
    this.codex = createCodex() as Codex;
    logger.info("Codex SDK initialized");
  }

  /**
   * 啟動會話 - 對應 ProcessManager.startClaudeProcess
   */
  async startSession(session: Session): Promise<void> {
    const virtualPid = Date.now();

    // 建立進程資訊（模擬 ProcessManager）
    const processInfo: ProcessInfo = {
      sessionId: session.sessionId,
      pid: virtualPid,
      startTime: new Date(),
      status: ProcessStatus.IDLE,
      memoryUsage: 0,
      cpuUsage: 0,
      workingDirectory: session.workingDir,
      commandArgs: [],
      lastActivityTime: new Date(),
    };

    this.processInfo.set(session.sessionId, processInfo);

    // 觸發事件 - 立即返回（與 ProcessManager 一致）
    this.emitProcessStarted(session.sessionId, virtualPid);

    // 如果有初始任務，狀態應該是 processing
    if (session.task) {
      this.emitStatusUpdate(session.sessionId, "processing");
    } else {
      this.emitStatusUpdate(session.sessionId, "idle");
    }

    logger.info(`Codex session created successfully`, {
      sessionId: session.sessionId,
      virtualPid,
    });

    // 如果有初始任務，非同步執行（不等待，與 ProcessManager 一致）
    if (session.task) {
      setImmediate(async () => {
        try {
          await this.sendMessage(session.sessionId, session.task);
        } catch (error: any) {
          logger.error(`Failed to execute initial task for ${session.sessionId}:`, error);
          this.emitError(session.sessionId, error.message || "Failed to execute initial task");
        }
      });
    }
  }

  /**
   * 發送訊息 - 對應 ProcessManager.sendMessage
   */
  async sendMessage(sessionId: string, content: string): Promise<void> {
    // 儲存用戶訊息（與 ProcessManager 一致）
    logger.info(`=== CodexService.sendMessage: Saving user message ===`);
    logger.info(`SessionId: ${sessionId}, Content: ${content?.slice(0, 100)}`);

    try {
      const savedMessage = await this.messageRepository.save({
        sessionId,
        type: "user",
        content,
      });
      logger.info(`User message saved successfully:`, savedMessage);
    } catch (saveError) {
      logger.error(`Failed to save user message:`, saveError);
      throw saveError;
    }

    // 立即發送用戶訊息到 WebSocket（與 ProcessManager 一致）
    logger.info(`Emitting user message immediately for session ${sessionId}:`, { content: content.slice(0, 100) });

    const messageData: ClaudeStreamMessage = {
      sessionId,
      type: "user",
      content,
      timestamp: new Date(),
    };

    this.emitMessage(messageData);

    // 更新狀態為忙碌（與 ProcessManager 一致）
    const processInfo = this.processInfo.get(sessionId);
    if (processInfo) {
      processInfo.status = ProcessStatus.BUSY;
      processInfo.lastActivityTime = new Date();
    }

    this.emitStatusUpdate(sessionId, "processing");

    try {
      // 開始或繼續 Codex 對話
      await this.startOrContinueConversation(sessionId, content);
    } catch (error) {
      logger.error(`Failed to execute Codex:`, {
        error: error instanceof Error ? error.message : error,
        sessionId,
      });

      // 更新 session 狀態（與 ProcessManager 一致）
      try {
        const session = await this.sessionRepository.findById(sessionId);
        if (session) {
          session.status = SessionStatus.ERROR;
          session.error = JSON.stringify({
            message: error instanceof Error ? error.message : "Execution failed",
            type: "EXECUTION_ERROR",
            timestamp: new Date().toISOString(),
          });
          session.updatedAt = new Date();
          await this.sessionRepository.update(session);
        }
      } catch (updateError) {
        logger.error("Failed to update session status after error:", updateError);
      }
    }
  }

  private async startOrContinueConversation(sessionId: string, prompt: string): Promise<void> {
    let thread = this.threads.get(sessionId);

    if (!thread) {
      // 新建對話
      const session = await this.sessionRepository.findById(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      thread = session.claudeSessionId
        ? this.codex.resumeThread(session.claudeSessionId)
        : this.codex.startThread({
            workingDirectory: session.workingDir,
            skipGitRepoCheck: true,
          });

      if (!thread) {
        throw new Error("Failed to create or resume thread");
      }

      this.threads.set(sessionId, thread);

      // 儲存 conversation ID
      if (thread.id) {
        this.conversationIds.set(sessionId, thread.id);
        this.emitSessionId(sessionId, thread.id);
        logger.info(`Thread ID stored for session ${sessionId}: ${thread.id}`);
      }
    }

    // 在背景處理串流回應
    this.processStreamInBackground(sessionId, thread, prompt).catch((error) => {
      logger.error(`Background processing failed for session ${sessionId}:`, error);
    });
  }

  private generateToolDescription(toolName: string, input: any): string {
    if (!toolName) return "Unknown tool";

    switch (toolName.toLowerCase()) {
      case "read_file":
        return `讀取檔案：${input?.filePath || "未指定檔案"}`;
      case "replace_string_in_file":
        return `修改檔案：${input?.filePath || "未指定檔案"}`;
      case "create_file":
        return `建立檔案：${input?.filePath || "未指定檔案"}`;
      case "list_dir":
        return `列出目錄：${input?.path || "未指定路徑"}`;
      case "file_search":
        return `搜尋檔案：${input?.query || ""}`;
      case "grep_search":
        return `搜尋內容：${input?.query || ""}`;
      case "run_in_terminal":
        return `執行指令：${input?.command?.slice(0, 50) || ""}`;
      case "semantic_search":
        return `語意搜尋：${input?.query || ""}`;
      default:
        return `${toolName}：${JSON.stringify(input)}`;
    }
  }

  /**
   * 中斷執行 - 對應 ProcessManager.interruptProcess
   */
  async interrupt(sessionId: string): Promise<void> {
    const thread = this.threads.get(sessionId);
    if (thread) {
      await thread.interrupt();
    }

    // 清理資源
    this.cleanup(sessionId);

    // 發送中斷事件和狀態更新（與 ProcessManager 一致）
    this.emitStatusUpdate(sessionId, "idle");

    // 儲存中斷訊息（與 ProcessManager 一致）
    try {
      await this.messageRepository.save({
        sessionId,
        type: "assistant",
        content: "⚠️ 執行已被使用者中斷",
      });
    } catch (error) {
      logger.error("Failed to save interrupt message:", error);
    }

    logger.info(`Session interrupted: ${sessionId}`);
  }

  /**
   * 停止會話 - 對應 ProcessManager.stopProcess
   */
  async stop(sessionId: string): Promise<void> {
    const processInfo = this.processInfo.get(sessionId);

    if (!processInfo) {
      logger.warn(`Process info not found for session ${sessionId}`);
      return;
    }

    processInfo.status = ProcessStatus.STOPPED;
    logger.info(`Stopping session ${sessionId}`);

    this.cleanup(sessionId);
  }

  private cleanup(sessionId: string): void {
    this.threads.delete(sessionId);
    this.conversationIds.delete(sessionId);
    this.processInfo.delete(sessionId);
    logger.info(`Cleaned up Codex resources for session ${sessionId}`);
  }

  private async processStreamInBackground(sessionId: string, thread: any, prompt: string): Promise<void> {
    try {
      logger.info(`Starting background stream processing for session ${sessionId}`);

      const turn = await thread.runStreamed(prompt);
      logger.debug("Background turn started:", { turn });

      await this.handleStreamEvents(sessionId, turn.events);

      logger.info(`Background stream processing completed for session ${sessionId}`);
    } catch (error) {
      logger.error(`Error in background stream processing for session ${sessionId}:`, error);
      // 發送錯誤事件但不中斷程序
      const errorMessage = error instanceof Error ? error.message : "Unknown stream processing error";

      const errorMsg: ClaudeStreamMessage = {
        sessionId,
        type: "error",
        content: `Stream processing error: ${errorMessage}`,
        timestamp: new Date(),
      };

      this.emitMessage(errorMsg);
    }
  }

  private async handleStreamEvents(sessionId: string, events: AsyncIterable<any>) {
    if (!events) {
      logger.error(`No events received for session ${sessionId}`);
      return;
    }

    logger.info(`Starting to process stream events for session ${sessionId}`);

    try {
      for await (const event of events) {
        logger.debug(`Event received:`, {
          sessionId,
          eventType: event.type,
          eventContent: event.item || event.usage || event,
        });

        switch (event.type) {
          case "item.completed":
            if (!event.item) {
              logger.warn(`Received item.completed event without item data for session ${sessionId}`);
              continue;
            }

            const normalized = this.normalizeCodexEvent(sessionId, event.item);
            if (normalized) {
              this.emitMessage(normalized);

              // 儲存到資料庫
              try {
                await this.messageRepository.save({
                  sessionId,
                  type: normalized.type,
                  content: normalized.content,
                  metadata: normalized.metadata,
                });
              } catch (saveError) {
                logger.error("Failed to save normalized message:", saveError);
              }
            } else {
              logger.warn(`Failed to normalize event for session ${sessionId}:`, event.item);
            }
            break;

          case "turn.completed":
            logger.info(`Turn completed for session ${sessionId}`, {
              usage: event.usage,
              threadId: this.conversationIds.get(sessionId),
            });

            // 更新狀態為閒置（與 ProcessManager 一致）
            this.emitStatusUpdate(sessionId, "idle");
            this.emitProcessExit(sessionId, 0, event.usage);

            // 更新 session 狀態（與 ProcessManager 一致）
            try {
              const session = await this.sessionRepository.findById(sessionId);
              if (session) {
                session.status = SessionStatus.IDLE;
                session.error = null;
                session.updatedAt = new Date();
                await this.sessionRepository.update(session);
              }
            } catch (error) {
              logger.error("Failed to update session status:", error);
            }

            // 發送完成通知（與 ProcessManager 一致）
            const notificationService = getNotificationService();
            try {
              const session = await this.sessionRepository.findById(sessionId);
              if (session) {
                await notificationService.notify({
                  title: "Claude Code Board",
                  message: `任務執行完成：${session.name}`,
                  sound: true,
                });
              }
            } catch (err) {
              logger.warn("Failed to send completion notification:", err);
            }
            break;

          default:
            logger.debug(`Unhandled event type "${event.type}" for session ${sessionId}:`, event);
        }
      }

      logger.info(`Finished processing all events for session ${sessionId}`);
    } catch (error) {
      logger.error(`Error handling stream events for session ${sessionId}:`, error);

      const errorMessage = error instanceof Error ? error.message : "Unknown stream processing error";
      const errorMsg: ClaudeStreamMessage = {
        sessionId,
        type: "error",
        content: `Stream processing error: ${errorMessage}`,
        timestamp: new Date(),
      };

      this.emitMessage(errorMsg);
      throw error;
    }
  }

  private normalizeCodexEvent(sessionId: string, event: any): ClaudeStreamMessage | null {
    if (!event) return null;

    const timestamp = new Date();
    const messageId = event.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 處理不同類型的 Codex 事件，輸出統一的 ClaudeStreamMessage
    switch (event.type) {
      case "text":
      case "agent_message":
        return {
          sessionId,
          type: "assistant",
          content: event.text,
          timestamp,
          metadata: {
            messageId,
            isComplete: true,
          },
        };

      case "reasoning":
        return {
          sessionId,
          type: "thinking",
          content: event.text,
          timestamp,
          metadata: {
            messageId,
            isComplete: true,
          },
        };

      case "tool":
        const toolDescription = this.generateToolDescription(event.name, event.args);
        const toolStatus = event.status === "success" ? "complete" : event.status === "error" ? "error" : "start";

        return {
          sessionId,
          type: "tool_use",
          content: toolDescription,
          timestamp,
          metadata: {
            messageId,
            toolName: event.name,
            toolInput: event.args,
            toolStatus,
            toolId: messageId,
            isError: event.status === "error",
          },
        };

      case "thinking":
        return {
          sessionId,
          type: "thinking",
          content: event.text || "Thinking...",
          timestamp,
          metadata: {
            messageId,
            isComplete: true,
            isThinking: true,
          },
        };

      case "error":
        return {
          sessionId,
          type: "error",
          content: event.error?.message || event.text || "An error occurred",
          timestamp,
          metadata: {
            messageId,
            isError: true,
            toolStatus: "error",
            toolOutput: event.error?.type || "UNKNOWN_ERROR",
          },
        };

      case "system":
        return {
          sessionId,
          type: "system",
          content: event.text,
          timestamp,
          metadata: {
            messageId,
            isComplete: true,
          },
        };

      default:
        logger.debug(`Unhandled Codex event type: ${event.type}`, event);
        return null;
    }
  }
}
