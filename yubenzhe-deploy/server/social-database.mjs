import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdirSync,chmodSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function openSocialDatabase(filename) {
 if(!filename)throw new Error('SOCIAL_DATABASE_PATH is required.');
 if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true,mode:0o700});
 const raw=new DatabaseSync(filename,{timeout:5000});
 raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 if(filename!==':memory:')chmodSync(filename,0o600);
 const migration=readFileSync(new URL('../migrations/003-social.sql',import.meta.url),'utf8'),checksum=createHash('sha256').update(migration).digest('hex');
 raw.exec('CREATE TABLE IF NOT EXISTS social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);BEGIN IMMEDIATE;');
 try {const old=raw.prepare('SELECT checksum FROM social_migrations WHERE version=1').get();if(old&&old.checksum!==checksum)throw new Error('Social migration checksum mismatch.');if(!old){raw.exec(migration);raw.prepare('INSERT INTO social_migrations VALUES(1,?,?)').run(checksum,Date.now());}raw.exec('COMMIT');}
 catch(error){raw.exec('ROLLBACK');raw.close();throw error;}
 return {raw,close(){raw.close()}};
}
