'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {BRIDGE_FILES,verifyBridgeBundle}=require('../scripts/verify-release.cjs');
const pkg=require('../package.json');
const filter=pkg.build.extraResources.find(entry=>entry.to==='device-bridge').filter;
function preload(argv){
 const exposed={};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{
  require:name=>{assert.equal(name,'electron','Sandboxed preload must not require package files or Node APIs');return {contextBridge:{exposeInMainWorld:(key,value)=>exposed[key]=value},ipcRenderer:{}};},
  process:{argv},document:{addEventListener(){}}
 });
 return exposed.YubenzheDesktop;
}
test('desktop app ID is stable and uninstall still preserves application data',()=>{
 assert.equal(pkg.build.appId,'app.yubenzhe.desktop');assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,false);
 assert.equal(pkg.build.electronFuses.runAsNode,false);assert.equal(pkg.build.electronFuses.onlyLoadAppFromAsar,true);
});
test('sandboxed preload reports the host package version without enabling package or filesystem reads',()=>{
 const exposed=preload(['electron','--ybz-app-version=0.0.0-old','--ybz-app-version='+pkg.version]);
 assert.equal(exposed.version,pkg.version);assert.equal(Object.isFrozen(exposed),true);
 for(const version of ['1.2.3','1.2.3-dev.999'])assert.equal(preload(['--ybz-app-version='+version]).version,version);
});
test('missing or malformed runtime version is unknown rather than a misleading hard-coded release',()=>{
 for(const argv of [[],['--ybz-app-version='],['--ybz-app-version=<script>'],['--ybz-app-version=1.2.3\nspoof'],['--ybz-app-version='+('x'.repeat(100))]])assert.equal(preload(argv).version,'unknown');
});
test('release verifier accepts all current connector files including decision protocol',t=>{
 const bundleDir=fs.mkdtempSync(path.join(os.tmpdir(),'ybz-bridge-release-'));t.after(()=>fs.rmSync(bundleDir,{recursive:true,force:true}));
 const sourceDir=path.resolve(__dirname,'../../yubenzhe-deploy/device-bridge');
 for(const file of BRIDGE_FILES)fs.copyFileSync(path.join(sourceDir,file),path.join(bundleDir,file));
 assert.ok(BRIDGE_FILES.includes('decision-protocol.mjs'));assert.doesNotThrow(()=>verifyBridgeBundle({sourceDir,bundleDir,filter}));
 fs.unlinkSync(path.join(bundleDir,'decision-protocol.mjs'));assert.throws(()=>verifyBridgeBundle({sourceDir,bundleDir,filter}),/Only allowlisted connector/);
 fs.copyFileSync(path.join(sourceDir,'decision-protocol.mjs'),path.join(bundleDir,'decision-protocol.mjs'));
 fs.appendFileSync(path.join(bundleDir,'decision-protocol.mjs'),'\n// mismatched build');assert.throws(()=>verifyBridgeBundle({sourceDir,bundleDir,filter}),/decision-protocol\.mjs/);
});
test('connector verifier rejects unknown files and a widened build filter',t=>{
 const bundleDir=fs.mkdtempSync(path.join(os.tmpdir(),'ybz-bridge-allowlist-'));t.after(()=>fs.rmSync(bundleDir,{recursive:true,force:true}));
 const sourceDir=path.resolve(__dirname,'../../yubenzhe-deploy/device-bridge');
 for(const file of BRIDGE_FILES)fs.copyFileSync(path.join(sourceDir,file),path.join(bundleDir,file));
 assert.throws(()=>verifyBridgeBundle({sourceDir,bundleDir,filter:[...filter,'private-state.bin']}),/Builder connector allowlist/);
 fs.writeFileSync(path.join(bundleDir,'private-state.bin'),'synthetic test fixture');assert.throws(()=>verifyBridgeBundle({sourceDir,bundleDir,filter}),/Only allowlisted connector/);
});
