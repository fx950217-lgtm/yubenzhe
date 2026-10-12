import { createSponsorshipPolicy, mergeGasEstimate, mergePaymasterData, normalizeUserOperationV07, SPONSORSHIP_LIMITS, sponsorshipDigest, sponsorshipError, sponsorshipJson, userOperationHashV07 } from './sponsorship-policy.mjs';

const AVAILABILITY = Object.freeze({ enabled: false, mode: 'disabled', reason: 'Gas 代付尚未接通；当前交易需要由你确认并自行支付网络手续费。', missing: Object.freeze(['GAS_SPONSORSHIP_SPEND_AUTHORIZATION', 'GAS_SPONSORSHIP_BUDGET', 'ERC4337_SMART_ACCOUNT_ADAPTER', 'ERC4337_ENTRYPOINT_RUNTIME_VERIFICATION', 'PAYMASTER_PROVIDER_POLICY', 'BUNDLER_PROVIDER', 'USER_OPERATION_WALLET_SIGNATURE', 'TESTNET_SPONSORSHIP_ACCEPTANCE']) });
export function getSponsorshipAvailability() { return AVAILABILITY; }
const fallback = reason => ({ status: 'self-pay-required', reason, message: '本次需自付 Gas，请重新核对并由你本人确认。', requiresUserApproval: true, sponsored: false, signed: false, broadcast: false });
const review = (record, reason) => ({ status: 'verify-existing', reason, record, message: '现有赞助状态尚需核验，请勿换编号或重复付款。', sponsored: false, signed: false, broadcast: false });

/** No real transport exists here. This explicit fake-only harness exercises
 * durable lifecycle/policy code, not a live ERC-4337 integration. A UI must keep
 * displaying getSponsorshipAvailability(), including when tests use this class.
 */
export function createPaymasterService({ mode = 'disabled', policy: policyInput, journal, fakeTransport, now = Date.now, timeoutMs = 5000 } = {}) {
  if (mode !== 'local-harness') {
    if (mode !== 'disabled') throw sponsorshipError('SPONSORSHIP_CONFIG', '真实代付尚未开放。');
    return Object.freeze({ getAvailability: getSponsorshipAvailability, request: async () => fallback('SPONSORSHIP_DISABLED'), reconcile: async () => fallback('SPONSORSHIP_DISABLED') });
  }
  if (!journal || fakeTransport?.kind !== 'local-fake' || !['inspect', 'getStubData', 'estimateGas', 'getFinalData', 'getReceipt'].every(key => typeof fakeTransport[key] === 'function') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw sponsorshipError('SPONSORSHIP_CONFIG', '本地框架必须显式注入测试替身和独立持久记录。');
  const policy = createSponsorshipPolicy(policyInput), config = policy.getConfig();
  async function invoke(name, input) {
    if (name !== 'getReceipt' && journal.isPaused()) throw sponsorshipError('SPONSORSHIP_PAUSED', '测试赞助已停用。');
    let timer;
    try { return await Promise.race([Promise.resolve().then(() => fakeTransport[name](sponsorshipJson(input))), new Promise((_, reject) => { timer = setTimeout(() => reject(sponsorshipError('SPONSORSHIP_UNKNOWN', '测试适配器结果尚不明确。')), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  function inputFingerprint(input) { return sponsorshipDigest({ ownerId: input.ownerId, sessionId: input.sessionId, chainId: input.chainId, entryPoint: input.entryPoint, operation: normalizeUserOperationV07(input.operation) }); }
  function timestamp() { const value = now(); if (!Number.isSafeInteger(value) || value < 0) throw sponsorshipError('SPONSORSHIP_CLOCK', '本机时间无效。'); return value; }
  async function request(rawInput) {
    const input = sponsorshipJson(rawInput), fingerprint = inputFingerprint(input);
    const existing = journal.find(input.ownerId, input.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw sponsorshipError('SPONSORSHIP_IDEMPOTENCY_CONFLICT', '相同编号的请求内容已经变化。');
      return review(existing, 'SPONSORSHIP_ALREADY_RECORDED');
    }
    const prior = journal.findOpen(input.ownerId, input.operation.sender);
    if (prior) return review(prior.ownerId === input.ownerId ? prior : null, 'SPONSORSHIP_PRIOR_UNKNOWN');
    if (journal.isPaused()) return fallback('SPONSORSHIP_PAUSED');
    let initial, evidence;
    try {
      evidence = sponsorshipJson(await invoke('inspect', { operation: input.operation, chainId: input.chainId, entryPoint: input.entryPoint }));
      initial = policy.evaluate({ ...input, evidence });
    } catch (error) { return fallback(error.code || 'SPONSORSHIP_POLICY_REJECTED'); }
    const reserved = journal.reserve(initial, { requestId: input.requestId, fingerprint });
    if (!reserved.created) return reserved.record || reserved.hold ? review(reserved.record || null, reserved.reason || 'SPONSORSHIP_ALREADY_RECORDED') : fallback(reserved.reason);
    const reservationId = reserved.record.id;
    try {
      // Persist before the first potentially authorizing call. A crash anywhere
      // after this point holds the full cap; restart never replays the sequence.
      journal.beginRequest(reservationId);
      const payload = { operation: initial.operation, entryPoint: config.entryPoint, chainId: config.chainId, context: {} };
      let operation = mergePaymasterData(initial.operation, await invoke('getStubData', payload), config.paymaster.address);
      policy.evaluate({ ...input, operation, evidence });
      operation = mergeGasEstimate(operation, await invoke('estimateGas', { ...payload, operation }));
      policy.evaluate({ ...input, operation, evidence });
      const beforeFinal = operation;
      const response = sponsorshipJson(await invoke('getFinalData', { ...payload, operation }));
      if (!response || Object.keys(response).some(key => !['data', 'validUntil'].includes(key)) || !Number.isSafeInteger(response.validUntil) || response.validUntil <= timestamp() || response.validUntil > timestamp() + SPONSORSHIP_LIMITS.authorizationMs) throw sponsorshipError('SPONSORSHIP_AUTHORIZATION_INVALID', '最终测试授权时限无效。');
      operation = mergePaymasterData(operation, response.data, config.paymaster.address);
      // Changing the gas pair after the final estimate would invalidate both the
      // budget and user's future signature. New data requires a fresh review.
      if (operation.paymasterVerificationGasLimit !== beforeFinal.paymasterVerificationGasLimit || operation.paymasterPostOpGasLimit !== beforeFinal.paymasterPostOpGasLimit) throw sponsorshipError('SPONSORSHIP_AUTHORIZATION_INVALID', '最终授权更改了已估算的 Gas 参数。');
      policy.evaluate({ ...input, operation, evidence });
      const hash = userOperationHashV07(operation, config.entryPoint, config.chainId);
      const record = journal.authorized(reservationId, hash);
      // No account signature, eth_sendUserOperation or automatic self-pay exists.
      return { status: 'authorized-local-only', mode: 'local-harness', record, userOpHash: hash, validUntil: response.validUntil, alerts: reserved.alerts, sponsored: false, signed: false, broadcast: false };
    } catch (error) {
      const record = journal.markUnknown(reservationId);
      return { ...review(record, error.code || 'SPONSORSHIP_UNKNOWN'), alerts: reserved.alerts };
    }
  }
  async function reconcile({ reservationId, ownerId }) {
    const record = journal.get(reservationId);
    if (!record || record.ownerId !== ownerId) throw sponsorshipError('SPONSORSHIP_NOT_FOUND', '没有此本地赞助记录。');
    if (!['authorized', 'unknown', 'requesting', 'reserved'].includes(record.state)) return { status: 'settled-local-only', record, simulation: true, sponsored: false, signed: false, broadcast: false };
    if (!record.userOpHash) return review(record, 'SPONSORSHIP_HASH_UNKNOWN');
    try {
      const receipt = await invoke('getReceipt', { userOpHash: record.userOpHash, chainId: record.chainId, entryPoint: record.entryPoint });
      // Neither null, accepted, queued, expired nor authorization timeout proves
      // zero spending. Only a fully bound canonical receipt may release a hold.
      if (!receipt) return unknownOrSettled(reservationId, 'SPONSORSHIP_RECEIPT_PENDING');
      const settled = journal.settle(reservationId, sponsorshipJson(receipt));
      return { status: 'settled-local-only', record: settled, simulation: true, sponsored: false, signed: false, broadcast: false };
    } catch (error) { return unknownOrSettled(reservationId, error.code || 'SPONSORSHIP_RECEIPT_UNVERIFIED'); }
  }
  function unknownOrSettled(reservationId, reason) {
    const current = journal.markUnknown(reservationId);
    if (current && ['confirmed', 'failed'].includes(current.state)) return { status: 'settled-local-only', record: current, simulation: true, sponsored: false, signed: false, broadcast: false };
    return review(current, reason);
  }
  return Object.freeze({ getAvailability: getSponsorshipAvailability, request, reconcile });
}
