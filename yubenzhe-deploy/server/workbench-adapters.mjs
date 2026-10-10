import { createHash } from 'node:crypto';

export const PRICE_VERSION='local-file-trial-2026-10-10';
export const STEP_COST=7000n;
export const MARGIN_BPS=3000n;
export const FILE_LIMIT=256*1024;
export const RETENTION_MS=30*24*60*60*1000;
export function priceMicro(cost,{roundCent=false}={}) {
 const value=BigInt(cost); if(value<0n)throw new Error('Negative cost');
 const priced=(value*10000n+(10000n-MARGIN_BPS)-1n)/(10000n-MARGIN_BPS);
 return roundCent&&priced>0n?((priced+9999n)/10000n)*10000n:priced;
}
export function parseCSV(text) {
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw new Error('CSV 引号位置不正确。');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(field);field='';closed=false;
   if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}continue;
  }
  if(closed&&c!==' '&&c!=='\t')throw new Error('CSV 引号后的内容无效。');
  if(!closed)field+=c;
 }
 if(quoted)throw new Error('CSV 存在未闭合引号。');
 if(field||row.length||closed)rows.push([...row,field]);
 if(rows.length>10000)throw new Error('本地测试每个文件最多 10000 行。');
 return rows;
}
function csvCell(value){const t=String(value),safe=/^[\s]*[=+@-]/.test(t)?"'"+t:t;return '"'+safe.replaceAll('"','""')+'"';}
function csv(rows){return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
export function validateFile(name,bytes){
 if(typeof name!=='string'||name.length<1||name.length>100||/[\\/\x00-\x1f]/.test(name)||! /\.(csv|txt|md|json)$/i.test(name))throw new Error('仅支持 CSV、TXT、Markdown、JSON 文本文件。');
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>FILE_LIMIT)throw new Error('文件必须为 1 字节至 256 KiB。');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
 if(/-----BEGIN .*PRIVATE KEY-----|"(?:privateKey|private_key|mnemonic|encryptedJson)"\s*:|(?:^|\n)(?:[A-Z_]*API_KEY|PRIVATE_KEY|MNEMONIC)\s*=/i.test(text)||/^(?:wallet|keystore|\.env)(?:[.-]|$)/i.test(name))throw new Error('请勿上传钱包密钥、助记词、凭证或配置文件。');
 return {text,sha256:createHash('sha256').update(bytes).digest('hex')};
}
// This adapter parses files deterministically. It never executes instructions,
// launches a shell/browser, contacts a provider, or pretends to be a model.
export function processLocalFiles(files,operation='analyze'){
 if(!['analyze','deduplicate'].includes(operation))throw new Error('不支持的文件操作。');
 const outputs=[],report=['本地文件测试成果','执行器：确定性文件解析（非语言模型）','没有调用云模型或远程桌面；没有对外发送文件。',''];
 for(const file of files){const {text}=validateFile(file.name,Buffer.from(file.content));
  const lines=text.split(/\r?\n/),base=file.name.replace(/\.[^.]+$/,'');
  report.push('文件：'+file.name,'大小：'+file.content.length+' 字节','行数：'+lines.length);
  if(/\.csv$/i.test(file.name)){
   const rows=parseCSV(text);const header=rows[0]||[];let body=rows.slice(1).filter(row=>row.some(v=>v.trim()));
   const original=body.length;
   if(operation==='deduplicate'){const seen=new Set();body=body.filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true;});}
   report.push('列数：'+header.length,'数据行：'+original,'空值：'+body.reduce((s,r)=>s+r.filter(x=>!x.trim()).length,0),'宽度不一致行：'+body.filter(row=>row.length!==header.length).length,'移除重复行：'+(original-body.length));
   header.forEach((column,index)=>{const values=body.map(row=>row[index]??'').filter(v=>v.trim());if(values.length&&values.every(v=>/^-?\d+(\.\d+)?$/.test(v)&&Number.isFinite(Number(v)))){const sum=values.reduce((s,v)=>s+Number(v),0);if(Number.isFinite(sum))report.push(column+'：数值合计 '+sum+'（文件统计，不用于资产记账）');}});
   outputs.push({name:base+'-整理.csv',mime:'text/csv; charset=utf-8',content:Buffer.from(csv([header,...body]))});
  }else if(/\.json$/i.test(file.name)){
   const parsed=JSON.parse(text);report.push('JSON 类型：'+(Array.isArray(parsed)?'数组 ('+parsed.length+' 项)':typeof parsed));
   outputs.push({name:base+'-格式化.json',mime:'application/json; charset=utf-8',content:Buffer.from(JSON.stringify(parsed,null,2)+'\n')});
  }else{
   const cleaned=operation==='deduplicate'?[...new Set(lines)]:lines;
   report.push('字符数：'+text.length,'移除重复行：'+(lines.length-cleaned.length));
   outputs.push({name:base+'-整理.txt',mime:'text/plain; charset=utf-8',content:Buffer.from(cleaned.join('\n'))});
  }
  report.push('');
 }
 outputs.push({name:'文件整理报告.txt',mime:'text/plain; charset=utf-8',content:Buffer.from(report.join('\n'))});
 return outputs;
}
