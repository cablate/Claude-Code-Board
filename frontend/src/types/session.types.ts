export interface Session {
  sessionId: string;
  name: string;
  workingDir: string;
  task: string;
  status: SessionStatus;
  continueChat?: boolean;
  previousSessionId?: string;
  claudeSessionId?: string;
  processId?: number;
  dangerouslySkipPermissions?: boolean;
  lastUserMessage?: string;
  messageCount?: number;
  sortOrder?: number;
  error?: string;
  // CLI 類型相關
  cliType?: 'claude-code' | 'codex';
  codexConfig?: any;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  deletedAt?: Date;
  // Work Item 關聯
  work_item_id?: string;
  // 工作流程階段
  workflow_stage_id?: string;
  workflow_stage?: {
    stage_id: string;
    name: string;
    color?: string;
    icon?: string;
    description?: string;
  };
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
  PROCESSING = 'processing',
  IDLE = 'idle',
  COMPLETED = 'completed',
  ERROR = 'error',
  INTERRUPTED = 'interrupted'
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
  // CLI 類型相關
  cliType?: 'claude-code' | 'codex';
  codexConfig?: any;
}

export interface Message {
  messageId: string;
  sessionId: string;
  type: 'user' | 'claude' | 'assistant' | 'system' | 'tool_use' | 'thinking' | 'output' | 'error';
  content: string;
  timestamp: Date;
  compressed?: boolean;
  originalSize?: number;
  compressedSize?: number;
  metadata?: {
    isStreaming?: boolean;
    isPartial?: boolean;
    sequenceId?: string;
    status?: 'sending' | 'sent' | 'failed';
    [key: string]: any;
  };
}

export interface ProcessInfo {
  sessionId: string;
  pid: number;
  startTime: Date;
  status: ProcessStatus;
  memoryUsage: number;
  cpuUsage: number;
  workingDirectory: string;
  commandArgs: string[];
  lastActivityTime: Date;
}

export enum ProcessStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  IDLE = 'idle',
  BUSY = 'busy',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error',
  CRASHED = 'crashed'
}

export interface SystemStats {
  totalProcesses: number;
  processes: ProcessInfo[];
  systemStatus: 'active' | 'idle';
  memory?: {
    used: number;
    total: number;
    free: number;
  };
  cpu?: {
    usage: number;
  };
}