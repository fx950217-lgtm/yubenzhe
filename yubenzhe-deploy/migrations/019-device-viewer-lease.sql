-- Viewer heartbeat is separate from the ten-minute maximum session duration.
-- A lost browser connection must stop capture/input within fifteen seconds.
ALTER TABLE personal_devices ADD COLUMN viewer_until INTEGER;
