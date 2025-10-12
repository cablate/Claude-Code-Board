import { EventEmitter } from 'events';
import { IAITool } from '../../interfaces/IAITool';
import { ProcessStatus } from '../../types/process.types';
import { Session } from '../../types/session.types';
import { SessionRepository } from '../../repositories/SessionRepository';
import { logger } from '../../utils/logger';
import { ClaudeCodeStreamController } from './ClaudeCodeStreamController';
import { AIStreamMessage } from '../../interfaces/IAIMessage';
import { UnifiedMessage } from '../../interfaces/UnifiedMessage';
import { MessageRepository } from '../../repositories/MessageRepository';

export class ClaudeCodeToolAdapter extends EventEmitter implements IAITool {
  private sessionRepository: SessionRepository;
  private messageRepository: MessageRepository;
  private activeControllers: Map<string, ClaudeCodeStreamController> = new Map();

  constructor() {
    super();
    this.sessionRepository = new SessionRepository();
    this.messageRepository = new MessageRepository();
  }

  async start(session: Session): Promise<number> {
    // Adapter 僅初始化，不直接啟動行程，首次 sendMessage 時才啟動
    return Promise.resolve(process.pid);
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const baseFlags = ['-p'];
    if (session.dangerouslySkipPermissions) {
      baseFlags.push('--dangerously-skip-permissions');
    }
    baseFlags.push('--verbose', '--output-format=stream-json');

    let claudeCommand: string;
    if (session.claudeSessionId) {
      claudeCommand = `npx -y @anthropic-ai/claude-code@latest ${baseFlags.join(' ')} --resume=${session.claudeSessionId}`;
    } else if (session.continueChat) {
      claudeCommand = `npx -y @anthropic-ai/claude-code@latest ${baseFlags.join(' ')} --continue`;
    } else {
      claudeCommand = `npx -y @anthropic-ai/claude-code@latest ${baseFlags.join(' ')}`;
    }

    logger.info(`Executing via ClaudeCodeStreamController: ${claudeCommand}`, { sessionId });
    const [command, ...args] = claudeCommand.split(' ');

    const controller = new ClaudeCodeStreamController();
    this.activeControllers.set(sessionId, controller);

    this.setupControllerEventHandlers(sessionId, controller);

    await controller.startProcess(sessionId, command, args, session.workingDir, content);
  }

  private setupControllerEventHandlers(sessionId: string, controller: ClaudeCodeStreamController): void {
    controller.on('message', (message: UnifiedMessage) => {
      if (message.type === 'output') {
        this.emit('output', message);
        return;
      }

      const adaptedMessage: AIStreamMessage = {
        sessionId: message.sessionId,
        type: message.type,
        content: message.content,
        timestamp: message.timestamp,
        metadata: {
          ...message.metadata,
          aiProvider: 'claude'
        }
      };

      this.emit('message', adaptedMessage);
    });

    controller.on('persistMessage', (message: UnifiedMessage) => {
      void this.persistUnifiedMessage(message);
    });

    controller.on('message_stop', () => {
      logger.info(`[ClaudeCodeToolAdapter] Received 'message_stop' for session ${sessionId}. Forcing a 'processExit' event.`);
      this.emit('processExit', { sessionId, code: 0 });
    });

    controller.on('processExit', (data: { sessionId: string; code: number | null }) => {
      this.emit('processExit', data);
      this.activeControllers.delete(sessionId);
    });

    controller.on('error', (error: any) => {
      this.emit('error', error);
    });

    controller.on('sessionId', (data: any) => {
      this.sessionRepository.updateClaudeSessionId(data.sessionId, data.claudeSessionId).catch(err =>
        logger.error(`Failed to update Claude session ID: ${err}`, { sessionId })
      );
    });
  }

  private async persistUnifiedMessage(message: UnifiedMessage): Promise<void> {
    try {
      await this.messageRepository.save({
        sessionId: message.sessionId,
        type: message.type,
        content: message.content,
        metadata: message.metadata
      });
    } catch (error) {
      logger.error(`Failed to persist message for session ${message.sessionId}: ${(error as Error).message}`, {
        sessionId: message.sessionId,
        type: message.type
      });
    }
  }

  interrupt(sessionId: string): Promise<void> {
    const controller = this.activeControllers.get(sessionId);
    if (controller) {
      controller.interrupt();
      this.activeControllers.delete(sessionId);
    } else {
      logger.warn(`No active ClaudeCode stream found to interrupt for session ${sessionId}`);
    }
    return Promise.resolve();
  }

  stop(sessionId: string): Promise<void> {
    return this.interrupt(sessionId);
  }

  getStatus(sessionId: string): ProcessStatus {
    return this.activeControllers.has(sessionId) ? ProcessStatus.RUNNING : ProcessStatus.IDLE;
  }
}
