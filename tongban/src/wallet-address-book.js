import {normalizePublicAddress} from './wallet-compatibility.js';

export const ADDRESS_BOOK_KEY='ybz.wallet.address-book.v1';
export const ADDRESS_BOOK_LOCK=ADDRESS_BOOK_KEY+':write';
const fail=(message,code)=>Object.assign(new Error(message),{code});
const keys=(input,allowed)=>input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>allowed.includes(k));
function text(value,max,required=false){
 if(typeof value!=='string'||Array.from(value.trim()).length>max||/[\u0000-\u001f\u007f]/.test(value)||required&&!value.trim())throw fail(required?'请填写 1–40 字备注名。':'备注最多 160 字，不能含控制字符。','ADDRESS_BOOK_FIELD');
 return value.trim();
}
export function createWalletAddressBook({storage,makeId=()=>crypto.randomUUID(),locks=globalThis.navigator?.locks}={}){
 function local(){try{return storage??globalThis.localStorage;}catch{throw fail('无法访问本机地址簿，请检查存储权限。','ADDRESS_BOOK_STORAGE');}}
 function load(){
  let raw;try{raw=local().getItem(ADDRESS_BOOK_KEY);}catch{throw fail('无法读取本机地址簿，请检查存储权限。','ADDRESS_BOOK_STORAGE');}
  if(raw===null)return {version:1,entries:[]};
  try{
   if(typeof raw!=='string'||raw.length>100000)throw Error();
   const data=JSON.parse(raw);if(!keys(data,['version','entries'])||data.version!==1||!Array.isArray(data.entries)||data.entries.length>100)throw Error();
   const ids=new Set(),addresses=new Set();
   const entries=data.entries.map(row=>{
    if(!keys(row,['id','name','address','note','revision'])||typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,64}$/.test(row.id)||!Number.isSafeInteger(row.revision)||row.revision<1)throw Error();
    const entry={id:row.id,name:text(row.name,40,true),address:normalizePublicAddress(row.address),note:text(row.note,160),revision:row.revision};
    if(ids.has(entry.id)||addresses.has(entry.address))throw Error();ids.add(entry.id);addresses.add(entry.address);return entry;
   });return {version:1,entries};
  }catch{throw fail('本机地址簿数据无法读取，原有记录已保留，未覆盖。','ADDRESS_BOOK_CORRUPT');}
 }
  function write(entries){try{local().setItem(ADDRESS_BOOK_KEY,JSON.stringify({version:1,entries}));}catch{throw fail('地址簿未保存，请检查本机存储空间与权限。','ADDRESS_BOOK_STORAGE');}}
  function list(){return load().entries;}
  function isWritable(){return typeof locks?.request==='function';}
  async function mutate(operation){
   if(!isWritable())throw fail('当前设备暂不支持安全保存地址簿，请在转账页手动填写收款地址。','ADDRESS_BOOK_READ_ONLY');
   // Every instance and tab uses the same origin-scoped lock. The entire read,
   // revision check and write must run inside it, not only the final setItem.
   return locks.request(ADDRESS_BOOK_LOCK,{mode:'exclusive'},operation);
  }
  async function save(input,{id=null,revision}={}){
   if(!keys(input,['name','address','note']))throw fail('地址簿只接受备注名、公开地址和备注。','ADDRESS_BOOK_FIELD');
   const entry={name:text(input.name,40,true),address:normalizePublicAddress(input.address),note:text(input.note??'',160)};
   return mutate(()=>{
  const rows=list(),index=id===null?-1:rows.findIndex(r=>r.id===id),old=rows[index];
   if(id!==null&&(!old||revision!==old.revision))throw fail('这条记录已改变，请重新打开后编辑。','ADDRESS_BOOK_CHANGED');
   if(old&&old.revision===Number.MAX_SAFE_INTEGER)throw fail('这条记录的修改次数已达上限，原有记录已保留。','ADDRESS_BOOK_LIMIT');
  if(rows.some(r=>r.address===entry.address&&r.id!==id))throw fail('这个地址已经保存在本机地址簿中。','ADDRESS_BOOK_DUPLICATE');
  if(!old&&rows.length>=100)throw fail('最多保存 100 个地址，请先移除不需要的记录。','ADDRESS_BOOK_LIMIT');
  const next={id:old?.id??makeId(),...entry,revision:old?old.revision+1:1};
  if(typeof next.id!=='string'||!/^[-a-zA-Z0-9]{1,64}$/.test(next.id)||rows.some(r=>r.id===next.id&&r!==old))throw fail('无法创建地址记录，请重试。','ADDRESS_BOOK_ID');
   if(old)rows[index]=next;else rows.push(next);write(rows);return {...next};
   });
  }
  async function remove(id,revision){return mutate(()=>{const rows=list(),row=rows.find(r=>r.id===id);if(!row||row.revision!==revision)throw fail('这条记录已改变，请重新打开后删除。','ADDRESS_BOOK_CHANGED');write(rows.filter(r=>r.id!==id));});}
  return Object.freeze({list,save,remove,isWritable});
}
