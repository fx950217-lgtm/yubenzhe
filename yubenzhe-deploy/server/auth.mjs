import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, statSync } from 'node:fs';
const scrypt = promisify(scryptCallback);
export async function passwordRecord(username, password, userId = 'acceptance-owner') {
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(username) || typeof password !== 'string' || password.length < 16 || password.length > 256) throw new Error('Username must be 3–40 ASCII characters; password must be 16–256 characters.');
  const salt = randomBytes(32).toString('hex');
  const hash = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
  return { username, userId, displayName: '验收管理员', salt, hash };
}
export function readAuthFile(filename) {
  if (!filename) throw new Error('AUTH_CONFIG_FILE is required. No default password is supplied.');
  const stat = statSync(filename);
  if (!stat.isFile() || stat.size > 4096) throw new Error('Invalid authentication file.');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('Authentication file must have mode 0600 (or 0400).');
  const value = JSON.parse(readFileSync(filename, 'utf8'));
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(value.username) || !/^[a-f0-9]{64}$/.test(value.salt) || !/^[a-f0-9]{128}$/.test(value.hash) || typeof value.userId !== 'string' || !value.userId) throw new Error('Invalid authentication configuration.');
  return value;
}
export function createAuthentication(config, { role, origin, ttlMs = 60 * 60 * 1000 } = {}) {
  const cookieName = role === 'admin' ? 'ybz_admin_session' : 'ybz_front_session';
  const secure = new URL(origin).protocol === 'https:';
  const sessions = new Map(), attempts = new Map();
  function expire() { const now = Date.now(); for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key); for (const [key, item] of attempts) if (item.reset <= now) attempts.delete(key); }
  function token(request) { return (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''; }
  return {
    user(request) { expire(); const value = sessions.get(token(request)); return value && { userId: config.userId, displayName: config.displayName || '验收管理员' }; },
    async login(username, password, remoteAddress) {
      expire(); const key = remoteAddress || 'unknown', now = Date.now();
      const attempt = attempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
      if (attempt.count >= 10) return { limited: true };
      attempt.count++; attempts.set(key, attempt);
      if (typeof password !== 'string' || password.length > 256 || typeof username !== 'string') return { ok: false };
      const derived = Buffer.from(await scrypt(password, config.salt, 64));
      if (!timingSafeEqual(derived, Buffer.from(config.hash, 'hex')) || username !== config.username) return { ok: false };
      attempts.delete(key);
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      const value = randomBytes(32).toString('hex'); sessions.set(value, { expires: now + ttlMs });
      return { ok: true, cookie: `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}` };
    },
    logout(request) { sessions.delete(token(request)); return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`; },
  };
}
