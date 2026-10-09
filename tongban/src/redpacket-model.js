// Local tBNB demo model only. No network, persistence, keys or real money.
export const DEMO_UNIT = 1_000_000;
export const PACKET_LIFETIME = 24 * 60 * 60 * 1000;
const MAX_UNITS = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_RECIPIENTS = 100;
const fail = message => { throw new Error(message); };
const safeUnits = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000 - PACKET_LIFETIME;
const uid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const timeLabel = timestamp => new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(timestamp));

export function demoAmount(units = 0) {
  if (!safeUnits(units)) return '0';
  const value = BigInt(units);
  const whole = value / BigInt(DEMO_UNIT);
  const fraction = (value % BigInt(DEMO_UNIT)).toString().padStart(6,'0').replace(/0+$/,'');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parseAmount(value) {
  if (typeof value !== 'string' || value.length > 24 || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value.trim())) fail('请输入有效金额，最多保留 6 位小数');
  const [whole, fraction = ''] = value.trim().split('.');
  const units = BigInt(whole) * BigInt(DEMO_UNIT) + BigInt(fraction.padEnd(6,'0'));
  if (units < 1n || units > MAX_UNITS) fail('红包金额超出可用范围');
  return Number(units);
}

function parseCount(value) {
  if (typeof value === 'string') {
    if (!/^[1-9]\d{0,2}$/.test(value)) fail('请输入有效的红包个数');
    value = Number(value);
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_RECIPIENTS) fail('红包个数需为 1–100');
  return value;
}

function balance(data, id) {
  if (!validId(id) || !data?.wallets || !Object.hasOwn(data.wallets,id) || !safeUnits(data.wallets[id])) fail('演示平台余额异常');
  return data.wallets[id];
}

function recipientsFor(data, chatId, kind, recipientId) {
  if (!validId(chatId) || !Array.isArray(data?.friends) || !Array.isArray(data?.groups)) fail('红包接收人无效');
  const group = data.groups.find(g => g.id === chatId);
  if (!group) {
    if (chatId === 'me' || !data.friends.includes(chatId) || kind !== 'equal') fail('单聊红包只能发给当前好友');
    balance(data,chatId);
    return { isGroup:false, recipientIds:[chatId] };
  }
  if (!Array.isArray(group.members)) fail('群成员名单无效');
  const snapshot = [...new Set([...group.members,'me'])];
  if (snapshot.length > MAX_RECIPIENTS || snapshot.some(id => !validId(id))) fail('群成员名单无效或超过 100 人');
  snapshot.forEach(id => balance(data,id));
  if (kind === 'exclusive') {
    if (!validId(recipientId) || recipientId === 'me' || !snapshot.includes(recipientId)) fail('专属红包需指定群内其他成员');
    return { isGroup:true, recipientIds:[recipientId] };
  }
  return { isGroup:true, recipientIds:snapshot };
}

function draftCopy(input) {
  const greeting = input.greeting == null || input.greeting === '' ? '恭喜发财，大吉大利' : input.greeting;
  const cover = input.cover == null || input.cover === '' ? 'classic' : input.cover;
  if (typeof greeting !== 'string' || greeting.trim().length > 80) fail('祝福语最多 80 个字符');
  if (typeof cover !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(cover)) fail('红包封面无效');
  return { greeting:greeting.trim() || '恭喜发财，大吉大利', cover };
}

export function buildPacketDraft(data, chatId, input = {}) {
  const kind = input.kind || 'equal';
  if (!['equal','random','exclusive'].includes(kind)) fail('红包类型无效');
  const { recipientIds,isGroup } = recipientsFor(data,chatId,kind,input.recipientId);
  const count = parseCount(input.count ?? 1);
  if ((!isGroup || kind === 'exclusive') && count !== 1) fail('定向红包只能发 1 个');
  if (count > recipientIds.length) fail('红包个数不能超过接收人数');
  const amountUnits = parseAmount(input.amount);
  const total = BigInt(amountUnits) * BigInt(kind === 'equal' ? count : 1);
  if (total > MAX_UNITS) fail('红包总金额超出可用范围');
  if (total < BigInt(count)) fail('每个红包至少为 0.000001 tBNB');
  return {
    kind, amount:demoAmount(amountUnits), amountUnits, totalUnits:Number(total), count,
    ...(kind === 'exclusive' ? { recipientId:input.recipientId } : {}), ...draftCopy(input),
  };
}

// Inspect financial fields before any mutation; malformed historic records cannot pay out.
function inspect(packet) {
  if (!packet || !['equal','random','exclusive'].includes(packet.kind) || !safeUnits(packet.totalUnits) || packet.totalUnits < 1 || !Number.isInteger(packet.count) || packet.count < 1 || packet.count > MAX_RECIPIENTS) fail('红包金额或份数无效');
  if (!validId(packet.sender) || !validTime(packet.createdAt) || packet.expiresAt !== packet.createdAt + PACKET_LIFETIME) fail('红包发送人与有效期无效');
  if (!Array.isArray(packet.recipientIds) || !packet.recipientIds.length || packet.recipientIds.length > MAX_RECIPIENTS || packet.recipientIds.some(id => !validId(id)) || new Set(packet.recipientIds).size !== packet.recipientIds.length || packet.count > packet.recipientIds.length) fail('红包接收人快照无效');
  if (!Array.isArray(packet.allocations) || packet.allocations.length !== packet.count || packet.allocations.some(value => !safeUnits(value) || value < 1)) fail('红包份额无效');
  if (packet.allocations.reduce((sum,value) => sum + BigInt(value),0n) !== BigInt(packet.totalUnits)) fail('红包金额与分配份额不一致');
  if (packet.kind === 'equal' && packet.allocations.some(value => value !== packet.allocations[0])) fail('普通红包每份金额需相同');
  if (!packet.isGroup && (packet.kind !== 'equal' || packet.count !== 1 || packet.recipientIds.length !== 1 || packet.recipientIds[0] === packet.sender)) fail('单聊红包接收人无效');
  if (packet.kind === 'exclusive' && (!packet.isGroup || packet.count !== 1 || packet.recipientIds.length !== 1 || packet.recipientIds[0] !== packet.recipientId || packet.recipientId === packet.sender)) fail('专属红包接收人无效');
  if (packet.amountUnits !== undefined && (!safeUnits(packet.amountUnits) || BigInt(packet.amountUnits) * BigInt(packet.kind === 'equal' ? packet.count : 1) !== BigInt(packet.totalUnits))) fail('红包金额已被修改');
  if (packet.amount !== undefined && parseAmount(packet.amount) !== (packet.amountUnits ?? (packet.kind === 'equal' ? packet.totalUnits / packet.count : packet.totalUnits))) fail('红包输入金额与总额不一致');
  if (!Array.isArray(packet.claims) || packet.claims.length > packet.count) fail('红包领取记录无效');
  const users = new Set();
  let received = 0n;
  for (let i=0;i<packet.claims.length;i++) {
    const claim = packet.claims[i];
    if (!claim || !packet.recipientIds.includes(claim.user) || users.has(claim.user) || claim.units !== packet.allocations[i] || (!packet.isGroup && claim.user === packet.sender)) fail('红包领取记录与份额不一致');
    const timestamp = claim.timestamp ?? claim.createdAt;
    if (timestamp !== undefined && (!validTime(timestamp) || timestamp < packet.createdAt || timestamp >= packet.expiresAt)) fail('红包领取时间无效');
    users.add(claim.user);
    received += BigInt(claim.units);
  }
  const remainingUnits = Number(BigInt(packet.totalUnits)-received);
  if (packet.refunded && (!safeUnits(packet.refundUnits) || packet.refundUnits !== remainingUnits)) fail('红包退款金额与剩余份额不一致');
  return { remainingUnits, receivedUnits:Number(received), completed:remainingUnits===0 && packet.claims.length===packet.count };
}

export function ledgerPackets(data) {
  if (!data?.chats || typeof data.chats !== 'object') return [];
  return Object.values(data.chats).filter(Array.isArray).flat().filter(message => {
    if (message?.type !== 'packet') return false;
    try { inspect(message.packet); return true; } catch { return false; }
  });
}

export function packetRemaining(packet) {
  try { return inspect(packet).remainingUnits; } catch { return 0; }
}

export function packetStatus(packet, user = 'me', timestamp = Date.now()) {
  const invalid = { code:'invalid',label:'红包数据异常',canClaim:false,remainingUnits:0,claimedUnits:0,claimedCount:0,count:0,ownClaim:null,completed:false,expired:false,refunded:false,isSender:false,isGroup:false,isExclusive:false,refundUnits:0 };
  try {
    if (!validId(user) || !validTime(timestamp)) return invalid;
    const meta = inspect(packet);
    const ownClaim = packet.claims.find(claim => claim.user === user) || null;
    const expired = timestamp >= packet.expiresAt;
    // Old versions wrongly set refunded=true/refundUnits=0 after all shares were claimed.
    const refunded = !meta.completed && packet.refunded === true && packet.refundUnits > 0;
    const isSender = packet.sender === user;
    const eligible = packet.recipientIds.includes(user) && !(isSender && !packet.isGroup);
    let code = meta.completed ? 'completed' : refunded ? 'refunded' : expired ? 'expired' : ownClaim ? 'claimed' : !eligible ? (isSender ? 'sent' : 'ineligible') : 'available';
    if (timestamp < packet.createdAt && !meta.completed && !refunded) code = 'invalid';
    const labels = { completed:'已领完',refunded:'已退回',expired:'已过期',claimed:'已领取',sent:'待领取',ineligible:'不可领取',available:'待领取',invalid:'红包尚未生效' };
    return { code,label:labels[code],canClaim:code==='available',remainingUnits:meta.remainingUnits,claimedUnits:ownClaim?.units || 0,
      claimedCount:packet.claims.length,count:packet.count,ownClaim,completed:meta.completed,expired,refunded,isSender,
      isGroup:packet.isGroup===true,isExclusive:packet.kind==='exclusive',refundUnits:refunded?packet.refundUnits:0 };
  } catch { return invalid; }
}

export function createDemoPacket(data, chatId, input, timestamp = Date.now(), random = Math.random) {
  if (!validTime(timestamp) || typeof random !== 'function') fail('红包创建参数无效');
  if (!input || !['equal','random','exclusive'].includes(input.kind)) fail('红包类型无效');
  const p = { kind:input.kind,totalUnits:input.totalUnits,count:parseCount(input.count),...draftCopy(input) };
  if (!safeUnits(p.totalUnits) || p.totalUnits < p.count) fail('红包金额或份数无效');
  const route = recipientsFor(data,chatId,p.kind,input.recipientId);
  if (p.count > route.recipientIds.length || ((!route.isGroup || p.kind==='exclusive') && p.count!==1)) fail('红包金额、份数或接收人无效');
  if (p.kind==='equal' && p.totalUnits%p.count!==0) fail('普通红包每份金额需相同');
  p.amountUnits = p.kind==='equal' ? p.totalUnits/p.count : p.totalUnits;
  if (input.amountUnits !== undefined && input.amountUnits !== p.amountUnits) fail('红包金额已被修改');
  if (input.amount !== undefined && parseAmount(input.amount) !== p.amountUnits) fail('红包输入金额与总额不一致');
  p.amount = demoAmount(p.amountUnits);
  if (p.kind==='exclusive') p.recipientId = input.recipientId;
  const available = balance(data,'me');
  if (available < p.totalUnits) fail('演示平台余额不足');
  if (!data.chats || typeof data.chats !== 'object' || (data.chats[chatId] !== undefined && !Array.isArray(data.chats[chatId]))) fail('聊天记录异常');
  let remaining = p.totalUnits;
  const allocations = [];
  for (let i=0;i<p.count;i++) {
    const left = p.count-i;
    let share;
    if (left===1) share=remaining;
    else if(p.kind==='equal') share=p.amountUnits;
    else {
      const draw=random();
      if(!Number.isFinite(draw) || draw<0 || draw>=1) fail('随机红包分配失败，请重试');
      const upper=Math.min(remaining-left+1,Number(BigInt(remaining)*2n/BigInt(left)));
      share=1+Math.min(upper-1,Math.floor(draw*upper));
    }
    allocations.push(share);
    remaining-=share;
  }
  const packet = { ...p,sender:'me',...route,allocations,claims:[],createdAt:timestamp,expiresAt:timestamp+PACKET_LIFETIME };
  inspect(packet);
  const message = { id:uid(),type:'packet',from:'me',packet,time:timeLabel(timestamp),createdAt:timestamp };
  // All validation and allocation finishes before the first balance mutation.
  data.wallets.me=available-p.totalUnits;
  data.chats[chatId] ||= [];
  data.chats[chatId].push(message);
  return message;
}

export function claimDemoPacket(data, packet, timestamp = Date.now(), user = 'me') {
  if (!ledgerPackets(data).some(message => message.packet===packet) || !packetStatus(packet,user,timestamp).canClaim) fail('当前红包不可领取');
  const units = packet.allocations[packet.claims.length];
  const available = balance(data,user);
  const updated = BigInt(available)+BigInt(units);
  if (updated>MAX_UNITS) fail('演示平台余额超出可用范围');
  packet.claims.push({ user,units,time:timeLabel(timestamp),timestamp,createdAt:timestamp });
  data.wallets[user]=Number(updated);
  return units;
}

export function settleExpired(data, timestamp = Date.now()) {
  if (!validTime(timestamp)) fail('红包结算时间无效');
  const refunds=[];
  const walletUpdates=new Map();
  for(const message of ledgerPackets(data)) {
    const p=message.packet;
    const remaining=packetRemaining(p);
    if (p.refunded || timestamp<p.expiresAt || remaining<=0) continue;
    const available=walletUpdates.get(p.sender) ?? BigInt(balance(data,p.sender));
    const updated=available+BigInt(remaining);
    if(updated>MAX_UNITS) fail('演示平台余额超出可用范围');
    walletUpdates.set(p.sender,updated);
    refunds.push({packet:p,units:remaining});
  }
  for(const [id,value] of walletUpdates)data.wallets[id]=Number(value);
  for(const {packet,units} of refunds){packet.refunded=true;packet.refundUnits=units;packet.refundedAt=timestamp;}
  return refunds.length>0;
}
