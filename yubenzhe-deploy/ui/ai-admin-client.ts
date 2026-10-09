import { api, APIError } from './admin-client';

export type WorkspaceStatus = 'pending_review' | 'awaiting_configuration' | 'active' | 'paused' | 'rejected' | 'closed' | 'cancelled';
export type WorkspaceAction = 'approve' | 'reject' | 'activate' | 'pause' | 'resume' | 'close';
export type Workspace = { id: string; ownerId: string; name: string; purpose: string; requirements: string; status: WorkspaceStatus; version: number; createdAt: string | number; updatedAt: string | number; reviewNote: string };
export type AITask = { id: string; workspaceId: string; prompt: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; version: number; output: string | null; errorCode: string | null; errorMessage: string | null; createdAt: string | number; updatedAt: string | number; finishedAt: string | number | null; usage: null | { inputTokens: number; outputTokens: number } };
export type AIAudit = { id: string; actorId: string; actorRole: string; action: string; workspaceId: string | null; taskId: string | null; fromStatus: string; toStatus: string; reason: string; requestId: string | null; createdAt: string | number };
export type Capabilities = { identityType: 'acceptance'; cloud: { configured: boolean; ready: boolean; status: 'not_configured' | 'configured_unverified' | 'ready'; message: string; lastCheckedAt?: string | number | null }; limits: { dailyTasks: number; maxOutputTokens: number; maxInputChars: number }; billing: { mode: string; realBalanceDeduction: boolean }; useCases: { id: string; label: string }[] };
export type WorkspaceDetail = { workspace: Workspace; tasks: AITask[]; quota: { date: string; limit: number; used: number; remaining: number } };
export type ActionRequest = { action: WorkspaceAction; reason: string; version: number; requestId: string };
export const workspaceLabels: Record<WorkspaceStatus, string> = { pending_review: '待审核', awaiting_configuration: '待开通', active: '已开通', paused: '已暂停', rejected: '已拒绝', closed: '已关闭', cancelled: '已取消' };
export const actionLabels: Record<WorkspaceAction, string> = { approve: '批准申请', reject: '拒绝申请', activate: '开通工作区', pause: '暂停工作区', resume: '恢复工作区', close: '关闭工作区' };
export const taskLabels: Record<AITask['status'], string> = { running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' };
export const auditLabels: Record<string, string> = { 'workspace.create': '提交工作区申请', 'workspace.approve': '批准申请', 'workspace.reject': '拒绝申请', 'workspace.activate': '开通工作区', 'workspace.pause': '暂停工作区', 'workspace.resume': '恢复工作区', 'workspace.close': '关闭工作区', 'workspace.cancel': '撤回申请', 'task.submit': '提交任务', 'task.succeeded': '任务完成', 'task.failed': '任务失败', 'task.cancel': '取消任务', 'provider.check': '验证模型连接' };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务返回的数据不完整，请重新读取。');
  return value as Record<string, unknown>;
}
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const time = (value: unknown) => (typeof value === 'string' || typeof value === 'number') && Number.isFinite(new Date(value).getTime());
export function parseWorkspace(value: unknown): Workspace {
  const w = record(value);
  if (!['id', 'ownerId', 'name', 'purpose', 'requirements'].every(key => typeof w[key] === 'string') || !w.id || !Object.hasOwn(workspaceLabels, String(w.status)) || !integer(w.version) || Number(w.version) < 1 || !time(w.createdAt) || !time(w.updatedAt)) throw new Error('申请记录不完整，请刷新后再处理。');
  return { id: String(w.id), ownerId: String(w.ownerId), name: String(w.name), purpose: String(w.purpose), requirements: String(w.requirements), status: w.status as WorkspaceStatus, version: Number(w.version), createdAt: w.createdAt as string | number, updatedAt: w.updatedAt as string | number, reviewNote: typeof w.reviewNote === 'string' ? w.reviewNote : '' };
}
export function parseCapabilities(value: unknown): Capabilities {
  const c = record(value), cloud = record(c.cloud), limits = record(c.limits), billing = record(c.billing);
  if (c.identityType !== 'acceptance' || typeof cloud.configured !== 'boolean' || typeof cloud.ready !== 'boolean' || !['not_configured', 'configured_unverified', 'ready'].includes(String(cloud.status)) || typeof cloud.message !== 'string' || (cloud.ready && (!cloud.configured || cloud.status !== 'ready')) || !['dailyTasks', 'maxOutputTokens', 'maxInputChars'].every(k => integer(limits[k])) || typeof billing.realBalanceDeduction !== 'boolean' || !Array.isArray(c.useCases)) throw new Error('服务状态未完整返回，请重新检查连接。');
  return { identityType: 'acceptance', cloud: { configured: cloud.configured, ready: cloud.ready, status: cloud.status as Capabilities['cloud']['status'], message: cloud.message, lastCheckedAt: time(cloud.lastCheckedAt) ? cloud.lastCheckedAt as string | number : null }, limits: { dailyTasks: Number(limits.dailyTasks), maxOutputTokens: Number(limits.maxOutputTokens), maxInputChars: Number(limits.maxInputChars) }, billing: { mode: String(billing.mode || ''), realBalanceDeduction: billing.realBalanceDeduction }, useCases: c.useCases.map(v => { const use = record(v); if (typeof use.id !== 'string' || typeof use.label !== 'string') throw new Error('服务用途未完整返回。'); return { id: use.id, label: use.label }; }) };
}
export function parseTask(value: unknown): AITask {
  const t = record(value);
  if (!['id', 'workspaceId', 'prompt'].every(k => typeof t[k] === 'string') || !Object.hasOwn(taskLabels, String(t.status)) || !integer(t.version) || !time(t.createdAt) || !time(t.updatedAt)) throw new Error('任务记录不完整，请重新读取。');
  const usage = t.usage ? record(t.usage) : null;
  if (usage && (!integer(usage.inputTokens) || !integer(usage.outputTokens))) throw new Error('任务用量未完整返回。');
  return { id: String(t.id), workspaceId: String(t.workspaceId), prompt: String(t.prompt), status: t.status as AITask['status'], version: Number(t.version), output: typeof t.output === 'string' ? t.output : null, errorCode: typeof t.errorCode === 'string' ? t.errorCode : null, errorMessage: typeof t.errorMessage === 'string' ? t.errorMessage : null, createdAt: t.createdAt as string | number, updatedAt: t.updatedAt as string | number, finishedAt: time(t.finishedAt) ? t.finishedAt as string | number : null, usage: usage ? { inputTokens: Number(usage.inputTokens), outputTokens: Number(usage.outputTokens) } : null };
}
export function parseDetail(value: unknown): WorkspaceDetail {
  const d = record(value), quota = record(d.quota);
  if (!Array.isArray(d.tasks) || typeof quota.date !== 'string' || !['limit', 'used', 'remaining'].every(k => integer(quota[k]))) throw new Error('工作区额度或任务未完整返回，请重试。');
  return { workspace: parseWorkspace(d.workspace), tasks: d.tasks.map(parseTask), quota: { date: quota.date, limit: Number(quota.limit), used: Number(quota.used), remaining: Number(quota.remaining) } };
}
export function parseAudit(value: unknown): AIAudit[] {
  const result = record(value);
  if (!Array.isArray(result.items)) throw new Error('操作记录未完整返回，请重试。');
  return result.items.map(value => {
    const a = record(value);
    if (!['id', 'actorId', 'actorRole', 'action', 'reason'].every(k => typeof a[k] === 'string') || !time(a.createdAt)) throw new Error('操作记录不完整。');
    return { id: String(a.id), actorId: String(a.actorId), actorRole: String(a.actorRole), action: String(a.action), workspaceId: typeof a.workspaceId === 'string' ? a.workspaceId : null, taskId: typeof a.taskId === 'string' ? a.taskId : null, fromStatus: typeof a.fromStatus === 'string' ? a.fromStatus : '', toStatus: typeof a.toStatus === 'string' ? a.toStatus : '', reason: String(a.reason), requestId: typeof a.requestId === 'string' ? a.requestId : null, createdAt: a.createdAt as string | number };
  });
}
export function availableActions(status: WorkspaceStatus): WorkspaceAction[] {
  return ({ pending_review: ['approve', 'reject'], awaiting_configuration: ['activate', 'close'], active: ['pause', 'close'], paused: ['resume', 'close'], rejected: [], closed: [], cancelled: [] } as Record<WorkspaceStatus, WorkspaceAction[]>)[status] || [];
}
export function actionEnabled(action: WorkspaceAction, capabilities: Capabilities | null) { return !['activate', 'resume'].includes(action) || capabilities?.cloud.ready === true; }
export function createActionRequest(workspace: Workspace, action: WorkspaceAction, reason: string, requestId: string): ActionRequest {
  const text = reason.trim();
  if (!availableActions(workspace.status).includes(action)) throw new Error('当前状态无法执行这项操作，请先刷新记录。');
  if (text.length < 4 || text.length > 300) throw new Error('请填写 4–300 字的处理理由。');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new Error('操作编号无效，请刷新页面。');
  return Object.freeze({ action, reason: text, version: workspace.version, requestId });
}
export function mutationOutcome(error: unknown): 'conflict' | 'rejected' | 'uncertain' {
  if (error instanceof APIError && error.status === 409) return 'conflict';
  if (error instanceof APIError && ['AI_NOT_CONFIGURED', 'AI_NOT_READY'].includes(error.code)) return 'rejected';
  if (error instanceof APIError && error.status < 500) return 'rejected';
  return 'uncertain';
}
export function safeText(value: string | null | undefined, max = 600): string {
  return (value || '').replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[密钥已隐藏]').replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [已隐藏]').replace(/((?:api[_ -]?key|secret|password|token|密钥|密码)["']?\s*[=:：]\s*["']?)[^\s,;，；"'}]+/gi, '$1[已隐藏]').replace(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, '***@$1').replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/g, '$1****$2').slice(0, max);
}
export function shortId(value: string) { return value.length > 15 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value; }

export const aiAPI = {
  capabilities: async (signal?: AbortSignal) => parseCapabilities(await api('ai/capabilities', { signal })),
  workspaces: async (signal?: AbortSignal) => { const result = record(await api('ai/workspaces', { signal })); if (!Array.isArray(result.items)) throw new Error('申请列表未完整返回，请重试。'); return result.items.map(parseWorkspace); },
  detail: async (id: string, signal?: AbortSignal) => parseDetail(await api(`ai/workspaces/${encodeURIComponent(id)}`, { signal })),
  audit: async (id: string, signal?: AbortSignal) => parseAudit(await api(`ai/audit?workspaceId=${encodeURIComponent(id)}`, { signal })),
  action: async (id: string, body: ActionRequest) => { const result = record(await api(`ai/workspaces/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify(body) })); return parseWorkspace(result.workspace); },
  readiness: async (requestId: string) => { const result = record(await api('ai/readiness', { method: 'POST', body: JSON.stringify({ requestId }) })); return parseCapabilities(result.capabilities); },
};
