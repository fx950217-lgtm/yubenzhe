import { isSafeProfilePhoto } from './profile-photo.js';
const KEY = 'tongban.profile.v1'; // Keep the existing key so v1 upgrades preserve user data.
export const PROFILE_AVATARS = Object.freeze(['🌱', '☀️', '🍊', '🌊', '🪴', '✨', '🐱', '🌻']);
export const USER_ID_LIMITS = Object.freeze({ min: 5, max: 24 });
export function isReservedUserId(id) {
  const text = String(id).toLowerCase();
  if (/^(admin|administrator|root|system|support|official|yubenzhe|security|service|moderator|wallet)(_|$)/.test(text)) return true;
  if (/(\d)\1{3,}/.test(text) || /^(\d{2,3})\1+$/.test(text)) return true;
  if (text.length >= 6) {
    const steps = Array.from(text.slice(1), (value, index) => Number(value) - Number(text[index]));
    if (steps.every(step => step === 1) || steps.every(step => step === -1)) return true;
  }
  return ['100000', '100001', '100100', '520520', '521521', '1314520', '5201314'].includes(text);
}
export function validateUserId(input, { allowReserved = false } = {}) {
  const userId = String(input ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{5,24}$/.test(userId)) throw new Error('账户 ID 需要 5–24 位英文字母、数字或下划线。');
  if (!allowReserved && isReservedUserId(userId)) throw new Error('这个 ID 属于系统保留靓号，请换一个号码。');
  return userId;
}
function randomUserId() {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('设备无法安全生成用户 ID，请使用 HTTPS 或更新应用。');
  for (let attempt = 0; attempt < 32; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let id = String(1 + bytes[0] % 9);
    for (const value of bytes.subarray(1)) { if (value < 250 && id.length < 10) id += String(value % 10); }
    if (id.length === 10 && !isReservedUserId(id)) return id;
  }
  throw new Error('用户 ID 暂未生成，请重新打开应用后重试。');
}
function freshProfile() {
  const userId = randomUserId();
  return { version: 2, nickname: '用户' + userId.slice(-6), bio: '', avatar: PROFILE_AVATARS[0], avatarImage: '', userId, localId: userId, level: 1, official: false, identityScope: 'local', revision: 1 };
}
function fields(input) {
  const nickname = String(input.nickname ?? '').trim(), bio = String(input.bio ?? '').trim(), avatar = input.avatar, avatarImage = input.avatarImage ?? '';
  if (!nickname || nickname.length > 24 || /[\u0000-\u001f\u007f]/.test(nickname)) throw new Error('昵称请填写 1–24 个字符，不含控制符。');
  if (bio.length > 80 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(bio)) throw new Error('个人签名最多 80 个字符，不含控制符。');
  if (!PROFILE_AVATARS.includes(avatar)) throw new Error('请选择一个头像。');
  if (!isSafeProfilePhoto(avatarImage)) throw new Error('头像照片无效或过大，请重新选择。');
  return { nickname, bio, avatar, avatarImage };
}
function persist(profile, storage) {
  try { storage.setItem(KEY, JSON.stringify(profile)); }
  catch { throw new Error('资料没有保存，请检查本机存储空间后重试。'); }
  return profile;
}
function normalized(input, remote = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('资料格式无效。');
  const userId = validateUserId(input.userId, { allowReserved: true });
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('资料版本无效。');
  if (remote && (!Number.isSafeInteger(input.level) || input.level < 1 || input.level > 1000 || typeof input.official !== 'boolean')) throw new Error('账号标识无效。');
  return { version: 2, ...fields(input), userId, localId: userId, level: remote ? input.level : 1, official: remote ? input.official : false, identityScope: remote ? 'server' : 'local', revision: input.revision, ...(remote && ['email','pin','password'].includes(input.authMode) ? {authMode: input.authMode} : {}) };
}
export function getLocalProfile(storage = globalThis.localStorage) {
  let raw;
  try { raw = storage.getItem(KEY); } catch { throw new Error('无法读取本机资料，请检查浏览器存储权限。'); }
  if (!raw) return persist(freshProfile(), storage);
  let stored;
  try {
    const value = JSON.parse(raw);
    if (value.version === 1) {
      const old = fields(value), generated = freshProfile();
      stored = { ...generated, ...old };
    } else if (value.version === 2) return normalized(value, value.identityScope === 'server');
    else throw new Error('version');
  } catch { throw new Error('本机资料无法读取，原始数据已保留。'); }
  // Migration is committed only after complete validation; failed writes retain v1.
  return persist(stored, storage);
}
export function saveLocalProfile(input, storage = globalThis.localStorage) {
  const current = getLocalProfile(storage);
  if (current.identityScope === 'server') throw new Error('请连接账号服务保存资料，本机不能更改线上 ID。');
  if (input.revision !== undefined && input.revision !== current.revision) throw new Error('资料已在其他页面更新，请保留未保存内容后重新打开。');
  const userId = validateUserId(input.userId ?? current.userId, { allowReserved: (input.userId ?? current.userId) === current.userId });
  return persist({ ...current, ...fields({ ...current, ...input }), userId, localId: userId, revision: current.revision + 1, level: 1, official: false }, storage);
}
/** Cache a profile returned by the authenticated account service. Never use for form input. */
export function applyRemoteProfile(remote, storage = globalThis.localStorage) {
  return persist(normalized(remote, true), storage);
}
