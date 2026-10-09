const KEY='tongban.profile.v1';
export const PROFILE_AVATARS=['🌱','☀️','🍊','🌊','🪴','✨','🐱','🌻'];
const defaultProfile=()=>({version:1,nickname:'我的愚笨者',bio:'和熟悉的人，分享每一天。',avatar:'🌱',localId:'本机体验档案'});
export function getLocalProfile(storage=globalThis.localStorage){
  let raw;try{raw=storage.getItem(KEY)}catch{throw new Error('无法读取本机资料，请检查浏览器存储权限。')}
  if(!raw)return defaultProfile();
  try{const p=JSON.parse(raw);if(p.version!==1||typeof p.nickname!=='string'||!p.nickname.trim()||p.nickname.length>24||typeof p.bio!=='string'||p.bio.length>80||!PROFILE_AVATARS.includes(p.avatar))throw new Error();return {...defaultProfile(),nickname:p.nickname,bio:p.bio,avatar:p.avatar};}catch{throw new Error('本机资料无法读取，原始数据已保留。')}
}
export function saveLocalProfile(input,storage=globalThis.localStorage){
  getLocalProfile(storage);
  const nickname=String(input.nickname??'').trim(),bio=String(input.bio??'').trim(),avatar=input.avatar;
  if(!nickname||nickname.length>24)throw new Error('昵称请填写 1–24 个字符。');
  if(bio.length>80)throw new Error('个人签名最多 80 个字符。');
  if(!PROFILE_AVATARS.includes(avatar))throw new Error('请选择一个头像。');
  const next={...defaultProfile(),nickname,bio,avatar};
  try{storage.setItem(KEY,JSON.stringify(next))}catch{throw new Error('资料没有保存，请检查本机存储空间后重试。')}
  return next;
}
