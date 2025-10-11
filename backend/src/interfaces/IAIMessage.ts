export interface AIStreamMessage {
  sessionId: string;
  type: 'assistant' | 'user' | 'system' | 'tool_use' | 'thinking' | 'error';
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
