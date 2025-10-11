import { IAITool } from '../interfaces/IAITool';
import { ClaudeCodeAdapter } from '../adapters/ClaudeCodeAdapter';

export class AIToolFactory {
  static createTool(toolType: string): IAITool {
    switch (toolType) {
      case 'claude':
        return new ClaudeCodeAdapter();
      // Future tools can be added here
      // case 'gemini':
      //   return new GeminiAdapter();
      default:
        throw new Error(`Unsupported AI tool type: ${toolType}`);
    }
  }
}
