import { EventEmitter } from 'events';
import { Session } from '../types/session.types';
import { ProcessInfo, ProcessStatus } from '../types/process.types';
import { MessageRepository } from '../repositories/MessageRepository';
import { SessionRepository } from '../repositories/SessionRepository';
import { logger } from '../utils/logger';
import { IAITool } from '../interfaces/IAITool';
import { AIToolFactory } from '../factories/AIToolFactory';
import { AIStreamMessage } from '../interfaces/IAIMessage';

/**
 * AIToolManager - Manages different AI tool adapters.
 */
export class AIToolManager extends EventEmitter {
  private activeTools: Map<string, IAITool> = new Map();
  private messageRepository: MessageRepository;
  private sessionRepository: SessionRepository;

  constructor() {
    super();
    this.messageRepository = new MessageRepository();
    this.sessionRepository = new SessionRepository();
    logger.info('AIToolManager initialized');
  }

  async startToolProcess(session: Session, toolType: string = 'claude'): Promise<number> {
    if (this.activeTools.has(session.sessionId)) {
      throw new Error(`A tool is already active for session ${session.sessionId}`);
    }

    const adapter = AIToolFactory.createTool(toolType);
    this.activeTools.set(session.sessionId, adapter);

    this.setupAdapterEventHandlers(session.sessionId, adapter);

    const pid = await adapter.start(session);
    this.emit('processStarted', { sessionId: session.sessionId, pid });

    return pid;
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const adapter = this.activeTools.get(sessionId);
    if (!adapter) {
      throw new Error(`No active tool found for session ${sessionId}`);
    }

    // Save user message before sending
    await this.messageRepository.save({ sessionId, type: 'user', content });
    this.emit('message', { sessionId, type: 'user', content, timestamp: new Date() });

    this.emit('statusUpdate', { sessionId, status: 'processing' });
    await adapter.sendMessage(sessionId, content);
  }

  async interruptProcess(sessionId: string): Promise<void> {
    const adapter = this.activeTools.get(sessionId);
    if (!adapter) {
      throw new Error(`No active tool found for session ${sessionId}`);
    }
    await adapter.interrupt(sessionId);
    this.emit('statusUpdate', { sessionId, status: 'idle' });
  }

  async stopProcess(sessionId: string): Promise<void> {
    const adapter = this.activeTools.get(sessionId);
    if (adapter) {
      await adapter.stop(sessionId);
      this.activeTools.delete(sessionId);
      this.emit('processStopped', { sessionId });
    }
  }

  private setupAdapterEventHandlers(sessionId: string, adapter: IAITool): void {
    adapter.on('message', (message: AIStreamMessage) => {
      // Forward message to be sent to the client via WebSocket
      this.emit('message', message);
    });

    adapter.on('processExit', (data: { sessionId: string; code: number | null }) => {
      this.emit('statusUpdate', { sessionId: data.sessionId, status: 'idle' });
      this.emit('processExit', data);
      this.activeTools.delete(data.sessionId);
    });

    adapter.on('error', (error: any) => {
      logger.error('Adapter error:', error);
      this.emit('error', error);
      this.emit('statusUpdate', { sessionId, status: 'error' });
    });
  }

  public isToolActive(sessionId: string): boolean {
    return this.activeTools.has(sessionId);
  }

  getProcessInfo(sessionId: string): ProcessInfo | undefined {
    const adapter = this.activeTools.get(sessionId);
    // This is a simplified representation. The adapter should ideally provide this.
    if (adapter) {
        // This is a placeholder. The adapter should provide the real ProcessInfo.
        return {
            sessionId: sessionId,
            pid: 0,
            startTime: new Date(),
            status: ProcessStatus.RUNNING, // Or get it from adapter.getStatus(sessionId)
            memoryUsage: 0,
            cpuUsage: 0,
            workingDirectory: '',
            commandArgs: [],
            lastActivityTime: new Date(),
        };
    }
    return undefined;
  }

  getAllProcessInfo(): ProcessInfo[] {
    return Array.from(this.activeTools.keys()).map(sessionId => this.getProcessInfo(sessionId)).filter(p => p) as ProcessInfo[];
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down AIToolManager...');
    const stopPromises = Array.from(this.activeTools.keys()).map(sessionId =>
      this.stopProcess(sessionId).catch(error =>
        logger.error(`Error stopping tool for session ${sessionId}:`, error)
      )
    );
    await Promise.all(stopPromises);
    logger.info('AIToolManager shutdown complete');
  }
}
