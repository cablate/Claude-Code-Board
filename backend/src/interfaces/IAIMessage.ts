import { UnifiedMessageType } from './UnifiedMessage';

type AIStreamMessageType = Exclude<UnifiedMessageType, 'output'>;

export interface AIStreamMessage {
  sessionId: string;
  type: AIStreamMessageType;
  content: string;
  timestamp: Date;
  metadata?: {
    toolName?: string;
    aiProvider?: 'claude' | 'codex' | 'gemini' | 'copilot';
    originalFormat?: any;
    toolInput?: any;
    isPartial?: boolean;
  };
}
