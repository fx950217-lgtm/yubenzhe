import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdirSync,chmodSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { archiveRetiredSimulation } from './retire-platform-assets.mjs';
const MIGRATIONS=['003-social.sql','004-social-safety.sql','005-account-security.sql','006-social-moments.sql','007-social-notifications.sql','008-account-access.sql','009-platform-assets.sql','010-community.sql','011-workbench.sql','012-workbench-experience.sql','013-social-experience.sql','014-points.sql','015-retire-platform-assets.sql'];
export function openSocialDatabase(filename) {
 if(!filename)throw new Error('SOCIAL_DATABASE_PATH is required.');
 if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true,mode:0o700});
 const raw=new DatabaseSync(filename,{timeout:5000});
 raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 if(filename!==':memory:')chmodSync(filename,0o600);
 raw.exec('CREATE TABLE IF NOT EXISTS social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);BEGIN IMMEDIATE;');
 try {const rows=raw.prepare('SELECT version FROM social_migrations ORDER BY version').all();if(rows.some((r,i)=>r.version!==i+1)||rows.length>MIGRATIONS.length)throw new Error('Unsupported social migration sequence.');
 for(const [index,file] of MIGRATIONS.entries()){const migration=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'),checksum=createHash('sha256').update(migration).digest('hex'),version=index+1;const old=raw.prepare('SELECT checksum FROM social_migrations WHERE version=?').get(version);if(old&&old.checksum!==checksum)throw new Error('Social migration checksum mismatch: '+file);if(!old){if(file==='015-retire-platform-assets.sql')archiveRetiredSimulation(raw,filename);raw.exec(migration);raw.prepare('INSERT INTO social_migrations VALUES(?,?,?)').run(version,checksum,Date.now());}}
 raw.exec('COMMIT');}
 catch(error){raw.exec('ROLLBACK');raw.close();throw error;}
 return {raw,close(){raw.close()}};
}
