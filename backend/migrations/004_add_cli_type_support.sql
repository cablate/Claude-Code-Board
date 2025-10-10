-- Add CLI type support to sessions table
-- This migration adds support for multiple CLI types (claude-code, codex)

-- Add cli_type column
ALTER TABLE sessions ADD COLUMN cli_type TEXT DEFAULT 'claude-code' CHECK (cli_type IN ('claude-code', 'codex'));

-- Add codex_config column for storing Codex-specific configuration
ALTER TABLE sessions ADD COLUMN codex_config TEXT;

-- Add comment to describe the codex_config format
-- Expected JSON format:
-- {
--   "sandbox": "auto" | "read-only" | "workspace-write" | "danger-full-access",
--   "model": "gpt-4" | string,
--   "model_reasoning_effort": "low" | "medium" | "high",
--   "model_reasoning_summary": "auto" | "concise" | "detailed" | "none",
--   "model_reasoning_summary_format": "none" | "experimental",
--   "oss": boolean,
--   "profile": string | null,
--   "base_instructions": string | null,
--   "include_plan_tool": boolean,
--   "include_apply_patch_tool": boolean,
--   "append_prompt": string | null
-- }
