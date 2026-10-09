import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the pure local-demo ledger helpers without the browser CSS import.
const mediaSource = (await readFile(new URL('../src/chat-media.js', import.meta.url), 'utf8')).replace(/import '\.\/[^']+\.css';\n/g, '');
const mediaURL = `data:text/javascript;base64,${Buffer.from(mediaSource).toString('base64')}`;
const source = (await readFile(new URL('../src/social.js', import.meta.url), 'utf8')).replace(/import '\.\/[^']+\.css';\n/g, '').replace("'./redpacket-model.js'", JSON.stringify(new URL('../src/redpacket-model.js', import.meta.url).href)).replace("'./chat-media.js'", JSON.stringify(mediaURL)).replace("'./profile-store.js'", JSON.stringify(new URL('../src/profile-store.js', import.meta.url).href)) + '\nexport { seed, createDemoPacket, claimDemoPacket, settleExpired, packetRemaining, ledgerPackets, installDemoPacketSample };';
const { seed, createDemoPacket, claimDemoPacket, settleExpired, packetRemaining, ledgerPackets, installDemoPacketSample } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const total = data => Object.values(data.wallets).reduce((a, b) => a + b, 0) + ledgerPackets(data).filter(m => !m.packet.refunded).reduce((sum, m) => sum + packetRemaining(m.packet), 0);
const input = (overrides = {}) => ({ totalUnits: 100000, count: 1, kind: 'equal', greeting: '演示红包', ...overrides });

test('incoming sample can be claimed once and credits only local demo balance', () => {
  const data = seed(), originalTotal = total(data);
  const packet = data.chats.lin.find(m => m.type === 'packet').packet;
  assert.equal(claimDemoPacket(data, packet), 10000);
  assert.equal(data.wallets.me, 1010000);
  assert.equal(packetRemaining(packet), 0);
  assert.throws(() => claimDemoPacket(data, packet), /不可领取/);
  assert.equal(total(data), originalTotal);
});

test('sending deducts demo balance, sender cannot claim, expiry refunds once', () => {
  const data = seed(), originalTotal = total(data), start = Date.now();
  const { packet } = createDemoPacket(data, 'lin', input(), start);
  assert.equal(data.wallets.me, 900000);
  assert.deepEqual(packet.recipientIds, ['lin']);
  assert.throws(() => claimDemoPacket(data, packet, start), /不可领取/);
  assert.equal(total(data), originalTotal);
  settleExpired(data, start + 24 * 60 * 60 * 1000);
  assert.equal(data.wallets.me, 1000000);
  assert.equal(packet.refundUnits, 100000);
  const settled = structuredClone(data.wallets);
  assert.equal(settleExpired(data, start + 48 * 60 * 60 * 1000), false);
  assert.deepEqual(data.wallets, settled);
  assert.equal(total(data), originalTotal);
});

test('ordinary group packets split equally and random packets conserve every unit', () => {
  for (const random of [() => 0, () => 0.5, () => 0.999999]) {
    const data = seed(), originalTotal = total(data);
    const ordinary = createDemoPacket(data, 'group-weekend', input({ totalUnits: 300000, count: 3 })).packet;
    assert.deepEqual(ordinary.allocations, [100000, 100000, 100000]);
    const randomPacket = createDemoPacket(data, 'group-weekend', input({ totalUnits: 100001, count: 3, kind: 'random' }), Date.now(), random).packet;
    assert.equal(randomPacket.allocations.reduce((a, b) => a + b, 0), 100001);
    assert.ok(randomPacket.allocations.every(value => Number.isInteger(value) && value > 0));
    assert.deepEqual(randomPacket.recipientIds, ['lin', 'ke', 'zhou', 'me']);
    assert.equal(total(data), originalTotal);
  }
});

test('invalid recipients, insufficient funds, invalid share counts are rejected before deduction', () => {
  const data = seed();
  assert.throws(() => createDemoPacket(data, 'moon', input()), /当前好友/);
  assert.throws(() => createDemoPacket(data, 'lin', input({ totalUnits: 1000001 })), /平台余额不足/);
  assert.throws(() => createDemoPacket(data, 'lin', input({ count: 2 })), /份数/);
  assert.throws(() => createDemoPacket(data, 'group-weekend', input({ count: 5 })), /份数/);
  assert.throws(() => createDemoPacket(data, 'group-weekend', input({ totalUnits: 100000, count: 3 })), /相同/);
  assert.equal(data.wallets.me, 1000000);
});

test('expired or ineligible packets cannot be claimed', () => {
  const data = seed();
  const packet = data.chats.lin.find(m => m.type === 'packet').packet;
  assert.throws(() => claimDemoPacket(data, packet, packet.expiresAt), /不可领取/);
  packet.recipientIds = ['ke'];
  assert.throws(() => claimDemoPacket(data, packet, packet.createdAt), /不可领取/);
  assert.equal(data.wallets.me, 1000000);
});

test('group sender can claim one share; remaining funds expire back without duplication', () => {
  const data = seed(), originalTotal = total(data), start = Date.now();
  const packet = createDemoPacket(data, 'group-weekend', input({ totalUnits: 400000, count: 4 }), start).packet;
  assert.equal(packet.isGroup, true);
  assert.equal(data.wallets.me, 600000);
  assert.equal(claimDemoPacket(data, packet, start), 100000);
  assert.equal(data.wallets.me, 700000);
  assert.throws(() => claimDemoPacket(data, packet, start), /不可领取/);
  assert.equal(packetRemaining(packet), 300000);
  settleExpired(data, packet.expiresAt);
  assert.equal(data.wallets.me, 1000000);
  assert.equal(packet.refundUnits, 300000);
  assert.equal(total(data), originalTotal);
});


test('one-time group sample preserves total demo funds and never fabricates claims', () => {
  const data = seed(), originalTotal = total(data), originalMine = data.wallets.me;
  assert.equal(installDemoPacketSample(data), true);
  const packet = data.chats['group-weekend'].find(message => message.id === 'demo-group-packet-v3').packet;
  assert.equal(packet.claims.length, 0);
  assert.equal(data.wallets.me, originalMine);
  assert.equal(data.wallets.ke, 970000);
  assert.equal(total(data), originalTotal);
  assert.equal(installDemoPacketSample(data), false);
  assert.equal(data.wallets.ke, 970000);
  claimDemoPacket(data, packet);
  assert.equal(total(data), originalTotal);
});
