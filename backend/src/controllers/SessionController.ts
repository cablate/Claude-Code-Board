import { NextFunction, Request, Response } from "express";
import { io } from "../server";
import { SessionService } from "../services/SessionService";
import { CreateSessionRequest } from "../types/session.types";
import { logger } from "../utils/logger";

export class SessionController {
  constructor(private sessionService: SessionService) {}

  async createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const createRequest: CreateSessionRequest = req.body;
      const session = await this.sessionService.createSession(createRequest);
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  }

  async listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessions = await this.sessionService.listSessions();
      res.json(sessions);
    } catch (error) {
      next(error);
    }
  }

  async getSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId } = req.params;
      const session = await this.sessionService.getSession(sessionId);

      if (!session) {
        res.status(404).json({
          error_code: "SESSION_NOT_FOUND",
          error_message: "Session not found",
        });
        return;
      }

      res.json(session);
    } catch (error) {
      next(error);
    }
  }

  async completeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId } = req.params;
      const session = await this.sessionService.completeSession(sessionId);

      if (!session) {
        res.status(404).json({
          error_code: "SESSION_NOT_FOUND",
          error_message: "Session not found",
        });
        return;
      }

      // Notify WebSocket clients
      io.to(`session:${sessionId}`).emit("status_update", {
        sessionId,
        status: session.status,
        completedAt: session.completedAt,
      });

      res.json(session);
    } catch (error) {
      next(error);
    }
  }

  async deleteSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId } = req.params;
      await this.sessionService.deleteSession(sessionId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  async sendMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { content } = req.body;

      logger.info(`=== SessionController.sendMessage START ===`);
      logger.info(`SessionId: ${sessionId}`);
      logger.info(`Content: ${content?.slice(0, 100)}`);

      const message = await this.sessionService.sendMessage(sessionId, content);

      logger.info(`SessionService returned message:`, message);

      logger.info(`=== SessionController.sendMessage END ===`);
      res.json(message);
    } catch (error) {
      logger.error(`SessionController.sendMessage error:`, error);
      next(error);
    }
  }

  async getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      logger.info(`=== SessionController.getMessages START ===`);
      logger.info(`SessionId: ${sessionId}`);
      logger.info(`Page: ${page}, Limit: ${limit}`);

      const messages = await this.sessionService.getMessages(sessionId, Number(page), Number(limit));

      logger.info(`Retrieved ${messages?.messages?.length || 0} messages`);

      res.json(messages);
    } catch (error) {
      logger.error(`SessionController.getMessages error:`, error);
      next(error);
    }
  }

  async interruptSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId } = req.params;
      const session = await this.sessionService.interruptSession(sessionId);

      // Notify WebSocket clients
      io.to(`session:${sessionId}`).emit("status_update", {
        sessionId,
        status: session.status,
      });

      res.json(session);
    } catch (error) {
      next(error);
    }
  }

  async resumeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId } = req.params;
      const session = await this.sessionService.resumeSession(sessionId);

      // Notify WebSocket clients
      io.to(`session:${sessionId}`).emit("status_update", {
        sessionId,
        status: session.status,
      });

      res.json(session);
    } catch (error) {
      next(error);
    }
  }

  async getSystemStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await this.sessionService.getSystemStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  }

  async reorderSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, sessionIds } = req.body;

      if (!status || !Array.isArray(sessionIds)) {
        res.status(400).json({
          error_code: "INVALID_REQUEST",
          error_message: "Status and sessionIds array are required",
        });
        return;
      }

      await this.sessionService.reorderSessions(status, sessionIds);

      // Notify all clients about the reorder
      io.emit("sessions_reordered", { status, sessionIds });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
