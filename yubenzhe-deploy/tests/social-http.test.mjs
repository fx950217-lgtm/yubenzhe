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

const ORIGIN = 'https://66.42.56.29';
const PIN = '248635', NEXT_PIN = '593826'; // Synthetic test account passwords only.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHj8AAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG.split(',')[1], 'base64');
const acceptanceAuth = await passwordRecord('reviewer', 'Synthetic-HTTP-test-password-only!');
async function fixture(t) {
 const dir = mkdtempSync(join(tmpdir(), 'ybz-social-http-'));
 writeFileSync(join(dir, 'index.html'), '<h1>Public application fixture</h1>');
 const db = openSocialDatabase(join(dir, 'social.sqlite'));
 const service = createSocialService({ database: db });
 const server = createAcceptanceServer({ role: 'frontend', origin: ORIGIN, publicFrontend: true, authConfig: acceptanceAuth, socialService: service, staticRoot: dir });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const address = server.address();
 t.after(async () => {
   server.closeAllConnections(); await new Promise(done => server.close(done)); db.close();
   const absolute = resolve(dir), temp = resolve(tmpdir());
   assert.ok(absolute.startsWith(temp + sep) && basename(absolute).startsWith('ybz-social-http-'));
   rmSync(absolute, { recursive: true, force: true });
 });
 const request = (path, options = {}) => new Promise((done, reject) => {
   const req = httpRequest({ host: '127.0.0.1', port: address.port, path, method: options.method || 'GET', headers: { Host: '66.42.56.29', Connection: 'close', ...options.headers } }, res => {
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
 return { db, service, request, get, post, register };
}
function nativeHeaders(token, origin = NATIVE_SOCIAL_ORIGINS[0]) { return { Origin: origin, Authorization: 'Bearer ' + token }; }

test('public social routes do not authenticate anonymous requests to legacy AI or admin APIs', async t => {
 const f = await fixture(t);
 assert.equal((await f.request('/healthz')).status, 200);
 for (const path of ['/api/ai/workspaces', '/api/admin/bootstrap', '/api/admin/ai/workspaces']) {
   const response = await f.request(path, { headers: { 'oai-authenticated-user-id': 'forged-user' } });
   assert.equal(response.status, path.startsWith('/api/ai/')?404:401); assert.equal(response.json().code, path.startsWith('/api/ai/')?'NOT_FOUND':'SIGN_IN_REQUIRED');
 }
 const account = await f.register(NATIVE_SOCIAL_ORIGINS[0]);
 for (const path of ['/api/ai/workspaces', '/api/admin/bootstrap']) assert.equal((await f.request(path, { headers: { ...nativeHeaders(account.token), Cookie: account.cookie } })).status, path.startsWith('/api/ai/')?404:401);
 assert.equal(f.db.raw.prepare('SELECT count(*) n FROM accounts').get().n, 1);
});

test('web registration uses a secure HttpOnly Strict cookie and never exposes a bearer token', async t => {
 const f = await fixture(t), requestId = randomUUID();
 const response = await f.post('register', { password: PIN, requestId, native: true });
 assert.equal(response.status, 200); assert.equal(response.json().token, undefined);
 const header = response.headers['set-cookie'][0];
 assert.match(header, /^ybz_social=[-_A-Za-z0-9]{43}; Path=\/api\/social;/);
 for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Max-Age=2592000', 'Secure']) assert.ok(header.includes(attribute));
 const cookie = header.split(';')[0], profile = response.json().profile;
 assert.match(profile.userId, /^\d{10}$/); assert.equal(profile.identityScope, 'server');
 const me = await f.get('me', { Cookie: cookie }); assert.equal(me.status, 200); assert.equal(me.json().profile.userId, profile.userId);
 assert.equal(me.headers['set-cookie'], undefined); assert.equal(me.headers['access-control-allow-origin'], undefined);
 const replay = await f.post('register', { password: PIN, requestId }); assert.equal(replay.status, 200); assert.equal(replay.json().profile.userId, profile.userId);
 assert.equal(f.db.raw.prepare('SELECT count(*) n FROM accounts').get().n, 1);
 assert.match(response.headers['cache-control'], /no-store/); assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('exactly three native origins can receive bearer tokens and CORS response headers', async t => {
 const f = await fixture(t);
 assert.deepEqual(NATIVE_SOCIAL_ORIGINS, ['https://localhost', 'http://127.0.0.1:45931', 'yubenzhe://app']);
 for (const origin of NATIVE_SOCIAL_ORIGINS) {
   const account = await f.register(origin); assert.match(account.token, /^[-_A-Za-z0-9]{43}$/);
   assert.equal(account.response.headers['access-control-allow-origin'], origin); assert.equal(account.response.headers.vary, 'Origin');
   assert.equal(account.response.headers['access-control-allow-credentials'], undefined);
   assert.equal(account.response.headers['access-control-expose-headers'], 'ETag');
   const me = await f.get('me', nativeHeaders(account.token, origin)); assert.equal(me.status, 200); assert.equal(me.json().profile.userId, account.profile.userId);
   const preflight = await f.request('/api/social/profile', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
   assert.equal(preflight.status, 204); assert.equal(preflight.bytes.length, 0); assert.equal(preflight.headers['access-control-allow-origin'], origin);
   assert.equal(preflight.headers['access-control-allow-methods'], 'GET, POST, OPTIONS'); assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type, Authorization, If-None-Match');
 }
 for (const origin of ['null', 'http://localhost', 'https://localhost:444', 'http://127.0.0.1:45932', 'yubenzhe://evil', 'https://66.42.56.29.evil.test', 'https://attacker.example']) {
   const response = await f.request('/api/social/register', { method: 'OPTIONS', headers: { Origin: origin } });
   assert.equal(response.status, 403, origin); assert.equal(response.json().code, 'ORIGIN_DENIED'); assert.equal(response.headers['access-control-allow-origin'], undefined);
 }
});

test('host mismatch and cross-site or absent-origin mutations cannot use an existing cookie', async t => {
 const f = await fixture(t), account = await f.register();
 for (const origin of [undefined, 'https://attacker.example', 'null']) {
   const headers = { Cookie: account.cookie, 'Content-Type': 'application/json' }; if (origin !== undefined) headers.Origin = origin;
   const response = await f.request('/api/social/logout', { method: 'POST', headers, body: '{}' });
   assert.equal(response.status, 403); assert.equal(response.json().code, 'ORIGIN_DENIED'); assert.equal(response.headers['set-cookie'], undefined);
 }
 assert.equal((await f.get('me', { Cookie: account.cookie, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
 for (const host of ['attacker.example', '66.42.56.29:444', '66.42.56.29.evil.test']) {
   const response = await f.get('me', { Cookie: account.cookie, Host: host }); assert.equal(response.status, 403); assert.equal(response.json().code, 'HOST_DENIED');
 }
 assert.equal((await f.get('me', { Cookie: account.cookie })).status, 200);
 assert.equal((await f.request('/api/social/me', { method: 'DELETE', headers: nativeHeaders('A'.repeat(43)) })).status, 405);
});

test('wrong business password is distinguishable from expired sessions and does not log the account out', async t => {
 const f = await fixture(t), account = await f.register(), auth = { Cookie: account.cookie };
 const wrong = await f.post('password', { currentPassword: '111222', newPassword: NEXT_PIN }, auth);
 assert.equal(wrong.status, 401); assert.equal(wrong.json().code, 'BAD_PASSWORD'); assert.equal(wrong.headers['set-cookie'], undefined);
 assert.equal((await f.get('me', auth)).status, 200);
 const idChange = await f.post('profile', { nickname: account.profile.nickname, bio: account.profile.bio, avatar: account.profile.avatar, avatarImage: account.profile.avatarImage, revision: account.profile.revision, userId: '29573186', currentPassword: '111222' }, auth);
 assert.equal(idChange.status, 401); assert.equal(idChange.json().code, 'BAD_PASSWORD'); assert.equal((await f.get('me', auth)).status, 200);
 const invalid = await f.get('me', nativeHeaders('A'.repeat(43))); assert.equal(invalid.status, 401); assert.equal(invalid.json().code, 'ACCOUNT_REQUIRED');
 const login = await f.post('login', { userId: account.profile.userId, password: '111222' }); assert.equal(login.status, 401); assert.equal(login.json().code, 'BAD_CREDENTIALS');
 assert.equal((await f.get('me', auth)).status, 200);
});

test('password rotation replaces the web cookie and revokes every prior device session; logout revokes only its token', async t => {
 const f = await fixture(t), account = await f.register();
 const logged = await f.post('login', { userId: account.profile.userId, password: PIN }, { Origin: NATIVE_SOCIAL_ORIGINS[2] }); assert.equal(logged.status, 200); const oldToken = logged.json().token;
 const changed = await f.post('password', { currentPassword: PIN, newPassword: NEXT_PIN }, { Cookie: account.cookie });
 assert.equal(changed.status, 200); assert.equal(changed.json().token, undefined); const nextCookie = changed.headers['set-cookie'][0].split(';')[0]; assert.notEqual(nextCookie, account.cookie);
 assert.equal((await f.get('me', { Cookie: account.cookie })).status, 401); assert.equal((await f.get('me', nativeHeaders(oldToken))).status, 401);
 assert.equal((await f.get('me', { Cookie: nextCookie })).status, 200);
 const nextNative = await f.post('login', { userId: account.profile.userId, password: NEXT_PIN }, { Origin: NATIVE_SOCIAL_ORIGINS[0] }); assert.equal(nextNative.status, 200);
 const logout = await f.post('logout', {}, { Cookie: nextCookie }); assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
 assert.equal((await f.get('me', { Cookie: nextCookie })).status, 401);
 assert.equal((await f.get('me', nativeHeaders(nextNative.json().token))).status, 200);
 const nativeLogout = await f.post('logout', {}, nativeHeaders(nextNative.json().token)); assert.equal(nativeLogout.status, 200);
 assert.equal((await f.get('me', nativeHeaders(nextNative.json().token))).status, 401);
});

test('GET state returns ETag 304 until an authoritative profile change', async t => {
 const f = await fixture(t), account = await f.register(NATIVE_SOCIAL_ORIGINS[0]), headers = nativeHeaders(account.token);
 const first = await f.get('state', headers); assert.equal(first.status, 200); assert.match(first.headers.etag, /^"[a-f0-9]{64}"$/);
 const same = await f.get('state', { ...headers, 'If-None-Match': first.headers.etag }); assert.equal(same.status, 304); assert.equal(same.bytes.length, 0); assert.equal(same.headers.etag, first.headers.etag);
 const profile = account.profile, changed = await f.post('profile', { nickname: 'HTTP 更新资料', bio: '', avatar: profile.avatar, avatarImage: '', userId: profile.userId, revision: profile.revision }, headers); assert.equal(changed.status, 200, changed.text);
 const newer = await f.get('state', { ...headers, 'If-None-Match': first.headers.etag }); assert.equal(newer.status, 200); assert.notEqual(newer.headers.etag, first.headers.etag); assert.equal(newer.json().profile.nickname, 'HTTP 更新资料');
});

test('invalid JSON, wrong content types and oversized fixed-length bodies do not create accounts', async t => {
 const f = await fixture(t);
 for (const body of ['{broken', 'null', '[]', 'true', '"hello"']) {
   const response = await f.request('/api/social/register', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body });
   assert.equal(response.status, 400); assert.equal(response.json().code, 'INVALID_JSON');
 }
 const wrongType = await f.request('/api/social/register', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: '{}' }); assert.equal(wrongType.status, 415);
 const huge = 'x'.repeat(800 * 1024 + 1);
 const oversized = await f.request('/api/social/register', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(huge) }, body: huge });
 assert.equal(oversized.status, 413); assert.equal(oversized.json().code, 'BODY_TOO_LARGE'); assert.equal(f.db.raw.prepare('SELECT count(*) n FROM accounts').get().n, 0);
});

test('public opaque avatars return only image bytes across origins and old URLs are revoked after removal', async t => {
 const f = await fixture(t), owner = await f.register(NATIVE_SOCIAL_ORIGINS[0]), viewer = await f.register(NATIVE_SOCIAL_ORIGINS[1]);
 const input = { nickname: owner.profile.nickname, bio: '', avatar: owner.profile.avatar, avatarImage: PNG, userId: owner.profile.userId, revision: owner.profile.revision };
 const updated = await f.post('profile', input, nativeHeaders(owner.token)); assert.equal(updated.status, 200, updated.text);
 const found = await f.get('lookup?userId=' + owner.profile.userId, nativeHeaders(viewer.token)); assert.equal(found.status, 200);
 const avatar = found.json().profile.avatarImage; assert.match(avatar, /^\/api\/social\/avatars\/[a-f0-9-]{36}$/);
 const response = await f.request(avatar, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'image' } });
 assert.equal(response.status, 200); assert.equal(response.headers['content-type'], 'image/png'); assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.equal(response.headers['set-cookie'], undefined); assert.deepEqual(response.bytes, PNG_BYTES);
 for (const suffix of ['?x=1', '?', '#fragment', '/extra']) assert.equal((await f.request(avatar + suffix)).status, 404, suffix);
 assert.equal((await f.request(avatar, { headers: { Origin: 'https://attacker.example' } })).status, 403);
 const invalidImage = await f.post('profile', { ...input, revision: updated.json().profile.revision, avatarImage: 'data:image/svg+xml;base64,PHN2Zy8+' }, nativeHeaders(owner.token)); assert.equal(invalidImage.status, 400);
 const removed = await f.post('profile', { ...input, revision: updated.json().profile.revision, avatarImage: '' }, nativeHeaders(owner.token)); assert.equal(removed.status, 200); assert.equal((await f.request(avatar)).status, 404);
});

test('chat media requires membership and authentication even when its opaque URL is known', async t => {
 const f = await fixture(t), sender = await f.register(NATIVE_SOCIAL_ORIGINS[0]), recipient = await f.register(NATIVE_SOCIAL_ORIGINS[1]), stranger = await f.register(NATIVE_SOCIAL_ORIGINS[2]);
 const request = await f.post('friends/request', { userId: recipient.profile.userId }, nativeHeaders(sender.token)); assert.equal(request.status, 200);
 const accepted = await f.post('friends/respond', { requestId: request.json().requestId, accept: true }, nativeHeaders(recipient.token)); assert.equal(accepted.status, 200);
 const conversationId = accepted.json().conversationId;
 const sent = await f.post('conversations/' + conversationId + '/messages', { clientId: randomUUID(), type: 'image', image: { src: PNG, name: 'synthetic.png' } }, nativeHeaders(sender.token)); assert.equal(sent.status, 200, sent.text);
 const media = sent.json().message.image.src;
 const anonymous = await f.request(media); assert.equal(anonymous.status, 401); assert.equal(anonymous.json().code, 'ACCOUNT_REQUIRED');
 const outside = await f.request(media, { headers: nativeHeaders(stranger.token) }); assert.equal(outside.status, 404); assert.equal(outside.json().code, 'CHAT_NOT_FOUND');
 const member = await f.request(media, { headers: nativeHeaders(recipient.token) }); assert.equal(member.status, 200); assert.equal(member.headers['content-type'], 'image/png'); assert.deepEqual(member.bytes, PNG_BYTES);
 assert.equal((await f.request(media, { headers: { Cookie: recipient.cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
 assert.equal((await f.request(media.replace('/media/', '/avatars/'))).status, 404);
});

test('oversized chunked uploads return an explicit 413 without executing registration', async t => {
 const f = await fixture(t), chunk = 'x'.repeat(32 * 1024);
 const response = await f.request('/api/social/register', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }, chunks: Array(27).fill(chunk) });
 assert.equal(response.status, 413); assert.equal(response.json().code, 'BODY_TOO_LARGE'); assert.equal(f.db.raw.prepare('SELECT count(*) n FROM accounts').get().n, 0);
});

test('native password rotation returns a replacement bearer and rejects the previous one', async t => {
 const f = await fixture(t), account = await f.register(NATIVE_SOCIAL_ORIGINS[2]);
 const changed = await f.post('password', { currentPassword: PIN, newPassword: NEXT_PIN }, nativeHeaders(account.token, NATIVE_SOCIAL_ORIGINS[2]));
 assert.equal(changed.status, 200); const nextToken = changed.json().token; assert.match(nextToken, /^[-_A-Za-z0-9]{43}$/); assert.notEqual(nextToken, account.token);
 assert.equal((await f.get('me', nativeHeaders(account.token))).status, 401); assert.equal((await f.get('me', nativeHeaders(nextToken))).status, 200);
});
