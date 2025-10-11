export interface Session {
  sessionId: string;
  name: string;
  workingDir: string;
  task: string;
  status: SessionStatus;
  continueChat: boolean;
  previousSessionId?: string;
  claudeSessionId?: string; // Claude Code 的實際 session ID
  processId?: number;
  dangerouslySkipPermissions?: boolean;
  lastUserMessage?: string; // 最後用戶發送的訊息
  messageCount?: number; // 對話次數
  sortOrder?: number; // 排序順序
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  deletedAt?: Date;
  error?: string | null;
  // 工作流程階段
  workflow_stage_id?: string;
  workflow_stage?: {
    stage_id: string;
    name: string;
    color?: string;
    icon?: string;
    system_prompt?: string;
    temperature?: number;
    suggested_tasks?: string[];
  };
  // Work Item 關聯
  work_item_id?: string;
  // 分類相關
  projects?: Array<{
    project_id: string;
    name: string;
    color?: string;
    icon?: string;
  }>;
  tags?: Array<{
    tag_id: string;
    name: string;
    color?: string;
    type: string;
  }>;
}

export enum SessionStatus {
  INITIALIZING = 'initializing',
  PROCESSING = 'processing',
  IDLE = 'idle',
  COMPLETED = 'completed',
  ERROR = 'error',
  INTERRUPTED = 'interrupted',
  CRASHED = 'crashed'
}

export interface CreateSessionRequest {
  name: string;
  workingDir: string;
  task: string;
  continueChat?: boolean;
  previousSessionId?: string;
  dangerouslySkipPermissions?: boolean;
  workflow_stage_id?: string;
  work_item_id?: string;
}

export interface SessionResponse {
  sessionId: string;
  name: string;
  status: SessionStatus;
  workingDir: string;
  task?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface ErrorResponse {
  error_code: string;
  error_message: string;
  details?: any;
}