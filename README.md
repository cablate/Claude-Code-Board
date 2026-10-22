# Claude Code Board

> ## ⚠️ NOTICE: This project is no longer actively maintained.
>
> This repository is archived and will not receive updates, bug fixes, or new features.
>
> **The project is released under the MIT License** — you are free to fork, modify, distribute, and use it for any purpose, including commercial use, without restrictions. Feel free to take it and make it your own!
>
> 🌐 **Landing Page:** [https://cc-board.cablate.com](https://cc-board.cablate.com)

<div align="center">

![Claude Code Board](assets/banner.png)

**A comprehensive session management system for Claude Code with advanced workflow capabilities**

**📖 Language / 語言:** [English](README.md) | [繁體中文](README-zh-TW.md)

**⚠️ IMPORTANT:** [Read Disclaimer First](#️-disclaimer) | **🚀 Quick Start:** [Installation](#installation) | **📖 Guide:** [Usage](#-usage-guide)

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-no-red.svg)]()
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#requirements)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)](https://nodejs.org/)

</div>

## 🌟 Overview

Claude Code Board is a powerful web-based management system designed for developers working with Claude Code CLI. It provides an intuitive interface to manage multiple AI coding sessions simultaneously, with advanced features including workflow automation, agent-based prompting, and intelligent project organization.

![Session List Management](assets/SessionList.png)
*Main dashboard showcasing multiple active sessions with status tracking and management interface*


## 🆚 Why Claude Code Board vs Direct CLI?

### Enhanced CLI Experience
Claude Code CLI is excellent for single-focus coding sessions. However, when managing complex projects with multiple contexts, some additional capabilities become valuable:
- **Concurrent Development** - Working on multiple features or projects simultaneously
- **Session Organization** - Organizing conversations by project goals and development stages
- **Agent Workflow** - Streamlined switching between different AI specializations
- **Visual Management** - Web interface for better session overview and navigation


### Workflow Comparison

**Traditional CLI Workflow** 😤
```
1. Open project directory
2. Launch cmd/terminal window
3. Enter Claude Code CLI command
4. Input commands and wait for completion
5. With multiple projects: hunt for the right terminal window
6. Difficult to run multiple session with same project at the same time
```

**Claude Code Board Workflow** 🚀
```
1. Create new session directly in web interface
2. Select project directory and Agent with one click
3. Launch multiple conversations for same project effortlessly
4. Cross-session continuity: build upon previous conversations
5. Clear completion notifications when tasks finish
6. Intuitive interface: see all session status at a glance
7. Instant switching: click to enter any conversation
8. Concurrent management: handle multiple projects seamlessly
```


## ✨ Key Features

### 🎯 Core Session Management
- **Multi-Session Support** - Run and manage multiple Claude Code instances concurrently
- **Real-time Chat Interface** - WebSocket-powered seamless conversation experience
- **Smart Status Tracking** - Automatic monitoring of session states (idle, processing, completed, error)
- **Session Recovery** - Resume previous conversations with full context preservation
- **Quick Session Launch** - Create new sessions based on existing ones with intelligent prefilling


### 🤖 Advanced AI Workflow
- **Agent Integration** - Dynamic loading of Claude agents from `.claude/agents` directory
- **Workflow Stages** - Pre-configured development stages (code review, debugging, feature development)
- **Smart Message Enhancement** - Automatic agent instruction injection for consistent behavior
- **Custom Prompt Templates** - Quick-start templates for common development tasks


### 📊 Project Organization
- **Work Items** - Organize sessions under project-specific work items
- **Project Classification** - Tag and categorize sessions with projects and topics
- **Workspace Path Integration** - Automatic working directory management
- **Development Context** - Integration with dev.md and project documentation


### 🎨 Modern UI/UX
- **Responsive Layout** - Optimized for desktop and tablet viewing
- **Real-time Notifications** - Windows Toast notifications for session events
- **Message Filtering** - Advanced filtering system for different message types

## 🚀 Quick Start

### Prerequisites

- **Operating System**: Windows 10/11
- **Node.js**: Version 22.12.0 or higher
- **Claude Code CLI**: Latest version installed globally
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/claude-code-board.git
   cd claude-code-board
   ```

2. **Install Dependencies**
   ```bash
   # Install root dependencies
   npm install

   # Install backend dependencies
   cd backend && npm install

   # Install frontend dependencies
   cd ../frontend && npm install
   ```

3. **Quick Launch**
   ```bash
   # Option 1: Use the provided batch file (Windows)
   start.bat

   # Option 2: Manual startup
   npm run dev:backend   # Terminal 1
   npm run dev:frontend  # Terminal 2
   ```

4. **Access the Application**
   - Frontend: `http://localhost:5173`
   - Backend API: `http://localhost:3001`

![Welcome Interface](assets/Demo1.png)
*Welcome interface after initial startup*

## 🎯 Usage Guide

### Creating Your First Session

![Session Creation Wizard](assets/CreateSession.png)
*Session creation wizard with quick templates and preset configurations*

1. **Basic Setup**
   - Click "New Session" from the main dashboard
   - Enter a descriptive name for your coding task
   - Select or enter your project's working directory

2. **Advanced Configuration**
   - Choose a **Workflow Stage** for specialized AI behavior
   - Link to a **Work Item** for project organization
   - Select an **Agent** for domain-specific expertise

3. **Quick Templates**
   - Use predefined templates for common tasks:
     - 🔍 Code Review
     - 🐛 Bug Fixing
     - ✨ Feature Development
     - 📝 Documentation

### Working with Agents

![Agent Configuration](assets/EditWorkStageAgent.png)
*Workflow Stage and Agent configuration interface*

1. **Agent Setup**
   - Configure your Claude agents directory in settings
   - Agents are automatically loaded from `~/.claude/agents/`
   - Create workflow stages that reference specific agents

2. **Dynamic Agent Loading**
   - Agents are loaded on-demand for each message
   - No token waste from static prompt inclusion
   - Consistent behavior throughout conversations

### Message Management

![Message Filter Interface](assets/SessionDetail.png)
*Message filtering and management interface*

- **Filtering**: Hide/show different message types (user, assistant, tool_use, thinking)
- **Export**: Download conversation history as JSON
- **Real-time Updates**: See responses as they're generated
- **Search**: Find specific messages in conversation history

### Project Organization

![Project Organization](assets/WorkItem.png)
*Project classification and work item organization interface*

- **Work Items**: Group related sessions under project tasks
- **Classification**: Tag sessions with projects and topics
- **Workspace Integration**: Automatic path detection and inheritance
- **Quick Launch**: Start new sessions based on existing ones

## 🔧 Configuration

### Environment Variables

Create `.env` files in both `backend/` and `frontend/` directories:

**Backend (.env)**
```env
PORT=3001
NODE_ENV=development
DATABASE_PATH=./database/claude_code_board.db
SOCKET_PORT=3001
```

**Frontend (.env)**
```env
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
```

### Agent Configuration

1. **Setup Claude Agents Directory**
   - Default location: `~/.claude/agents/`
   - Configure path in application settings
   - Create `.md` files for each agent with instructions

2. **Agent File Structure**
   ```
   ~/.claude/agents/
   ├── code-reviewer.md     # Code review specialist
   ├── debugger.md          # Bug fixing expert
   ├── architect.md         # System design advisor
   └── documenter.md        # Documentation writer
   ```

### Workflow Stages

![Workflow Stage Configuration](assets/WorkStage.png)
*Workflow Stage editing interface showcasing Agent selection and custom prompts*

![Agent Configuration](assets/Agent.png)
*Agent management and configuration interface*

- **Custom Prompts**: Define stage-specific system prompts
- **Agent References**: Link stages to specific Claude agents
- **Suggested Tasks**: Provide task templates for each stage
- **Color Coding**: Visual organization with custom colors


## ⚠️ Disclaimer

**IMPORTANT SECURITY NOTICE**

This tool is designed for **personal computer use only** and is **NOT suitable for online deployment**. The application has **no security protections** beyond basic hardcoded authentication.

**Key Security Limitations:**
- No encryption for data transmission
- No secure authentication system
- No input validation or sanitization
- No protection against common web vulnerabilities
- No access control mechanisms
- Database and file system directly accessible

**LIABILITY DISCLAIMER:**
The authors and contributors of this project accept **NO RESPONSIBILITY** for any damages, losses, or security breaches that may occur from using this software. This includes but is not limited to:
- Loss of intellectual property or creative work
- Financial losses or damages
- Data breaches or unauthorized access
- System compromises or malware infections
- Any other direct or indirect damages

**BY USING THIS SOFTWARE, YOU ACKNOWLEDGE THAT:**
- You use it entirely at your own risk
- You understand the security limitations
- You will only use it on secure, personal computers
- You will not deploy it on public or shared networks
- You accept full responsibility for any consequences

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support

### Getting Help

- 📚 **Documentation**: Check this README and inline code documentation
- 🐛 **Bug Reports**: Open an issue on GitHub
- 💡 **Feature Requests**: Discuss in GitHub Discussions

---

<div align="center">

**Built with ❤️ for developers who love AI-powered coding**

[⭐ Star this repo](https://github.com/yourusername/claude-code-board) • [🐛 Report Bug](https://github.com/yourusername/claude-code-board/issues) • [💡 Request Feature](https://github.com/yourusername/claude-code-board/issues)

</div>