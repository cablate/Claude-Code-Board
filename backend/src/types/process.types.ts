import type { UnifiedMessage } from '../interfaces/UnifiedMessage';

export interface ProcessInfo {
  sessionId: string;
  pid: number;
  startTime: Date;
  status: ProcessStatus;
  memoryUsage: number; // MB
  cpuUsage: number; // %
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

export interface ProcessMessage {
  sessionId: string;
  type: 'stdin' | 'stdout' | 'stderr' | 'status';
  content: string;
  timestamp: Date;
  metadata?: any;
}

// Claude 特定的訊息類型（維持別名以兼容舊程式碼）
export type ClaudeStreamMessage = UnifiedMessage;

// 工具使用記錄
export interface ToolUsageRecord {
  toolName: string;
  timestamp: Date;
  input?: any;
  output?: any;
  duration?: number;
  status: 'success' | 'error';
  error?: string;
}

export interface ProcessMetrics {
  sessionId: string;
  timestamp: Date;
  memoryUsage: {
    rss: number; // Resident Set Size
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  uptime: number; // seconds
}

export interface ClaudeCodeConfig {
  executablePath: string;
  defaultTimeout: number; // milliseconds
  maxConcurrentProcesses: number;
  healthCheckInterval: number; // milliseconds
  maxIdleTime: number; // milliseconds
  maxMemoryUsage: number; // MB
  enableMetrics: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface StartProcessOptions {
  workingDirectory: string;
  continueChat?: boolean;
  previousSessionPath?: string;
  initialTask?: string;
  timeout?: number;
  environment?: Record<string, string>;
  maxMemory?: number;
  priority?: 'low' | 'normal' | 'high';
}
