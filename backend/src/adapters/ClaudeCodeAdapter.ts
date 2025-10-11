import { EventEmitter } from 'events';
import { IAITool } from '../interfaces/IAITool';
import { ProcessStatus } from '../types/process.types';
import { Session } from '../types/session.types';
import { SessionRepository } from '../repositories/SessionRepository';
import { logger } from '../utils/logger';
import { UnifiedStreamProcessor } from '../services/UnifiedStreamProcessor'; // Import the original processor
import { AIStreamMessage } from '../interfaces/IAIMessage';

export class ClaudeCodeAdapter extends EventEmitter implements IAITool {
  private sessionRepository: SessionRepository;
  private activeProcessors: Map<string, UnifiedStreamProcessor> = new Map();

  constructor() {
    super();
    this.sessionRepository = new SessionRepository();
  }

  async start(session: Session): Promise<number> {
    // The adapter doesn't start a process itself, it prepares for it.
    // The actual process is started on first sendMessage.
    return Promise.resolve(process.pid); // Return a virtual PID
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

    logger.info(`Executing via UnifiedStreamProcessor: ${claudeCommand}`, { sessionId });
    const [command, ...args] = claudeCommand.split(' ');

    const processor = new UnifiedStreamProcessor();
    this.activeProcessors.set(sessionId, processor);

    this._setupProcessorEventHandlers(sessionId, processor);

    // The promise from startProcess will resolve when the process exits.
    await processor.startProcess(sessionId, command, args, session.workingDir, content);
  }

  private _setupProcessorEventHandlers(sessionId: string, processor: UnifiedStreamProcessor): void {
    processor.on('message', (message: any) => {
        // Adapt and re-emit the message for AIToolManager
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

    processor.on('message_stop', () => {
        logger.info(`[Adapter] Received 'message_stop' for session ${sessionId}. Forcing a 'processExit' event.`);
        this.emit('processExit', { sessionId, code: 0 });
    });

    processor.on('processExit', (data: { sessionId: string; code: number | null }) => {
        this.emit('processExit', data);
        this.activeProcessors.delete(sessionId);
    });

    processor.on('error', (error: any) => {
        this.emit('error', error);
    });

    // Forward other events if necessary
    processor.on('sessionId', (data: any) => {
        this.sessionRepository.updateClaudeSessionId(data.sessionId, data.claudeSessionId).catch(err => 
            logger.error(`Failed to update Claude session ID: ${err}`, { sessionId })
        );
    });
  }

  interrupt(sessionId: string): Promise<void> {
    const processor = this.activeProcessors.get(sessionId);
    if (processor) {
      processor.interrupt();
      this.activeProcessors.delete(sessionId);
    } else {
      logger.warn(`No active processor found to interrupt for session ${sessionId}`);
    }
    return Promise.resolve();
  }

  stop(sessionId: string): Promise<void> {
    return this.interrupt(sessionId);
  }

  getStatus(sessionId: string): ProcessStatus {
    return this.activeProcessors.has(sessionId) ? ProcessStatus.RUNNING : ProcessStatus.IDLE;
  }
}