import { When, Then } from '@cucumber/cucumber';
import { expect } from 'chai';
import { TestContext } from './world';
import { SessionService } from '../../src/services/SessionService';
import { AIToolManager } from '../../src/services/AIToolManager';
import { CreateSessionRequest, SessionStatus } from '../../src/types/session.types';

// Mock ProcessManager for testing
class MockAIToolManager extends AIToolManager {
  private testContext: TestContext;
  
  constructor(context: TestContext) {
    super();
    this.testContext = context;
  }
  
  async startToolProcess(session: any): Promise<number> {
    const mockPid = Math.floor(Math.random() * 10000) + 1000;
    this.testContext.mockProcesses.set(mockPid.toString(), {
      sessionId: session.sessionId,
      pid: mockPid,
      status: 'processing'
    });
    return mockPid;
  }
}

// 注入服務 (在實際實作中會使用依賴注入)
let sessionService: SessionService;

When('使用者建立新 Session，設定如下：', async function(this: TestContext, dataTable: any) {
  const data = dataTable.rowsHash();
  
  const request: CreateSessionRequest = {
    name: data['name'],
    workingDir: data['workingDir'],
    task: data['task'],
    continueChat: data['continueChat'] === 'true',
    previousSessionId: data['previousSessionId'],
    dangerouslySkipPermissions: data['dangerouslySkipPermissions'] === 'true'
  };
  
  try {
    // 調用服務層
    if (!sessionService) {
      sessionService = new SessionService();
      // 注入 Mock ProcessManager
      (sessionService as any).processManager = new MockAIToolManager(this);
    }
    
    const result = await sessionService.createSession(request);
    
    this.responseStatus = 201;
    this.responseBody = result;
    this.currentSession = result;
    this.sessions.set(result.sessionId, result);
  } catch (error: any) {
    this.responseStatus = error.statusCode || 500;
    this.responseBody = {
      error_code: error.code || 'INTERNAL_ERROR',
      error_message: error.message
    };
  }
});

Then('response 應包含 status {string}', async function(this: TestContext, status: string) {
  expect(this.responseBody).to.have.property('status', status);
});

Then('response 應包含 dangerouslySkipPermissions {string}', async function(this: TestContext, value: string) {
  const expectedValue = value === 'true';
  expect(this.responseBody).to.have.property('dangerouslySkipPermissions', expectedValue);
});

Then('系統應該啟動一個新的 Claude Code 進程', async function(this: TestContext) {
  // 驗證進程已啟動
  expect(this.currentSession).to.exist;
  expect(this.currentSession?.processId).to.be.a('number');
  expect(this.currentSession?.processId).to.be.greaterThan(0);
  
  // 驗證進程存在於模擬進程列表中
  const processId = this.currentSession?.processId;
  if (processId) {
    expect(this.mockProcesses.has(processId.toString())).to.be.true;
  }
});