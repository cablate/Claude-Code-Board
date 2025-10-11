import { ProcessStatus } from '../types/process.types';
import { Session } from '../types/session.types';
import { EventEmitter } from 'events';

export interface IAITool extends EventEmitter {
  start(session: Session): Promise<number>;
  sendMessage(sessionId: string, content: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  getStatus(sessionId: string): ProcessStatus;
}
