import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Interface, MaxUint256, hexlify, toUtf8Bytes } from 'ethers';
import { DAPP_LINKS, DAPP_POLICY_LIMITS, getDappLink, isAllowedDappUrl, getWalletConnectAvailability, createDappRequestPolicy } from '../src/wallet-dapp-policy.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const CONTEXT = { address: ACCOUNT, chainId: 97, unlocked: true, epoch: 1 };
const ABI = new Interface(['function transfer(address to,uint256 amount)', 'function approve(address spender,uint256 amount)']);
const code = expected => error => error?.code === expected;
const baseTx = () => ({ from: ACCOUNT, to: RECIPIENT, value: '0x10', data: '0x', gas: '0x5208', gasPrice: '0x3b9aca00', nonce: '0x0', chainId: '0x61', type: '0x0' });
const baseTyped = () => ({ domain: { name: 'YBZ local policy fixture', version: '1', chainId: 97, verifyingContract: TOKEN }, types: { Consent: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }] }, primaryType: 'Consent', message: { recipient: RECIPIENT, amount: '12' } });
function fixture(options = {}) {
  let time = 1000000;
  const policy = createDappRequestPolicy({ mode: 'local-preview', now: () => time });
  const sessionInput = { dappId: 'remix', peerUrl: 'https://app.remix.live/', chainId: 97, account: ACCOUNT, approved: true, walletContext: CONTEXT, ...options };
  const session = policy.createSession(sessionInput);
  const request = (overrides = {}) => ({ sessionId: session.id, requestId: 'req-1', method: 'eth_sendTransaction', params: [baseTx()], walletContext: CONTEXT, ...overrides });
  const approve = preview => ({ sessionId: session.id, requestId: preview.requestId, digest: preview.digest, approved: true, walletContext: CONTEXT });
  return { policy, session, sessionInput, request, approve, advance: delta => { time += delta; }, setTime: value => { time = value; } };
}

test('fixed external links contain only a read-only testnet explorer and official Remix tool', () => {
  assert.deepEqual(DAPP_LINKS.map(({ id, url }) => ({ id, url })), [
    { id: 'bsc-testnet-explorer', url: 'https://testnet.bscscan.com/' },
    { id: 'remix', url: 'https://app.remix.live/' },
  ]);
  assert.equal(getDappLink('unknown'), null);
  assert.equal(getDappLink('remix').walletConnect, false);
  assert.throws(() => { DAPP_LINKS[0].url = 'https://invalid.test/'; }, TypeError);
  assert.equal(isAllowedDappUrl('https://app.remix.live/'), true);
});

test('external links reject custom schemes, redirects, credentials, fragments and lookalike hosts', () => {
  for (const url of ['javascript:alert(1)', 'http://app.remix.live/', 'https://app.remix.live.evil.test/', 'https://evil.test/?url=https://app.remix.live/', 'https://app.remix.live@evil.test/', 'https://user@app.remix.live/', 'https://app.remix.live:443/', 'https://app.remix.live/?plugin=evil', 'https://app.remix.live/#evil', ' https://app.remix.live/', 'https://app.remix.live/path', 'https://remix.ethereum.org/', null, 42]) assert.equal(isAllowedDappUrl(url), false, String(url));
});

test('WalletConnect stays unavailable even if a caller passes configuration or a transport', () => {
  assert.deepEqual(getWalletConnectAvailability({ enabled: true, projectId: 'fake', transport: {} }), { enabled: false, status: 'unavailable', reason: 'WalletConnect 尚未接通，不能连接或签名。', missing: ['WALLETCONNECT_PROJECT_ID', 'WALLETCONNECT_SDK', 'WALLETCONNECT_PROVIDER_VERIFICATION'] });
  const policy = createDappRequestPolicy();
  assert.throws(() => policy.createSession(), code('WALLETCONNECT_UNAVAILABLE'));
  assert.throws(() => policy.prepareRequest(), code('WALLETCONNECT_UNAVAILABLE'));
  assert.throws(() => policy.consumeApproval(), code('WALLETCONNECT_UNAVAILABLE'));
  assert.throws(() => createDappRequestPolicy({ mode: 'connected' }), code('DAPP_CONFIG_INVALID'));
});

test('local preview session never claims a real connection', () => {
  const f = fixture();
  assert.equal(f.session.connected, false);
  assert.equal(f.session.mode, 'local-preview');
  assert.equal(f.session.expiresAt, 1000000 + DAPP_POLICY_LIMITS.sessionMs);
  assert.equal(f.policy.getAvailability().enabled, false);
  assert.equal(f.policy.listSessions().length, 1);
});

test('session creation requires explicit user consent, origin and an unlocked matching wallet', () => {
  const f = fixture();
  for (const [changes, expected] of [
    [{ approved: false }, 'DAPP_APPROVAL_REQUIRED'],
    [{ approved: 'true' }, 'DAPP_APPROVAL_REQUIRED'],
    [{ dappId: 'bsc-testnet-explorer', peerUrl: 'https://testnet.bscscan.com/' }, 'DAPP_ORIGIN_BLOCKED'],
    [{ peerUrl: 'https://app.remix.live.evil.test/' }, 'DAPP_ORIGIN_BLOCKED'],
    [{ walletContext: { ...CONTEXT, unlocked: false } }, 'DAPP_WALLET_LOCKED'],
    [{ account: RECIPIENT }, 'DAPP_WALLET_CHANGED'],
    [{ methods: ['eth_sign'] }, 'DAPP_METHOD_BLOCKED'],
    [{ methods: [] }, 'DAPP_METHOD_BLOCKED'],
  ]) assert.throws(() => f.policy.createSession({ ...f.sessionInput, ...changes }), code(expected));
});

test('unknown chains and disabled mainnets cannot create sessions', () => {
  const f = fixture();
  for (const chainId of [1, 56, 137, 42161]) assert.throws(() => f.policy.createSession({ ...f.sessionInput, chainId }), code('NETWORK_DISABLED'));
  assert.throws(() => f.policy.createSession({ ...f.sessionInput, chainId: 999999 }), code('NETWORK_UNSUPPORTED'));
  for (const chainId of ['eip155:97', -1, NaN, {}, '0x0']) assert.throws(() => f.policy.createSession({ ...f.sessionInput, chainId }), code('DAPP_CHAIN_INVALID'));
});

test('native transaction preview includes every supplied parameter and unverified fee details', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request());
  assert.deepEqual(preview.params, [baseTx()]);
  assert.deepEqual(preview.details.transaction, { from: ACCOUNT, to: RECIPIENT, chainId: 97, valueWei: '16', data: '0x', gas: '21000', nonce: '0', type: 0, gasPrice: '1000000000' });
  assert.equal(preview.details.gasFeeMaxWei, '21000000000000');
  assert.equal(preview.details.feeVerified, false);
  assert.equal(preview.signable, false);
  assert.equal(preview.expiresAt, 1090000);
  assert.throws(() => { preview.params[0].to = TOKEN; }, TypeError);
});

test('preview snapshots cannot be changed by later mutation of a request object', () => {
  const f = fixture(), input = f.request(), preview = f.policy.prepareRequest(input);
  input.params[0].value = '0x1000';
  const result = f.policy.consumeApproval(f.approve(preview));
  assert.equal(result.preview.params[0].value, '0x10');
  assert.equal(result.status, 'reviewed-only');
  assert.equal(result.signed, false);
  assert.equal(result.broadcast, false);
});

test('manual consent and exact preview digest are required for every request', () => {
  for (const [changes, expected] of [[{ approved: false }, 'DAPP_APPROVAL_REQUIRED'], [{ approved: 'true' }, 'DAPP_APPROVAL_REQUIRED'], [{ digest: 'wrong' }, 'DAPP_PREVIEW_CHANGED']]) {
    const f = fixture(), preview = f.policy.prepareRequest(f.request());
    assert.throws(() => f.policy.consumeApproval({ ...f.approve(preview), ...changes }), code(expected));
    assert.throws(() => f.policy.consumeApproval(f.approve(preview)), code('DAPP_REQUEST_INVALID'));
  }
});

test('consent is single-use and request ids or identical payloads cannot be replayed', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request());
  f.policy.consumeApproval(f.approve(preview));
  assert.throws(() => f.policy.consumeApproval(f.approve(preview)), code('DAPP_REQUEST_INVALID'));
  assert.throws(() => f.policy.prepareRequest(f.request()), code('DAPP_REQUEST_REPLAY'));
  assert.throws(() => f.policy.prepareRequest(f.request({ requestId: 'new-id-same-payload' })), code('DAPP_REQUEST_REPLAY'));
});

test('preview expiry invalidates a request without reviving it on clock rollback', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request());
  f.advance(DAPP_POLICY_LIMITS.previewMs);
  assert.throws(() => f.policy.consumeApproval(f.approve(preview)), code('DAPP_REQUEST_INVALID'));
  f.setTime(1000000);
  assert.throws(() => f.policy.consumeApproval(f.approve(preview)), code('DAPP_REQUEST_INVALID'));
});

test('session expiry removes sessions and pending payloads', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request());
  f.advance(DAPP_POLICY_LIMITS.sessionMs);
  assert.deepEqual(f.policy.listSessions(), []);
  assert.throws(() => f.policy.consumeApproval(f.approve(preview)), code('DAPP_SESSION_INVALID'));
});

test('session revocation invalidates pending requests immediately', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request());
  assert.equal(f.policy.disconnect(f.session.id), true);
  assert.equal(f.policy.disconnect(f.session.id), false);
  assert.throws(() => f.policy.consumeApproval(f.approve(preview)), code('DAPP_SESSION_INVALID'));
  assert.deepEqual(f.policy.listSessions(), []);
});

test('wallet lock, account and epoch changes prevent stale approvals', () => {
  for (const [changes, expected] of [[{ unlocked: false }, 'DAPP_WALLET_LOCKED'], [{ address: RECIPIENT }, 'DAPP_WALLET_CHANGED'], [{ epoch: 2 }, 'DAPP_WALLET_CHANGED'], [{ chainId: 1 }, 'NETWORK_DISABLED']]) {
    const f = fixture(), preview = f.policy.prepareRequest(f.request());
    assert.throws(() => f.policy.consumeApproval({ ...f.approve(preview), walletContext: { ...CONTEXT, ...changes } }), code(expected));
    assert.deepEqual(f.policy.listSessions(), []);
    assert.throws(() => f.policy.consumeApproval(f.approve(preview)), code('DAPP_SESSION_INVALID'));
  }
});

test('request frequency is limited per DApp across different preview sessions', () => {
  const f = fixture();
  for (let index = 0; index < DAPP_POLICY_LIMITS.requestsPerMinute; index++) assert.throws(() => f.policy.prepareRequest(f.request({ requestId: index, method: 'eth_sign' })), code('DAPP_METHOD_BLOCKED'));
  const other = f.policy.createSession(f.sessionInput);
  assert.throws(() => f.policy.prepareRequest(f.request({ sessionId: other.id })), code('DAPP_RATE_LIMIT'));
  f.advance(60000);
  assert.equal(f.policy.prepareRequest(f.request()).method, 'eth_sendTransaction');
});

test('session count and lifetime bound retained policy state', () => {
  const f = fixture();
  for (let index = 1; index < DAPP_POLICY_LIMITS.maxSessions; index++) f.policy.createSession(f.sessionInput);
  assert.throws(() => f.policy.createSession(f.sessionInput), code('DAPP_SESSION_LIMIT'));
  assert.equal(f.policy.disconnectAll(), DAPP_POLICY_LIMITS.maxSessions);
  assert.equal(f.policy.listSessions().length, 0);
});

test('pending request limit refuses additional work until previews expire', () => {
  const f = fixture();
  const prepare = index => f.policy.prepareRequest(f.request({ requestId: index, params: [{ ...baseTx(), value: String(index) }] }));
  for (let index = 0; index < 5; index++) prepare(index);
  f.advance(60000);
  for (let index = 5; index < 8; index++) prepare(index);
  assert.throws(() => prepare(8), code('DAPP_REQUEST_LIMIT'));
  f.advance(60000);
  assert.equal(prepare(9).requestId, 9);
});

test('request tombstones remain bounded while preserving replay prevention', () => {
  const f = fixture();
  for (let index = 0; index < DAPP_POLICY_LIMITS.maxRequestsPerSession; index++) {
    if (index && index % 5 === 0) f.advance(60000);
    const preview = f.policy.prepareRequest(f.request({ requestId: index, params: [{ ...baseTx(), value: String(index) }] }));
    f.policy.consumeApproval(f.approve(preview));
  }
  f.advance(60000);
  assert.throws(() => f.policy.prepareRequest(f.request({ requestId: 'extra' })), code('DAPP_REQUEST_LIMIT'));
});

test('a preview cannot authorize a different request or a different session', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request());
  const other = f.policy.createSession(f.sessionInput);
  assert.throws(() => f.policy.consumeApproval({ ...f.approve(preview), sessionId: other.id }), code('DAPP_REQUEST_INVALID'));
  assert.throws(() => f.policy.consumeApproval({ ...f.approve(preview), requestId: 'missing' }), code('DAPP_REQUEST_INVALID'));
  assert.equal(f.policy.consumeApproval(f.approve(preview)).status, 'reviewed-only');
});

test('only session-approved methods are accepted; raw and hash signing remain forbidden', () => {
  for (const method of ['eth_sign', 'eth_signTransaction', 'eth_sendRawTransaction', 'eth_signTypedData', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'wallet_sendCalls']) {
    const f = fixture(); assert.throws(() => f.policy.prepareRequest(f.request({ method })), code('DAPP_METHOD_BLOCKED'));
  }
  const f = fixture({ methods: ['personal_sign'] });
  assert.throws(() => f.policy.prepareRequest(f.request()), code('DAPP_METHOD_BLOCKED'));
});

test('transaction account, chain and unknown field changes are rejected', () => {
  for (const [change, expected] of [[{ from: RECIPIENT }, 'DAPP_ACCOUNT_MISMATCH'], [{ chainId: '0x1' }, 'DAPP_CHAIN_MISMATCH'], [{ authorizationList: [] }, 'DAPP_PARAMS_INVALID'], [{ to: '0x0000000000000000000000000000000000000000' }, 'DAPP_ADDRESS_INVALID']]) {
    const f = fixture(); assert.throws(() => f.policy.prepareRequest(f.request({ params: [{ ...baseTx(), ...change }] })), code(expected));
  }
});

test('transactions require complete fees, nonce, valid quantities and supported types', () => {
  for (const change of [{ gasPrice: undefined }, { nonce: undefined }, { gas: '1' }, { gasPrice: '0' }, { gas: '5000001' }, { value: '-1' }, { value: 1.1 }, { value: '1e9' }, { type: '0x1' }, { type: 1 }, { gasPrice: '1000000000001' }, { nonce: '9007199254740992' }]) {
    const f = fixture(), tx = { ...baseTx(), ...change }; for (const key of Object.keys(tx)) if (tx[key] === undefined) delete tx[key];
    assert.throws(() => f.policy.prepareRequest(f.request({ params: [tx] })), code('DAPP_PARAMS_INVALID'));
  }
});

test('EIP-1559 preview computes maximum fee and refuses mixed or contradictory inputs', () => {
  const tx = { ...baseTx(), type: '0x2', maxFeePerGas: '2000000000', maxPriorityFeePerGas: '1000000000' }; delete tx.gasPrice;
  const f = fixture(), preview = f.policy.prepareRequest(f.request({ params: [tx] }));
  assert.equal(preview.details.gasFeeMaxWei, '42000000000000');
  assert.equal(preview.details.transaction.type, 2);
  for (const change of [{ gasPrice: '1' }, { maxPriorityFeePerGas: '3000000000' }, { type: 0 }]) {
    const other = fixture(); assert.throws(() => other.policy.prepareRequest(other.request({ params: [{ ...tx, ...change }] })), code('DAPP_PARAMS_INVALID'));
  }
});

test('unknown contract calls and malformed known calls are blocked rather than blind-signed', () => {
  for (const data of ['0xdeadbeef', ABI.encodeFunctionData('transfer', [RECIPIENT, 10n]) + '00', '0xa9059cbb', '0x0']) {
    const f = fixture(); assert.throws(() => f.policy.prepareRequest(f.request({ params: [{ ...baseTx(), data, value: '0' }] })), error => ['DAPP_CALL_UNRECOGNIZED', 'DAPP_PARAMS_INVALID'].includes(error.code));
  }
});

test('ERC20 transfer preview shows recipient, raw amount and contract verification limitation', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request({ params: [{ ...baseTx(), to: TOKEN, value: '0', data: ABI.encodeFunctionData('transfer', [RECIPIENT, 123n]) }] }));
  assert.deepEqual(preview.details.call, { method: 'transfer', contract: TOKEN, arguments: { to: RECIPIENT, amount: '123' }, unlimitedApproval: false });
  assert.match(preview.details.warnings.join(' '), /尚未验证目标合约代码/);
});

test('unlimited approval warns about the specific spender and allowance', () => {
  const f = fixture(), preview = f.policy.prepareRequest(f.request({ params: [{ ...baseTx(), to: TOKEN, value: '0', data: ABI.encodeFunctionData('approve', [RECIPIENT, MaxUint256]) }] }));
  assert.equal(preview.details.call.unlimitedApproval, true);
  assert.equal(preview.details.call.arguments.spender, RECIPIENT);
  assert.equal(preview.details.call.arguments.amount, MaxUint256.toString());
  assert.match(preview.details.warnings.join(' '), /无限额度授权/);
});

test('token calls cannot quietly attach a native amount or target zero recipient', () => {
  for (const [value, recipient, expected] of [['1', RECIPIENT, 'DAPP_PARAMS_INVALID'], ['0', '0x0000000000000000000000000000000000000000', 'DAPP_ADDRESS_INVALID']]) {
    const f = fixture(); assert.throws(() => f.policy.prepareRequest(f.request({ params: [{ ...baseTx(), to: TOKEN, value, data: ABI.encodeFunctionData('transfer', [recipient, 2n]) }] })), code(expected));
  }
});

test('personal_sign displays full UTF-8 and hex without claiming cross-chain replay protection', () => {
  const message = '本地策略测试\n请逐项核对内容。', encoded = hexlify(toUtf8Bytes(message));
  const f = fixture(), preview = f.policy.prepareRequest(f.request({ method: 'personal_sign', params: [encoded, ACCOUNT] }));
  assert.equal(preview.details.message, message);
  assert.equal(preview.details.messageHex, encoded);
  assert.equal(preview.details.chainBound, false);
});

test('personal_sign rejects invalid UTF-8, hidden controls, wrong account and oversized messages', () => {
  for (const params of [['0xff', ACCOUNT], ['0x00', ACCOUNT], [hexlify(toUtf8Bytes('a\u202eb')), ACCOUNT], ['0x' + 'ff'.repeat(32), ACCOUNT], ['0x' + '61'.repeat(4097), ACCOUNT], ['0x6162', RECIPIENT]]) {
    const f = fixture(); assert.throws(() => f.policy.prepareRequest(f.request({ method: 'personal_sign', params })), error => ['DAPP_MESSAGE_INVALID', 'DAPP_ACCOUNT_MISMATCH'].includes(error.code));
  }
});

test('typed signature preview shows complete domain, message, types and original JSON', () => {
  const typed = baseTyped(), f = fixture(), preview = f.policy.prepareRequest(f.request({ method: 'eth_signTypedData_v4', params: [ACCOUNT, JSON.stringify(typed)] }));
  assert.equal(preview.details.domain.name, typed.domain.name);
  assert.equal(preview.details.domain.verifyingContract, TOKEN);
  assert.equal(preview.details.primaryType, 'Consent');
  assert.equal(preview.details.message.amount, '12');
  assert.deepEqual(preview.details.types.Consent, typed.types.Consent);
  assert.deepEqual(JSON.parse(preview.params[1]), typed);
});

test('typed signing rejects a wrong chain, missing contract, invalid domain, hidden unsigned fields and bad schema', () => {
  const mutations = [
    typed => { typed.domain.chainId = 1; },
    typed => { delete typed.domain.verifyingContract; },
    typed => { typed.domain.name = ''; },
    typed => { typed.domain.unrecognized = 'x'; },
    typed => { typed.message.notSigned = 'hidden'; },
    typed => { typed.primaryType = 'Other'; },
    typed => { typed.types.Consent[1].type = 'invalid'; },
    typed => { typed.types.EIP712Domain = [{ name: 'chainId', type: 'string' }]; },
  ];
  for (const mutate of mutations) { const f = fixture(), typed = baseTyped(); mutate(typed); assert.throws(() => f.policy.prepareRequest(f.request({ method: 'eth_signTypedData_v4', params: [ACCOUNT, typed] })), error => ['DAPP_CHAIN_MISMATCH', 'DAPP_PARAMS_INVALID', 'DAPP_TYPED_DATA_INVALID'].includes(error.code)); }
});

test('structured nested data preserves all signed array entries and rejects extra nested fields', () => {
  const typed = { ...baseTyped(), types: { Batch: [{ name: 'items', type: 'Item[]' }], Item: [{ name: 'amount', type: 'uint256' }] }, primaryType: 'Batch', message: { items: [{ amount: '1' }, { amount: '2' }] } };
  const f = fixture(), preview = f.policy.prepareRequest(f.request({ method: 'eth_signTypedData_v4', params: [ACCOUNT, typed] }));
  assert.deepEqual(preview.details.message.items, [{ amount: '1' }, { amount: '2' }]);
  typed.message.items[0].notSigned = 3;
  const other = fixture(); assert.throws(() => other.policy.prepareRequest(other.request({ method: 'eth_signTypedData_v4', params: [ACCOUNT, typed] })), code('DAPP_PARAMS_INVALID'));
});

test('hostile JSON cannot introduce getters, prototypes, functions or excessive size', () => {
  let getterRan = false;
  const getter = {}; Object.defineProperty(getter, 'to', { enumerable: true, get() { getterRan = true; return RECIPIENT; } });
  const hostile = [[getter], [JSON.parse('{"__proto__":{"polluted":true}}')], [new Date()], [{ toJSON() { return baseTx(); } }], [Object.assign([], { extra: 'value' })], [new Array(1)], [Symbol('bad')], ['x'.repeat(DAPP_POLICY_LIMITS.maxJsonBytes + 1)]];
  for (const params of hostile) { const f = fixture(); assert.throws(() => f.policy.prepareRequest(f.request({ params })), code('DAPP_PARAMS_INVALID')); }
  assert.equal(getterRan, false);
  assert.equal({}.polluted, undefined);
});

test('local strategy has no secret, signing, storage or transport path', async () => {
  const source = await readFile(new URL('../src/wallet-dapp-policy.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|\bWebSocket\s*\(|localStorage|sessionStorage|\.signTransaction\s*\(|\.signMessage\s*\(|\.signTypedData\s*\(|privateKey|mnemonic/);
  const policy = fixture().policy;
  for (const key of ['sign', 'broadcast', 'dispatch', 'connect', 'sendTransaction']) assert.equal(policy[key], undefined);
});
