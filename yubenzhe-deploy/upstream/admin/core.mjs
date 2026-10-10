import { COHORTS, SEED_VERSION, createSeedRecords } from './seed.mjs';

export class AdminError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AdminError(status, code, message); };
const STATUSES = Object.freeze({ users: ['active', 'restricted'], groups: ['active', 'restricted'], reviews: ['pending', 'approved', 'rejected'], tickets: ['open', 'resolved'] });
const TRANSITIONS = Object.freeze({ users: { restrict: ['active', 'restricted'], restore: ['restricted', 'active'] }, groups: { restrict: ['active', 'restricted'], restore: ['restricted', 'active'] }, reviews: { approve: ['pending', 'approved'], reject: ['pending', 'rejected'] }, tickets: { resolve: ['open', 'resolved'], reopen: ['resolved', 'open'] } });
export const PERMISSIONS = Object.freeze([
  { role: 'owner', label: '所有者', description: '唯一管理员，可查看、处理测试记录与审计；资金操作始终禁用', enabled: true },
  { role: 'operator', label: '运营', description: '预留角色，尚未启用，不可分配', enabled: false },
  { role: 'reviewer', label: '审核', description: '预留角色，尚未启用，不可分配', enabled: false },
  { role: 'support', label: '客服', description: '预留角色，尚未启用，不可分配', enabled: false },
  { role: 'auditor', label: '只读审计', description: '预留角色，尚未启用，不可分配', enabled: false },
]);
export const SYSTEM = Object.freeze({ network: 'BSC 测试网', consumerConnected: false, synthetic: true, financialActionsEnabled: false, teamRolesEnabled: false, aiConnected: false, aiStatus: 'AI 工作台服务预留，未连接模型服务，无实际调用统计', seedVersion: SEED_VERSION, sampleNote: '固定场景样本分布，不是实际用户、真实运营数据或调研结论', fundsNote: 'V0.2 不提供平台资产账户与托管资金操作；退休样本只在历史数据库和审计备份保留' });

function identity(user) {
  if (!user || typeof user.userId !== 'string' || !user.userId.trim() || user.userId.length > 500) fail(401, 'SIGN_IN_REQUIRED', '请先使用 ChatGPT 身份登录后台。');
  return { id: user.userId, name: String(user.displayName || user.fullName || user.email || '管理员').slice(0, 120) };
}
export function assertSameOrigin(request) {
  let expected, origin;
  try { expected = new URL(request.url).origin; origin = new URL(request.headers.get('origin') || '').origin; } catch { fail(403, 'ORIGIN_DENIED', '无法验证请求来源，请从本后台页面重新操作。'); }
  if (origin !== expected || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'ORIGIN_DENIED', '不允许来自其他网站的管理操作。');
}
export async function authorizeAdmin(db, user, { allowUninitialized = false } = {}) {
  const actor = identity(user);
  if (!db?.prepare || !db?.batch) fail(503, 'DATABASE_UNAVAILABLE', '后台数据库暂不可用，请稍后重试。');
  const settings = await db.prepare('SELECT * FROM admin_settings WHERE id = 1').first();
  if (settings && settings.owner_id !== actor.id) fail(403, 'OWNER_ONLY', '此后台仅允许已绑定的所有者访问。');
  if ((!settings || settings.initialized !== 1) && !allowUninitialized) fail(409, 'NOT_INITIALIZED', '请先由所有者初始化测试后台。');
  return { actor, settings, initialized: settings?.initialized === 1 };
}

function recordItem(row) {
  if (!row) return null;
  return { id: row.id, title: row.title, subtitle: row.subtitle, status: row.status, version: row.version, createdAt: row.created_at, segment: row.segment, type: row.type, amount: row.amount, currency: row.currency, detail: JSON.parse(row.detail_json), synthetic: true };
}
const retiredRecord = row => row?.kind === 'ledger' || row?.kind === 'reviews' && (row.type === 'integration' || row.segment === 'integration');
const retired = () => fail(410, 'ADMIN_MODULE_RETIRED', '平台资产账务与接入模块已移除，历史数据保留但不再通过此入口提供。');
function kindOf(kind) { if (kind === 'ledger') retired(); if (typeof kind !== 'string' || !Object.hasOwn(STATUSES, kind)) fail(400, 'INVALID_KIND', '记录类型无效。'); return kind; }
function idOf(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,99}$/.test(id)) fail(400, 'INVALID_ID', '记录编号无效。'); return id; }
function positiveInteger(input, fallback, max) { const raw = input === undefined || input === null || input === '' ? String(fallback) : String(input); if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) fail(400, 'INVALID_PAGE', '分页参数无效。'); return Number(raw); }
function searchText(value) { if (value !== undefined && value !== null && typeof value !== 'string') fail(400, 'INVALID_QUERY', '搜索条件无效。'); const text = String(value || '').trim(); if (text.length > 120) fail(400, 'INVALID_QUERY', '搜索文字最多 120 个字符。'); return text; }
const like = text => `%${text.replace(/[\\%_]/g, character => `\\${character}`)}%`;
const results = output => output.results || [];

export async function setupAdmin(db, user) {
  const access = await authorizeAdmin(db, user, { allowUninitialized: true });
  if (access.initialized) return { ok: true, initialized: true, alreadyInitialized: true };
  const { actor } = access, now = Date.now(), records = createSeedRecords();
  const batch = [db.prepare('INSERT OR IGNORE INTO admin_settings (id, owner_id, owner_name, initialized, seed_version, created_at) VALUES (1, ?, ?, 0, ?, ?)').bind(actor.id, actor.name, SEED_VERSION, now)];
  // JSON batches stay below D1's parameter cap. All <= 60 statements execute in
  // one atomic D1 transaction, so owner binding, seed and ready state cannot split.
  for (let offset = 0; offset < records.length; offset += 25) {
    const chunk = JSON.stringify(records.slice(offset, offset + 25));
    batch.push(db.prepare(`INSERT OR IGNORE INTO admin_records (kind,id,title,subtitle,status,version,created_at,segment,type,amount,currency,detail_json)
      SELECT json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.subtitle'),json_extract(value,'$.status'),json_extract(value,'$.version'),json_extract(value,'$.createdAt'),json_extract(value,'$.segment'),json_extract(value,'$.type'),json_extract(value,'$.amount'),json_extract(value,'$.currency'),json_extract(value,'$.detail')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM admin_settings WHERE id=1 AND owner_id=? AND initialized=0)`).bind(chunk, actor.id));
  }
  batch.push(db.prepare(`INSERT OR IGNORE INTO admin_audit (id,request_id,fingerprint,actor_id,actor,action,kind,target_id,target,reason,from_status,to_status,created_at,item_json)
    SELECT 'setup-v1','setup-v1','setup-v1',?,?,'setup','system','seed-v1','初始化测试后台','由所有者主动初始化固定合成样本；未连接前台和真实资金','empty','initialized',?,'{}'
    WHERE EXISTS (SELECT 1 FROM admin_settings WHERE id=1 AND owner_id=? AND initialized=0)`).bind(actor.id, actor.name, now, actor.id));
  batch.push(db.prepare('UPDATE admin_settings SET initialized=1 WHERE id=1 AND owner_id=? AND initialized=0').bind(actor.id));
  await db.batch(batch);
  await authorizeAdmin(db, user);
  return { ok: true, initialized: true, alreadyInitialized: false };
}

export async function getBootstrap(db, user) {
  const access = await authorizeAdmin(db, user, { allowUninitialized: true });
  const base = { initialized: access.initialized, viewer: { name: access.actor.name, role: 'owner' }, overview: { users: 0, groups: 0, pendingReviews: 0, openTickets: 0, restrictedUsers: 0 }, cohorts: [], permissions: PERMISSIONS.map(item => ({ ...item })), system: { ...SYSTEM } };
  if (!access.initialized) return base;
  const counts = results(await db.prepare("SELECT kind,status,COUNT(*) AS count FROM admin_records WHERE kind <> 'ledger' AND NOT (kind='reviews' AND (type='integration' OR segment='integration')) GROUP BY kind,status").all());
  for (const row of counts) {
    if (row.kind === 'users') { base.overview.users += row.count; if (row.status === 'restricted') base.overview.restrictedUsers += row.count; }
    if (row.kind === 'groups') base.overview.groups += row.count;
    if (row.kind === 'reviews' && row.status === 'pending') base.overview.pendingReviews += row.count;
    if (row.kind === 'tickets' && row.status === 'open') base.overview.openTickets += row.count;
  }
  const cohorts = results(await db.prepare("SELECT segment,COUNT(*) AS count FROM admin_records WHERE kind='users' GROUP BY segment").all());
  base.cohorts = COHORTS.map(cohort => ({ ...cohort, count: cohorts.find(row => row.segment === cohort.id)?.count || 0 }));
  return base;
}

export async function listRecords(db, user, input = {}) {
  await authorizeAdmin(db, user);
  const kind = kindOf(input.kind), page = positiveInteger(input.page, 1, 100000), pageSize = positiveInteger(input.pageSize, 20, 100), q = searchText(input.q);
  const predicates = ['kind=?'], bindings = [kind];
  if (kind === 'reviews') { if (input.segment === 'integration') retired(); predicates.push("type <> 'integration' AND segment <> 'integration'"); }
  if (input.status && input.status !== 'all') { if (!STATUSES[kind].includes(input.status)) fail(400, 'INVALID_STATUS', '状态筛选无效。'); predicates.push('status=?'); bindings.push(input.status); }
  if (input.segment && input.segment !== 'all') { if (typeof input.segment !== 'string' || !/^[a-z][a-z0-9_-]{0,49}$/.test(input.segment)) fail(400, 'INVALID_SEGMENT', '分组筛选无效。'); predicates.push('segment=?'); bindings.push(input.segment); }
  if (q) { predicates.push("(id LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR subtitle LIKE ? ESCAPE '\\')"); bindings.push(like(q), like(q), like(q)); }
  const where = predicates.join(' AND ');
  const rows = await db.batch([db.prepare(`SELECT COUNT(*) AS total FROM admin_records WHERE ${where}`).bind(...bindings), db.prepare(`SELECT * FROM admin_records WHERE ${where} ORDER BY created_at DESC,id ASC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize)]);
  return { items: results(rows[1]).map(recordItem), total: results(rows[0])[0]?.total || 0, page, pageSize };
}
export async function getRecord(db, user, kind, id) {
  await authorizeAdmin(db, user); kindOf(kind); idOf(id);
  const row = await db.prepare('SELECT * FROM admin_records WHERE kind=? AND id=?').bind(kind, id).first();
  if (!row) fail(404, 'NOT_FOUND', '没有找到这条测试记录。');
  if (retiredRecord(row)) retired();
  return recordItem(row);
}
function validateAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_BODY', '操作内容无效。');
  if (body.kind === 'ledger' || ['transfer', 'withdraw', 'deposit', 'refund', 'charge', 'pay'].includes(body.action)) fail(403, 'FINANCIAL_ACTION_DISABLED', '测试账务只读，所有资金操作均已禁用。');
  if (['roles', 'permissions', 'admins'].includes(body.kind) || ['grant', 'assign', 'promote', 'setRole'].includes(body.action)) fail(403, 'ROLE_CHANGE_DISABLED', '当前仅开放单人管理，不支持授权或调整角色。');
  kindOf(body.kind); idOf(body.id);
  if (Object.keys(body).some(key => !['kind', 'id', 'action', 'reason', 'version', 'requestId'].includes(key))) fail(400, 'INVALID_FIELDS', '操作包含不支持的字段。');
  if (typeof body.action !== 'string' || !Object.hasOwn(TRANSITIONS[body.kind] || {}, body.action)) fail(400, 'INVALID_ACTION', '此记录不支持该操作。');
  if (typeof body.reason !== 'string' || body.reason.trim().length < 2 || body.reason.trim().length > 500) fail(400, 'REASON_REQUIRED', '请填写 2–500 个字符的处理理由。');
  if (!Number.isSafeInteger(body.version) || body.version < 1) fail(400, 'INVALID_VERSION', '记录版本无效，请刷新后重试。');
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)) fail(400, 'INVALID_REQUEST_ID', '操作编号无效，请重新发起操作。');
  return { kind: body.kind, id: body.id, action: body.action, reason: body.reason.trim(), version: body.version, requestId: body.requestId };
}
function replay(audit, actor, fingerprint) {
  if (audit.actor_id !== actor.id || audit.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', '此操作编号已用于不同的内容，请刷新后重新操作。');
  return { ok: true, item: JSON.parse(audit.item_json) };
}
export async function applyAction(db, user, body) {
  const { actor } = await authorizeAdmin(db, user), input = validateAction(body);
  const fingerprint = JSON.stringify([actor.id, input.kind, input.id, input.action, input.reason, input.version]);
  const row = await db.prepare('SELECT * FROM admin_records WHERE kind=? AND id=?').bind(input.kind, input.id).first();
  if (!row) fail(404, 'NOT_FOUND', '没有找到这条测试记录。');
  if (retiredRecord(row)) retired();
  let previous = await db.prepare('SELECT * FROM admin_audit WHERE request_id=?').bind(input.requestId).first();
  if (previous) return replay(previous, actor, fingerprint);
  if (row.version !== input.version) fail(409, 'VERSION_CONFLICT', '记录已被其他操作更新，请刷新后重新确认。');
  const [fromStatus, toStatus] = TRANSITIONS[input.kind][input.action];
  if (row.status !== fromStatus) fail(409, 'STATUS_CONFLICT', '当前状态不支持此操作，请刷新记录。');
  const item = { ...recordItem(row), status: toStatus, version: row.version + 1 }, now = Date.now();
  try {
    await db.batch([
      db.prepare('UPDATE admin_records SET status=?,version=version+1,last_request_id=? WHERE kind=? AND id=? AND version=? AND status=? AND EXISTS (SELECT 1 FROM admin_settings WHERE id=1 AND owner_id=? AND initialized=1) AND NOT EXISTS (SELECT 1 FROM admin_audit WHERE request_id=?)').bind(toStatus, input.requestId, input.kind, input.id, input.version, fromStatus, actor.id, input.requestId),
      db.prepare(`INSERT INTO admin_audit (id,request_id,fingerprint,actor_id,actor,action,kind,target_id,target,reason,from_status,to_status,created_at,item_json)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM admin_records WHERE kind=? AND id=? AND version=? AND last_request_id=? AND NOT EXISTS (SELECT 1 FROM admin_audit WHERE request_id=?)`).bind(crypto.randomUUID(), input.requestId, fingerprint, actor.id, actor.name, input.action, input.kind, input.id, row.title, input.reason, fromStatus, toStatus, now, JSON.stringify(item), input.kind, input.id, item.version, input.requestId, input.requestId),
    ]);
  } catch (error) {
    previous = await db.prepare('SELECT * FROM admin_audit WHERE request_id=?').bind(input.requestId).first();
    if (previous) return replay(previous, actor, fingerprint);
    throw error;
  }
  previous = await db.prepare('SELECT * FROM admin_audit WHERE request_id=?').bind(input.requestId).first();
  if (previous) return replay(previous, actor, fingerprint);
  fail(409, 'VERSION_CONFLICT', '记录已发生变化，本次操作未执行，请刷新后重试。');
}
export async function listAudit(db, user, input = {}) {
  await authorizeAdmin(db, user);
  const page = positiveInteger(input.page, 1, 100000), pageSize = positiveInteger(input.pageSize, 20, 100), q = searchText(input.q), bindings = q ? [like(q), like(q), like(q), like(q)] : [];
  const where = q ? " WHERE actor LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\' OR target_id LIKE ? ESCAPE '\\'" : '';
  const rows = await db.batch([db.prepare(`SELECT COUNT(*) AS total FROM admin_audit${where}`).bind(...bindings), db.prepare(`SELECT id,created_at,actor,action,target,reason,from_status,to_status FROM admin_audit${where} ORDER BY created_at DESC,id ASC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize)]);
  return { items: results(rows[1]).map(row => ({ id: row.id, createdAt: row.created_at, actor: row.actor, action: row.action, target: row.target, reason: row.reason, fromStatus: row.from_status, toStatus: row.to_status })), total: results(rows[0])[0]?.total || 0, page, pageSize };
}
