import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, ZeroHash, ZeroAddress } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { invitations, commitment } from '../scripts/protocol.mjs';

// No RPC URL, mnemonic, real private key, network request, or deployment outside this process.
const artifacts = (await compile()).contracts;
const campaignArtifact = artifacts['src/SingleDistribution.sol'].SingleDistribution;
const tokenArtifact = artifacts['test/MockToken.sol'].MockToken;

async function fixture(t, { count = 3, amount = 100_003n, penalty = 8000 } = {}) {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { totalAccounts: count + 3 }, miner: { timestampIncrement: 0 } });
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await rpc.disconnect(); });
  const signers = await Promise.all(Array.from({ length: count + 3 }, (_, i) => provider.getSigner(i)));
  const [sender, stranger, ...members] = signers;
  const token = await new ContractFactory(tokenArtifact.abi, tokenArtifact.evm.bytecode.object, sender).deploy();
  await token.waitForDeployment();
  const now = Number((await rpc.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })).timestamp);
  const campaignId = id('LOCAL TEST CAMPAIGN');
  const list = invitations({ chainId: 31337, sender: await sender.getAddress(), campaignId,
    members: await Promise.all(members.slice(0, count).map(async (s, i) => ({ account: await s.getAddress(), salt: id('TEST INVITATION ' + i) }))) });
  const config = { token: await token.getAddress(), campaignId, whitelistRoot: list.root, amount, recipientCount: count,
    commitStart: now + 120, commitEnd: now + 240, revealEnd: now + 360, expiresAt: now + 660, decayDuration: 120, initialPenaltyBps: penalty };
  const deploy = async (overrides = {}) => {
    const c = await new ContractFactory(campaignArtifact.abi, campaignArtifact.evm.bytecode.object, sender).deploy({ ...config, ...overrides });
    await c.waitForDeployment(); return c;
  };
  const campaign = await deploy();
  const domain = await campaign.domain();
  const entries = list.entries.map((e, i) => ({ ...e, signer: members[i], secret: id('TEST ENTROPY SECRET ' + i),
    commitment: commitment({ domain, index: i, account: e.account, secret: id('TEST ENTROPY SECRET ' + i) }) }));
  const at = async ts => { await rpc.request({ method: 'evm_setTime', params: [ts * 1000] }); await rpc.request({ method: 'evm_mine', params: [] }); };
  const tx = async promise => { const result = await promise; return result.wait(); };
  const fund = async () => { await tx(token.mint(await sender.getAddress(), amount)); await tx(token.approve(await campaign.getAddress(), amount)); await tx(campaign.fund()); };
  const commitAll = async () => { await at(config.commitStart); for (const e of entries) await tx(campaign.connect(e.signer).commit(e.index, e.commitment, e.salt, e.proof)); };
  const revealAll = async (order = entries) => { await at(config.commitEnd); for (const e of order) await tx(campaign.connect(e.signer).reveal(e.index, e.secret)); };
  const ready = async () => { await fund(); await commitAll(); await revealAll(); await at(config.revealEnd); await tx(campaign.connect(stranger).finalize()); };
  const conserved = async () => {
    assert.equal(await campaign.remaining() + await campaign.totalPaid() + await campaign.totalRefunded(), amount);
    assert.equal(await token.balanceOf(await campaign.getAddress()), await campaign.remaining());
  };
  const bad = async (call, expected) => {
    await assert.rejects(call, error => {
      const raw = error.data ?? error.info?.error?.data?.result;
      const parsed = typeof raw === 'string' ? campaign.interface.parseError(raw) : null;
      assert.equal(parsed?.name, expected, error.shortMessage ?? error.message);
      return true;
    });
  };
  return { rpc, provider, sender, stranger, members, token, campaign, config, entries, deploy, at, tx, fund, commitAll, revealAll, ready, conserved, bad, amount };
}

test('immutable parameters reject empty roots, non-contract tokens, bad windows and unsafe bounds', async t => {
  const f = await fixture(t);
  for (const overrides of [ { whitelistRoot: ZeroHash }, { token: ZeroAddress }, { campaignId: ZeroHash }, { recipientCount: 1 },
    { recipientCount: 201 }, { amount: 2 }, { commitStart: f.config.commitStart - 61 },
    { commitEnd: f.config.commitStart + 59 }, { revealEnd: f.config.commitEnd + 59 },
    { decayDuration: 59 }, { expiresAt: f.config.revealEnd + 179 }, { initialPenaltyBps: 0 }, { initialPenaltyBps: 9001 } ]) {
    await assert.rejects(f.deploy(overrides));
  }
});

test('wallet funding needs sender authority, approval, exact balance, one funding and start delay', async t => {
  const f = await fixture(t);
  await f.bad(f.campaign.connect(f.stranger).fund.staticCall(), 'Unauthorized');
  await assert.rejects(f.campaign.fund.staticCall());
  assert.equal(await f.campaign.funded(), false);
  await f.fund();
  await f.bad(f.campaign.fund.staticCall(), 'DuplicateAction');
  assert.equal(await f.campaign.phase(), 0n);
  await f.conserved();
  const other = await f.deploy();
  await f.at(f.config.commitStart - 59);
  await f.bad(other.fund.staticCall(), 'WrongPhase');
});

test('whitelist binds address, slot and invitation; copied mempool commit cannot claim a slot', async t => {
  const f = await fixture(t); await f.fund(); await f.at(f.config.commitStart);
  const e = f.entries[0];
  await f.bad(f.campaign.commit.staticCall(e.index,e.commitment,e.salt,e.proof),'Unauthorized');
  assert.equal(await f.campaign.whitelistLeaf(e.index, e.account, e.salt), e.leaf);
  await f.bad(f.campaign.connect(f.stranger).commit.staticCall(e.index, e.commitment, e.salt, e.proof), 'InvalidProof');
  await f.bad(f.campaign.connect(e.signer).commit.staticCall(1, e.commitment, e.salt, e.proof), 'InvalidProof');
  await f.bad(f.campaign.connect(e.signer).commit.staticCall(0, e.commitment, id('wrong salt'), e.proof), 'InvalidProof');
  await f.tx(f.campaign.connect(e.signer).commit(0, e.commitment, e.salt, e.proof));
  await f.bad(f.campaign.connect(e.signer).commit.staticCall(0, e.commitment, e.salt, e.proof), 'DuplicateAction');
  await f.bad(f.campaign.connect(e.signer).commit.staticCall(1, e.commitment, e.salt, e.proof), 'DuplicateAction');
  assert.equal(await f.campaign.committedCount(), 1n);
});

test('invitation helper rejects sender, zero address and duplicate recipients before deployment',async t=>{
 const f=await fixture(t),sender=await f.sender.getAddress(),campaignId=f.config.campaignId;
 for(const members of [[{account:sender,salt:id('a')},{account:f.entries[0].account,salt:id('b')}],[{account:ZeroAddress,salt:id('a')},{account:f.entries[0].account,salt:id('b')}],[{account:f.entries[0].account,salt:id('a')},{account:f.entries[0].account,salt:id('b')}]] )assert.throws(()=>invitations({chainId:31337,sender,campaignId,members}));
});

test('commit/reveal phase boundaries, wrong secrets and duplicate reveals cannot change commitments', async t => {
  const f = await fixture(t); await f.fund(); const e = f.entries[0];
  await f.bad(f.campaign.connect(e.signer).commit.staticCall(0, e.commitment, e.salt, e.proof), 'WrongPhase');
  await f.commitAll();
  await f.bad(f.campaign.connect(e.signer).reveal.staticCall(0, e.secret), 'WrongPhase');
  await f.at(f.config.commitEnd);
  await f.bad(f.campaign.connect(e.signer).commit.staticCall(0, e.commitment, e.salt, e.proof), 'WrongPhase');
  await f.bad(f.campaign.connect(e.signer).reveal.staticCall(0, id('wrong')), 'InvalidCommitment');
  await f.bad(f.campaign.connect(f.stranger).reveal.staticCall(0, e.secret), 'Unauthorized');
  await f.tx(f.campaign.connect(e.signer).reveal(0, e.secret));
  await f.bad(f.campaign.connect(e.signer).reveal.staticCall(0, e.secret), 'DuplicateAction');
  await f.at(f.config.revealEnd);
  await f.bad(f.campaign.connect(f.entries[1].signer).reveal.staticCall(1, f.entries[1].secret), 'WrongPhase');
  await f.bad(f.campaign.finalize.staticCall(), 'IncompleteReveals');
  await f.conserved();
});

test('commitments are bound to deployment, chain domain and recipient, so reveal cannot replay', async t => {
  const f = await fixture(t); const other = await f.deploy(); const e = f.entries[0];
  assert.notEqual(await other.domain(), await f.campaign.domain());
  assert.notEqual(await other.commitmentFor(0, e.account, e.secret), e.commitment);
  assert.notEqual(await f.campaign.commitmentFor(1, e.account, e.secret), e.commitment);
  assert.notEqual(await f.campaign.commitmentFor(0, await f.stranger.getAddress(), e.secret), e.commitment);
  await f.fund(); await f.at(f.config.commitStart);
  for (const entry of f.entries) {
    const foreign = await other.commitmentFor(entry.index, entry.account, entry.secret);
    await f.tx(f.campaign.connect(entry.signer).commit(entry.index, foreign, entry.salt, entry.proof));
  }
  await f.at(f.config.commitEnd);
  await f.bad(f.campaign.connect(e.signer).reveal.staticCall(0, e.secret), 'InvalidCommitment');
});

test('seed and allocations are independent of reveal ordering; early finalize is rejected', async t => {
  const f = await fixture(t); await f.fund(); await f.commitAll();
  const snapshot = await f.rpc.request({ method: 'evm_snapshot', params: [] });
  await f.revealAll(); await f.bad(f.campaign.finalize.staticCall(), 'WrongPhase');
  await f.at(f.config.revealEnd); await f.tx(f.campaign.finalize());
  const seed = await f.campaign.seed();
  const allocations = await Promise.all(f.entries.map(async e => (await f.campaign.participants(e.index)).allocation));
  await f.rpc.request({ method: 'evm_revert', params: [snapshot] });
  await f.revealAll([...f.entries].reverse()); await f.at(f.config.revealEnd); await f.tx(f.campaign.finalize());
  assert.equal(await f.campaign.seed(), seed);
  assert.deepEqual(await Promise.all(f.entries.map(async e => (await f.campaign.participants(e.index)).allocation)), allocations);
  await f.bad(f.campaign.finalize.staticCall(), 'DuplicateAction');
});

test('all funds assigned exactly; arbitrary claim order conserves funds and cannot pay other addresses', async t => {
  const f = await fixture(t, { count: 7 }); await f.ready(); await f.at(f.config.revealEnd + f.config.decayDuration);
  assert.equal(await f.campaign.phase(), 1n);
  const sum = (await Promise.all(f.entries.map(async e => (await f.campaign.participants(e.index)).allocation))).reduce((a,b) => a+b, 0n);
  assert.equal(sum, f.amount);
  await f.bad(f.campaign.connect(f.stranger).claim.staticCall(0), 'Unauthorized');
  for (const e of [...f.entries].reverse()) {
    const allocation = (await f.campaign.participants(e.index)).allocation;
    await f.tx(f.campaign.connect(e.signer).claim(e.index));
    assert.equal(await f.token.balanceOf(e.account), allocation);
    await f.bad(f.campaign.connect(e.signer).claim.staticCall(e.index), 'DuplicateAction');
    await f.conserved();
  }
  assert.equal(await f.campaign.totalPaid(), f.amount);
  assert.equal(await f.campaign.phase(), 2n);
});

test('time-decaying early penalty is explicit, not reallocated, and refunded only after expiry', async t => {
  const f = await fixture(t); await f.ready(); const e = f.entries[0];
  assert.equal(await f.campaign.penaltyBpsAt(f.config.revealEnd), 8000n);
  assert.equal(await f.campaign.penaltyBpsAt(f.config.revealEnd + 60), 4000n);
  assert.equal(await f.campaign.penaltyBpsAt(f.config.revealEnd + 120), 0n);
  const allocation = (await f.campaign.participants(0)).allocation;
  const expected = allocation * 2000n / 10000n;
  await f.tx(f.campaign.connect(e.signer).claim(0));
  assert.equal(await f.token.balanceOf(e.account), expected);
  await f.bad(f.campaign.refundExpired.staticCall(), 'WrongPhase');
  await f.at(f.config.expiresAt);
  await f.bad(f.campaign.connect(f.entries[1].signer).claim.staticCall(1), 'WrongPhase');
  await f.tx(f.campaign.connect(f.stranger).refundExpired());
  assert.equal(await f.token.balanceOf(await f.sender.getAddress()), f.amount - expected);
  await f.bad(f.campaign.refundExpired.staticCall(), 'DuplicateAction');
  await f.conserved();
});

test('smallest units never burn through rounding; zero early payout remains retryable', async t => {
  const f = await fixture(t, { count: 2, amount: 2n }); await f.ready();
  await f.bad(f.campaign.connect(f.entries[0].signer).claim.staticCall(0), 'ZeroPayout');
  assert.equal((await f.campaign.participants(0)).claimed, false);
  await f.at(f.config.revealEnd + f.config.decayDuration);
  for (const e of f.entries) await f.tx(f.campaign.connect(e.signer).claim(e.index));
  assert.equal(await f.campaign.totalPaid(), 2n); await f.conserved();
});

test('missing commitment or last reveal never invokes biased fallback; original sender receives refund', async t => {
  for (const missing of ['commit', 'reveal']) {
    await t.test(missing, async t => {
      const f = await fixture(t); await f.fund(); await f.at(f.config.commitStart);
      const committers = missing === 'commit' ? f.entries.slice(1) : f.entries;
      for (const e of committers) await f.tx(f.campaign.connect(e.signer).commit(e.index, e.commitment, e.salt, e.proof));
      await f.at(f.config.commitEnd);
      if (missing === 'commit') await f.bad(f.campaign.connect(f.entries[1].signer).reveal.staticCall(1, f.entries[1].secret), 'IncompleteReveals');
      else for (const e of f.entries.slice(1)) await f.tx(f.campaign.connect(e.signer).reveal(e.index, e.secret));
      await f.at(f.config.revealEnd); await f.bad(f.campaign.finalize.staticCall(), 'IncompleteReveals');
      await f.at(f.config.expiresAt); await f.tx(f.campaign.connect(f.stranger).refundExpired());
      assert.equal(await f.token.balanceOf(await f.sender.getAddress()), f.amount);
      assert.equal(await f.token.balanceOf(await f.stranger.getAddress()), 0n);
      await f.bad(f.campaign.finalize.staticCall(), 'WrongPhase'); await f.conserved();
    });
  }
});

test('blocked recipient rolls back its claim, others continue, then unblock permits exactly one retry', async t => {
  const f = await fixture(t); await f.ready(); await f.at(f.config.revealEnd + f.config.decayDuration);
  const [a,b] = f.entries;
  await f.tx(f.token.setBlocked(a.account, true));
  await assert.rejects(f.tx(f.campaign.connect(a.signer).claim(0, { gasLimit: 600000 })));
  assert.equal((await f.campaign.participants(0)).claimed, false);
  assert.equal(await f.campaign.claimedCount(), 0n); await f.conserved();
  await f.tx(f.campaign.connect(b.signer).claim(1));
  await f.tx(f.token.setBlocked(a.account, false));
  await f.tx(f.campaign.connect(a.signer).claim(0));
  await f.bad(f.campaign.connect(a.signer).claim.staticCall(0), 'DuplicateAction'); await f.conserved();
});

test('SafeERC20 rejects false return and a failed claim stays refundable', async t => {
  const f = await fixture(t); await f.tx(f.token.setReturnFalse(true));
  await assert.rejects(f.fund()); assert.equal(await f.campaign.funded(), false);
  await f.tx(f.token.setReturnFalse(false));
  // The failed fund() rolled back its transfer, but mock mint/approval are independent transactions.
  await f.tx(f.campaign.fund()); await f.commitAll(); await f.revealAll(); await f.at(f.config.revealEnd);
  await f.tx(f.campaign.finalize()); await f.tx(f.token.setReturnFalse(true));
  await assert.rejects(f.tx(f.campaign.connect(f.entries[0].signer).claim(0, { gasLimit: 600000 })));
  assert.equal((await f.campaign.participants(0)).claimed, false); await f.conserved();
  await f.tx(f.token.setReturnFalse(false)); await f.at(f.config.expiresAt); await f.tx(f.campaign.refundExpired());
  await f.conserved();
});

test('fee-on-transfer is rejected on funding and outgoing transfer, with full transaction rollback', async t => {
  const f = await fixture(t); await f.tx(f.token.setChargeFee(true));
  await assert.rejects(f.fund()); assert.equal(await f.campaign.funded(), false);
  await f.tx(f.token.setChargeFee(false)); await f.tx(f.campaign.fund()); await f.commitAll(); await f.revealAll();
  await f.at(f.config.revealEnd); await f.tx(f.campaign.finalize()); await f.tx(f.token.setChargeFee(true));
  await f.bad(f.campaign.connect(f.entries[0].signer).claim.staticCall(0), 'UnsupportedToken');
  await assert.rejects(f.tx(f.campaign.connect(f.entries[0].signer).claim(0, { gasLimit: 600000 })));
  assert.equal((await f.campaign.participants(0)).claimed, false);
  assert.equal(await f.token.balanceOf(f.entries[0].account), 0n); await f.conserved();
});

test('refund transfer failure rolls back finality; retry goes only to the immutable funder', async t => {
  const f = await fixture(t); await f.fund(); await f.tx(f.token.setBlocked(await f.sender.getAddress(), true));
  await f.at(f.config.expiresAt);
  await assert.rejects(f.tx(f.campaign.connect(f.stranger).refundExpired({ gasLimit: 600000 })));
  assert.equal(await f.campaign.refunded(), false); await f.conserved();
  await f.tx(f.token.setBlocked(await f.sender.getAddress(), false));
  await f.tx(f.campaign.connect(f.stranger).refundExpired()); await f.conserved();
  assert.equal(await f.token.balanceOf(await f.sender.getAddress()), f.amount);
});

test('malicious token callback encounters OZ ReentrancyGuard while payout remains conserved', async t => {
  const f = await fixture(t); await f.ready(); await f.at(f.config.revealEnd + f.config.decayDuration);
  await f.tx(f.token.setCallback(await f.campaign.getAddress(), f.campaign.interface.encodeFunctionData('refundExpired')));
  await f.tx(f.campaign.connect(f.entries[0].signer).claim(0));
  assert.equal(await f.token.callbackError(), id('ReentrancyGuardReentrantCall()').slice(0,10));
  await f.conserved();
});

test('there is no owner, upgrade, arbitrary withdrawal, destination override or allowance API', () => {
  const allowed = new Set(['BPS','COMMIT_TAG','ENTROPY_TAG','LEAF_TAG','MAX_RECIPIENTS','MIN_WINDOW','campaignId','claim','claimable','claimedCount','commit','commitEnd','commitStart','commitmentFor','committedCount','decayDuration','domain','expiresAt','finalize','finalized','fund','funded','hasCommitted','initialPenaltyBps','participants','penaltyBpsAt','phase','recipientCount','refundExpired','refunded','remaining','reveal','revealEnd','revealedCount','seed','sender','token','totalAmount','totalPaid','totalRefunded','whitelistLeaf','whitelistRoot']);
  for (const entry of campaignArtifact.abi.filter(e => e.type === 'function')) assert.ok(allowed.has(entry.name), entry.name);
  assert.equal(campaignArtifact.abi.some(e => e.type === 'receive' || e.type === 'fallback'), false);
});


test('conservation across uneven smallest-unit and uint128-maximum campaigns', async t => {
  for (const [count, amount] of [[2,3n], [3,11n], [5,1000003n], [3,(1n << 128n)-1n]]) {
    await t.test(count + ' recipients, ' + amount + ' units', async t => {
      const f = await fixture(t, { count, amount }); await f.ready();
      const allocations = await Promise.all(f.entries.map(async e => (await f.campaign.participants(e.index)).allocation));
      assert.equal(allocations.reduce((a,b) => a+b, 0n), amount);
      assert.ok(allocations.every(value => value >= 1n));
      await f.at(f.config.revealEnd + f.config.decayDuration);
      for (const e of f.entries.slice(1)) { await f.tx(f.campaign.connect(e.signer).claim(e.index)); await f.conserved(); }
      await f.at(f.config.expiresAt); await f.tx(f.campaign.refundExpired());
      assert.equal(await f.campaign.totalRefunded(), allocations[0]); await f.conserved();
    });
  }
});
