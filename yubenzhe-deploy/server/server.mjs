import { createServer } from 'node:http';
import { createReadStream, realpathSync, readFileSync } from 'node:fs';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, basename, relative, isAbsolute, sep } from 'node:path';
import { createAuthentication } from './auth.mjs';
import { handleSocialHTTP } from './social-http.mjs';
import {validateInternalPreview} from './internal-preview.mjs';
import {readDeploymentConfiguration} from './deployment-config.mjs';
import {readChainPreviewConfig} from './chain-preview-config.mjs';
import { AdminError, assertSameOrigin, authorizeAdmin, setupAdmin, getBootstrap, listRecords, getRecord, applyAction, listAudit } from '../upstream/admin/core.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const APP_VERSION=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.apk':'application/vnd.android.package-archive','.deb':'application/vnd.debian.binary-package','.exe':'application/octet-stream','.zip':'application/zip','.txt':'text/plain; charset=utf-8','.pdf':'application/pdf' };
function json(response, value, status = 200) { response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
function redirect(response, location = '/') { response.writeHead(303, { Location: location }); response.end(); }
function gatePage(role, error = '', logout = false) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YBZ 愚笨者 · 内部预览</title><style>body{margin:0;background:#F7F7F9;color:#1A1A1A;font:15px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;letter-spacing:.5px;display:grid;place-items:center;min-height:100dvh}main{box-sizing:border-box;width:min(420px,calc(100% - 40px));margin:28px 0;padding:32px;background:#fff;border:1px solid #E8E8EE;border-radius:20px}small{color:#666;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}h1{color:#1B1B1F;font-size:26px;line-height:1.5;margin:12px 0 16px}p{font-size:14px;color:#666;margin:0 0 24px}label{display:block;margin:20px 0;font-size:13px}input{box-sizing:border-box;width:100%;margin-top:8px;padding:13px 14px;border:1px solid #E8E8EE;border-radius:8px;background:#fff;color:#1A1A1A;font:inherit}input:focus-visible,button:focus-visible{outline:2px solid #6C5CE7;outline-offset:3px}button{width:100%;margin-top:8px;background:linear-gradient(90deg,#6C5CE7,#A29BFE);color:#1B1B1F;border:0;padding:14px;border-radius:14px;font:inherit;font-size:19px;font-weight:700;line-height:1.5;cursor:pointer}.error{color:#C02F28}</style><main><small>YBZ · ${APP_VERSION}</small><h1>YBZ 愚笨者 ${role === 'admin' ? '管理后台' : '内部预览'}</h1><p>仅供内部体验与反馈。链上功能使用 BSC 测试网。</p>${error ? `<p role="alert" class="error">${escape(error)}</p>` : ''}<form method="post" action="${logout ? '/logout' : '/login'}">${logout ? '<p>退出后，需要重新输入访问凭证。</p>' : '<label>内部账号<input name="username" autocomplete="username" maxlength="40" required></label><label>访问密码<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label>'}<button type="submit">${logout ? '确认退出' : '进入内部预览'}</button></form></main></html>`;
}
async function body(request,limit=16384) {
  if (Number(request.headers['content-length'] || 0) > limit) throw new AdminError(413,'BODY_TOO_LARGE','请求内容过大。');
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new AdminError(413,'BODY_TOO_LARGE','请求内容过大。'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createAcceptanceServer({ role, origin, authConfig, database, aiService = null, socialService = null, publicFrontend = false, internalPreview = false, chainPreviewConfigFile, rpcUrls=readDeploymentConfiguration({}).rpcUrls, staticRoot, reportFile = new URL('../reports/thousand-users.json', import.meta.url) }) {
  if (!['admin','frontend'].includes(role)) throw new Error('ROLE must be admin or frontend.');
  validateInternalPreview({internalPreview,role,origin,publicFrontend});
  const publicURL = new URL(origin);
  if (!['http:','https:'].includes(publicURL.protocol) || publicURL.pathname !== '/' || publicURL.search || publicURL.hash || publicURL.username || publicURL.password) throw new Error('PUBLIC_ORIGIN must be a single origin.');
  if (publicURL.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(publicURL.hostname)) throw new Error('Plain HTTP is permitted only through loopback/SSH forwarding.');
  if (role === 'admin' && !database) throw new Error('Admin requires a real SQLite database.');
  const rpcOrigins=[...new Set(rpcUrls.map(value=>{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid public RPC URL.');return url.origin;}))];
  const auth = createAuthentication(authConfig, { role, origin: publicURL.origin });
  const staticBase = realpathSync.native(resolve(staticRoot));
  const insideStatic = file => {const path=relative(staticBase,file);return path!=='' && path!=='..' && !path.startsWith('..'+sep) && !isAbsolute(path);};
  const publicStatic = role === 'frontend' && publicFrontend;
  // Keep private release material inaccessible even if an operator accidentally
  // copies it into a public image. Check resolved paths as well to cover aliases.
  const internalStatic = file => relative(staticBase,file).split(sep)[0].replace(/[ .]+$/,'').toLowerCase() === 'internal';
  const checkOrigin = request => assertSameOrigin(new Request(`${publicURL.origin}/`, { headers: { origin: request.headers.origin || '', 'sec-fetch-site': request.headers['sec-fetch-site'] || '' } }));
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control','no-store, private'); response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','same-origin'); response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Permissions-Policy',role === 'frontend' ? 'camera=(self), microphone=(), geolocation=()' : 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${role === 'frontend' ? ' '+rpcOrigins.join(' ') : ''}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    try {
      const url = new URL(request.url || '/', publicURL.origin);
      if (url.pathname === '/healthz' && request.method === 'GET') {
        if (role === 'admin') database.raw.prepare('SELECT 1').get();
        socialService?.health?.();
        json(response,{ok:true,service:role,version:APP_VERSION,stage:internalPreview ? 'internal-preview' : role === 'frontend' && publicFrontend ? 'public-preview' : 'private-acceptance',...(socialService?.desktop?{desktop:{available:socialService.desktop.capabilities().available,code:socialService.desktop.capabilities().code}}:{})}); return;
      }
      if (request.headers.host !== publicURL.host || url.origin !== publicURL.origin) throw new AdminError(403,'HOST_DENIED','访问地址不匹配，请使用验收地址。');
      if (publicStatic) {
        let pathname;try { pathname=decodeURIComponent(url.pathname); } catch { throw new AdminError(404,'NOT_FOUND','页面不存在。'); }
        if (internalStatic(resolve(staticBase,`.${pathname.replace(/\\/g,'/')}`))) throw new AdminError(404,'NOT_FOUND','页面不存在。');
      }
      if(role==='frontend'&&(['/api/device-bridge/claim','/api/device-bridge/enroll','/api/device-bridge/poll','/api/device-bridge/ai/poll'].includes(url.pathname)||url.pathname.startsWith('/api/device-bridge/ai/files/'))){
        if(request.method!=='POST'||request.headers.origin||request.headers.referer||request.headers['sec-fetch-site']==='cross-site')throw new AdminError(403,'DEVICE_AGENT_ONLY','此接口仅接受设备连接器。');
        if(request.headers['content-type']?.split(';')[0]!=='application/json')throw new AdminError(415,'JSON_REQUIRED','操作仅接受 JSON。');
        if(!socialService?.devices)throw new AdminError(503,'DEVICE_UNAVAILABLE','设备服务未启用。');
        let input;try{input=JSON.parse(await body(request,url.pathname.endsWith('/claim')?8192:650*1024));}catch(e){if(e.status)throw e;throw new AdminError(400,'INVALID_JSON','请求内容无效。');}
        const token=/^Bearer ([-_A-Za-z0-9]{43})$/.exec(request.headers.authorization||'')?.[1];
        if(url.pathname.startsWith('/api/device-bridge/ai/')&&!socialService.aiChannel)throw new AdminError(503,'AI_CHANNEL_UNAVAILABLE','AI 设备通道未启用。');
        const value=url.pathname==='/api/device-bridge/claim'?socialService.devices.claimMachine(input,request.socket.remoteAddress||'unknown'):url.pathname==='/api/device-bridge/ai/poll'?socialService.aiChannel.poll(token,input):url.pathname.startsWith('/api/device-bridge/ai/files/')?socialService.aiChannel.handleAgentFiles(token,url.pathname.slice('/api/device-bridge/ai/files/'.length),input):url.pathname.endsWith('/enroll')?socialService.devices.enroll(input):socialService.devices.poll(token,input);
        json(response,value);return;
      }
      if (!internalPreview && role === 'frontend' && url.pathname.startsWith('/api/ai-channel/')) {
        await handleSocialHTTP({request,response,url,publicURL,service:socialService,readBody:body,pathPrefix:'/api/ai-channel/',pathBase:'ai-channel/'}); return;
      }
      if (!internalPreview && role === 'frontend' && (url.pathname==='/api/desktop'||url.pathname.startsWith('/api/desktop/'))) {
        await handleSocialHTTP({request,response,url,publicURL,service:socialService,readBody:body,pathPrefix:'/api/desktop',pathBase:'desktop'}); return;
      }
      if (!internalPreview && role === 'frontend' && url.pathname.startsWith('/api/social/')) {
        await handleSocialHTTP({request,response,url,publicURL,service:socialService,readBody:body}); return;
      }
      if (url.pathname === '/login' && request.method === 'POST') {
        checkOrigin(request);
        if (!String(request.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw new AdminError(415,'FORM_REQUIRED','请使用登录表单。');
        const values = new URLSearchParams(await body(request));
        const result = await auth.login(values.get('username'), values.get('password'), request.socket.remoteAddress);
        if (!result.ok) { response.writeHead(result.limited ? 429 : 401, {'Content-Type':'text/html; charset=utf-8'}); response.end(gatePage(role,result.limited ? '尝试过于频繁，请 15 分钟后重试。' : '账号或密码不正确。')); return; }
        response.setHeader('Set-Cookie',result.cookie); redirect(response); return;
      }
      if (url.pathname === '/logout' && request.method === 'POST') { checkOrigin(request); response.setHeader('Set-Cookie',auth.logout(request)); redirect(response); return; }
      const user = auth.user(request);
      if (!user) {
        if (url.pathname.startsWith('/api/')) { json(response,{error:internalPreview?'请先登录内部预览，再使用产品账号。':'验收会话已失效，请刷新页面重新登录。',code:internalPreview?'INTERNAL_PREVIEW_REQUIRED':'SIGN_IN_REQUIRED'},401); return; }
        if (role !== 'frontend' || !publicFrontend || url.pathname === '/login') {
          response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); response.end(gatePage(role)); return;
        }
      }
      if (internalPreview && role === 'frontend' && url.pathname.startsWith('/api/social/')) {
        await handleSocialHTTP({request,response,url,publicURL,service:socialService,readBody:body,internalPreviewUser:user}); return;
      }
      if (internalPreview && role === 'frontend' && url.pathname.startsWith('/api/ai-channel/')) {
        await handleSocialHTTP({request,response,url,publicURL,service:socialService,readBody:body,internalPreviewUser:user,pathPrefix:'/api/ai-channel/',pathBase:'ai-channel/'}); return;
      }
      if (internalPreview && role === 'frontend' && (url.pathname==='/api/desktop'||url.pathname.startsWith('/api/desktop/'))) {
        await handleSocialHTTP({request,response,url,publicURL,service:socialService,readBody:body,internalPreviewUser:user,pathPrefix:'/api/desktop',pathBase:'desktop'}); return;
      }
      if (internalPreview && url.pathname.startsWith('/api/ai/'))throw new AdminError(404,'NOT_FOUND','请使用产品账号工作台入口。');
      if (internalPreview && url.pathname === '/api/chain-preview/config') {
        if(request.method!=='GET')throw new AdminError(405,'METHOD_NOT_ALLOWED','配置接口仅支持读取。');
        if(request.headers.origin&&request.headers.origin!==publicURL.origin||request.headers['sec-fetch-site']==='cross-site')throw new AdminError(403,'ORIGIN_DENIED','配置仅限当前内部预览读取。');
        json(response,await readChainPreviewConfig(chainPreviewConfigFile));return;
      }
      if (url.pathname === '/logout' || url.pathname === '/signout-with-chatgpt') { response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); response.end(gatePage(role,'',true)); return; }
      if (url.pathname.startsWith('/api/')) {
        if(role==='admin'&&url.pathname.startsWith('/api/admin/product/')){
          await authorizeAdmin(database,user);
          if(!socialService?.operations)throw new AdminError(503,'PRODUCT_ADMIN_UNAVAILABLE','真实产品运营暂不可用。');
          let input={};
          if(request.method==='POST'){
            checkOrigin(request);
            if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new AdminError(415,'JSON_REQUIRED','操作仅接受 JSON。');
            try{input=JSON.parse(await body(request,8192));}catch(error){if(error instanceof AdminError)throw error;throw new AdminError(400,'INVALID_JSON','请求内容无效。');}
            if(!input||typeof input!=='object'||Array.isArray(input))throw new AdminError(400,'INVALID_FIELDS','操作字段无效。');
          }
          const result=await socialService.operations.handle({method:request.method,path:url.pathname.slice('/api/admin/product/'.length),query:Object.fromEntries(url.searchParams),input,actor:user.userId});
          if(result.binary){response.writeHead(200,{'Content-Type':result.mime,'Content-Length':result.binary.length});response.end(result.binary);}else json(response,result);return;
        }
        if(role==='admin'&&url.pathname.startsWith('/api/admin/community/')){
          await authorizeAdmin(database,user);
          if(!socialService?.community)throw new AdminError(503,'COMMUNITY_UNAVAILABLE','社区管理尚未接通。');
          let input={};
          if(request.method==='POST'){
            checkOrigin(request);
            if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new AdminError(415,'JSON_REQUIRED','操作仅接受 JSON。');
            try{input=JSON.parse(await body(request,32768));}catch(error){if(error instanceof AdminError)throw error;throw new AdminError(400,'INVALID_JSON','请求内容无效。');}
            if(!input||typeof input!=='object'||Array.isArray(input))throw new AdminError(400,'INVALID_JSON','请求内容无效。');
          }
          const result=await socialService.community.adminHandle({method:request.method,path:url.pathname.slice('/api/admin/community/'.length),input,actor:user.userId});
          json(response,result);return;
        }
        if(role==='admin'&&url.pathname.startsWith('/api/admin/social/')){
          await authorizeAdmin(database,user);
          if(!socialService?.moderation)throw new AdminError(503,'SOCIAL_UNAVAILABLE','真实社交管理暂不可用。');
          const actionPath=url.pathname.slice('/api/admin/social/'.length);let result;
          if(request.method==='GET'&&actionPath==='reports')result={reports:socialService.moderation.list(url.searchParams.get('status')||'pending')};
          else if(request.method==='GET'&&/^reports\/[a-f0-9-]{36}$/.test(actionPath))result=socialService.moderation.show(actionPath.slice(8));
          else if(request.method==='POST'&&actionPath==='resolve'){
            checkOrigin(request);
            if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new AdminError(415,'JSON_REQUIRED','操作仅接受 JSON。');
            let input;try{input=JSON.parse(await body(request,8192))}catch(error){if(error instanceof AdminError)throw error;throw new AdminError(400,'INVALID_JSON','请求内容无效。');}
            if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['reportId','action','reason'].includes(key)))throw new AdminError(400,'INVALID_FIELDS','操作字段无效。');
            result=socialService.moderation.resolve({...input,actor:user.userId});
          }else throw new AdminError(404,'NOT_FOUND','管理入口不存在。');
          json(response,result);return;
        }
        const aiPrefix=role==='admin'?'/api/admin/ai/':'/api/ai/';
        if(url.pathname.startsWith(aiPrefix)) {
          if(!aiService)throw new AdminError(503,'AI_DATABASE_UNAVAILABLE','工作台存储尚未接通，请稍后重试。');
          if(role==='admin')await authorizeAdmin(database,user,{allowUninitialized:true});
          let aiInput={};
          if(request.method==='POST') {
            checkOrigin(request);
            if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new AdminError(415,'JSON_REQUIRED','操作仅接受 JSON。');
            try{aiInput=JSON.parse(await body(request,32768));}catch(error){if(error instanceof AdminError)throw error;throw new AdminError(400,'INVALID_JSON','请求格式无效。');}
            if(!aiInput||typeof aiInput!=='object'||Array.isArray(aiInput))throw new AdminError(400,'INVALID_JSON','请求格式无效。');
          }
          const result=await aiService.handle({role,user,method:request.method,path:url.pathname.slice(aiPrefix.length),input:aiInput,query:Object.fromEntries(url.searchParams)});
          json(response,result.value,result.status||200);return;
        }
        if (role !== 'admin') throw new AdminError(404,'NOT_FOUND','此入口不存在。');
        if (!url.pathname.startsWith('/api/admin/')) throw new AdminError(404,'NOT_FOUND','接口不存在。');
        const path = url.pathname.slice('/api/admin/'.length), input = Object.fromEntries(url.searchParams);
        let value;
        if (request.method === 'GET') {
          if (path === 'bootstrap') value = await getBootstrap(database,user);
          else if (path === 'records') value = await listRecords(database,user,input);
          else if (/^records\/[a-z]+\/[a-z0-9-]+$/.test(path)) { const [,kind,id] = path.split('/'); value = await getRecord(database,user,kind,id); }
          else if (path === 'audit') value = await listAudit(database,user,input);
          else if (path === 'report') { await authorizeAdmin(database,user,{allowUninitialized:true}); value = JSON.parse(await readFile(reportFile,'utf8')); }
          else throw new AdminError(404,'NOT_FOUND','接口不存在。');
        } else if (request.method === 'POST' && ['setup','actions'].includes(path)) {
          checkOrigin(request);
          if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AdminError(415,'JSON_REQUIRED','操作仅接受 JSON。');
          let input; try { input = JSON.parse(await body(request)); } catch (error) { if (error instanceof AdminError) throw error; throw new AdminError(400,'INVALID_JSON','请求格式无效。'); }
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminError(400,'INVALID_JSON','请求格式无效。');
          if (path === 'setup') { if (Object.keys(input).length) throw new AdminError(400,'INVALID_FIELDS','初始化不接受自定义所有者或样本。'); value = await setupAdmin(database,user); }
          else value = await applyAction(database,user,input);
        } else throw new AdminError(405,'METHOD_NOT_ALLOWED','不支持此请求方式。');
        json(response,value); return;
      }
      if (!['GET','HEAD'].includes(request.method)) throw new AdminError(405,'METHOD_NOT_ALLOWED','不支持此请求方式。');
      const name = decodeURIComponent(url.pathname), file = resolve(staticBase, `.${name === '/' ? '/index.html' : name}`);
      if (!insideStatic(file) || name.split('/').some(part => part.startsWith('.')) || /[\\\0]/.test(name)) throw new AdminError(404,'NOT_FOUND','页面不存在。');
      let resolved, info; try { resolved = await realpath(file); info = await stat(resolved); } catch { throw new AdminError(404,'NOT_FOUND','页面不存在。'); }
      if (!insideStatic(resolved) || !info.isFile() || !types[extname(file)] || publicStatic && internalStatic(resolved)) throw new AdminError(404,'NOT_FOUND','页面不存在。');
      if (['.exe','.apk','.zip','.deb'].includes(extname(file))) response.setHeader('Content-Disposition',`attachment; filename="${basename(file).replace(/[^a-zA-Z0-9._-]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(basename(file)).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
      response.writeHead(200,{'Content-Type':types[extname(file)],'Content-Length':info.size});
      if (request.method === 'HEAD') response.end(); else createReadStream(resolved).on('error',() => response.destroy()).pipe(response);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof AdminError) json(response,{error:error.message,code:error.code},error.status);
      else json(response,{error:'验收服务暂不可用，数据未被重置。',code:'SERVICE_UNAVAILABLE'},503);
    }
  });
  // No WebSocket transport is implemented. Never let an upgrade bypass the gate.
  if(internalPreview)server.on('upgrade',(request,socket)=>{
    const allowed=request.headers.host===publicURL.host&&(!request.headers.origin||request.headers.origin===publicURL.origin)&&auth.user(request);
    socket.end('HTTP/1.1 '+(allowed?'404 Not Found':'401 Unauthorized')+'\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n');
  });
  server.requestTimeout=15000; server.headersTimeout=10000; server.keepAliveTimeout=5000;
  return server;
}
