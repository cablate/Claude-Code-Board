import { Router } from "express";
import { SessionController } from "../controllers/SessionController";
import { SessionService } from "../services/SessionService";

export async function createSessionRouter(sessionService: SessionService): Promise<Router> {
  const router = Router();
  const sessionController = new SessionController(sessionService);

  // Session management routes
  router.post("/", sessionController.createSession.bind(sessionController));
  router.get("/", sessionController.listSessions.bind(sessionController));
  router.get("/:sessionId", sessionController.getSession.bind(sessionController));
  router.post("/:sessionId/complete", sessionController.completeSession.bind(sessionController));
  router.delete("/:sessionId", sessionController.deleteSession.bind(sessionController));

  // System stats route (must be before /:sessionId routes)
  router.get("/system/stats", sessionController.getSystemStats.bind(sessionController));

  // Session interaction routes
  router.post("/:sessionId/messages", sessionController.sendMessage.bind(sessionController));
  router.get("/:sessionId/messages", sessionController.getMessages.bind(sessionController));
  router.post("/:sessionId/interrupt", sessionController.interruptSession.bind(sessionController));
  router.post("/:sessionId/resume", sessionController.resumeSession.bind(sessionController));

  // Session reordering route
  router.put("/reorder", sessionController.reorderSessions.bind(sessionController));

  return router;
}
