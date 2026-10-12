const LIMIT=20*1024*1024,CHUNK=196608;
const keyPromises=new Map();
const hex=b=>[...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('');
const b64=b=>{let s='';const a=new Uint8Array(b);for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s);};
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const filename=s=>(String(s||'file').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/^\.+|[. ]+$/g,'').slice(0,100)||'file');
function defaultKeyStore(){
 const db=new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return reject(Error('浏览器不支持本机文件密钥保存。'));const r=indexedDB.open('ybz-device-files-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('无法打开本机文件密钥。'));});
 return {async get(id){const d=await db;return new Promise((resolve,reject)=>{const r=d.transaction('keys').objectStore('keys').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('无法读取本机文件密钥。'));});},async put(id,value){const d=await db;return new Promise((resolve,reject)=>{const t=d.transaction('keys','readwrite');t.objectStore('keys').put(value,id);t.oncomplete=resolve;t.onerror=()=>reject(Error('无法保存本机文件密钥。'));});}};
}
export function createAIChannelFiles({client,ownerKey,keyStore,cryptoImpl=globalThis.crypto,saveDownload}={}){
 if(!ownerKey)throw Error('请先登录。');
 let store=keyStore,active=true;
 const check=()=>{if(!active||client.getProfile()?.userId!==ownerKey)throw Error('页面或账号已改变，文件操作已停止。');};
 const api=async(path,method='GET',input)=>{check();const r=await client.authenticatedRequest('ai-channel/files/'+path,{method,input});check();return r;};
 async function key(){
  check();store??=defaultKeyStore();let pending=keyStore?null:keyPromises.get(ownerKey);
  if(!pending){pending=(async()=>{let k=await store.get(ownerKey);if(!k){k=await cryptoImpl.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);await store.put(ownerKey,k);}return k;})();if(!keyStore){keyPromises.set(ownerKey,pending);pending.catch(()=>keyPromises.delete(ownerKey));}}
  return pending;
 }
 async function prepareReplyKey(){const k=await key();const der=await cryptoImpl.subtle.exportKey('spki',k.publicKey);check();return {publicKey:b64(der)};}
 return {
  cancel(){active=false;},
  prepareReplyKey,
  async upload(file,{deviceId,publicKey}){
   check();if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>LIMIT)throw Error('单文件大小须为1字节至20MB。');
   if(typeof publicKey!=='string'||publicKey.length>1024)throw Error('电脑文件通道尚未就绪。');
   const der=bytes(publicKey),recipient=await cryptoImpl.subtle.importKey('spki',der,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
   const aes=await cryptoImpl.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']),iv=cryptoImpl.getRandomValues(new Uint8Array(12));
   const raw=new Uint8Array(await file.arrayBuffer());if(raw.byteLength!==file.size)throw Error('文件大小发生变化，请重新选择。');
   const cipher=new Uint8Array(await cryptoImpl.subtle.encrypt({name:'AES-GCM',iv},aes,raw));raw.fill(0);
   const exported=new Uint8Array(await cryptoImpl.subtle.exportKey('raw',aes));
   const wrappedKey=b64(await cryptoImpl.subtle.encrypt({name:'RSA-OAEP'},recipient,exported));exported.fill(0);
   const envelope={version:1,algorithm:'RSA-OAEP-256+A256GCM',name:filename(file.name),size:file.size,iv:b64(iv),wrappedKey,keyId:hex(await cryptoImpl.subtle.digest('SHA-256',der)),cipherSha256:hex(await cryptoImpl.subtle.digest('SHA-256',cipher))};
   const result=await api('init','POST',{deviceId,requestId:cryptoImpl.randomUUID(),envelope});
   if(!result.file?.id||result.file.chunkSize!==CHUNK)throw Error('文件中转响应无效。');
   for(let index=0;index<Math.ceil(cipher.length/CHUNK);index++)await api(result.file.id+'/chunks/'+index,'POST',{data:b64(cipher.subarray(index*CHUNK,(index+1)*CHUNK))});
   return (await api(result.file.id+'/finish','POST',{})).file;
  },
  async download(file){
   check();const f=(await api(file.id)).file,e=f?.envelope;
   if(!e||e.version!==1||e.algorithm!=='RSA-OAEP-256+A256GCM'||!Number.isSafeInteger(e.size)||e.size<1||e.size>LIMIT||f.chunkSize!==CHUNK||f.chunkCount!==Math.ceil((e.size+16)/CHUNK))throw Error('加密文件信息无效。');
   const own=await prepareReplyKey();if(hex(await cryptoImpl.subtle.digest('SHA-256',bytes(own.publicKey)))!==e.keyId)throw Error('该成果只能由发送任务时的浏览器解密，请回到原设备下载。');
   const cipher=new Uint8Array(e.size+16);for(let i=0;i<f.chunkCount;i++){const r=await api(f.id+'/chunks/'+i);const part=bytes(r.data);if(part.length!==Math.min(CHUNK,cipher.length-i*CHUNK))throw Error('文件分片不完整。');cipher.set(part,i*CHUNK);}
   if(hex(await cryptoImpl.subtle.digest('SHA-256',cipher))!==e.cipherSha256)throw Error('加密文件校验失败。');
   const k=await key(),aesBytes=new Uint8Array(await cryptoImpl.subtle.decrypt({name:'RSA-OAEP'},k.privateKey,bytes(e.wrappedKey)));
   const aes=await cryptoImpl.subtle.importKey('raw',aesBytes,{name:'AES-GCM'},false,['decrypt']);aesBytes.fill(0);
   const plain=await cryptoImpl.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv)},aes,cipher);check();
   const name=filename(e.name),blob=new Blob([plain],{type:'application/octet-stream'});
   if(saveDownload){await saveDownload(blob,name);return {requested:true,name,size:plain.byteLength};}
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';
   try{document.body.append(a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
   return {requested:true,name,size:plain.byteLength};
  },
 };
}
