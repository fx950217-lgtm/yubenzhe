import {writeFile, realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep, join, basename, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {restoreDrill} from './backup-suite.mjs';
import {verifyUpgrade} from './upgrade-verify.mjs';

// Never run migrations on the snapshot or the live mount. Restore all three
// databases to a new directory first, then verify the current code against it.
export async function rehearseRelease({snapshot, destination}) {
  snapshot=await realpath(resolve(snapshot));
  destination=resolve(destination);
  destination=join(await realpath(dirname(destination)),basename(destination));
  const within=relative(snapshot,destination);
  if(!within||!isAbsolute(within)&&within!=='..'&&!within.startsWith('..'+sep)) {
    throw Error('Rehearsal destination must be outside the backup snapshot.');
  }
  await restoreDrill({snapshot,destination});
  const upgrade=verifyUpgrade(['social','ai','admin'].map(kind=>join(destination,kind+'.sqlite')));
  const report={kind:'isolated-release-rehearsal',sourceSnapshot:basename(snapshot),verifiedAt:new Date().toISOString(),
    // A restore test proves recoverability, not that writers were stopped when
    // the source suite was taken. Deployment must separately record that step.
    stopWriteEvidenceRequired:true,upgrade};
  await writeFile(join(destination,'upgrade-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const [snapshot,destination,...extra]=process.argv.slice(2);
  if(!snapshot||!destination||extra.length)throw Error('Usage: release-rehearsal.mjs <complete-snapshot> <new-isolated-directory>');
  console.log(JSON.stringify(await rehearseRelease({snapshot,destination})));
}
