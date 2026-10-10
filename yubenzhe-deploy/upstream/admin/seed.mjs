export const SEED_VERSION = 2;
export const COHORTS = Object.freeze([
  { id: 'newcomer', label: '入门体验者', count: 300, need: '场景假设：需要清楚的入口和首次操作指引' },
  { id: 'connector', label: '熟人联络者', count: 250, need: '场景假设：常用好友聊天、朋友圈和照片' },
  { id: 'organizer', label: '群组织者', count: 200, need: '场景假设：需要群管理、活动安排和记录' },
  { id: 'creator', label: '创作者与服务者', count: 150, need: '场景假设：需要清晰的服务申请与审核反馈' },
  { id: 'cautious', label: '谨慎资产使用者', count: 100, need: '场景假设：关注地址核对、账户区分与安全说明' },
]);
const BASE = Date.UTC(2026, 9, 1, 8);
const pad = number => String(number).padStart(4, '0');
const detail = values => ({ '数据性质': '合成测试样本，非真实用户或实际业务', ...values });
const entry = (kind, id, title, subtitle, index, values = {}) => ({ kind, id, title, subtitle, status: kind === 'reviews' ? 'pending' : kind === 'tickets' ? 'open' : 'active', version: 1, createdAt: BASE + index * 60000, segment: '', type: '', amount: null, currency: null, detail: detail({}), ...values });

export function createSeedRecords() {
  const records = [], names = ['清风', '小禾', '海盐', '阿蓝', '木木', '青柠', '小满', '山川', '橙子', '星河'];
  let number = 0;
  for (const cohort of COHORTS) for (let i = 0; i < cohort.count; i++) {
    const n = ++number;
    records.push(entry('users', `user-${pad(n)}`, `${names[(n - 1) % names.length]} ${pad(n)}`, `${cohort.label} · 合成用户`, n, {
      segment: cohort.id, status: n % 50 === 0 ? 'restricted' : 'active',
      detail: detail({ '样本编号': `U${pad(n)}`, '场景分组': cohort.label, '操作需求假设': cohort.need.replace('场景假设：', ''), '好友数': 3 + n % 48, '加入群数': 1 + n % 6, '身份认证': '未连接真实账号服务', '来源': '固定场景分布，不是用户调研结论' }),
    }));
  }
  const groupTypes = [['private', '好友小聚'], ['study', '一起学习'], ['activity', '周末活动'], ['project', '协作小组']];
  for (let n = 1; n <= 100; n++) {
    const [segment, label] = groupTypes[(n - 1) % 4];
    records.push(entry('groups', `group-${pad(n)}`, `${label} ${String(n).padStart(3, '0')}`, `${12 + n % 39} 位合成成员 · 测试群`, 1000 + n, {
      segment, status: n % 20 === 0 ? 'restricted' : 'active',
      detail: detail({ '群类型': label, '成员数量': 12 + n % 39, '群主样本': `user-${pad(n * 7)}`, '成员示例': Array.from({ length: 5 }, (_, i) => `user-${pad((n * 7 + i) % 1000 + 1)}`), '群公告': '熟人交流测试群，不向实际成员发送通知。', '举报摘要': n % 10 === 0 ? '测试举报：群公告重复发布；仅场景摘要，不包含私人聊天' : '此样本无待处理举报', '聊天隐私': '未读取或生成真实私聊内容' }),
    }));
  }
  const reviewTypes = [['provider', '服务商入驻'], ['bounty', '赏金任务'], ['meme', 'Meme 创建申请']];
  for (let n = 1; n <= 48; n++) {
    const [type, label] = reviewTypes[(n - 1) % reviewTypes.length], state = n <= 36 ? 'pending' : n <= 42 ? 'approved' : 'rejected';
    records.push(entry('reviews', `review-${pad(n)}`, `${label} ${String(n).padStart(3, '0')}`, `申请样本 user-${pad(n * 9)} · 未接通实际业务`, 1100 + n, {
      type, segment: type, status: state,
      detail: detail({ '申请类型': label, '申请用户': `user-${pad(n * 9)}`, '内容说明': type === 'provider' ? '提供设计、内容与社群协作服务的测试申请。' : type === 'bounty' ? '协作完成产品体验与资料整理的测试需求。' : '仅审核创建意向，不部署合约或发行代币。', '费用规则': '未收费；审核仅改变测试记录状态', '审核边界': '批准不创建真实服务、不产生转账、不部署合约' }),
    }));
  }
  const topics = ['钱包备份咨询', '转账记录核对', '好友申请说明', '群聊使用问题', '服务申请进度', '朋友圈内容举报'];
  for (let n = 1; n <= 40; n++) records.push(entry('tickets', `ticket-${pad(n)}`, `${topics[(n - 1) % topics.length]} ${String(n).padStart(3, '0')}`, `user-${pad(n * 13)} · 合成客服工单`, 1200 + n, { status: n <= 32 ? 'open' : 'resolved', type: ['wallet', 'transfer', 'social', 'group', 'service', 'report'][(n - 1) % topics.length], detail: detail({ '用户样本': `user-${pad(n * 13)}`, '问题描述': n % 6 === 0 ? '测试举报摘要：朋友圈重复推广内容，等待内部处理；不包含实际用户内容。' : '这是用于验证客服处理和审计流程的固定测试工单。', '优先级': n % 5 === 0 ? '高' : '普通', '沟通状态': '未向任何用户发送消息' }) }));
  return records;
}
