import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,mkdir,readFile,writeFile,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupSuite,restoreDrill } from '../scripts/backup-suite.mjs';
async function fixture(){const root=await mkdtemp(join(tmpdir(),'ybz-backup-test-')),sources=join(root,'sources');for(const [dir,name]of Object.entries({social:'social.sqlite',ai:'workspaces.sqlite',admin:'acceptance.sqlite'})){await mkdir(join(sources,dir),{recursive:true});const db=new DatabaseSync(join(sources,dir,name));db.exec("PRAGMA journal_mode=WAL;CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parent(id));INSERT INTO parent VALUES(1);INSERT INTO child VALUES(1,1)");db.close();}return {root,sources,destination:join(root,'backups')};}
test('online three-database backup and isolated restore preserve hashes, rows and foreign keys',async()=>{
 const f=await fixture(),snapshot=await backupSuite(f);assert.deepEqual(Object.keys(snapshot.manifest.databases),['social','ai','admin']);
 const result=await restoreDrill({snapshot:snapshot.folder,destination:join(f.root,'restored')});assert.equal(result.ok,true);for(const value of Object.values(result.results)){assert.equal(value.integrity,'ok');assert.equal(value.tables.child,1);}
 await assert.rejects(()=>restoreDrill({snapshot:snapshot.folder,destination:f.sources}),/new destination/);
});
test('restore rejects tampering and never overwrites source',async()=>{
 const f=await fixture(),snapshot=await backupSuite(f);await writeFile(join(snapshot.folder,'social.sqlite'),'damaged');await assert.rejects(()=>restoreDrill({snapshot:snapshot.folder,destination:join(f.root,'tampered-restore')}),/checksum mismatch/);
 const db=new DatabaseSync(join(f.sources,'social/social.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM child').get().n,1);db.close();
});
test('retention prunes only complete tool-owned snapshots and preserves unrelated directories',async()=>{
 const f=await fixture(),old=await backupSuite({...f,now:new Date('2026-01-01T00:00:00Z')});await mkdir(join(f.destination,'keep-forever'));await writeFile(join(f.destination,'keep-forever/note.txt'),'preserve');
 await backupSuite({...f,now:new Date('2026-02-01T00:00:00Z')});await assert.rejects(()=>stat(old.folder),e=>e.code==='ENOENT');assert.equal(await readFile(join(f.destination,'keep-forever/note.txt'),'utf8'),'preserve');
});
