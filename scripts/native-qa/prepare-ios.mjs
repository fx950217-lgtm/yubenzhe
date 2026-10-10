/** Prepare a separate, reviewable iOS local QA app; never alter the 0.13 installed identity. */
import {readFile,writeFile,mkdir,cp,stat} from 'node:fs/promises';
import {resolve,join,relative,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..'),args=process.argv.slice(2);
const value=name=>{const at=args.indexOf(name);return at<0?null:args[at+1]};
const WEB=['index.html','app.js','app.css','icon.png','icon.svg','apple-touch-icon.png','manifest.webmanifest','privacy.html','terms.html'];
const ID='app.yubenzhe.wallet.localqa',PRODUCT='YubenzheLocalQA',NAME='愚笨者本机验收',VERSION='0.14.0',BUILD='1',DEB_VERSION='0.14.0-localqa.1';
const source=join(repo,'tongban/dist'),original=join(repo,'yubenzhe-ios');
const hashes={};for(const name of WEB)hashes[name]=createHash('sha256').update(await readFile(join(source,name))).digest('hex');
const frozenVersion=JSON.parse(await readFile(join(repo,'tongban/package.json'),'utf8')).version;
if(!frozenVersion.startsWith(VERSION+'-'))throw Error('Review the QA version before preparing another frontend release.');
const sourcePolicy=JSON.parse(await readFile(join(here,'ios-qa-web-lock.json'),'utf8'));
if(JSON.stringify(Object.keys(sourcePolicy).sort())!==JSON.stringify([...WEB].sort())||WEB.some(name=>sourcePolicy[name]!==hashes[name]))throw Error('Frozen web assets differ from ios-qa-web-lock.json; review the frontend before updating this lock.');
if(!args.includes('--frozen-web')){console.log(JSON.stringify({mode:'read-only-preflight',platform:'ios',bundleId:ID,version:VERSION,frontendVersion:frozenVersion,source,webSHA256:hashes,ready:true},null,2));process.exit(0);}
const output=value('--output')?resolve(value('--output')):resolve(repo,'../native-theme-qa/ios-'+Date.now());
const relation=relative(repo,output);if(!relation.startsWith('..')&&!isAbsolute(relation))throw Error('iOS QA staging must be outside the source repository.');
try{await stat(output);throw Error('Refuse to overwrite an existing QA staging directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(output,{recursive:true});
function replace(value,search,replacement,label,count=1){if(value.split(search).length!==count+1)throw Error('Reviewed iOS source changed at '+label);return value.split(search).join(replacement);}
async function modify(file,transform){await writeFile(file,transform(await readFile(file,'utf8')));}
await cp(join(original,'App'),join(output,'App'),{recursive:true,filter:file=>!relative(join(original,'App'),file).split(/[\\/]/).includes('Web')});
await cp(join(original,'scripts'),join(output,'scripts'),{recursive:true,filter:file=>!relative(join(original,'scripts'),file).split(/[\\/]/).includes('__pycache__')});
await cp(join(here,'verify-frozen-ios-web.py'),join(output,'scripts/verify-frozen-web.py'));
await cp(join(original,'Yubenzhe.xcodeproj'),join(output,'Yubenzhe.xcodeproj'),{recursive:true});
await cp(join(here,'LocalQaApi.swift'),join(output,'App/LocalQaApi.swift'));
await modify(join(output,'App/Info.plist'),text=>text.replace('<string>愚笨者</string>','<string>'+NAME+'</string>').replace('<string>Yubenzhe</string>','<string>'+PRODUCT+'</string>').replace('<string>0.13.0</string>','<string>'+VERSION+'</string>').replace('<string>16</string>','<string>'+BUILD+'</string>'));
await modify(join(output,'App/Preview.entitlements'),text=>replace(text,'app.yubenzhe.wallet',ID,'distinct app identity and required container',2));
await modify(join(output,'scripts/generate-project.py'),text=>{
 text=replace(text,"'BrowserViewController.swift','bridge.js'","'BrowserViewController.swift','LocalQaApi.swift','bridge.js'",'compile QA API bridge');
 text=replace(text,"'PRODUCT_NAME':'Yubenzhe'","'PRODUCT_NAME':'"+PRODUCT+"'",'product name');
 text=replace(text,"'PRODUCT_BUNDLE_IDENTIFIER':'app.yubenzhe.wallet'","'PRODUCT_BUNDLE_IDENTIFIER':'"+ID+"'",'bundle identifier');
 text=text.replaceAll('Yubenzhe.app',PRODUCT+'.app').replace("'CURRENT_PROJECT_VERSION':'16'","'CURRENT_PROJECT_VERSION':'"+BUILD+"'").replace("'MARKETING_VERSION':'0.13.0'","'MARKETING_VERSION':'"+VERSION+"'");return text;
});
await modify(join(output,'scripts/build-ios.sh'),text=>{
 text=replace(text,'(cd ../tongban && node build.mjs)\npython3 scripts/sync-web.py','python3 scripts/verify-frozen-web.py','verify isolated frozen QA assets without rebuilding production web');
 text=text.replace('# Generated web assets are deliberately absent from Git. Rebuild them from the\n# checked-out consumer source rather than packaging an earlier release snapshot.','# This isolated QA project uses the reviewed frozen assets prepared with its\n# QA adapter and restricted origin. Never replace them with production assets.');
 return text.replaceAll('Yubenzhe.app',PRODUCT+'.app');
});
await modify(join(output,'scripts/verify_app.py'),text=>text.replace("EXPECTED_ID = 'app.yubenzhe.wallet'","EXPECTED_ID = '"+ID+"'").replace("!= '0.13.0'","!= '"+VERSION+"'").replace("!= '16'","!= '"+BUILD+"'").replace("'privacy.html', 'terms.html'","'privacy.html', 'terms.html', 'qa-runtime.js'"));
await modify(join(output,'scripts/package-deb.py'),text=>text.replaceAll('app.yubenzhe.wallet',ID).replaceAll('Yubenzhe.app',PRODUCT+'.app').replaceAll('0.13.0',DEB_VERSION).replace('Name: 愚笨者','Name: '+NAME).replace('Private BSC testnet wallet and familiar-friends social preview.','Local-only QA client; requires a private USB tunnel to the local test server.'));
await modify(join(output,'App/LocalAssetServer.swift'),text=>{
 text=replace(text,'static let port: UInt16 = 45931','static let port: UInt16 = 45932','distinct local origin');
 text=replace(text,'"index.html": "text/html; charset=utf-8",','"qa-runtime.js": "application/javascript; charset=utf-8",\n        "index.html": "text/html; charset=utf-8",','QA runtime static whitelist');
 text=replace(text,'private let root: URL','private let root: URL\n    private let qaApi: LocalQaApi','server QA proxy member');
 text=replace(text,'init(root: URL) { self.root = root }','init(root: URL, qaApi: LocalQaApi) { self.root = root; self.qaApi = qaApi }','server QA proxy injection');
 text=replace(text,'        let rawPath = String(parts[1])','        let rawPath = String(parts[1])\n        if LocalQaApi.avatarPath(rawPath) {\n            qaApi.perform(["path": rawPath, "method": "GET", "headers": [String: String](), "body": ""]) { [weak self] result in\n                switch result {\n                case .success(let (status, headers, body)):\n                    let type = headers["content-type"] ?? "application/octet-stream"\n                    guard ["image/png", "image/jpeg", "image/webp"].contains(type.components(separatedBy: ";")[0]) else { self?.send(connection, status: "502 Bad Gateway", body: Data(), type: "text/plain"); return }\n                    self?.send(connection, status: "\\(status) Local QA", body: body, type: type)\n                case .failure: self?.send(connection, status: "503 Service Unavailable", body: Data(), type: "text/plain")\n                }\n            }\n            return\n        }','strict local avatar proxy');
 text=text.replace(' https://66.42.56.29/api/social/avatars/','').replace(' https://66.42.56.29/api/social/','');return text;
});
await modify(join(output,'App/BrowserViewController.swift'),text=>{
 text=replace(text,'    private var server: LocalAssetServer?','    private var server: LocalAssetServer?\n    private let qaApi = LocalQaApi()','retained QA bridge');
 text=replace(text,'        content.addScriptMessageHandler(self, contentWorld: .page, name: "exportJSON")','        content.addScriptMessageHandler(self, contentWorld: .page, name: "exportJSON")\n        content.addScriptMessageHandler(qaApi, contentWorld: .page, name: "localQA")\n        content.add(qaApi, name: "localQATheme")\n        qaApi.onTheme = { [weak self] theme in self?.applyQaTheme(theme) }','trusted QA message handlers');
 text=replace(text,'server = LocalAssetServer(root: root)','server = LocalAssetServer(root: root, qaApi: qaApi)','same retained proxy for avatar requests');
 text=text.replace('webView.isInspectable = false','webView.isInspectable = true').replaceAll('愚笨者\\n',NAME+'\\n');
 text=replace(text,'    private func isLocal(_ url: URL?) -> Bool {','    private func applyQaTheme(_ theme: String) {\n        let color: UIColor\n        switch theme {\n        case "dark": color = UIColor(red: 16/255, green: 21/255, blue: 31/255, alpha: 1)\n        case "eyecare": color = UIColor(red: 221/255, green: 232/255, blue: 208/255, alpha: 1)\n        case "light": color = UIColor(red: 247/255, green: 249/255, blue: 252/255, alpha: 1)\n        default: return\n        }\n        overrideUserInterfaceStyle = theme == "dark" ? .dark : .light\n        view.backgroundColor = color; webView.backgroundColor = color; webView.scrollView.backgroundColor = color; privacyCover.backgroundColor = color\n    }\n\n    private func isLocal(_ url: URL?) -> Bool {','native shell theme synchronization');
 return replace(text,'deinit { startupTimeout?.cancel(); server?.stop() }','deinit { startupTimeout?.cancel(); server?.stop(); qaApi.stop() }','cancel QA requests on teardown');
});
const web=join(output,'App/Web');await mkdir(web,{recursive:true});
for(const name of WEB)await cp(join(source,name),join(web,name));
await cp(join(here,'qa-runtime.js'),join(web,'qa-runtime.js'));
await modify(join(web,'index.html'),text=>replace(text,'</head>','<script src="./qa-runtime.js"></script>\n</head>','load QA adapter before application').replace(' https://66.42.56.29/api/social/avatars/','').replace(' https://66.42.56.29/api/social/',''));
const webHashes={};for(const name of [...WEB,'qa-runtime.js'])webHashes[name]=createHash('sha256').update(await readFile(join(web,name))).digest('hex');
for(const name of WEB.filter(name=>name!=='index.html'))if(webHashes[name]!==hashes[name])throw Error('Frozen application asset unexpectedly changed: '+name);
await writeFile(join(output,'web-snapshot.json'),JSON.stringify(webHashes,null,2)+'\n');
const python=value('--python')||process.env.PYTHON||(process.platform==='win32'?'python':'python3');
await run(python,[join(output,'scripts/generate-project.py')],{cwd:output,windowsHide:true});
const info={mode:'isolated-local-native-qa',platform:'ios',output,bundleId:ID,packageId:ID,product:PRODUCT,displayName:NAME,version:VERSION,build:BUILD,debVersion:DEB_VERSION,frontendVersion:frozenVersion,origin:'http://127.0.0.1:45932',upstream:'http://127.0.0.1:18914',upstreamNativeOrigin:'https://localhost',sourceSHA256:hashes,qaWebSHA256:webHashes,productionSourceModified:false,credentialsCopied:false,built:false,installed:false,notes:['Distinct app id, DEB package id, application directory, required data container and loopback port.','Local API requires an explicit iPhone SSH reverse tunnel to the host loopback server.','No production service origin is permitted in static or HTTP response CSP.','App JS/CSS and other static source assets are byte-identical; QA index adds its adapter and tightens CSP.','Only existing device jailbreak signing is used; no Apple developer credentials are required.']};
await writeFile(join(output,'local-qa-manifest.json'),JSON.stringify(info,null,2)+'\n');console.log(JSON.stringify(info,null,2));
