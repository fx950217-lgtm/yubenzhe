import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Implements only the D1 methods used by the preserved admin business layer. */
export function openDatabase(filename, migrationFile = new URL('../migrations/001-admin.sql', import.meta.url)) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
  const raw = new DatabaseSync(filename, { timeout: 5000 });
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  const migration = readFileSync(migrationFile, 'utf8');
  const digest = createHash('sha256').update(migration).digest('hex');
  raw.exec('CREATE TABLE IF NOT EXISTS deployment_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL);');
  const applied = raw.prepare('SELECT checksum FROM deployment_migrations WHERE version=1').get();
  if (applied && applied.checksum !== digest) { raw.close(); throw new Error('Migration checksum changed; database was not modified.'); }
  if (!applied) {
    raw.exec('BEGIN IMMEDIATE');
    try { raw.exec(migration); raw.prepare('INSERT INTO deployment_migrations VALUES(1,?,?)').run(digest, Date.now()); raw.exec('COMMIT'); }
    catch (error) { raw.exec('ROLLBACK'); raw.close(); throw error; }
  }
  const db = {
    raw,
    prepare(sql) {
      const statement = { sql, params: [], bind(...params) { return { ...statement, params }; },
        async first() { return raw.prepare(sql).get(...this.params) || null; },
        async all() { return { results: raw.prepare(sql).all(...this.params) }; },
      };
      return statement;
    },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const output = statements.map(statement => ({ success: true, results: raw.prepare(statement.sql).all(...statement.params) }));
        raw.exec('COMMIT'); return output;
      } catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
    async backup(destination) {
      if (existsSync(destination)) throw new Error('Backup destination already exists.');
      mkdirSync(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
      await backup(raw, destination); chmodSync(destination, 0o600);
      const check = new DatabaseSync(destination, { readOnly: true });
      try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed.'); }
      finally { check.close(); }
      return destination;
    },
    close() { raw.close(); },
  };
  return db;
}
