-- Optional reference to an owned kind='output' file; NULL on ordinary moments.
-- SET NULL lets the existing 30-day cleanup delete files without deleting posts.
-- Never CASCADE: the metadata snapshot must survive physical file deletion.
ALTER TABLE moments ADD COLUMN workbench_file_id TEXT REFERENCES workbench_files(id) ON DELETE SET NULL;

-- Metadata only: {fileId,fileName,size,sha256,mime,taskTitle,operation,createdAt}.
-- fileId preserves the original identity after SET NULL. Never store file BLOBs.
ALTER TABLE moments ADD COLUMN share_snapshot TEXT;

CREATE INDEX moments_workbench_file ON moments(workbench_file_id);
