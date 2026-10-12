import { createHash } from 'node:crypto';
import { fail } from './social-validation.mjs';
import {INTERNAL_PREVIEW_SESSION} from './internal-preview.mjs';
import {DEFAULT_TRUSTED_PROXY_IPS,requestClientIP} from './request-client-ip.mjs';
export {parseTrustedProxyIPs} from './request-client-ip.mjs';
export const NATIVE_SOCIAL_ORIGINS=Object.freeze(['https://localhost','http://127.0.0.1:45931','yubenzhe://app']);
export async function handleSocialHTTP({request,response,url,publicURL,service,readBody,internalPreviewUser=null,pathPrefix='/api/social/',pathBase='',trustedProxyIPs=DEFAULT_TRUSTED_PROXY_IPS}){
 const origin=request.headers.origin||'',native=NATIVE_SOCIAL_ORIGINS.includes(origin),same=origin===publicURL.origin;
 const path=pathBase+url.pathname.slice(pathPrefix.length);
 const desktopRequest=path==='desktop'||path.startsWith('desktop/');
 const avatarPath=/^avatars\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path);
 const hasAvatarSuffix=Boolean(url.search||url.hash||String(request.url||'').includes('?')||String(request.url||'').includes('#'));
 const publicAvatar=request.method==='GET'&&avatarPath&&!hasAvatarSuffix;
 if(origin&&!same&&!native)fail(403,'ORIGIN_DENIED','不允许从这个来源访问账号服务。');
 if(native){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');response.setHeader('Access-Control-Expose-Headers','ETag');}
 if(request.method==='OPTIONS'){if(!native&&!same)fail(403,'ORIGIN_DENIED','请求来源无效。');response.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':desktopRequest?'Content-Type, Authorization, If-None-Match, X-Desktop-Proof':'Content-Type, Authorization, If-None-Match','Access-Control-Max-Age':'600'});response.end();return;}
 if(!['GET','POST'].includes(request.method))fail(405,'METHOD_NOT_ALLOWED','不支持此请求方式。');
 if(!origin&&request.headers['sec-fetch-site']==='cross-site'&&!publicAvatar)fail(403,'ORIGIN_DENIED','请求来源无效。');
 if(request.method==='POST'&&!same&&!native)fail(403,'ORIGIN_DENIED','修改操作需要有效的应用来源。');
 if(path.startsWith('avatars/')&&hasAvatarSuffix)fail(404,'AVATAR_NOT_FOUND','头像不存在。');
 if(!service)fail(503,'SOCIAL_UNAVAILABLE','账号服务暂不可用，请稍后重试。');
 let input={};if(request.method==='POST'){if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON_REQUIRED','操作仅接受 JSON。');try{input=JSON.parse(await readBody(request,800*1024));}catch(e){if(e.status)throw e;fail(400,'INVALID_JSON','请求内容无效。');}if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_JSON','请求内容无效。');}
 const bearer=/^Bearer ([-_A-Za-z0-9]{43})$/.exec(request.headers.authorization||'')?.[1];
 const cookie=String(request.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('ybz_social='))?.slice(11)||'';
  const ip=requestClientIP(request,trustedProxyIPs);
 const handled=await service.handle({method:request.method,path,input,query:Object.fromEntries(url.searchParams),token:bearer||cookie,ip,devicePeerIp:request.socket.remoteAddress||'unknown',...(internalPreviewUser?{internalPreviewSession:INTERNAL_PREVIEW_SESSION}:{}),userAgent:String(request.headers['user-agent']||'').slice(0,300),...(desktopRequest?{proof:request.headers['x-desktop-proof']}:{} )});
 const value=desktopRequest?handled.value:handled;
 const status=desktopRequest?(handled.status||200):200;
 if(value.token){const secure=publicURL.protocol==='https:'?'; Secure':'';response.setHeader('Set-Cookie','ybz_social='+value.token+'; Path=/api/social; HttpOnly; SameSite=Strict; Max-Age=2592000'+secure);if(!native)delete value.token;}
 if(path==='logout'||value.deleted===true||value.currentSessionRevoked===true)response.setHeader('Set-Cookie','ybz_social=; Path=/api/social; HttpOnly; SameSite=Strict; Max-Age=0'+(publicURL.protocol==='https:'?'; Secure':''));
 if(value.binary){if(value.downloadName)response.setHeader('Content-Disposition',"attachment; filename=\"download.txt\"; filename*=UTF-8''"+encodeURIComponent(value.downloadName).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()));response.writeHead(200,{'Content-Type':value.mime,'Content-Length':value.binary.length});response.end(value.binary);return;}
 const serialized=JSON.stringify(value),etag='"'+createHash('sha256').update(serialized).digest('hex')+'"';
 if(request.method==='GET'&&!desktopRequest){response.setHeader('ETag',etag);if(request.headers['if-none-match']===etag){response.writeHead(304);response.end();return;}}
 response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(serialized);
}
