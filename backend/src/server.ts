import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { getEnvConfig } from "./config/env.config";
import { Database } from "./database/database";
import { errorHandler } from "./middleware/error.middleware";
import { ClaudeCodeProvider } from "./services/ClaudeCodeProvider";
import { logger } from "./utils/logger";

const config = getEnvConfig();
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Routes - 延遲到 claudeCodeProvider 初始化後再載入
// app.use('/api/sessions', sessionRouter);

// Error handling
app.use(errorHandler);

// WebSocket handling
io.on("connection", (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on("subscribe", (sessionId: string) => {
    socket.join(`session:${sessionId}`);
    logger.info(`Client ${socket.id} subscribed to session ${sessionId}`);
  });

  socket.on("unsubscribe", (sessionId: string) => {
    socket.leave(`session:${sessionId}`);
    logger.info(`Client ${socket.id} unsubscribed from session ${sessionId}`);
  });

  socket.on("disconnect", () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Export for use in other modules
export { io };

// Initialize database and start server
const PORT = config.port;

// Global ClaudeCodeProvider instance
let claudeCodeProvider: ClaudeCodeProvider;

// 全局錯誤處理
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  // 不要退出程序，繼續運行
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  // 不要退出程序，繼續運行
});

async function startServer() {
  try {
    // 1. 初始化基礎服務
    const db = Database.getInstance();
    await db.initialize();
    logger.info("Database initialized successfully");

    const { agentPromptService } = await import("./services/AgentPromptService");
    await agentPromptService.initialize();
    logger.info("Agent Prompt Service initialized");

    // 2. 初始化核心服務
    claudeCodeProvider = new ClaudeCodeProvider();
    await claudeCodeProvider.initialize();
    logger.info("ClaudeCodeProvider initialized");

    const { SessionService } = await import("./services/SessionService");
    const sessionService = new SessionService(claudeCodeProvider);
    await sessionService.initialize();
    logger.info("Session Service initialized");

    try {
      // 建立路由處理器並注入 sessionService 實例
      const router = await (await import("./routes/session.routes")).createSessionRouter(sessionService);

      // 載入認證中介軟體
      const auth = await import("./middleware/auth.middleware");
      app.use("/api/sessions", auth.authMiddleware, router);
      logger.info("Routes initialized");
    } catch (error) {
      logger.error("Error during initialization:", error);
      throw error;
    }

    // 設定 ClaudeCodeProvider 錯誤處理，防止程序崩潰
    claudeCodeProvider.on("error", (data) => {
      logger.error(`ClaudeCodeProvider error for session ${data.sessionId}:`, {
        error: data.error,
        errorType: data.errorType,
        details: data.details,
        timestamp: data.timestamp,
      });
      // 將結構化錯誤轉發給訂閱的客戶端
      io.to(`session:${data.sessionId}`).emit("error", {
        sessionId: data.sessionId,
        error: data.error,
        errorType: data.errorType,
        details: data.details,
        timestamp: data.timestamp,
      });
    });

    // 設定 ClaudeCodeProvider 事件處理，用於 WebSocket 推送
    claudeCodeProvider.on("message", (data) => {
      logger.info(`=== WebSocket: Received message event from ClaudeCodeProvider ===`);
      logger.info(`SessionId: ${data.sessionId}, Type: ${data.type}, Content: ${data.content?.slice(0, 100)}`);

      // 檢查是否有客戶端訂閱這個 session
      const room = `session:${data.sessionId}`;
      const clientsInRoom = io.sockets.adapter.rooms.get(room);
      logger.info(`Clients in room ${room}:`, clientsInRoom ? Array.from(clientsInRoom) : "No clients");

      // 發送通用的 message 事件和特定類型事件，前端會過濾重複
      logger.info(`Emitting message to room: ${room}, type: ${data.type}`);
      io.to(room).emit("message", data);

      // 同時發送特定類型事件，確保前端兼容性
      if (data.type === "assistant") {
        io.to(room).emit("assistant", data);
      } else if (data.type === "user") {
        io.to(room).emit("user", data);
      } else if (data.type === "system") {
        io.to(room).emit("system", data);
      }

      logger.info(`=== WebSocket: Message forwarding completed ===`);
    });

    claudeCodeProvider.on("output", (data) => {
      io.to(`session:${data.sessionId}`).emit("output", data);
    });

    claudeCodeProvider.on("statusUpdate", (data) => {
      // 發送到特定 session 房間（詳細頁面使用）
      io.to(`session:${data.sessionId}`).emit("status_update", data);
      // 同時發送全域事件（列表頁面使用）
      io.emit("global_status_update", data);
    });

    claudeCodeProvider.on("processStarted", (data) => {
      io.emit("process_started", data);
    });

    claudeCodeProvider.on("processExit", (data) => {
      // 發送到特定 session 房間（詳細頁面使用）
      io.to(`session:${data.sessionId}`).emit("process_exit", data);
      // 同時發送全域事件（列表頁面使用）
      io.emit("global_process_exit", data);
    });

    // 動態載入所有路由
    const sessionRouter = await (await import("./routes/session.routes")).createSessionRouter(sessionService);

    // Auth routes (不需要認證)
    const authRouter = (await import("./routes/auth.routes")).default;
    app.use("/api/auth", authRouter);

    // Common paths routes (需要認證)
    const commonPathRouter = (await import("./routes/commonPath.routes")).default;

    // Project routes (需要認證)
    const projectRouter = (await import("./routes/project.routes")).default;

    // Tag routes (需要認證)
    const tagRouter = (await import("./routes/tag.routes")).default;

    // Workflow Stage routes (需要認證)
    const workflowStageRouter = (await import("./routes/workflowStage.routes")).default;

    // Work Item routes (需要認證)
    const { workItemRouter } = await import("./routes/workitem.routes");

    // Agent Prompts routes (需要認證)
    const agentPromptsRouter = (await import("./routes/agentPrompts")).default;

    // Task Template routes (需要認證)
    const taskTemplateRouter = (await import("./routes/taskTemplate.routes")).default;

    // Session routes (需要認證)
    const { authMiddleware } = await import("./middleware/auth.middleware");
    app.use("/api/sessions", authMiddleware, sessionRouter);
    app.use("/api/common-paths", authMiddleware, commonPathRouter);
    app.use("/api/projects", authMiddleware, projectRouter);
    app.use("/api/tags", authMiddleware, tagRouter);
    app.use("/api/workflow-stages", authMiddleware, workflowStageRouter);
    app.use("/api/work-items", authMiddleware, workItemRouter);
    app.use("/api/agent-prompts", authMiddleware, agentPromptsRouter);
    app.use("/api/task-templates", authMiddleware, taskTemplateRouter);

    logger.info("Routes initialized successfully");

    // Start HTTP server
    httpServer.listen(PORT, "0.0.0.0", () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`WebSocket server is ready`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Export process manager for use in other modules
export { claudeCodeProvider };

// Handle graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully");
  await gracefulShutdown();
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  await gracefulShutdown();
});

async function gracefulShutdown() {
  try {
    // Shutdown process manager first
    if (claudeCodeProvider) {
      await claudeCodeProvider.shutdown();
      logger.info("claudeCodeProvider shutdown complete");
    }

    // Close database connection
    const db = Database.getInstance();
    await db.close();
    logger.info("Database closed");

    // Close HTTP server
    httpServer.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
}

startServer();
