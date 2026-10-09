import { createServer } from 'node:http';
import { createReadStream, realpathSync } from 'node:fs';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, basename, relative, isAbsolute, sep } from 'node:path';
import { createAuthentication } from './auth.mjs';
import { handleSocialHTTP } from './social-http.mjs';
import { AdminError, assertSameOrigin, authorizeAdmin, setupAdmin, getBootstrap, listRecords, getRecord, applyAction, listAudit } from '../upstream/admin/core.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.apk':'application/vnd.android.package-archive','.deb':'application/vnd.debian.binary-package','.exe':'application/octet-stream','.zip':'application/zip','.txt':'text/plain; charset=utf-8' };
function json(response, value, status = 200) { response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
function redirect(response, location = '/') { response.writeHead(303, { Location: location }); response.end(); }
function gatePage(role, error = '', logout = false) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>愚笨者 · 受限验收</title><style>body{margin:0;background:#f3f8f5;color:#204235;font:15px/1.8 system-ui,sans-serif;display:grid;place-items:center;min-height:100dvh}main{max-width:390px;margin:24px;padding:32px;background:#fff;border:1px solid #deebe2;border-radius:18px}small{color:#678573}h1{font-size:27px;margin:12px 0}p{font-size:13px;color:#6f8276}label{display:block;margin:17px 0;font-size:13px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cdddce;border-radius:7px;font:inherit}button{width:100%;background:#14835f;color:#fff;border:0;padding:13px;border-radius:7px;font:inherit;cursor:pointer}.error{color:#a64438}</style><main><small>PRIVATE ACCEPTANCE · 0.9.0</small><h1>愚笨者${role === 'admin' ? '管理后台' : '体验验收'}</h1><p>仅限受邀验收。AI 工作台申请、审核和任务记录真实保存在服务器；模型需要配置与审核开通。消费者账号与聊天使用独立服务；资金流程仍为体验数据，未开放真实托管结算。</p>${error ? `<p role="alert" class="error">${escape(error)}</p>` : ''}<form method="post" action="${logout ? '/logout' : '/login'}">${logout ? '<p>退出当前验收会话后，需要重新输入访问凭证。</p>' : '<label>验收账号<input name="username" autocomplete="username" maxlength="40" required></label><label>访问密码<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label>'}<button type="submit">${logout ? '确认退出' : '进入受限验收'}</button></form></main></html>`;
}
async function body(request,limit=16384) {
  if (Number(request.headers['content-length'] || 0) > limit) throw new AdminError(413,'BODY_TOO_LARGE','请求内容过大。');
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new AdminError(413,'BODY_TOO_LARGE','请求内容过大。'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createAcceptanceServer({ role, origin, authConfig, database, aiService = null, socialService = null, publicFrontend = false, staticRoot, reportFile = new URL('../reports/thousand-users.json', import.meta.url) }) {
  if (!['admin','frontend'].includes(role)) throw new Error('ROLE must be admin or frontend.');
  const publicURL = new URL(origin);
  if (!['http:','https:'].includes(publicURL.protocol) || publicURL.pathname !== '/' || publicURL.search || publicURL.hash || publicURL.username || publicURL.password) throw new Error('PUBLIC_ORIGIN must be a single origin.');
  if (publicURL.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(publicURL.hostname)) throw new Error('Plain HTTP is permitted only through loopback/SSH forwarding.');
  if (role === 'admin' && !database) throw new Error('Admin requires a real SQLite database.');
  const auth = createAuthentication(authConfig, { role, origin: publicURL.origin });
  const staticBase = realpathSync.native(resolve(staticRoot));
  const insideStatic = file => {const path=relative(staticBase,file);return path!=='' && path!=='..' && !path.startsWith('..'+sep) && !isAbsolute(path);};
  const checkOrigin = request => assertSameOrigin(new Request(`${publicURL.origin}/`, { headers: { origin: request.headers.origin || '', 'sec-fetch-site': request.headers['sec-fetch-site'] || '' } }));
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control','no-store, private'); response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer'); response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Permissions-Policy',role === 'frontend' ? 'camera=(self), microphone=(), geolocation=()' : 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${role === 'frontend' ? ' https://bsc-testnet-dataseed.bnbchain.org https://bsc-testnet.bnbchain.org' : ''}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    try {
      const url = new URL(request.url || '/', publicURL.origin);
      if (url.pathname === '/healthz' && request.method === 'GET') {
        if (role === 'admin') database.raw.prepare('SELECT 1').get();
        json(response,{ok:true,service:role,version:'0.12.0',stage:role === 'frontend' && publicFrontend ? 'public-preview' : 'private-acceptance'}); return;
      }
      if (request.headers.host !== publicURL.host || url.origin !== publicURL.origin) throw new AdminError(403,'HOST_DENIED','访问地址不匹配，请使用验收地址。');
      if (role === 'frontend' && url.pathname.startsWith('/api/social/')) {
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
        if (url.pathname.startsWith('/api/')) { json(response,{error:'验收会话已失效，请刷新页面重新登录。',code:'SIGN_IN_REQUIRED'},401); return; }
        if (role !== 'frontend' || !publicFrontend || url.pathname === '/login') {
          response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); response.end(gatePage(role)); return;
        }
      }
      if (url.pathname === '/logout' || url.pathname === '/signout-with-chatgpt') { response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); response.end(gatePage(role,'',true)); return; }
      if (url.pathname.startsWith('/api/')) {
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
      if (!insideStatic(resolved) || !info.isFile() || !types[extname(file)]) throw new AdminError(404,'NOT_FOUND','页面不存在。');
      if (['.exe','.apk','.zip','.deb'].includes(extname(file))) response.setHeader('Content-Disposition',`attachment; filename="${basename(file).replace(/[^a-zA-Z0-9._-]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(basename(file)).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
      response.writeHead(200,{'Content-Type':types[extname(file)],'Content-Length':info.size});
      if (request.method === 'HEAD') response.end(); else createReadStream(resolved).on('error',() => response.destroy()).pipe(response);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof AdminError) json(response,{error:error.message,code:error.code},error.status);
      else json(response,{error:'验收服务暂不可用，数据未被重置。',code:'SERVICE_UNAVAILABLE'},503);
    }
  });
  server.requestTimeout=15000; server.headersTimeout=10000; server.keepAliveTimeout=5000;
  return server;
}
