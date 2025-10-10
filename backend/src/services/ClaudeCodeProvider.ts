import { exec } from "child_process";
import { BaseAIProvider } from "../core/interfaces/IAIProvider";
import fs from "fs";
import path from "path";
import { MessageRepository } from "../repositories/MessageRepository";
import { SessionRepository } from "../repositories/SessionRepository";
import { ClaudeCodeConfig, ClaudeStreamMessage, ProcessInfo, ProcessMetrics, ProcessStatus } from "../types/process.types";
import { Session, SessionStatus } from "../types/session.types";
import { logger } from "../utils/logger";
import { MessageAccumulator } from "./MessageAccumulator";
import { getNotificationService } from "./NotificationService";
import { StreamProcessor } from "./StreamProcessor";
import { UnifiedStreamProcessor } from "./UnifiedStreamProcessor";

/**
 * ClaudeCodeProvider - 使用 npx 執行 Claude Code
 *
 * 主要特點：
 * 1. 使用 npx 執行最新版 Claude Code
 * 2. 使用 --output-format=stream-json 解析結構化輸出
 * 3. 避免 Windows spawn 問題
 * 4. 支援多資料夾多 session
 * 5. 實作 IAIProvider 統一介面
 */
export class ClaudeCodeProvider extends BaseAIProvider {
  private processInfo: Map<string, ProcessInfo> = new Map();
  private healthCheckTimer?: NodeJS.Timeout;
  private messageRepository: MessageRepository;
  private sessionRepository: SessionRepository;
  private streamProcessors: Map<string, StreamProcessor> = new Map();
  private messageAccumulators: Map<string, MessageAccumulator> = new Map();
  private unifiedProcessors: Map<string, UnifiedStreamProcessor> = new Map();
  private useStreamMode: boolean = true; // 切換串流模式
  private useUnifiedProcessor: boolean = true; // 使用統一處理器

  private config: ClaudeCodeConfig = {
    executablePath: "npx",
    defaultTimeout: 3600000, // 60 分鐘
    maxConcurrentProcesses: 10,
    healthCheckInterval: 30000, // 30 秒
    maxIdleTime: 3600000, // 1 小時
    maxMemoryUsage: 2048, // 2GB
    enableMetrics: true,
    logLevel: "info",
  };

  constructor(enableHealthCheck: boolean = true) {
    super();
    this.messageRepository = new MessageRepository();
    this.sessionRepository = new SessionRepository();

    if (enableHealthCheck) {
      this.startHealthCheck();
    }
  }

  getType(): 'claude-code' {
    return 'claude-code';
  }

  isSessionActive(sessionId: string): boolean {
    return this.processInfo.has(sessionId);
  }

  async initialize(): Promise<void> {
    // 建立必要的目錄
    await this.ensureDirectories();

    logger.info("ClaudeCodeProvider initialized successfully");
  }

  /**
   * 啟動會話 - 實作 IAIProvider.startSession
   */
  async startSession(session: Session): Promise<void> {
    return this.startClaudeProcess(session);
  }

  /**
   * 中斷執行 - 實作 IAIProvider.interrupt
   */
  async interrupt(sessionId: string): Promise<void> {
    return this.interruptProcess(sessionId);
  }

  /**
   * 停止會話 - 實作 IAIProvider.stop
   */
  async stop(sessionId: string): Promise<void> {
    return this.stopProcess(sessionId);
  }

  async initialize(): Promise<void> {
    // 建立必要的目錄
    await this.ensureDirectories();

    logger.info("ProcessManager initialized successfully");
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = ["./data/sessions", "./data/logs", "./data/temp"];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.debug(`Created directory: ${dir}`);
      }
    }
  }

  async startClaudeProcess(session: Session): Promise<number> {
    // 驗證工作目錄
    if (!fs.existsSync(session.workingDir)) {
      throw new Error(`Working directory does not exist: ${session.workingDir}`);
    }

    const virtualPid = Date.now();

    // 建立進程資訊
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

    // 觸發事件 - 立即返回
    this.emitProcessStarted(session.sessionId, virtualPid);
    // 如果有初始任務，狀態應該是 processing
    if (session.task) {
      this.emitStatusUpdate(session.sessionId, "processing");
    } else {
      this.emitStatusUpdate(session.sessionId, "idle");
    }

    logger.info(`Claude Code session created successfully`, {
      sessionId: session.sessionId,
      virtualPid,
    });

    // 如果有初始任務，非同步執行（不等待）
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

    return virtualPid;
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = await this.getSessionInfo(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 儲存用戶訊息
    logger.info(`=== ProcessManager.sendMessage: Saving user message ===`);
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

    // 立即發送用戶訊息到 WebSocket
    logger.info(`Emitting user message immediately for session ${sessionId}:`, { content: content.slice(0, 100) });

    const messageData: ClaudeStreamMessage = {
      sessionId,
      type: "user",
      content,
      timestamp: new Date(),
    };

    this.emitMessage(messageData);

    // 準備 Claude Code 命令
    let claudeCommand: string;
    let claudeSessionIdToResume: string | null = null;

    // 準備參數 - 參考 vibe-kanban 的實現方式
    logger.info(`Session dangerouslySkipPermissions: ${session.dangerouslySkipPermissions}`);
    const baseFlags = ["-p"];
    if (session.dangerouslySkipPermissions) {
      logger.info(`Adding --dangerously-skip-permissions flag`);
      baseFlags.push("--dangerously-skip-permissions");
    }
    baseFlags.push("--verbose", "--output-format=stream-json");

    // 1. 優先檢查當前 session 是否已有 Claude session ID（同個對話繼續）
    if (session.claudeSessionId) {
      logger.info(`Continuing same conversation with Claude session ID: ${session.claudeSessionId}`);
      claudeCommand = `npx -y @anthropic-ai/claude-code@latest ${baseFlags.join(" ")} --resume=${session.claudeSessionId}`;
    }
    // 2. 檢查是否要延續最近的對話（使用 --continue）
    else if (session.continueChat) {
      logger.info(`Continuing most recent conversation using --continue`);
      claudeCommand = `npx -y @anthropic-ai/claude-code@latest ${baseFlags.join(" ")} --continue`;
    }
    // 3. 全新對話
    else {
      logger.info(`Starting new conversation`);
      claudeCommand = `npx -y @anthropic-ai/claude-code@latest ${baseFlags.join(" ")}`;
    }

    if (session.dangerouslySkipPermissions) {
      logger.warn(`⚠️ DANGEROUS: Session ${sessionId} is running with --dangerously-skip-permissions`);
    }

    logger.info(`Executing Claude Code for session ${sessionId}`, {
      command: claudeCommand,
      workingDir: session.workingDir,
    });

    // 更新狀態為忙碌
    const processInfo = this.processInfo.get(sessionId);
    if (processInfo) {
      processInfo.status = ProcessStatus.BUSY;
      processInfo.lastActivityTime = new Date();
    }

    // 發送狀態更新事件
    this.emitStatusUpdate(sessionId, "processing");

    try {
      logger.info(`=== ProcessManager execution mode: useUnifiedProcessor=${this.useUnifiedProcessor}, useStreamMode=${this.useStreamMode} ===`);

      if (this.useUnifiedProcessor) {
        // 使用統一處理器（推薦）
        logger.info(`Using UnifiedStreamProcessor for session ${sessionId}`);
        await this.executeClaudeUnifiedCommand(sessionId, claudeCommand, content, session.workingDir);
      }

    } catch (error) {
      logger.error(`Failed to execute Claude Code:`, {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        sessionId,
        command: claudeCommand.slice(0, 200),
      });
      // 不要拋出錯誤，而是更新 session 狀態
      const sessionRepo = new SessionRepository();
      try {
        session.status = "error" as any;
        session.error = JSON.stringify({
          message: error instanceof Error ? error.message : "Execution failed",
          type: "EXECUTION_ERROR",
          timestamp: new Date().toISOString(),
        });
        session.updatedAt = new Date();
        await sessionRepo.update(session);
      } catch (updateError) {
        logger.error("Failed to update session status after error:", updateError);
      }
    }
  }

  /**
   * 使用統一處理器執行 Claude 命令 - 解決重複儲存問題
   */
  private async executeClaudeUnifiedCommand(sessionId: string, command: string, prompt: string, workingDir: string): Promise<void> {
    // 建立統一處理器
    const unifiedProcessor = new UnifiedStreamProcessor();
    this.unifiedProcessors.set(sessionId, unifiedProcessor);

    // 設定統一事件處理
    this.setupUnifiedEventHandlers(sessionId, unifiedProcessor);

    try {
      // 解析命令和參數
      const [cmd, ...args] = command.split(" ");

      // 使用統一處理器執行
      await unifiedProcessor.startProcess(sessionId, cmd, args, workingDir, prompt);
    } finally {
      // 清理資源
      unifiedProcessor.cleanup(sessionId);
      this.unifiedProcessors.delete(sessionId);
    }
  }

  /**
   * 設定統一處理器事件處理
   */
  private setupUnifiedEventHandlers(sessionId: string, unifiedProcessor: UnifiedStreamProcessor): void {
    // 即時訊息 - 直接轉發給前端
    unifiedProcessor.on("message", (message: ClaudeStreamMessage) => {
      this.emitMessage(message);
    });

    // 訊息開始
    unifiedProcessor.on("messageStart", (data: any) => {
      logger.info(`Message started: ${data.messageId}`, { sessionId });
    });

    // 訊息完成
    unifiedProcessor.on("messageComplete", (data: any) => {
      logger.info(`Message completed: ${data.messageId}`, { sessionId });
    });

    // Claude session ID
    unifiedProcessor.on("sessionId", async (data: { sessionId: string; claudeSessionId: string }) => {
      this.emitSessionId(data.sessionId, data.claudeSessionId);
      await this.updateSessionClaudeId(data.sessionId, data.claudeSessionId);
    });

    // 錯誤處理
    unifiedProcessor.on("error", (error: any) => {
      logger.error("Unified processor error:", error);
      this.emitError(error.sessionId || sessionId, error.error || "Unified processor error", error.errorType);
    });

    // 進程開始
    unifiedProcessor.on("processStarted", (data: any) => {
      this.emitProcessStarted(data.sessionId, data.pid);
    });

    // 進程結束
    unifiedProcessor.on("processExit", async (data: any) => {
      // 更新 session 狀態
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

      this.emitStatusUpdate(sessionId, "idle");
      this.emitProcessExit(data.sessionId, data.code, data.usage);

      // 發送完成通知
      const notificationService = getNotificationService();
      const session = await this.sessionRepository.findById(sessionId);
      if (session) {
        notificationService
          .notify({
            title: "Claude Code Board",
            message: `任務執行完成：${session.name}`,
            sound: true,
          })
          .catch((err) => {
            logger.warn("Failed to send notification:", err);
          });
      }
    });

    // 原始輸出
    unifiedProcessor.on("output", (data: any) => {
      logger.debug("Raw output:", data);
    });
  }

  private async updateSessionClaudeId(sessionId: string, claudeSessionId: string): Promise<void> {
    // 更新 session 的 Claude session ID
    const { SessionRepository } = require("../repositories/SessionRepository");
    const sessionRepo = new SessionRepository();

    try {
      const session = await sessionRepo.findById(sessionId);
      if (session) {
        session.claudeSessionId = claudeSessionId;
        await sessionRepo.update(session);
        logger.info(`Updated Claude session ID for ${sessionId}: ${claudeSessionId}`);
      }
    } catch (error) {
      logger.error(`Failed to update Claude session ID:`, error);
    }
  }

  private async getSessionInfo(sessionId: string): Promise<any> {
    try {
      const session = await this.sessionRepository.findById(sessionId);
      if (!session) {
        return null;
      }

      return {
        sessionId: session.sessionId,
        workingDir: session.workingDir,
        continueChat: session.continueChat || false,
        previousSessionId: session.previousSessionId,
        claudeSessionId: session.claudeSessionId,
        dangerouslySkipPermissions: session.dangerouslySkipPermissions || false,
      };
    } catch (error) {
      logger.error(`Failed to get session info for ${sessionId}:`, error);

      const processInfo = this.processInfo.get(sessionId);
      if (!processInfo) {
        return null;
      }

      return {
        sessionId,
        workingDir: processInfo.workingDirectory,
        continueChat: false,
      };
    }
  }

  async stopProcess(sessionId: string): Promise<void> {
    const processInfo = this.processInfo.get(sessionId);

    if (!processInfo) {
      logger.warn(`Process info not found for session ${sessionId}`);
      return;
    }

    processInfo.status = ProcessStatus.STOPPED;
    logger.info(`Stopping session ${sessionId}`);

    await this.saveSessionHistory(sessionId);
    this.processInfo.delete(sessionId);
    this.emit("processStopped", { sessionId });
  }

  private async saveSessionHistory(sessionId: string): Promise<void> {
    try {
      const historyPath = path.join("./data/sessions", `${sessionId}.history`);
      const messages = await this.messageRepository.getRecentMessages(sessionId, 1000);

      const historyData = {
        sessionId,
        savedAt: new Date().toISOString(),
        messageCount: messages.length,
        messages: messages.map((msg) => ({
          type: msg.type,
          content: msg.content,
          timestamp: msg.timestamp,
        })),
      };

      fs.writeFileSync(historyPath, JSON.stringify(historyData, null, 2));
      logger.info(`Session history saved: ${historyPath}`);
    } catch (error) {
      logger.error(`Failed to save session history for ${sessionId}:`, error);
    }
  }

  async interruptProcess(sessionId: string): Promise<void> {
    // 檢查是否有統一處理器
    const unifiedProcessor = this.unifiedProcessors.get(sessionId);
    if (unifiedProcessor) {
      unifiedProcessor.interrupt();
      unifiedProcessor.cleanup(sessionId);
      this.unifiedProcessors.delete(sessionId);
    }

    // 檢查是否有串流處理器（相容性）
    const streamProcessor = this.streamProcessors.get(sessionId);
    if (streamProcessor) {
      streamProcessor.interrupt();
      this.streamProcessors.delete(sessionId);

      // 清理訊息累積器
      const messageAccumulator = this.messageAccumulators.get(sessionId);
      if (messageAccumulator) {
        messageAccumulator.cleanup(sessionId);
        this.messageAccumulators.delete(sessionId);
      }
    }

    const processInfo = this.processInfo.get(sessionId);

    if (!processInfo) {
      throw new Error(`Process info not found for session ${sessionId}`);
    }

    // 如果有 PID，嘗試終止進程
    if (processInfo.pid && processInfo.pid > 0) {
      try {
        // 在 Windows 上使用 taskkill，其他平台使用 kill
        if (process.platform === "win32") {
          // 使用 /T 參數終止進程樹（包含所有子進程）
          exec(`taskkill /F /T /PID ${processInfo.pid}`, (error) => {
            if (error) {
              logger.warn(`Failed to kill process ${processInfo.pid}:`, error);
              // 如果失敗，嘗試使用進程名稱
              exec(`taskkill /F /IM node.exe /FI "PID eq ${processInfo.pid}"`, (killError) => {
                if (killError) {
                  logger.error(`Failed to kill process by name:`, killError);
                }
              });
            } else {
              logger.info(`Successfully killed process ${processInfo.pid}`);
            }
          });
        } else {
          // 先嘗試 SIGTERM，然後 SIGKILL
          process.kill(processInfo.pid, "SIGTERM");
          setTimeout(() => {
            try {
              process.kill(processInfo.pid, "SIGKILL");
            } catch (e) {
              // 進程可能已經結束
            }
          }, 1000);
        }
      } catch (error) {
        logger.warn(`Failed to interrupt process:`, error);
      }
    }

    // 從 Map 中移除進程資訊
    this.processInfo.delete(sessionId);

    // 發送中斷事件和狀態更新
    this.emitStatusUpdate(sessionId, "idle");

    // 儲存中斷訊息
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

  getProcess(sessionId: string): any {
    // 使用 npx 模式時，我們不維護長期運行的進程
    return undefined;
  }

  getProcessInfo(sessionId: string): ProcessInfo | undefined {
    return this.processInfo.get(sessionId);
  }

  getAllProcessInfo(): ProcessInfo[] {
    return Array.from(this.processInfo.values());
  }

  getActiveProcessCount(): number {
    return this.processInfo.size;
  }

  async getProcessMetrics(sessionId: string): Promise<ProcessMetrics | null> {
    const processInfo = this.processInfo.get(sessionId);

    if (!processInfo) {
      return null;
    }

    const metrics: ProcessMetrics = {
      sessionId,
      timestamp: new Date(),
      memoryUsage: {
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
      },
      cpuUsage: {
        user: 0,
        system: 0,
      },
      uptime: (Date.now() - processInfo.startTime.getTime()) / 1000,
    };

    return metrics;
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);

    logger.info("Health check started", { interval: this.config.healthCheckInterval });
  }

  private async performHealthCheck(): Promise<void> {
    const now = Date.now();
    const toStop: string[] = [];

    for (const [sessionId, processInfo] of this.processInfo.entries()) {
      const idleTime = now - processInfo.lastActivityTime.getTime();
      if (idleTime > this.config.maxIdleTime) {
        logger.info(`Session ${sessionId} has been idle for too long:`, {
          idleTime: idleTime / 1000 / 60,
          maxIdleMinutes: this.config.maxIdleTime / 1000 / 60,
        });
        toStop.push(sessionId);
        continue;
      }
    }

    for (const sessionId of toStop) {
      try {
        await this.stopProcess(sessionId);
        this.emit("processCleanedUp", { sessionId, reason: "health_check" });
      } catch (error) {
        logger.error(`Failed to stop session ${sessionId} during health check:`, error);
      }
    }

    if (this.config.enableMetrics) {
      this.emit("healthCheck", {
        totalSessions: this.processInfo.size,
        cleanedUp: toStop.length,
        timestamp: new Date(),
      });
    }
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down ClaudeCodeProvider...");

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const stopPromises = Array.from(this.processInfo.keys()).map((sessionId) => this.stopProcess(sessionId).catch((error) => logger.error(`Error stopping session ${sessionId}:`, error)));

    await Promise.all(stopPromises);

    logger.info("ClaudeCodeProvider shutdown complete");
  }

  /**
   * 設定處理器模式
   */
  setProcessorMode(mode: "unified" | "stream" | "legacy"): void {
    switch (mode) {
      case "unified":
        this.useUnifiedProcessor = true;
        this.useStreamMode = true;
        logger.info("Switched to unified processor mode");
        break;
      case "stream":
        this.useUnifiedProcessor = false;
        this.useStreamMode = true;
        logger.info("Switched to legacy stream processor mode");
        break;
      case "legacy":
        this.useUnifiedProcessor = false;
        this.useStreamMode = false;
        logger.info("Switched to legacy batch processor mode");
        break;
    }
  }

  /**
   * 獲取當前處理器模式
   */
  getProcessorMode(): string {
    if (this.useUnifiedProcessor) {
      return "unified";
    } else if (this.useStreamMode) {
      return "stream";
    } else {
      return "legacy";
    }
  }

  /**
   * 獲取處理器統計資訊
   */
  getProcessorStats(): any {
    return {
      mode: this.getProcessorMode(),
      unifiedProcessors: this.unifiedProcessors.size,
      streamProcessors: this.streamProcessors.size,
      messageAccumulators: this.messageAccumulators.size,
      totalActiveSessions: this.processInfo.size,
    };
  }
}
