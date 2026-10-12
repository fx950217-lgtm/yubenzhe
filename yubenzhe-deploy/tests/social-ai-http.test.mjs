import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { passwordRecord } from '../server/auth.mjs';
import { openSocialDatabase } from '../server/social-database.mjs';
import { createSocialService } from '../server/social-service.mjs';
import { createAcceptanceServer } from '../server/server.mjs';
import { NATIVE_SOCIAL_ORIGINS } from '../server/social-http.mjs';

import {openAiDatabase} from '../server/ai-database.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createSocialAI} from '../server/social-ai.mjs';
const ORIGIN = 'https://ai-isolated.invalid';
const PIN = '248635', NEXT_PIN = '593826'; // Synthetic test account passwords only.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHj8AAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG.split(',')[1], 'base64');
const acceptanceAuth = await passwordRecord('reviewer', 'Synthetic-HTTP-test-password-only!');
async function fixture(t) {
 const dir = mkdtempSync(join(tmpdir(), 'ybz-social-http-'));
 writeFileSync(join(dir, 'index.html'), '<h1>Public application fixture</h1>');
 const db = openSocialDatabase(join(dir, 'social.sqlite'));
 const service = createSocialService({ database: db });
 const aiDb=openAiDatabase(join(dir,'ai.sqlite')),ai=createAiService({database:aiDb,provider:{configured:false,configurationMessage:'隔离测试未配置模型',fingerprint:'ai-http-isolated'},maintenanceMs:100000}),adapter=createSocialAI({socialService:service,aiService:ai,maintenanceMs:100000});
 const router={handle:request=>request.path.startsWith('ai/')?adapter.handle(request):service.handle(request)};
 const server = createAcceptanceServer({ role: 'frontend', origin: ORIGIN, publicFrontend: true, authConfig: acceptanceAuth, socialService: router, staticRoot: dir });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const address = server.address();
 t.after(async () => {
   server.closeAllConnections(); await new Promise(done => server.close(done)); await adapter.close();await ai.close();aiDb.close();db.close();
   const absolute = resolve(dir), temp = resolve(tmpdir());
   assert.ok(absolute.startsWith(temp + sep) && basename(absolute).startsWith('ybz-social-http-'));
   rmSync(absolute, { recursive: true, force: true });
 });
 const request = (path, options = {}) => new Promise((done, reject) => {
   const req = httpRequest({ host: '127.0.0.1', port: address.port, path, method: options.method || 'GET', headers: { Host: 'ai-isolated.invalid', Connection: 'close', ...options.headers } }, res => {
     const chunks = []; res.on('data', value => chunks.push(value)); res.on('error', reject);
     res.on('end', () => { const bytes = Buffer.concat(chunks); done({ status: res.statusCode, headers: res.headers, bytes, text: bytes.toString('utf8'), json: () => JSON.parse(bytes.toString('utf8')) }); });
   });
   req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('HTTP test request timed out')));
   if (options.chunks) { for (const chunk of options.chunks) req.write(chunk); req.end(); }
   else req.end(options.body);
 });
 const get = (path, headers = {}) => request('/api/social/' + path, { headers });
 const post = (path, value, headers = {}) => request('/api/social/' + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
 const register = async (origin = ORIGIN) => {
   const response = await post('register', { password: PIN, requestId: randomUUID(), native: origin !== ORIGIN }, { Origin: origin });
   assert.equal(response.status, 200, response.text);
   return { response, ...response.json(), cookie: response.headers['set-cookie'][0].split(';')[0] };
 };
 return { db, aiDb, service, request, get, post, register };
}
function nativeHeaders(token, origin = NATIVE_SOCIAL_ORIGINS[0]) { return { Origin: origin, Authorization: 'Bearer ' + token }; }


test('HTTP product AI rejects anonymous access and accepts only valid web cookie or native bearer',async t=>{
 const f=await fixture(t);const anonymous=await f.get('ai/workspaces');assert.equal(anonymous.status,401);assert.equal(anonymous.json().code,'ACCOUNT_REQUIRED');
 const web=await f.register();const webHeaders={Cookie:web.cookie};assert.equal((await f.get('ai/workspaces',webHeaders)).status,200);const caps=await f.get('ai/capabilities',webHeaders);assert.equal(caps.json().identityType,'product_account');assert.equal(caps.json().cloud.configured,false);
 const native=await f.register(NATIVE_SOCIAL_ORIGINS[0]);const nativeRequest=await f.get('ai/workspaces',nativeHeaders(native.token));assert.equal(nativeRequest.status,200);assert.equal(nativeRequest.headers['access-control-allow-origin'],NATIVE_SOCIAL_ORIGINS[0]);assert.equal((await f.get('ai/workspaces',nativeHeaders(native.token,'https://untrusted.invalid'))).status,403);
 const bad=await f.post('ai/workspaces',{name:'拒绝跨域',purpose:'research',requirements:'这是未授权来源的隔离测试。',requestId:randomUUID()},{Cookie:web.cookie,Origin:'https://untrusted.invalid'});assert.equal(bad.status,403);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_workspaces').get().n,0);
});
test('HTTP AI workspaces are real and cross-account isolated with no legacy/admin privilege crossover',async t=>{
 const f=await fixture(t),a=await f.register(NATIVE_SOCIAL_ORIGINS[0]),b=await f.register(NATIVE_SOCIAL_ORIGINS[0]);const input={name:'产品账号独立工作区',purpose:'research',requirements:'通过真实HTTP验证账号隔离和申请持久化。',requestId:randomUUID()};const created=await f.post('ai/workspaces',input,nativeHeaders(a.token));assert.equal(created.status,200);const ws=created.json().workspace;assert.equal(ws.status,'pending_review');assert.equal((await f.post('ai/workspaces',input,nativeHeaders(a.token))).json().workspace.id,ws.id);assert.deepEqual((await f.get('ai/workspaces',nativeHeaders(b.token))).json().items,[]);assert.equal((await f.get('ai/workspaces/'+ws.id,nativeHeaders(b.token))).status,404);
 const denied=await f.post('ai/workspaces/'+ws.id+'/actions',{action:'approve',version:1,requestId:randomUUID()},nativeHeaders(a.token));assert.equal(denied.status,403);assert.equal((await f.post('ai/readiness',{requestId:randomUUID()},nativeHeaders(a.token))).status,404);
 assert.equal((await f.request('/api/ai/workspaces',{headers:nativeHeaders(a.token)})).status,404);assert.equal((await f.request('/api/admin/ai/workspaces',{headers:nativeHeaders(a.token)})).status,401);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_workspaces').get().n,1);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_tasks').get().n,0);
});
