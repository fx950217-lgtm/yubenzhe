import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// A separate database deliberately never migrates or shares the synthetic admin database.
export function openAiDatabase(filename) {
  if (!filename) throw new Error('AI_DATABASE_PATH is required.');
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), {recursive:true,mode:0o700});
  const raw = new DatabaseSync(filename, {timeout:5000});
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  if (filename !== ':memory:') chmodSync(filename,0o600);
  const migration=readFileSync(new URL('../migrations/002-ai-workspaces.sql',import.meta.url),'utf8');
  const checksum=createHash('sha256').update(migration).digest('hex');
  raw.exec('CREATE TABLE IF NOT EXISTS ai_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);');
  raw.exec('BEGIN IMMEDIATE');
  try {
    const previous=raw.prepare('SELECT checksum FROM ai_migrations WHERE version=1').get();
    if (previous && previous.checksum!==checksum) throw new Error('AI migration checksum mismatch; database not changed.');
    if (!previous) {raw.exec(migration);raw.prepare('INSERT INTO ai_migrations VALUES(1,?,?)').run(checksum,Date.now());}
    raw.exec('COMMIT');
  } catch(error) {raw.exec('ROLLBACK');raw.close();throw error;}
  return {raw,close(){raw.close()}};
}
