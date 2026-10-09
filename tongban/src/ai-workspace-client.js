export class AIServiceError extends Error {
  constructor(message, code = 'SERVICE_UNAVAILABLE', status = 0) { super(message); this.name = 'AIServiceError'; this.code = code; this.status = status; }
}
export function cloudAccessSupported(environment = globalThis) {
  const location = environment.location;
  return !environment.YubenzheDesktop && !environment.YubenzheNative && !environment.webkit?.messageHandlers?.exportJSON && !environment.Capacitor?.isNativePlatform?.() &&
    environment.Capacitor?.getPlatform?.() !== 'android' && !!location &&
    (location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname)));
}
export function createAIClient({ fetcher = (...args) => globalThis.fetch(...args), supported = () => cloudAccessSupported() } = {}) {
  return { supported, async request(path, { method = 'GET', body, signal } = {}) {
    if (!supported()) throw new AIServiceError('请在服务器网页版开通云端。当前客户端不会跨域传递你的验收身份。', 'SERVER_WEB_REQUIRED');
    if (!/^\/api\/ai\/[a-z0-9/_-]+$/.test(path)) throw new AIServiceError('服务地址无效。', 'INVALID_PATH');
    let response;
    try { response = await fetcher(path, { method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal, headers: { Accept: 'application/json', ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) }); }
    catch (error) { if (error.name === 'AbortError') throw error; throw new AIServiceError('连接没有完成。请重试；重复提交会沿用同一次请求，避免重复创建。', 'NETWORK_ERROR'); }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new AIServiceError('此页面未接入云端服务，请在服务器网页版开通云端。', 'SERVER_WEB_REQUIRED');
    let value; try { value = await response.json(); } catch { throw new AIServiceError('服务器返回内容不完整，请重试。', 'INVALID_RESPONSE'); }
    if (!response.ok) throw new AIServiceError(response.status === 401 ? '验收登录已失效，请刷新服务器网页版并重新登录。' : value.error || '服务请求没有完成。', value.code || 'SERVICE_ERROR', response.status);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIServiceError('服务器返回内容不完整，请重试。', 'INVALID_RESPONSE');
    return value;
  } };
}
