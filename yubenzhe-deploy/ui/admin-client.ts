export class APIError extends Error { status: number; code: string; constructor(message: string, status: number, code = '') { super(message); this.status = status; this.code = code; } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, cache: 'no-store' });
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('服务器响应未完整接收，请重试核对结果。'); }
  if (!response.ok) { const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : '操作失败，请重试。'; const code = data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code.slice(0, 80) : ''; throw new APIError(message, response.status, code); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('服务器返回格式异常，请重试核对结果。');
  const result = data as Record<string, unknown>;
  const recordValid = (value: unknown) => { const item = value as Record<string, unknown> | null; return !!item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.status === 'string' && typeof item.version === 'number' && Number.isSafeInteger(item.version) && item.version > 0 && !!item.detail && typeof item.detail === 'object'; };
  const invalid = path === 'actions' ? result.ok !== true || !recordValid(result.item) : path === 'bootstrap' ? typeof result.initialized !== 'boolean' || !result.viewer || !result.overview || !Array.isArray(result.cohorts) || !Array.isArray(result.permissions) : path === 'setup' ? result.ok !== true || result.initialized !== true : path === 'report' ? !result.summary || !Array.isArray(result.checks) || !Array.isArray(result.limitations) || !Array.isArray(result.recommendations) : path.startsWith('records/') ? !recordValid(result) : path.startsWith('records?') || path.startsWith('audit?') ? !Array.isArray(result.items) || typeof result.total !== 'number' : false;
  if (invalid) throw new Error('服务器返回内容不完整，请重试核对结果。');
  return data as T;
}
