'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile),{createRequire}=require('node:module');
const projectRequire=createRequire(path.join(process.cwd(),'package.json'));
const builderRequire=createRequire(projectRequire.resolve('electron-builder/package.json'));
const {PnpmNodeModulesCollector}=builderRequire('app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector.js');
const pnpm=process.env.QA_PNPM_CLI||path.resolve(path.dirname(process.execPath),'../node_modules/pnpm/bin/pnpm.cjs');
PnpmNodeModulesCollector.prototype.streamCollectorCommandToFile=async function(command,args,cwd,output){const result=await execFile(process.execPath,[pnpm,...args],{cwd,windowsHide:true,maxBuffer:20*1024*1024});await fs.writeFile(output,result.stdout);};
