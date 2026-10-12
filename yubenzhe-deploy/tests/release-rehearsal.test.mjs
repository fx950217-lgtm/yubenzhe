import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {openAiDatabase} from '../server/ai-database.mjs';
import {openDatabase} from '../server/sqlite-adapter.mjs';
import {backupSuite} from '../scripts/backup-suite.mjs';
import {rehearseRelease} from '../scripts/release-rehearsal.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const parent=await realpath(tmpdir());
  const root=await mkdtemp(join(parent,'ybz-release-rehearsal-'));
  t.after(async()=>{
    const target=await realpath(root);
    assert.equal(dirname(target).toLowerCase(),parent.toLowerCase());
    assert.equal(target.toLowerCase(),root.toLowerCase());
    assert.ok(basename(target).startsWith('ybz-release-rehearsal-'));
    await rm(target,{recursive:true,force:true});
  });
  const sources=join(root,'sources');
  for(const [kind,name,open] of [['social','social.sqlite',openSocialDatabase],['ai','workspaces.sqlite',openAiDatabase],['admin','acceptance.sqlite',openDatabase]]) {
    await mkdir(join(sources,kind),{recursive:true});
    const db=open(join(sources,kind,name));db.close();
  }
  const suite=await backupSuite({sources,destination:join(root,'backups')});
  return {root,suite};
}
test('release rehearsal restores a complete suite before upgrading and leaves snapshot bytes unchanged',async t=>{
  const {root,suite}=await fixture(t),destination=join(root,'rehearsed');
  const files=['manifest.json','social.sqlite','ai.sqlite','admin.sqlite'];
  const before=await Promise.all(files.map(async file=>sha(await readFile(join(suite.folder,file)))));
  const result=await rehearseRelease({snapshot:suite.folder,destination});
  assert.equal(result.kind,'isolated-release-rehearsal');
  assert.equal(result.stopWriteEvidenceRequired,true);
  assert.equal(result.upgrade.databases.length,3);
  assert.deepEqual(JSON.parse(await readFile(join(destination,'upgrade-verification.json'),'utf8')),result);
  const after=await Promise.all(files.map(async file=>sha(await readFile(join(suite.folder,file)))));
  assert.deepEqual(after,before);
  await assert.rejects(()=>rehearseRelease({snapshot:suite.folder,destination}),/new destination/);
});
test('rehearsal refuses missing manifests and any destination inside the backup',async t=>{
  const {root,suite}=await fixture(t);
  await assert.rejects(()=>rehearseRelease({snapshot:suite.folder,destination:join(suite.folder,'inside')}),/outside the backup/);
  await assert.rejects(()=>stat(join(suite.folder,'inside')),e=>e.code==='ENOENT');
  await mkdir(join(root,'empty-snapshot'));
  await assert.rejects(()=>rehearseRelease({snapshot:join(root,'empty-snapshot'),destination:join(root,'no-manifest')}),e=>e.code==='ENOENT');
  await assert.rejects(()=>stat(join(root,'no-manifest')),e=>e.code==='ENOENT');
});
