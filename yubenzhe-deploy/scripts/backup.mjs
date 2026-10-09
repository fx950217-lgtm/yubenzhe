import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const [source,destination]=process.argv.slice(2);
if(!source||!destination||!existsSync(source)||existsSync(destination))throw new Error('Usage: backup.mjs <existing-database> <new-backup-file>');
process.umask(0o077);mkdirSync(dirname(resolve(destination)),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,destination)}finally{db.close()}
chmodSync(destination,0o600);const copy=new DatabaseSync(destination,{readOnly:true});
try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed')}finally{copy.close()}
console.log('Backup complete; integrity_check passed.');
