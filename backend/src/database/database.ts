import sqlite3 from 'sqlite3';
import { Database as SQLiteDatabase } from 'sqlite3';
import path from 'path';
import fs from 'fs';

export class Database {
  private static instance: Database;
  private db: SQLiteDatabase;
  private dbPath: string;

  private constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.dbPath = path.join(dataDir, 'claude-sessions.db');
    this.db = new sqlite3.Database(this.dbPath);
    
    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public getDatabase(): SQLiteDatabase {
    return this.db;
  }

  public async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Create sessions table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            working_dir TEXT NOT NULL,
            task TEXT NOT NULL,
            status TEXT NOT NULL,
            continue_chat BOOLEAN DEFAULT FALSE,
            previous_session_id TEXT,
            claude_session_id TEXT,
            process_id INTEGER,
            error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            deleted_at DATETIME,
            FOREIGN KEY (previous_session_id) REFERENCES sessions(session_id)
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Add claude_session_id column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN claude_session_id TEXT
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add claude_session_id column:', err.message);
          }
        });

        // Add dangerously_skip_permissions column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN dangerously_skip_permissions BOOLEAN DEFAULT FALSE
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add dangerously_skip_permissions column:', err.message);
          }
        });

        // Add last_user_message column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN last_user_message TEXT
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add last_user_message column:', err.message);
          }
        });

        // Add message_count column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN message_count INTEGER DEFAULT 0
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add message_count column:', err.message);
          }
        });

        // Add sort_order column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN sort_order INTEGER DEFAULT 0
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add sort_order column:', err.message);
          }
        });

        // Add workflow_stage_id column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN workflow_stage_id TEXT REFERENCES workflow_stages(stage_id)
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add workflow_stage_id column:', err.message);
          }
        });

        // Add work_item_id column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN work_item_id TEXT REFERENCES work_items(work_item_id)
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add work_item_id column:', err.message);
          }
        });

        // Add cli_type column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN cli_type TEXT DEFAULT 'claude-code'
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add cli_type column:', err.message);
          }
        });

        // Add codex_config column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE sessions ADD COLUMN codex_config TEXT
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add codex_config column:', err.message);
          }
        });

        // Create messages table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS messages (
            message_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            compressed BOOLEAN DEFAULT FALSE,
            original_size INTEGER,
            compressed_size INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Add metadata column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE messages ADD COLUMN metadata TEXT
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add metadata column:', err.message);
          }
        });

        // Run role → type migration
        this.db.run(`
          ALTER TABLE messages ADD COLUMN type TEXT
        `, async (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add type column:', err.message);
            return;
          }
          
          // Execute migration if type column was just added or is empty
          try {
            const { MigrateRoleToTypeMigration } = require('./migrations/migrate_role_to_type');
            const migration = new MigrateRoleToTypeMigration();
            const status = await migration.getStatus();
            
            if (status.hasTypeColumn && status.totalMessages > 0 && status.consistentData < status.totalMessages) {
              console.log('執行 role → type 遷移...');
              await migration.up();
              console.log('role → type 遷移完成');
            }
          } catch (migrationError) {
            console.error('Migration failed:', migrationError);
          }
        });

        // Create session_status_history table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS session_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            old_status TEXT,
            new_status TEXT NOT NULL,
            reason TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Create system_config table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Create backups table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS backups (
            backup_id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            size INTEGER,
            status TEXT DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Create common_paths table for storing frequently used paths
        this.db.run(`
          CREATE TABLE IF NOT EXISTS common_paths (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            path TEXT NOT NULL,
            icon TEXT NOT NULL CHECK (icon IN ('FolderOpen', 'Code', 'Home')),
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, async (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Check if common_paths table is empty and insert default paths
          const count = await this.get<{count: number}>('SELECT COUNT(*) as count FROM common_paths');
          if (count && count.count === 0) {
            // Insert default paths
            const defaultPaths = [
              { id: '1', icon: 'Code', label: 'Projects', path: 'C:\\Users\\Projects', sort_order: 1 },
              { id: '2', icon: 'Code', label: 'Example', path: 'C:\\Users\\Example', sort_order: 2 },
              { id: '3', icon: 'Home', label: 'Desktop', path: 'C:\\Users\\User\\Desktop', sort_order: 3 },
              { id: '4', icon: 'Home', label: 'Documents', path: 'C:\\Users\\User\\Documents', sort_order: 4 },
              { id: '5', icon: 'FolderOpen', label: '當前目錄', path: '.', sort_order: 5 },
            ];
            
            for (const path of defaultPaths) {
              await this.run(`
                INSERT INTO common_paths (id, label, path, icon, sort_order)
                VALUES (?, ?, ?, ?, ?)
              `, [path.id, path.label, path.path, path.icon, path.sort_order]);
            }
            console.log('Default common paths inserted');
          }
        });

        // Create workflow_stages table for AI agent configurations
        this.db.run(`
          CREATE TABLE IF NOT EXISTS workflow_stages (
            stage_id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            system_prompt TEXT NOT NULL,
            suggested_tasks TEXT, -- JSON array
            color TEXT DEFAULT '#4F46E5',
            icon TEXT DEFAULT 'folder',
            sort_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT TRUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Add agent_ref column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE workflow_stages ADD COLUMN agent_ref TEXT
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add agent_ref column:', err.message);
          }
        });

        // Create work_items table for organizing related sessions
        this.db.run(`
          CREATE TABLE IF NOT EXISTS work_items (
            work_item_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            workspace_path TEXT,
            status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'in_progress', 'completed', 'cancelled')),
            priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
            planned_stages TEXT, -- JSON array of stage names
            current_stage TEXT,
            project_id TEXT REFERENCES projects(project_id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Add workspace_path column if it doesn't exist (migration)
        this.db.run(`
          ALTER TABLE work_items ADD COLUMN workspace_path TEXT
        `, (err) => {
          // Ignore error if column already exists
          if (err && !err.message.includes('duplicate column name')) {
            console.warn('Failed to add workspace_path column to work_items:', err.message);
          }
        });

        // Create projects table for session organization
        this.db.run(`
          CREATE TABLE IF NOT EXISTS projects (
            project_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#4F46E5',
            icon TEXT DEFAULT 'folder',
            status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Create tags table for labeling sessions
        this.db.run(`
          CREATE TABLE IF NOT EXISTS tags (
            tag_id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            color TEXT DEFAULT '#6B7280',
            type TEXT DEFAULT 'general' CHECK (type IN ('general', 'topic', 'department')),
            usage_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Create session_projects junction table (many-to-many)
        this.db.run(`
          CREATE TABLE IF NOT EXISTS session_projects (
            session_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (session_id, project_id),
            FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Create session_tags junction table (many-to-many)
        this.db.run(`
          CREATE TABLE IF NOT EXISTS session_tags (
            session_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (session_id, tag_id),
            FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Create indexes for better performance
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions(deleted_at)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)
        `);

        // Create indexes for new tables
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(type)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_session_projects_session_id ON session_projects(session_id)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_session_projects_project_id ON session_projects(project_id)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_session_tags_session_id ON session_tags(session_id)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_session_tags_tag_id ON session_tags(tag_id)
        `);

        // Create indexes for work_items
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items(project_id)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_sessions_work_item_id ON sessions(work_item_id)
        `);

        // Create task_templates table for storing task templates
        this.db.run(`
          CREATE TABLE IF NOT EXISTS task_templates (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            template TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_default BOOLEAN DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, async (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Check if task_templates table is empty and insert default templates
          const count = await this.get<{count: number}>('SELECT COUNT(*) as count FROM task_templates');
          if (count && count.count === 0) {
            // Insert default templates
            const defaultTemplates = [
              { id: '1', label: '繼續工作', template: '基於前一個對話的上下文，繼續進行相關工作。', sort_order: 1 },
              { id: '2', label: '程式審查', template: '請審查此專案的程式碼品質、安全性和最佳實踐。請先閱讀 dev.md 和相關專案檔案。', sort_order: 2 },
              { id: '3', label: '修復錯誤', template: '協助分析和修復專案中的錯誤。請先了解專案架構和現有程式碼。', sort_order: 3 },
              { id: '4', label: '功能開發', template: '協助開發新功能，請先了解現有架構和設計模式。', sort_order: 4 },
              { id: '5', label: '撰寫文件', template: '協助撰寫或更新專案文件，請先分析現有程式碼結構。', sort_order: 5 },
            ];

            for (const t of defaultTemplates) {
              await this.run(`
                INSERT INTO task_templates (id, label, template, sort_order, is_default, is_active)
                VALUES (?, ?, ?, ?, 1, 1)
              `, [t.id, t.label, t.template, t.sort_order]);
            }
            console.log('Default task templates inserted');
          }
        });

        // Create indexes for task_templates
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_task_templates_sort_order ON task_templates(sort_order)
        `);

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_task_templates_is_active ON task_templates(is_active)
        `);

        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Helper methods for transactions
  public async beginTransaction(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async commit(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async rollback(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('ROLLBACK', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Utility methods
  public run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  public get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row as T);
        }
      });
    });
  }

  public all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  // Data integrity check methods
  public async checkDataIntegrity(): Promise<{
    orphaned_messages: number;
    inconsistent_status: number;
    corrupted_data: number;
  }> {
    const orphanedMessages = await this.get<{count: number}>(`
      SELECT COUNT(*) as count 
      FROM messages 
      WHERE session_id NOT IN (SELECT session_id FROM sessions)
    `);

    const inconsistentStatus = await this.get<{count: number}>(`
      SELECT COUNT(*) as count 
      FROM sessions 
      WHERE status = 'idle' AND process_id IS NULL
    `);

    // For corrupted data, we'll check if any JSON fields are invalid (simplified check)
    const corruptedData = 0; // In real implementation, we'd parse JSON fields

    return {
      orphaned_messages: orphanedMessages?.count || 0,
      inconsistent_status: inconsistentStatus?.count || 0,
      corrupted_data: corruptedData
    };
  }

  // Backup methods
  public async createBackup(backupPath: string): Promise<string> {
    const { v4: uuidv4 } = require('uuid');
    const backupId = uuidv4();
    
    try {
      // Simple file copy backup for SQLite
      fs.copyFileSync(this.dbPath, backupPath);
      
      const stats = fs.statSync(backupPath);
      await this.run(`
        INSERT INTO backups (backup_id, file_path, size)
        VALUES (?, ?, ?)
      `, [backupId, backupPath, stats.size]);
      
      return backupId;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error}`);
    }
  }
}