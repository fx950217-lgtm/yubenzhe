import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_UNIT,PACKET_LIFETIME,demoAmount,ledgerPackets,packetRemaining,settleExpired,createDemoPacket,claimDemoPacket,packetStatus,buildPacketDraft } from '../src/redpacket-model.js';

const NOW=1_800_000_000_000;
function state(funds=10*DEMO_UNIT) {
  return { friends:['lin','ke','zhou'],groups:[{id:'group-one',members:['lin','ke','zhou']}],
    wallets:{me:funds,lin:0,ke:0,zhou:0,outsider:0},chats:{lin:[],ke:[],zhou:[],'group-one':[]} };
}
const send=(data,input={},chat='group-one')=>createDemoPacket(data,chat,buildPacketDraft(data,chat,{kind:'equal',amount:'0.1',count:2,...input}),NOW,()=>.4).packet;
const total=data=>BigInt(Object.values(data.wallets).reduce((sum,n)=>sum+n,0)) + ledgerPackets(data).filter(m=>!m.packet.refunded).reduce((sum,m)=>sum+BigInt(packetRemaining(m.packet)),0n);

test('integer parsing makes equal input per-share and random input total, without floating drift',()=>{
  const data=state();
  const equal=buildPacketDraft(data,'group-one',{kind:'equal',amount:'0.000001',count:'3'});
  assert.equal(equal.amountUnits,1);assert.equal(equal.totalUnits,3);assert.equal(equal.count,3);
  const random=buildPacketDraft(data,'group-one',{kind:'random',amount:'0.123456',count:3});
  assert.equal(random.totalUnits,123456);assert.equal(random.amountUnits,123456);
  assert.equal(demoAmount(123456),'0.123456');assert.equal(demoAmount(DEMO_UNIT),'1');
  assert.equal(demoAmount(Number.MAX_SAFE_INTEGER),'9007199254.740991');
  const whole=buildPacketDraft(data,'group-one',{kind:'equal',amount:'1.000001',count:3});
  assert.equal(whole.totalUnits,3000003);
});

test('NaN, exponent, excess decimals, overflow, invalid counts and tampered totals never debit',()=>{
  const data=state(),before=structuredClone(data);
  for(const amount of ['NaN','Infinity','1e3','-1','0','0.0000001','01','9007199254.740992',NaN,0.1]) {
    assert.throws(()=>buildPacketDraft(data,'group-one',{kind:'equal',amount,count:1}));
  }
  for(const count of [0,-1,NaN,1.5,'2.0','101',5])assert.throws(()=>buildPacketDraft(data,'group-one',{kind:'equal',amount:'1',count}));
  assert.throws(()=>buildPacketDraft(data,'group-one',{kind:'equal',amount:'9007199254.740991',count:2}),/总金额/);
  const draft=buildPacketDraft(data,'group-one',{kind:'equal',amount:'0.1',count:2});
  assert.throws(()=>createDemoPacket(data,'group-one',{...draft,totalUnits:400000},NOW),/修改/);
  assert.throws(()=>createDemoPacket(data,'group-one',{...draft,amount:'0.2'},NOW),/总额/);
  assert.throws(()=>createDemoPacket(data,'group-one',{...draft,totalUnits:NaN},NOW));
  assert.deepEqual(data,before);
});

test('direct packets require one actual friend and cannot be random, exclusive or self-directed',()=>{
  const data=state();
  for(const [chat,kind,count] of [['outsider','equal',1],['me','equal',1],['lin','random',1],['lin','exclusive',1],['lin','equal',2]]) {
    assert.throws(()=>buildPacketDraft(data,chat,{kind,amount:'0.1',count,recipientId:'lin'}));
  }
  const packet=send(data,{count:1},'lin');
  assert.deepEqual(packet.recipientIds,['lin']);assert.equal(packet.isGroup,false);
  assert.equal(packetStatus(packet,'me',NOW).code,'sent');
  assert.throws(()=>claimDemoPacket(data,packet,NOW),/不可领取/);
  assert.equal(claimDemoPacket(data,packet,NOW+1,'lin'),100000);
});

test('exclusive packets snapshot exactly one current non-sender group member',()=>{
  const data=state(),before=total(data);
  for(const recipientId of ['me','outsider','missing',''])assert.throws(()=>buildPacketDraft(data,'group-one',{kind:'exclusive',amount:'0.5',count:1,recipientId}),/群内/);
  assert.throws(()=>buildPacketDraft(data,'group-one',{kind:'exclusive',amount:'0.5',count:2,recipientId:'lin'}),/1 个/);
  const draft=buildPacketDraft(data,'group-one',{kind:'exclusive',amount:'0.5',count:1,recipientId:'lin',greeting:'生日快乐',cover:'birthday'});
  const packet=createDemoPacket(data,'group-one',draft,NOW).packet;
  assert.deepEqual(packet.recipientIds,['lin']);assert.equal(packet.totalUnits,500000);assert.equal(packet.cover,'birthday');
  assert.equal(packetStatus(packet,'ke',NOW).code,'ineligible');
  assert.throws(()=>claimDemoPacket(data,packet,NOW,'ke'));
  assert.throws(()=>claimDemoPacket(data,packet,NOW,'me'));
  assert.equal(claimDemoPacket(data,packet,NOW+1,'lin'),500000);
  assert.equal(total(data),before);
  const stale=buildPacketDraft(data,'group-one',{kind:'exclusive',amount:'0.1',count:1,recipientId:'ke'});
  data.groups[0].members=data.groups[0].members.filter(id=>id!=='ke');
  assert.throws(()=>createDemoPacket(data,'group-one',stale,NOW),/群内/);
});

test('group membership is fixed at sending and the group sender may claim once',()=>{
  const data=state(),before=total(data),packet=send(data,{count:4});
  assert.deepEqual(packet.recipientIds,['lin','ke','zhou','me']);
  data.groups[0].members=['outsider'];
  assert.equal(claimDemoPacket(data,packet,NOW+1),100000);
  assert.equal(packet.claims[0].timestamp,NOW+1);assert.equal(packet.claims[0].createdAt,NOW+1);
  assert.throws(()=>claimDemoPacket(data,packet,NOW+2),/不可领取/);
  assert.throws(()=>claimDemoPacket(data,packet,NOW+2,'outsider'),/不可领取/);
  assert.equal(claimDemoPacket(data,packet,NOW+2,'lin'),100000);
  assert.equal(packetStatus(packet,'me',NOW+3).code,'claimed');
  assert.equal(packetStatus(packet,'me',NOW+3).claimedUnits,100000);
  assert.equal(total(data),before);
});

test('random allocation reserves a minimum unit for every share and preserves total at boundaries',()=>{
  for(const random of [()=>0,()=>.5,()=>1-Number.EPSILON]) {
    const data=state(),before=total(data);
    const packet=createDemoPacket(data,'group-one',buildPacketDraft(data,'group-one',{kind:'random',amount:'0.100001',count:4}),NOW,random).packet;
    assert.ok(packet.allocations.every(n=>Number.isSafeInteger(n)&&n>=1));
    assert.equal(packet.allocations.reduce((a,b)=>a+b,0),100001);
    for(const user of ['ke','me','zhou','lin'])claimDemoPacket(data,packet,NOW+1,user);
    assert.equal(packetRemaining(packet),0);assert.equal(total(data),before);
  }
  const data=state(),before=structuredClone(data),draft=buildPacketDraft(data,'group-one',{kind:'random',amount:'0.1',count:3});
  for(const random of [()=>NaN,()=>1,()=>-.01])assert.throws(()=>createDemoPacket(data,'group-one',draft,NOW,random),/分配失败/);
  assert.deepEqual(data,before);
});

test('24-hour boundary rejects claims and refunds only the positive remaining amount once',()=>{
  const data=state(),before=total(data),packet=send(data,{amount:'0.1',count:3});
  claimDemoPacket(data,packet,NOW+1,'lin');
  assert.equal(settleExpired(data,NOW+PACKET_LIFETIME-1),false);
  assert.throws(()=>claimDemoPacket(data,packet,NOW+PACKET_LIFETIME,'ke'));
  assert.equal(packetStatus(packet,'me',NOW+PACKET_LIFETIME).code,'expired');
  assert.equal(settleExpired(data,NOW+PACKET_LIFETIME),true);
  assert.equal(packet.refundUnits,200000);assert.equal(packet.refundedAt,NOW+PACKET_LIFETIME);
  assert.equal(data.wallets.me,10*DEMO_UNIT-100000);
  assert.equal(packetStatus(packet,'me',NOW+PACKET_LIFETIME).code,'refunded');
  const balances=structuredClone(data.wallets);
  assert.equal(settleExpired(data,NOW+2*PACKET_LIFETIME),false);
  assert.deepEqual(data.wallets,balances);assert.equal(total(data),before);
});

test('fully claimed packets never become refunded, including historical zero-refund records',()=>{
  const data=state(),packet=send(data,{count:2});
  claimDemoPacket(data,packet,NOW+1,'lin');claimDemoPacket(data,packet,NOW+2,'ke');
  assert.equal(settleExpired(data,NOW+PACKET_LIFETIME),false);
  assert.equal(packet.refunded,undefined);assert.equal(packet.refundUnits,undefined);
  packet.refunded=true;packet.refundUnits=0;
  const status=packetStatus(packet,'lin',NOW+PACKET_LIFETIME);
  assert.equal(status.code,'completed');assert.equal(status.completed,true);assert.equal(status.refunded,false);
  assert.equal(status.claimedUnits,100000);assert.equal(settleExpired(data,NOW+2*PACKET_LIFETIME),false);
});

test('corrupt allocations, claims, refund amounts and detached packets cannot create credit',()=>{
  const mutations=[p=>{p.totalUnits++;},p=>{p.allocations[0]++;},p=>{p.allocations[0]=NaN;},p=>{p.claims=[{user:'ke',units:1}];},p=>{p.claims=[{user:'ke',units:100000},{user:'ke',units:100000}];},p=>{p.expiresAt++;},p=>{p.refunded=true;p.refundUnits=1;}];
  for(const mutate of mutations){
    const data=state(),packet=send(data),balances=structuredClone(data.wallets);mutate(packet);
    assert.equal(packetStatus(packet,'me',NOW+1).code,'invalid');
    assert.throws(()=>claimDemoPacket(data,packet,NOW+1));
    assert.equal(settleExpired(data,NOW+2*PACKET_LIFETIME),false);
    assert.deepEqual(data.wallets,balances);
  }
  const data=state(),packet=send(data);
  assert.throws(()=>claimDemoPacket(data,structuredClone(packet),NOW+1),/不可领取/);
});

test('claim and batch refund overflows fail before any in-memory balance changes',()=>{
  const data=state(),packet=send(data,{count:2});
  data.wallets.lin=Number.MAX_SAFE_INTEGER;
  const before=structuredClone(data);
  assert.throws(()=>claimDemoPacket(data,packet,NOW+1,'lin'),/超出/);
  assert.deepEqual(data,before);
  data.wallets.me=Number.MAX_SAFE_INTEGER;
  const beforeRefund=structuredClone(data);
  assert.throws(()=>settleExpired(data,NOW+PACKET_LIFETIME),/超出/);
  assert.deepEqual(data,beforeRefund);
});

test('old integer-unit drafts and incoming time-only claim records remain compatible',()=>{
  const data=state();
  const packet=createDemoPacket(data,'group-one',{totalUnits:300000,count:3,kind:'equal',greeting:'旧草稿'},NOW).packet;
  assert.equal(packet.amountUnits,100000);assert.equal(packet.amount,'0.1');
  delete packet.amountUnits;delete packet.amount;
  packet.claims.push({user:'lin',units:100000,time:'10:30'});data.wallets.lin+=100000;
  assert.equal(packetStatus(packet,'lin',NOW+1).code,'claimed');
  assert.equal(claimDemoPacket(data,packet,NOW+2),100000);
  assert.equal(settleExpired(data,NOW+PACKET_LIFETIME),true);
  assert.equal(packet.refundUnits,100000);
});
