import {readFile,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..'),root=resolve(repo,'../native-theme-qa');
const args=process.argv.slice(2),project=resolve(args[args.indexOf('--project')+1]||'');
const child=relative(root,project);if(!child||child.startsWith('..')||child.includes(':'))throw Error('Only an isolated native-theme-qa project can be built.');
const manifest=JSON.parse(await readFile(join(project,'local-qa-manifest.json'),'utf8'));if(manifest.mode!=='isolated-local-native-qa'||manifest.output!==project)throw Error('Invalid local QA manifest');
let command,commandArgs,cwd=project,env={...process.env};
if(manifest.platform==='windows'){
 command=process.execPath;commandArgs=['--require',join(here,'pnpm-collector.cjs'),join(project,'node_modules/electron-builder/out/cli/cli.js'),...(args.includes('--installer')?['--win','nsis','--x64','--prepackaged',join(project,'artifacts/win-unpacked')]:['--win','--x64','--dir']),'--publish','never'];env.QA_PNPM_CLI=process.env.QA_PNPM_CLI||resolve(dirname(process.execPath),'../node_modules/pnpm/bin/pnpm.cjs');env.npm_execpath=env.QA_PNPM_CLI;env.PATH=dirname(process.execPath)+';'+(env.PATH||'');
}else if(manifest.platform==='android'){
 const tools=resolve(repo,'../android-toolchain'),jdkParent=join(tools,'jdk'),jdk=join(jdkParent,(await readdir(jdkParent)).find(name=>name.startsWith('jdk-21'))||'');
 command=join(jdk,'bin/java.exe');await stat(command);cwd=join(project,'android');commandArgs=['-classpath',join(cwd,'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain','assembleDebug','--no-daemon','--offline','--console=plain'];env.JAVA_HOME=jdk;env.ANDROID_HOME=join(tools,'sdk');env.ANDROID_SDK_ROOT=env.ANDROID_HOME;env.GRADLE_USER_HOME=join(tools,'gradle-cache');env.PATH=join(jdk,'bin')+';'+(env.PATH||'');
}else throw Error('Unsupported QA platform');
const running=spawn(command,commandArgs,{cwd,env,windowsHide:true,stdio:'inherit'});running.on('error',e=>{console.error(e.message);process.exitCode=1;});running.on('exit',code=>{process.exitCode=code||0;});
