import { AbiCoder, Interface, concat, getAddress, keccak256, toBeHex, toUtf8Bytes } from 'ethers';

export const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
export const SPONSORSHIP_LIMITS = Object.freeze({ maxGas: 2000000n, maxFeePerGas: 1000000000n, authorizationMs: 600000, receiptConfirmations: 3 });
const ACCOUNT_ABI = new Interface(['function execute(address dest,uint256 value,bytes func)']);
const FACTORY_ABI = new Interface(['function createAccount(address owner,uint256 salt)']);
const GAS_FIELDS = ['callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'];
const OP_FIELDS = ['sender', 'nonce', 'factory', 'factoryData', 'callData', ...GAS_FIELDS, 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymaster', 'paymasterData'];
const ZERO = '0x0000000000000000000000000000000000000000';
const UINT128 = (1n << 128n) - 1n;
const UINT256 = (1n << 256n) - 1n;
const ABI = AbiCoder.defaultAbiCoder();

export function sponsorshipError(code, message) { const error = new Error(message); error.code = code; return error; }
function check(ok, code = 'SPONSORSHIP_INVALID', message = '代付请求不符合本地策略。') { if (!ok) throw sponsorshipError(code, message); }
export function sponsorshipInteger(value, { max = UINT256, positive = false } = {}) {
  check(typeof value === 'string' && /^(0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/.test(value) && value.length <= 80);
  const result = BigInt(value); check(result <= max && (!positive || result > 0n)); return result;
}
export function sponsorshipAddress(value) {
  try { const result = getAddress(value); check(result !== ZERO); return result; }
  catch { throw sponsorshipError('SPONSORSHIP_ADDRESS', '代付请求地址无效。'); }
}
function bytes(value, size) { check(typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && value.length <= 32770 && (size === undefined || value.length === size * 2 + 2)); return value.toLowerCase(); }
export function sponsorshipJson(value) {
  let count = 0;
  function visit(item, depth = 0) {
    check(++count <= 4096 && depth <= 16);
    if (item === null || typeof item === 'boolean' || typeof item === 'string') { check(typeof item !== 'string' || item.length <= 32768); return item; }
    if (typeof item === 'number') { check(Number.isSafeInteger(item)); return item; }
    check(item && typeof item === 'object' && (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype));
    const props = Object.getOwnPropertyDescriptors(item);
    check(Reflect.ownKeys(item).every(key => typeof key === 'string') && Object.entries(props).every(([key, d]) => !['__proto__', 'constructor', 'prototype'].includes(key) && !d.get && !d.set));
    if (Array.isArray(item)) { check(item.length <= 2048 && Object.keys(props).length === item.length + 1); return item.map(value => visit(value, depth + 1)); }
    const result = {}; for (const [key, d] of Object.entries(props)) { check(d.enumerable); result[key] = visit(d.value, depth + 1); } return result;
  }
  const result = visit(value); check(Buffer.byteLength(JSON.stringify(result)) <= 65536); return result;
}
function stable(value) { return value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value); }
export function sponsorshipDigest(value) { return keccak256(toUtf8Bytes(stable(sponsorshipJson(value)))); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fields(value, allowed, required = []) { check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key))); }
function exactRuntime(code, expected) { check(bytes(code) !== '0x' && keccak256(code) === expected, 'SPONSORSHIP_CODE_MISMATCH', '合约运行代码与已核对的本地配置不一致。'); }
function canonicalCall(iface, name, data) { try { const decoded = iface.decodeFunctionData(name, data); check(iface.encodeFunctionData(name, decoded).toLowerCase() === data.toLowerCase()); return decoded; } catch { throw sponsorshipError('SPONSORSHIP_CALL_BLOCKED', '不支持此账户调用编码，批量与未知调用均未开放。'); } }

export function normalizeUserOperationV07(value) {
  const op = sponsorshipJson(value);
  fields(op, OP_FIELDS, ['sender', 'nonce', 'callData', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas']);
  op.sender = sponsorshipAddress(op.sender); op.nonce = toBeHex(sponsorshipInteger(op.nonce)); op.callData = bytes(op.callData);
  check(Boolean(op.factory) === (op.factoryData !== undefined));
  if (op.factory) { op.factory = sponsorshipAddress(op.factory); op.factoryData = bytes(op.factoryData); }
  for (const name of GAS_FIELDS) if (op[name] !== undefined) op[name] = toBeHex(sponsorshipInteger(op[name], { max: UINT128, positive: true }));
  for (const name of ['maxFeePerGas', 'maxPriorityFeePerGas']) op[name] = toBeHex(sponsorshipInteger(op[name], { max: UINT128, positive: name === 'maxFeePerGas' }));
  if (op.paymaster !== undefined) { op.paymaster = sponsorshipAddress(op.paymaster); op.paymasterData = bytes(op.paymasterData); check(GAS_FIELDS.slice(3).every(key => op[key])); }
  else check(op.paymasterData === undefined);
  return freeze(op);
}

// ERC-4337 v0.7 packing follows the official UserOperationLib. The RPC object
// keeps factory/paymaster fields separate; v0.6 initCode is deliberately rejected.
export function userOperationHashV07(operation, entryPoint, chainId) {
  const op = normalizeUserOperationV07(operation); check(op.paymaster, 'SPONSORSHIP_FINAL_MISSING', '缺少最终本地测试授权。');
  const initCode = op.factory ? concat([op.factory, op.factoryData]) : '0x';
  const paymasterAndData = concat([op.paymaster, toBeHex(BigInt(op.paymasterVerificationGasLimit), 16), toBeHex(BigInt(op.paymasterPostOpGasLimit), 16), op.paymasterData]);
  const packedLimits = toBeHex((BigInt(op.verificationGasLimit) << 128n) | BigInt(op.callGasLimit), 32);
  const packedFees = toBeHex((BigInt(op.maxPriorityFeePerGas) << 128n) | BigInt(op.maxFeePerGas), 32);
  const inner = keccak256(ABI.encode(['address', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'bytes32'], [op.sender, op.nonce, keccak256(initCode), keccak256(op.callData), packedLimits, op.preVerificationGas, packedFees, keccak256(paymasterAndData)]));
  return keccak256(ABI.encode(['bytes32', 'address', 'uint256'], [inner, sponsorshipAddress(entryPoint), chainId]));
}

/** Pure, test-only policy. It cannot enable a provider, sign, or broadcast. */
export function createSponsorshipPolicy(input) {
  const config = sponsorshipJson(input);
  check(config.mode === 'local-harness' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(config.id), 'SPONSORSHIP_CONFIG', '仅支持明确标注的本地测试策略。');
  check([97, 1337, 31337].includes(config.chainId) && config.testnet === true, 'SPONSORSHIP_CHAIN', '只允许测试网或本地 EVM。');
  check(sponsorshipAddress(config.entryPoint) === ENTRY_POINT_V07 && config.entryPointVersion === '0.7', 'SPONSORSHIP_ENTRYPOINT', 'EntryPoint 地址与版本必须匹配 v0.7。');
  config.entryPoint = sponsorshipAddress(config.entryPoint);
  for (const key of ['entryPointRuntimeHash', 'accountRuntimeHash']) config[key] = bytes(config[key], 32);
  for (const key of ['factory', 'paymaster']) { fields(config[key], ['address', 'runtimeHash'], ['address', 'runtimeHash']); config[key].address = sponsorshipAddress(config[key].address); config[key].runtimeHash = bytes(config[key].runtimeHash, 32); }
  check(Array.isArray(config.senders) && config.senders.length > 0 && config.senders.length <= 1000);
  config.senders = config.senders.map(row => { fields(row, ['sender', 'ownerId', 'ownerAddress', 'salt'], ['sender', 'ownerId', 'ownerAddress', 'salt']); check(/^[A-Za-z0-9:_-]{1,128}$/.test(row.ownerId)); return { ...row, sender: sponsorshipAddress(row.sender), ownerAddress: sponsorshipAddress(row.ownerAddress), salt: sponsorshipInteger(row.salt).toString() }; });
  check(new Set(config.senders.map(row => row.sender)).size === config.senders.length);
  check(Array.isArray(config.calls) && config.calls.length > 0 && config.calls.length <= 100);
  config.calls = config.calls.map(row => { fields(row, ['action', 'target', 'selector', 'callDataHash', 'runtimeHash'], ['action', 'target', 'selector', 'callDataHash', 'runtimeHash']); check(['create', 'first-entry'].includes(row.action)); return { ...row, target: sponsorshipAddress(row.target), selector: bytes(row.selector, 4), callDataHash: bytes(row.callDataHash, 32), runtimeHash: bytes(row.runtimeHash, 32) }; });
  for (const key of ['monthlyWei', 'dailyWei', 'userDailyWei', 'sessionWei', 'singleWei']) config.budget[key] = sponsorshipInteger(config.budget?.[key], { positive: true }).toString();
  check(BigInt(config.budget.singleWei) <= SPONSORSHIP_LIMITS.maxGas * SPONSORSHIP_LIMITS.maxFeePerGas);
  for (const key of ['userHourly', 'globalHourly']) check(Number.isSafeInteger(config.budget[key]) && config.budget[key] > 0 && config.budget[key] <= 10000);
  freeze(config);
  const policyHash = sponsorshipDigest(config);
  function evaluate({ operation, ownerId, sessionId, chainId, entryPoint, evidence }) {
    const op = normalizeUserOperationV07(operation);
    check(chainId === config.chainId && sponsorshipAddress(entryPoint) === config.entryPoint, 'SPONSORSHIP_CHAIN', '请求链或 EntryPoint 与策略不一致。');
    check(typeof sessionId === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(sessionId));
    const binding = config.senders.find(row => row.sender === op.sender && row.ownerId === ownerId);
    check(binding, 'SPONSORSHIP_SENDER', '该账户未获本地测试赞助授权。');
    const proof = sponsorshipJson(evidence);
    check(proof.chainId === config.chainId && sponsorshipAddress(proof.entryPoint) === config.entryPoint, 'SPONSORSHIP_CHAIN', '链上核对证据的网络不一致。');
    exactRuntime(proof.entryPointCode, config.entryPointRuntimeHash);
    exactRuntime(proof.paymasterCode, config.paymaster.runtimeHash);
    check(sponsorshipAddress(proof.ownerAddress) === binding.ownerAddress && sponsorshipInteger(proof.nonce) === BigInt(op.nonce), 'SPONSORSHIP_ACCOUNT_BINDING', '智能账户所有者或 nonce 核对失败。');
    const action = op.factory ? 'create' : 'first-entry';
    if (op.factory) {
      check(op.factory === config.factory.address && bytes(proof.accountCode) === '0x' && BigInt(op.nonce) === 0n, 'SPONSORSHIP_FACTORY', '创建账户参数不符合策略。');
      exactRuntime(proof.factoryCode, config.factory.runtimeHash);
      const [owner, salt] = canonicalCall(FACTORY_ABI, 'createAccount', op.factoryData);
      check(sponsorshipAddress(owner) === binding.ownerAddress && salt.toString() === binding.salt && sponsorshipAddress(proof.predictedSender) === op.sender, 'SPONSORSHIP_FACTORY', '工厂、所有者或预计算账户不一致。');
    } else exactRuntime(proof.accountCode, config.accountRuntimeHash);
    // An allowed outer execute selector is insufficient. Inspect every inner byte.
    // executeBatch is intentionally unavailable in this first local harness.
    const [target, value, data] = canonicalCall(ACCOUNT_ABI, 'execute', op.callData);
    check(value === 0n, 'SPONSORSHIP_VALUE', '赞助动作不能夹带原生资产转账。');
    const rule = config.calls.find(row => row.action === action && row.target === sponsorshipAddress(target) && row.selector === data.slice(0, 10).toLowerCase() && row.callDataHash === keccak256(data));
    check(rule, 'SPONSORSHIP_INNER_CALL', '内层目标、方法或参数不在赞助白名单内。');
    exactRuntime(proof.targetCode, rule.runtimeHash);
    if (op.paymaster) check(op.paymaster === config.paymaster.address, 'SPONSORSHIP_PAYMASTER', 'Paymaster 地址不一致。');
    const gas = GAS_FIELDS.reduce((sum, key) => sum + BigInt(op[key] || '0'), 0n), maxFee = BigInt(op.maxFeePerGas);
    check(gas > 0n && gas <= SPONSORSHIP_LIMITS.maxGas && maxFee <= SPONSORSHIP_LIMITS.maxFeePerGas && BigInt(op.maxPriorityFeePerGas) <= maxFee, 'SPONSORSHIP_GAS_CAP', '请求超出测试代付 Gas 或费率上限。');
    const maxCost = gas * maxFee;
    check(maxCost <= BigInt(config.budget.singleWei), 'SPONSORSHIP_SINGLE_CAP', '请求超出单笔成本上限。');
    return freeze({ policyId: config.id, policyHash, ownerId, sessionId, chainId: config.chainId, entryPoint: config.entryPoint, sender: op.sender, nonce: BigInt(op.nonce).toString(), action, target: rule.target, selector: rule.selector, operation: op, maxCostWei: maxCost.toString(), reserveWei: config.budget.singleWei, budget: config.budget, paymaster: config.paymaster.address });
  }
  return Object.freeze({ evaluate, getConfig: () => config, policyHash });
}

export function mergePaymasterData(operation, response, expectedPaymaster) {
  const result = sponsorshipJson(response);
  fields(result, ['paymaster', 'paymasterData', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'], ['paymaster', 'paymasterData', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit']);
  check(sponsorshipAddress(result.paymaster) === expectedPaymaster, 'SPONSORSHIP_PAYMASTER', '测试适配器更改了 Paymaster。');
  return normalizeUserOperationV07({ ...operation, ...result });
}
export function mergeGasEstimate(operation, response) {
  const result = sponsorshipJson(response); fields(result, GAS_FIELDS, GAS_FIELDS); return normalizeUserOperationV07({ ...operation, ...result });
}
