import { getAddress, Interface, MaxUint256, TypedDataEncoder, keccak256, toUtf8Bytes, toUtf8String } from 'ethers';
import { getEnabledChain } from './chain-registry.js';

// These are external tools, not connected wallets. Never accept a user-supplied URL.
export const DAPP_LINKS = Object.freeze([
  Object.freeze({ id: 'bsc-testnet-explorer', name: 'BSC 测试网浏览器', url: 'https://testnet.bscscan.com/', kind: 'read-only', description: '在系统浏览器核对测试网地址与交易。', warning: '这是外部只读工具，不需要提供助记词或私钥。', walletConnect: false }),
  Object.freeze({ id: 'remix', name: 'Remix 合约工具', url: 'https://app.remix.live/', kind: 'developer', description: '在系统浏览器打开合约开发工具。', warning: '仅用于测试。请勿使用真实资产；不要签署不了解的调用。YBZ 尚未接通此工具的钱包连接。', walletConnect: false }),
]);

export function getDappLink(id) { return DAPP_LINKS.find(item => item.id === id) || null; }
export function isAllowedDappUrl(url) { return typeof url === 'string' && DAPP_LINKS.some(item => item.url === url); }

const UNAVAILABLE = Object.freeze({
  enabled: false, status: 'unavailable', reason: 'WalletConnect 尚未接通，不能连接或签名。',
  missing: Object.freeze(['WALLETCONNECT_PROJECT_ID', 'WALLETCONNECT_SDK', 'WALLETCONNECT_PROVIDER_VERIFICATION']),
});
export function getWalletConnectAvailability() { return UNAVAILABLE; }

export const DAPP_POLICY_LIMITS = Object.freeze({ sessionMs: 10 * 60 * 1000, previewMs: 90 * 1000, requestsPerMinute: 5, maxSessions: 4, maxRequestsPerSession: 30, maxPendingRequests: 8, maxJsonBytes: 32 * 1024 });
export const DAPP_REQUEST_METHODS = Object.freeze(['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4']);
const ZERO = '0x0000000000000000000000000000000000000000';
const ERC20 = new Interface(['function transfer(address to,uint256 amount)', 'function approve(address spender,uint256 amount)']);

function fail(code, message) { const error = new Error(message); error.code = code; return error; }
function requireThat(condition, code, message) { if (!condition) throw fail(code, message); }
function exactKeys(value, allowed, required = []) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), 'DAPP_PARAMS_INVALID', '请求包含缺失或不支持的参数。');
}
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function canonical(value) { return value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value); }
function digest(value) { return keccak256(toUtf8Bytes(canonical(value))); }

// JSON received from a future transport is hostile. Reject executable objects,
// accessors, excessive nesting and ambiguous properties before building a preview.
function plainJson(input) {
  let nodes = 0;
  function copy(value, depth = 0) {
    requireThat(++nodes <= 2048 && depth <= 12, 'DAPP_PARAMS_INVALID', '请求内容过大或嵌套过深。');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { requireThat(value.length <= DAPP_POLICY_LIMITS.maxJsonBytes, 'DAPP_PARAMS_INVALID', '请求内容过大。'); return value; }
    if (typeof value === 'number') { requireThat(Number.isSafeInteger(value), 'DAPP_PARAMS_INVALID', '数字必须是安全整数或精确字符串。'); return value; }
    requireThat(value && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'DAPP_PARAMS_INVALID', '请求必须是普通 JSON 数据。');
    const properties = Object.getOwnPropertyDescriptors(value);
    requireThat(Reflect.ownKeys(value).every(key => typeof key === 'string') && Object.entries(properties).every(([key, descriptor]) => !['__proto__', 'prototype', 'constructor'].includes(key) && !descriptor.get && !descriptor.set), 'DAPP_PARAMS_INVALID', '请求包含不安全的属性。');
    if (Array.isArray(value)) {
      requireThat(value.length <= 1024 && Object.keys(properties).every(key => key === 'length' || /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length) && Object.keys(properties).length === value.length + 1, 'DAPP_PARAMS_INVALID', '数组参数无效。');
      return value.map(item => copy(item, depth + 1));
    }
    const result = {};
    for (const [key, descriptor] of Object.entries(properties)) {
      requireThat(descriptor.enumerable, 'DAPP_PARAMS_INVALID', '请求包含隐藏属性。');
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  const result = copy(input);
  requireThat(toUtf8Bytes(JSON.stringify(result)).length <= DAPP_POLICY_LIMITS.maxJsonBytes, 'DAPP_PARAMS_INVALID', '请求内容过大。');
  return result;
}

function address(value) {
  try { const result = getAddress(value); if (result === ZERO) throw new Error(); return result; }
  catch { throw fail('DAPP_ADDRESS_INVALID', '请求地址无效或为零地址。'); }
}
function quantity(value, field, { max = MaxUint256, positive = false } = {}) {
  requireThat(typeof value === 'string' && /^(0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/.test(value) && value.length <= 80, 'DAPP_PARAMS_INVALID', `${field} 必须是精确的非负整数。`);
  const number = BigInt(value);
  requireThat(number <= max && (!positive || number > 0n), 'DAPP_PARAMS_INVALID', `${field} 超出允许范围。`);
  return number;
}
function chainNumber(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|[1-9][0-9]*)$/.test(value) && value.length <= 20) {
    const numeric = BigInt(value); if (numeric > 0n && numeric <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(numeric);
  }
  throw fail('DAPP_CHAIN_INVALID', '请求网络编号无效。');
}
function permittedChain(value) {
  const chain = getEnabledChain(chainNumber(value));
  requireThat(chain.testnet === true, 'DAPP_MAINNET_BLOCKED', '当前未授权主网连接或签名。');
  return chain;
}
function walletContext(input) {
  exactKeys(input, ['address', 'chainId', 'unlocked', 'epoch'], ['address', 'chainId', 'unlocked', 'epoch']);
  requireThat(input.unlocked === true, 'DAPP_WALLET_LOCKED', '请先由本人解锁钱包。');
  requireThat(Number.isSafeInteger(input.epoch) && input.epoch >= 0, 'DAPP_WALLET_CHANGED', '钱包状态标识无效。');
  return { address: address(input.address), chainId: permittedChain(input.chainId).chainId, epoch: input.epoch };
}

function transactionPreview(params, session) {
  requireThat(params.length === 1, 'DAPP_PARAMS_INVALID', '交易请求只能包含一笔交易。');
  const tx = params[0];
  exactKeys(tx, ['from', 'to', 'value', 'data', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce', 'chainId', 'type'], ['from', 'to', 'gas', 'nonce']);
  const from = address(tx.from), to = address(tx.to), value = quantity(tx.value ?? '0x0', 'value');
  requireThat(from === session.account, 'DAPP_ACCOUNT_MISMATCH', '请求账户与当前钱包不一致。');
  requireThat(chainNumber(tx.chainId ?? session.chainId) === session.chainId, 'DAPP_CHAIN_MISMATCH', '请求网络与会话不一致。');
  const data = tx.data ?? '0x';
  requireThat(typeof data === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(data) && data.length <= 16 * 1024, 'DAPP_PARAMS_INVALID', '合约调用数据无效。');
  const gas = quantity(tx.gas, 'gas', { max: 5000000n }), nonce = quantity(tx.nonce, 'nonce', { max: BigInt(Number.MAX_SAFE_INTEGER) });
  requireThat(gas >= 21000n, 'DAPP_PARAMS_INVALID', 'Gas 上限无效。');
  const is1559 = tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined;
  requireThat(!is1559 || tx.gasPrice === undefined, 'DAPP_PARAMS_INVALID', '不能混用两种手续费类型。');
  const type = is1559 ? 2 : 0;
  requireThat(tx.type === undefined || (typeof tx.type === 'number' ? tx.type : quantity(tx.type, 'type', { max: 2n })) == type, 'DAPP_PARAMS_INVALID', '交易类型与手续费参数不一致。');
  const fee = is1559
    ? { maxFeePerGas: quantity(tx.maxFeePerGas, 'maxFeePerGas', { max: 1000000000000n, positive: true }), maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas, 'maxPriorityFeePerGas', { max: 1000000000000n }) }
    : { gasPrice: quantity(tx.gasPrice, 'gasPrice', { max: 1000000000000n, positive: true }) };
  requireThat(!is1559 || fee.maxPriorityFeePerGas <= fee.maxFeePerGas, 'DAPP_PARAMS_INVALID', '优先手续费不能高于总手续费上限。');
  const warnings = ['手续费来自外部请求，尚未经过 RPC 复核。', '签名后资产可能被转走。'];
  let call = { method: 'native-transfer', arguments: { to, valueWei: value.toString() } };
  if (data !== '0x') {
    let parsed;
    try { parsed = ERC20.parseTransaction({ data }); } catch { /* Unknown methods are never approved blindly. */ }
    requireThat(parsed && ['transfer', 'approve'].includes(parsed.name) && ERC20.encodeFunctionData(parsed.name, parsed.args).toLowerCase() === data.toLowerCase(), 'DAPP_CALL_UNRECOGNIZED', '无法识别完整合约方法，已阻止盲签。');
    requireThat(value === 0n, 'DAPP_PARAMS_INVALID', '代币调用不能附带原生币金额。');
    const recipient = address(parsed.args[0]), amount = parsed.args[1].toString();
    call = { method: parsed.name, contract: to, arguments: parsed.name === 'approve' ? { spender: recipient, amount } : { to: recipient, amount }, unlimitedApproval: parsed.name === 'approve' && parsed.args[1] === MaxUint256 };
    warnings.push('方法名仅按调用数据解析；尚未验证目标合约代码与代币精度。');
    if (call.unlimitedApproval) warnings.push('这是无限额度授权，获授权合约可能转走该代币。');
  }
  const gasFeeMaxWei = gas * (is1559 ? fee.maxFeePerGas : fee.gasPrice);
  return { kind: 'transaction', transaction: { from, to, chainId: session.chainId, valueWei: value.toString(), data, gas: gas.toString(), nonce: nonce.toString(), type, ...Object.fromEntries(Object.entries(fee).map(([key, item]) => [key, item.toString()])) }, call, gasFeeMaxWei: gasFeeMaxWei.toString(), feeVerified: false, warnings };
}

function personalPreview(params, session) {
  requireThat(params.length === 2 && address(params[1]) === session.account, 'DAPP_ACCOUNT_MISMATCH', '消息签名账户与当前钱包不一致。');
  const encoded = params[0];
  requireThat(typeof encoded === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(encoded) && encoded.length <= 8194, 'DAPP_MESSAGE_INVALID', '仅支持可完整显示的 UTF-8 消息签名。');
  let message;
  try { message = toUtf8String(encoded); } catch { throw fail('DAPP_MESSAGE_INVALID', '消息无法完整解码，已阻止盲签。'); }
  requireThat(message.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(message), 'DAPP_MESSAGE_INVALID', '消息包含不可见或控制字符，已阻止签名。');
  return { kind: 'message', account: session.account, message, messageHex: encoded, chainBound: false, warnings: ['消息签名不含链上防重放保证。', '请核对完整消息与请求来源；签名后资产可能被转走。'] };
}

function typedMembers(types, name, value, depth = 0) {
  requireThat(depth <= 12, 'DAPP_TYPED_DATA_INVALID', '结构化签名嵌套过深。');
  const array = /^(.*)\[([0-9]*)\]$/.exec(name);
  if (array) {
    requireThat(Array.isArray(value) && (!array[2] || value.length === Number(array[2])), 'DAPP_TYPED_DATA_INVALID', '结构化签名数组无效。');
    for (const item of value) typedMembers(types, array[1], item, depth + 1);
  } else if (types[name]) {
    exactKeys(value, types[name].map(item => item.name), types[name].map(item => item.name));
    for (const field of types[name]) typedMembers(types, field.type, value[field.name], depth + 1);
  }
}
function typedPreview(params, session) {
  requireThat(params.length === 2 && address(params[0]) === session.account, 'DAPP_ACCOUNT_MISMATCH', '结构化签名账户与当前钱包不一致。');
  let data = params[1];
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { throw fail('DAPP_TYPED_DATA_INVALID', '结构化签名 JSON 无效。'); } }
  data = plainJson(data);
  exactKeys(data, ['domain', 'types', 'primaryType', 'message'], ['domain', 'types', 'primaryType', 'message']);
  exactKeys(data.domain, ['name', 'version', 'chainId', 'verifyingContract', 'salt'], ['name', 'chainId', 'verifyingContract']);
  requireThat(typeof data.domain.name === 'string' && data.domain.name.trim().length > 0 && data.domain.name.length <= 200, 'DAPP_TYPED_DATA_INVALID', '必须显示明确的签名域名称。');
  requireThat(chainNumber(data.domain.chainId) === session.chainId, 'DAPP_CHAIN_MISMATCH', '签名域网络与会话不一致。');
  address(data.domain.verifyingContract);
  requireThat(data.types && typeof data.types === 'object' && !Array.isArray(data.types), 'DAPP_TYPED_DATA_INVALID', '结构化签名类型无效。');
  for (const [name, fields] of Object.entries(data.types)) {
    requireThat(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && Array.isArray(fields) && fields.length <= 100, 'DAPP_TYPED_DATA_INVALID', '结构化签名类型无效。');
    for (const field of fields) { exactKeys(field, ['name', 'type'], ['name', 'type']); requireThat(typeof field.name === 'string' && typeof field.type === 'string', 'DAPP_TYPED_DATA_INVALID', '结构化签名字段无效。'); }
  }
  const { EIP712Domain, ...types } = data.types;
  let payload;
  try {
    const encoder = TypedDataEncoder.from(types);
    requireThat(encoder.primaryType === data.primaryType, 'DAPP_TYPED_DATA_INVALID', '主类型与签名内容不一致。');
    typedMembers(types, data.primaryType, data.message);
    payload = TypedDataEncoder.getPayload(data.domain, types, data.message);
    requireThat(!EIP712Domain || canonical(EIP712Domain) === canonical(payload.types.EIP712Domain), 'DAPP_TYPED_DATA_INVALID', '签名域类型不一致。');
  } catch (error) { if (error.code?.startsWith('DAPP_')) throw error; throw fail('DAPP_TYPED_DATA_INVALID', '结构化签名内容无法完整校验。'); }
  return { kind: 'typed-data', account: session.account, domain: payload.domain, primaryType: payload.primaryType, types: payload.types, message: payload.message, warnings: ['请核对域、合约和全部内容；结构化签名本身不提供防重放保证。', '签名后资产可能被转走。'] };
}

/**
 * Local policy harness only: default-disabled, no provider, transport, signer,
 * secret, persistence or network access. A reviewed result is NOT a signature,
 * connection or payment. Future WalletConnect integration needs separate review.
 */
export function createDappRequestPolicy({ mode = 'disabled', now = Date.now } = {}) {
  requireThat(['disabled', 'local-preview'].includes(mode) && typeof now === 'function', 'DAPP_CONFIG_INVALID', '不支持此连接配置。');
  const sessions = new Map(), rate = new Map();
  let lastTime = 0;
  function clock() { const value = now(); requireThat(Number.isSafeInteger(value) && value >= 0, 'DAPP_CLOCK_INVALID', '本机时间无效。'); lastTime = Math.max(lastTime, value); return lastTime; }
  function enabled() { requireThat(mode === 'local-preview', 'WALLETCONNECT_UNAVAILABLE', UNAVAILABLE.reason); }
  function cleanup() {
    const time = clock();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= time) { disconnect(id); continue; }
      for (const [id, request] of session.requests) if (request.status === 'pending' && request.preview.expiresAt <= time) session.requests.set(id, { status: 'expired' });
    }
    return time;
  }
  function sessionFor(id, context) {
    const session = sessions.get(id); requireThat(session, 'DAPP_SESSION_INVALID', '本地预览会话已断开或过期。');
    try {
      const wallet = walletContext(context);
      requireThat(wallet.address === session.account && wallet.chainId === session.chainId && wallet.epoch === session.walletEpoch, 'DAPP_WALLET_CHANGED', '钱包账户、网络或解锁状态已变化，请重新连接。');
    } catch (error) { disconnect(id); throw error; }
    return session;
  }
  function publicSession(session) { return freeze({ id: session.id, mode: 'local-preview', connected: false, dappId: session.dappId, origin: session.origin, account: session.account, chainId: session.chainId, methods: [...session.methods], expiresAt: session.expiresAt }); }
  function createSession({ dappId, peerUrl, chainId, account, methods = DAPP_REQUEST_METHODS, approved, walletContext: context } = {}) {
    enabled(); const time = cleanup();
    requireThat(approved === true, 'DAPP_APPROVAL_REQUIRED', '连接预览需要本人确认。');
    const dapp = getDappLink(dappId);
    requireThat(dapp?.kind === 'developer' && peerUrl === dapp.url, 'DAPP_ORIGIN_BLOCKED', '请求来源不在固定白名单内。');
    const chain = permittedChain(chainId), checkedAccount = address(account), wallet = walletContext(context);
    requireThat(wallet.chainId === chain.chainId && wallet.address === checkedAccount, 'DAPP_WALLET_CHANGED', '钱包账户或网络与请求不一致。');
    requireThat(Array.isArray(methods) && methods.length > 0 && methods.length <= DAPP_REQUEST_METHODS.length && new Set(methods).size === methods.length && methods.every(method => DAPP_REQUEST_METHODS.includes(method)), 'DAPP_METHOD_BLOCKED', '请求了不支持的签名方法。');
    requireThat(sessions.size < DAPP_POLICY_LIMITS.maxSessions, 'DAPP_SESSION_LIMIT', '本地预览会话过多，请先断开旧会话。');
    const session = { id: globalThis.crypto.randomUUID(), dappId, origin: dapp.url, account: checkedAccount, chainId: chain.chainId, walletEpoch: wallet.epoch, methods: [...methods], expiresAt: time + DAPP_POLICY_LIMITS.sessionMs, requests: new Map(), fingerprints: new Set() };
    sessions.set(session.id, session);
    session.timer = setTimeout(() => disconnect(session.id), DAPP_POLICY_LIMITS.sessionMs);
    session.timer?.unref?.();
    return publicSession(session);
  }
  function prepareRequest({ sessionId, requestId, method, params, walletContext: context } = {}) {
    enabled(); const time = cleanup(), session = sessionFor(sessionId, context);
    const recent = (rate.get(session.dappId) || []).filter(value => value > time - 60000);
    requireThat(recent.length < DAPP_POLICY_LIMITS.requestsPerMinute, 'DAPP_RATE_LIMIT', '此工具请求过于频繁，请稍后重试。');
    rate.set(session.dappId, [...recent, time]);
    requireThat(typeof requestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) || Number.isSafeInteger(requestId) && requestId >= 0, 'DAPP_REQUEST_INVALID', '请求编号无效。');
    const key = `${typeof requestId}:${requestId}`;
    requireThat(!session.requests.has(key), 'DAPP_REQUEST_REPLAY', '该请求已处理，不能重复确认。');
    requireThat(session.requests.size < DAPP_POLICY_LIMITS.maxRequestsPerSession && [...session.requests.values()].filter(item => item.status === 'pending').length < DAPP_POLICY_LIMITS.maxPendingRequests, 'DAPP_REQUEST_LIMIT', '待处理请求过多，请先处理或断开会话。');
    requireThat(session.methods.includes(method) && DAPP_REQUEST_METHODS.includes(method), 'DAPP_METHOD_BLOCKED', '该签名方法被禁止。');
    const checked = plainJson(params); requireThat(Array.isArray(checked), 'DAPP_PARAMS_INVALID', '请求参数必须是数组。');
    const details = method === 'eth_sendTransaction' ? transactionPreview(checked, session) : method === 'personal_sign' ? personalPreview(checked, session) : typedPreview(checked, session);
    const fingerprint = digest({ method, params: checked });
    requireThat(!session.fingerprints.has(fingerprint), 'DAPP_REQUEST_REPLAY', '相同内容已经请求确认，不能换编号重复提交。');
    const body = { sessionId, requestId, dappId: session.dappId, origin: session.origin, account: session.account, chainId: session.chainId, method, params: checked, details, expiresAt: Math.min(session.expiresAt, time + DAPP_POLICY_LIMITS.previewMs), mode: 'local-preview', signable: false };
    const preview = freeze({ ...body, digest: digest(body) });
    session.requests.set(key, { status: 'pending', preview }); session.fingerprints.add(fingerprint);
    return preview;
  }
  function consumeApproval({ sessionId, requestId, digest: expectedDigest, approved, walletContext: context } = {}) {
    enabled(); cleanup(); const session = sessionFor(sessionId, context), key = `${typeof requestId}:${requestId}`, request = session.requests.get(key);
    requireThat(request?.status === 'pending', 'DAPP_REQUEST_INVALID', '请求已处理或预览已过期。');
    // Any decision consumes this preview, even a stale digest or declined approval.
    // Retry must start a fresh review; nothing is signed or broadcast here.
    session.requests.set(key, { status: 'reviewed' });
    requireThat(approved === true, 'DAPP_APPROVAL_REQUIRED', '每笔请求都需要本人明确确认。');
    requireThat(expectedDigest === request.preview.digest, 'DAPP_PREVIEW_CHANGED', '预览内容不一致，已阻止确认。');
    return freeze({ status: 'reviewed-only', mode: 'local-preview', signed: false, broadcast: false, preview: request.preview });
  }
  function disconnect(sessionId) { const session = sessions.get(sessionId); if (session) { clearTimeout(session.timer); session.requests.clear(); session.fingerprints.clear(); sessions.delete(sessionId); } return Boolean(session); }
  function disconnectAll() { const count = sessions.size; for (const id of sessions.keys()) disconnect(id); return count; }
  return Object.freeze({ createSession, prepareRequest, consumeApproval, disconnect, disconnectAll, listSessions() { cleanup(); return [...sessions.values()].map(publicSession); }, getAvailability: getWalletConnectAvailability });
}
