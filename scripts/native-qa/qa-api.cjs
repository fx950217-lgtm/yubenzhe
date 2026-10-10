'use strict';
const http=require('node:http');
const MAX_BYTES=1024*1024,LOCAL_ORIGIN='yubenzhe://app',UPSTREAM_HOST='127.0.0.1',UPSTREAM_PORT=18914;
const SOCIAL_ORIGIN='https://66.42.56.29';
function pathFromUrl(value,origins=[LOCAL_ORIGIN,SOCIAL_ORIGIN]) {
 if(typeof value!=='string'||value.length>2048||/[\\\s#]/.test(value))return null;
 const origin=origins.find(x=>value.startsWith(x+'/api/social/'));
 if(!origin)return null;
 const path=value.slice(origin.length),pathname=path.split('?')[0];
 if(!/^\/api\/social\/[A-Za-z0-9_/-]*$/.test(pathname)||pathname.includes('//')||pathname.includes('..'))return null;
 if(path.slice(pathname.length)&&!/^\?[A-Za-z0-9_%=&.+-]{0,512}$/.test(path.slice(pathname.length)))return null;
 return path;
}
function isLocalApiUrl(value){return pathFromUrl(value,[LOCAL_ORIGIN])!==null;}
function localAvatar(value){const path=pathFromUrl(value,[SOCIAL_ORIGIN]);return path&&/^\/api\/social\/avatars\/[a-f0-9-]{36}$/i.test(path)?LOCAL_ORIGIN+path:null;}
function isProductionSocial(value){try{return new URL(value).origin===SOCIAL_ORIGIN&&new URL(value).pathname.startsWith('/api/social/');}catch{return false;}}
function validate(input){
 if(!input||!['GET','POST'].includes(input.method)||!isLocalApiUrl(input.url))throw Error('QA request denied');
 const body=input.body||'';if(typeof body!=='string'||Buffer.byteLength(body)>MAX_BYTES||input.method==='GET'&&body)throw Error('QA request body denied');
 if(body){try{JSON.parse(body);}catch{throw Error('QA accepts only JSON request bodies');}}
 const headers={Host:'localhost:18914',Origin:LOCAL_ORIGIN,'Accept':'application/json','Cache-Control':'no-cache'};
 for(const [name,value] of Object.entries(input.headers||{})){const key=name.toLowerCase();if(!['authorization','content-type','if-none-match'].includes(key))continue;if(typeof value!=='string'||/[\r\n]/.test(value)||value.length>512)throw Error('QA header denied');if(key==='authorization'&&!/^Bearer [-_A-Za-z0-9]{43}$/.test(value))throw Error('QA token shape denied');if(key==='content-type'&&value!=='application/json')throw Error('QA content type denied');headers[key]=value;}
 if(input.method==='POST')headers['content-type']='application/json';
 return {method:input.method,path:pathFromUrl(input.url,[LOCAL_ORIGIN]),body,headers};
}
function requestLocal(input,transport=http.request){
 const checked=validate(input);
 return new Promise((resolve,reject)=>{
  const request=transport({hostname:UPSTREAM_HOST,port:UPSTREAM_PORT,method:checked.method,path:checked.path,headers:checked.headers},response=>{const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){response.destroy();reject(Error('QA response too large'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>{const status=response.statusCode||502;if(status>=300&&status<400&&status!==304){reject(Error('QA API redirects are not permitted'));return;}const headers={};for(const key of ['content-type','etag','cache-control'])if(typeof response.headers[key]==='string')headers[key]=response.headers[key];resolve({status,headers,body:Buffer.concat(chunks)});});});
  request.setTimeout(15000,()=>request.destroy(Error('Local QA API timed out')));request.on('error',reject);request.end(checked.body||undefined);
 });
}
async function forward(request){
 try{const result=await requestLocal({url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body:request.method==='POST'?await request.text():''});return new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,headers:result.headers});}
 catch{return new Response(JSON.stringify({error:'本机验收服务未连接，请确认电脑本地服务与 USB 通道。',code:'LOCAL_QA_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json'}});}
}
module.exports={LOCAL_ORIGIN,UPSTREAM_HOST,UPSTREAM_PORT,MAX_BYTES,pathFromUrl,isLocalApiUrl,localAvatar,isProductionSocial,validate,requestLocal,forward};
