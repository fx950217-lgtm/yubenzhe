-- Capability metadata only. Keep the historical device provider CHECK as a
-- legacy sentinel; task.provider and devices.providers carry current identity.
ALTER TABLE ai_channel_devices ADD COLUMN providers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ai_channel_devices ADD COLUMN scanned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_channel_tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex';
