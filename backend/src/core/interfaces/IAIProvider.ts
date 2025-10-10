import { EventEmitter } from 'events';
import { ClaudeStreamMessage } from '../../types/process.types';
import { Session } from '../../types/session.types';

/**
 * 統一的 AI Provider 介面
 *
 * 核心設計原則：
 * 1. 統一的事件發送介面 - 所有 provider 都發送 ClaudeStreamMessage 格式
 * 2. 統一的生命週期管理 - init, sendMessage, interrupt, stop
 * 3. 每個 provider 內部負責自己的訊息格式轉換
 */
export interface IAIProvider extends EventEmitter {
  /**
   * 初始化 Provider
   */
  initialize(): Promise<void>;

  /**
   * 啟動會話
   * @param session 會話資訊
   */
  startSession(session: Session): Promise<void>;

  /**
   * 發送訊息
   * @param sessionId 會話 ID
   * @param content 訊息內容
   */
  sendMessage(sessionId: string, content: string): Promise<void>;

  /**
   * 中斷當前執行
   * @param sessionId 會話 ID
   */
  interrupt(sessionId: string): Promise<void>;

  /**
   * 停止會話
   * @param sessionId 會話 ID
   */
  stop(sessionId: string): Promise<void>;

  /**
   * 獲取 Provider 類型
   */
  getType(): 'claude-code' | 'codex';

  /**
   * 檢查會話是否活躍
   * @param sessionId 會話 ID
   */
  isSessionActive(sessionId: string): boolean;
}

/**
 * Provider 事件
 *
 * 所有 Provider 都必須發送這些標準事件：
 * - 'message': ClaudeStreamMessage - 訊息事件（前端直接使用）
 * - 'statusUpdate': { sessionId: string, status: string } - 狀態更新
 * - 'processStarted': { sessionId: string, pid?: number } - 進程開始
 * - 'processExit': { sessionId: string, code: number, usage?: any } - 進程結束
 * - 'sessionId': { sessionId: string, claudeSessionId: string } - Claude 會話 ID
 * - 'error': { sessionId: string, error: string, errorType?: string } - 錯誤事件
 */
export interface AIProviderEvents {
  message: (message: ClaudeStreamMessage) => void;
  statusUpdate: (data: { sessionId: string; status: string }) => void;
  processStarted: (data: { sessionId: string; pid?: number }) => void;
  processExit: (data: { sessionId: string; code: number; usage?: any }) => void;
  sessionId: (data: { sessionId: string; claudeSessionId: string }) => void;
  error: (data: { sessionId: string; error: string; errorType?: string; timestamp?: Date }) => void;
}

/**
 * 基礎 AI Provider 實作
 * 提供通用的事件發送邏輯
 */
export abstract class BaseAIProvider extends EventEmitter implements IAIProvider {
  abstract initialize(): Promise<void>;
  abstract startSession(session: Session): Promise<void>;
  abstract sendMessage(sessionId: string, content: string): Promise<void>;
  abstract interrupt(sessionId: string): Promise<void>;
  abstract stop(sessionId: string): Promise<void>;
  abstract getType(): 'claude-code' | 'codex';
  abstract isSessionActive(sessionId: string): boolean;

  /**
   * 發送標準化訊息到前端
   * 所有 Provider 都使用這個方法發送 ClaudeStreamMessage
   */
  protected emitMessage(message: ClaudeStreamMessage): void {
    this.emit('message', message);
  }

  /**
   * 發送狀態更新
   */
  protected emitStatusUpdate(sessionId: string, status: string): void {
    this.emit('statusUpdate', { sessionId, status });
  }

  /**
   * 發送進程開始事件
   */
  protected emitProcessStarted(sessionId: string, pid?: number): void {
    this.emit('processStarted', { sessionId, pid });
  }

  /**
   * 發送進程結束事件
   */
  protected emitProcessExit(sessionId: string, code: number, usage?: any): void {
    this.emit('processExit', { sessionId, code, usage });
  }

  /**
   * 發送會話 ID
   */
  protected emitSessionId(sessionId: string, claudeSessionId: string): void {
    this.emit('sessionId', { sessionId, claudeSessionId });
  }

  /**
   * 發送錯誤事件
   */
  protected emitError(sessionId: string, error: string, errorType?: string): void {
    this.emit('error', { sessionId, error, errorType, timestamp: new Date() });
  }
}