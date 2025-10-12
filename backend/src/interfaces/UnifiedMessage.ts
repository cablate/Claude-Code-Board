export type UnifiedMessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'tool_use'
  | 'thinking'
  | 'output'
  | 'error';

export interface UnifiedMessage {
  sessionId: string;
  type: UnifiedMessageType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}
