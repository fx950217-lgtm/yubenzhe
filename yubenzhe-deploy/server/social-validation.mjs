import { AdminError } from '../upstream/admin/core.mjs';
export const AVATARS=['🌱','☀️','🍊','🌊','🪴','✨','🐱','🌻'];
export function fail(status,code,message){throw new AdminError(status,code,message);}
export function fields(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail(400,'INVALID_FIELDS','输入内容包含不支持的字段。');}
export function text(value,max,label,min=0){if(typeof value!=='string')fail(400,'INVALID_TEXT',label+'格式不正确。');const clean=value.trim();if(clean.length<min||clean.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean))fail(400,'INVALID_TEXT',label+'长度或格式不正确。');return clean;}
export function reservedId(id){if(/(\d)\1{3,}/.test(id)||/^(\d{2,3})\1+$/.test(id))return true;if(id.length>=6){const steps=Array.from(id.slice(1),(v,i)=>Number(v)-Number(id[i]));if(steps.every(s=>s===1)||steps.every(s=>s===-1))return true;}return ['100000','100001','100100','520520','521521','1314520','5201314'].includes(id);}
export function userId(value,allowReserved=false){if(typeof value!=='string')fail(400,'INVALID_ID','用户 ID 需要 6–16 位数字。');const id=value.trim();if(!/^\d{6,16}$/.test(id))fail(400,'INVALID_ID','用户 ID 需要 6–16 位数字。');if(!allowReserved&&reservedId(id))fail(409,'ID_RESERVED','这个 ID 属于系统保留靓号，请换一个号码。');return id;}
export function password(value){if(typeof value!=='string'||!/^\d{6}$/.test(value))fail(400,'INVALID_PASSWORD','账号密码需要 6 位数字。');return value;}
export function imageData(src,max=512*1024){
 if(typeof src!=='string'||src.length>Math.ceil(max/3)*4+40)fail(400,'INVALID_IMAGE','图片过大或格式无效。');
 const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);if(!m)fail(400,'INVALID_IMAGE','仅支持 JPG、PNG、WebP 图片。');
 const bytes=Buffer.from(m[2],'base64');if(bytes.toString('base64')!==m[2]||bytes.length>max||bytes.length<20)fail(400,'INVALID_IMAGE','图片内容无效。');
 let width=0,height=0;
 if(m[1]==='image/png'&&bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.subarray(-8,-4).toString('ascii')==='IEND'){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
 if(m[1]==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217){let p=2;while(p+4<bytes.length){if(bytes[p++]!==255)break;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===218||marker===217)break;if(marker===1||(marker>=208&&marker<=215))continue;const n=bytes.readUInt16BE(p);if(n<2||p+n>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&n>=8){height=bytes.readUInt16BE(p+3);width=bytes.readUInt16BE(p+5);break;}p+=n;}}
 if(m[1]==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length){const kind=bytes.toString('ascii',12,16);if(kind==='VP8X'&&bytes.length>=30&&!(bytes[20]&2)){width=bytes.readUIntLE(24,3)+1;height=bytes.readUIntLE(27,3)+1;}else if(kind==='VP8L'&&bytes.length>=25&&bytes[20]===47){width=1+bytes[21]+((bytes[22]&63)<<8);height=1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10);}else if(kind==='VP8 '&&bytes.length>=30&&bytes.subarray(23,26).equals(Buffer.from([157,1,42]))){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}}
 if(!width||!height||width>8192||height>8192||width*height>16000000)fail(400,'INVALID_IMAGE','图片尺寸或内容无效。');return {bytes,mime:m[1],width,height};
}
