'use strict';
const ORIGIN = 'https://66.42.56.29';
const MAX_BODY = 1024 * 1024, MAX_RESPONSE = 16 * 1024 * 1024;
const OUTER_COOKIE = 'ybz_front_session';
function pathAllowed(path, method) {
 if (typeof path !== 'string' || path.length > 4096 || !['GET','POST'].includes(method)) return false;
 if (path === '/api/chain-preview/config') return method === 'GET';
 return /^\/api\/social\/[A-Za-z0-9_/-]+(?:\?[^#\s]*)?$/.test(path) && !path.split('?')[0].includes('//');
}
function validateRequest(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请求无效。');
 const {path,method='GET',body,headers={}}=input;
 if (!pathAllowed(path,method) || body!==undefined && (method!=='POST'||typeof body!=='string'||Buffer.byteLength(body)>MAX_BODY)) throw Error('请求路径、方式或大小无效。');
 if (!headers || typeof headers!=='object' || Array.isArray(headers)) throw Error('请求头无效。');
 const safe={};
 for(const [name,value] of Object.entries(headers)){const key=name.toLowerCase();if(!['content-type','authorization','if-none-match','accept'].includes(key)||typeof value!=='string'||value.length>1024||/[\r\n]/.test(value))throw Error('请求头无效。');safe[key]=value;}
 if(method==='POST'&&safe['content-type']!=='application/json')throw Error('操作只接受 JSON。');
 return {path,method,body,headers:safe};
}
function createInternalPreview({fetcher=globalThis.fetch,nativeOrigin='yubenzhe://app'}={}) {
 let cookies=new Map(),generation=0,loginBusy=false;
 const expired=()=>Object.assign(Error('请重新输入内部访问凭证。'),{code:'INTERNAL_PREVIEW_REQUIRED'});
 function clear(){generation++;cookies.clear();}
 function merge(response){for(const line of response.headers.getSetCookie?.()||[]){const pair=line.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),value=pair.slice(at+1);if(name!==OUTER_COOKIE||at<1||/[;\r\n]/.test(value))continue;if(!value||/max-age=0(?:;|$)/i.test(line))cookies.delete(name);else cookies.set(name,value);}}
 async function bytes(response,max=MAX_RESPONSE){const chunks=[];let size=0;for await(const chunk of response.body||[]){size+=chunk.length;if(size>max)throw Error('服务器响应过大。');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
 async function call(path,{method='GET',headers={},body}={},max=MAX_RESPONSE){const rev=generation;let response;try{response=await fetcher(ORIGIN+path,{method,headers:{...headers,Origin:path.startsWith('/api/social/')?nativeOrigin:ORIGIN,...(cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{})},body,redirect:'manual',signal:AbortSignal.timeout(25000)});}catch{throw Error('连接未完成，请检查网络后重试。');}const buffer=await bytes(response,max);if(rev!==generation)throw expired();merge(response);return {response,buffer};}
 return {
  status:async()=>({authenticated:cookies.has(OUTER_COOKIE)}),
  async login(input){if(loginBusy)throw Error('正在验证，请稍候。');if(!input||typeof input.username!=='string'||typeof input.password!=='string'||input.username.length<1||input.username.length>40||input.password.length<1||input.password.length>256)throw Error('请输入内部账号和访问密码。');loginBusy=true;clear();try{const {response}=await call('/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:input.username,password:input.password}).toString()},128*1024);if(response.status!==303||response.headers.get('location')!=='/'||!cookies.has(OUTER_COOKIE)){clear();throw Error(response.status===429?'尝试过于频繁，请稍后再试。':'内部账号或访问密码不正确。');}return {authenticated:true};}finally{loginBusy=false;}},
  async logout(){try{if(cookies.has(OUTER_COOKIE))await call('/logout',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:''},128*1024);}finally{clear();}return {authenticated:false};},
  async request(input){const value=validateRequest(input);if(!cookies.has(OUTER_COOKIE))return {status:401,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({code:'INTERNAL_PREVIEW_REQUIRED',error:'请先登录内部预览。'})).toString('base64')};const {response,buffer}=await call(value.path,value);if(response.status>=300&&response.status<400&&response.status!==304)throw Error('服务器返回了非预期跳转，请更新客户端。');if(response.status===401){try{if(JSON.parse(buffer.toString()).code==='INTERNAL_PREVIEW_REQUIRED')clear();}catch{}}const headers={};for(const key of ['content-type','content-disposition','etag']){const v=response.headers.get(key);if(v)headers[key]=v;}return {status:response.status,headers,bodyBase64:buffer.toString('base64')};},
  clear,
 };
}
module.exports={ORIGIN,MAX_BODY,MAX_RESPONSE,pathAllowed,validateRequest,createInternalPreview};
