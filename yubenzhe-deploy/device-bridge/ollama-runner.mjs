import http from 'node:http';
import {Readable} from 'node:stream';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {redactAIChannelText} from './codex-runner.mjs';

export const OLLAMA_ORIGIN='http://127.0.0.1:11434';
const ROUTES=new Set(['/api/tags','/api/show','/api/generate']);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const messages={AI_OLLAMA_UNAVAILABLE:'没有核验到本机 Ollama 服务。',AI_OLLAMA_MODEL_REQUIRED:'请在电脑设置中选择已安装的本地模型。',AI_OLLAMA_MODEL_UNVERIFIED:'所选模型未通过本地模型核验，当前不能执行。',AI_PROVIDER_FILES_UNSUPPORTED:'这个本地模型仅支持文字对话，不读取附件或执行文件。',AI_OUTPUT_LIMIT:'本地模型输出过长，已停止接收。',AI_CANCELLED:'已停止等待并取消本次本地模型响应。',AI_TIMEOUT:'本地模型响应超时，已停止等待。',AI_LEASE_EXPIRED:'授权心跳中断，已停止等待本地模型响应。',AI_REVOKED:'设备授权已撤销，已停止接收模型响应。',AI_EXECUTION_FAILED:'本地模型未返回可核验的完整回复。'};
const message=code=>messages[code]||messages.AI_EXECUTION_FAILED;
export const validLocalModel=model=>typeof model==='string'&&model.trim()===model&&model.length<=128&&/^([a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(:[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(model)&&!/cloud/i.test(model);

// Native http.request does not consult OLLAMA_HOST or HTTP(S)_PROXY. No caller
// can choose the host, port or route; redirects are never followed.
export function loopbackOllamaFetch(url,{method='GET',headers,body,signal}={}){
 if(typeof url!=='string'||!ROUTES.has(url.slice(OLLAMA_ORIGIN.length))||!url.startsWith(OLLAMA_ORIGIN))return Promise.reject(fail('AI_OLLAMA_UNAVAILABLE',message('AI_OLLAMA_UNAVAILABLE')));
 return new Promise((resolve,reject)=>{
  const request=http.request({hostname:'127.0.0.1',port:11434,path:url.slice(OLLAMA_ORIGIN.length),method,headers,signal},response=>resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers})));
  request.once('error',reject);request.end(body);
 });
}
async function json(fetchImpl,route,{body,signal,max=1024*1024}={}){
 const response=await fetchImpl(OLLAMA_ORIGIN+route,{method:body?'POST':'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
 if(signal?.aborted){await response.body?.cancel().catch(()=>{});throw fail('AI_CANCELLED',message('AI_CANCELLED'));}
 if(!response.ok||response.redirected||!response.body){await response.body?.cancel().catch(()=>{});throw fail('AI_OLLAMA_UNAVAILABLE',message('AI_OLLAMA_UNAVAILABLE'));}
 const reader=response.body.getReader(),chunks=[];let count=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>max)throw fail('AI_OUTPUT_LIMIT',message('AI_OUTPUT_LIMIT'));chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function remoteMetadata(value,depth=0){
 if(!value||typeof value!=='object')return false;if(depth>12)return true;
 return Object.entries(value).some(([key,item])=>/remote[_-]?(?:host|model)|cloud/i.test(key)||remoteMetadata(item,depth+1));
}
export async function inspectOllama({model,fetchImpl=loopbackOllamaFetch,signal}={}){
 if(!validLocalModel(model))throw fail('AI_OLLAMA_MODEL_REQUIRED',message('AI_OLLAMA_MODEL_REQUIRED'));
 const tags=await json(fetchImpl,'/api/tags',{signal});
 if(!Array.isArray(tags.models)||tags.models.length>1000)throw fail('AI_OLLAMA_MODEL_UNVERIFIED',message('AI_OLLAMA_MODEL_UNVERIFIED'));
 const matches=tags.models.filter(item=>item?.name===model);
 const entry=matches[0];
 if(matches.length!==1||remoteMetadata(entry)||entry.model&&entry.model!==model||!Number.isSafeInteger(entry.size)||entry.size<=0||typeof entry.digest!=='string'||!/^(?:sha256:)?[a-f0-9]{64}$/i.test(entry.digest)||entry.details?.format!=='gguf')throw fail('AI_OLLAMA_MODEL_UNVERIFIED',message('AI_OLLAMA_MODEL_UNVERIFIED'));
 const info=await json(fetchImpl,'/api/show',{body:{model},signal});
 if(remoteMetadata(info)||info.details?.format!=='gguf'||typeof info.model_info?.['general.architecture']!=='string'||!Number.isSafeInteger(info.model_info?.['general.parameter_count'])||info.model_info['general.parameter_count']<=0||!Array.isArray(info.capabilities)||!info.capabilities.includes('completion'))throw fail('AI_OLLAMA_MODEL_UNVERIFIED',message('AI_OLLAMA_MODEL_UNVERIFIED'));
 return {model,digest:entry.digest};
}
export async function createOllamaRunner({workspace,model,fetchImpl=loopbackOllamaFetch,maxTaskMs=120000}={}){
 if(typeof workspace!=='string'||!path.isAbsolute(workspace)||!validLocalModel(model))throw fail('AI_OLLAMA_MODEL_REQUIRED',message('AI_OLLAMA_MODEL_REQUIRED'));
 const cwd=await realpath(workspace);if(!(await stat(cwd)).isDirectory()||path.parse(cwd).root===cwd)throw fail('AI_STARTUP_PATH','本地模型需要明确的工作目录。');
 if(!Number.isSafeInteger(maxTaskMs)||maxTaskMs<1||maxTaskMs>600000)throw fail('AI_STARTUP_TIMEOUT','本地模型时限无效。');
 let active=null;
 async function loginStatus(){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{await inspectOllama({model,fetchImpl,signal:controller.signal});return {code:'ready'};}catch{return {code:'error'};}finally{clearTimeout(timer);}}
 function run({taskId,prompt,promptSuffix='',timeoutMs=maxTaskMs,signal,onEvent=()=>{}}={}){
  if(active)throw fail('AI_BUSY','当前电脑已有一个 AI 任务。');
  if(typeof taskId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId)||typeof prompt!=='string'||!prompt.trim()||prompt.length>8000||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>600000)throw fail('AI_TASK_INVALID','本地模型任务参数无效。');
  if(promptSuffix)throw fail('AI_PROVIDER_FILES_UNSUPPORTED',message('AI_PROVIDER_FILES_UNSUPPORTED'));
  if(signal?.aborted)throw fail('AI_CANCELLED',message('AI_CANCELLED'));
  const controller=new AbortController();let terminal=false,resolveDone,timer;
  const done=new Promise(resolve=>resolveDone=resolve);
  const finish=(kind,code,text)=>{if(terminal)return;terminal=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(active===job)active=null;const event={kind,code,text};onEvent(event);resolveDone(event);};
  const cancel=code=>{if(terminal)return;controller.abort();const reason=messages[code]?code:'AI_CANCELLED';finish('failed',reason,message(reason));};
  const abort=()=>cancel('AI_CANCELLED');
  const job={taskId,done,cancel};active=job;signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>cancel('AI_TIMEOUT'),Math.min(timeoutMs,maxTaskMs));timer.unref?.();
  void (async()=>{
   try{
    await inspectOllama({model,fetchImpl,signal:controller.signal});if(terminal)return;
    onEvent({kind:'progress',code:'AI_RUNNING',text:'电脑上的本地模型正在生成文字建议，不执行文件或命令。'});
    const result=await json(fetchImpl,'/api/generate',{body:{model,prompt,stream:false,think:false,keep_alive:'1m',options:{num_predict:1024,num_ctx:4096}},signal:controller.signal,max:256*1024});
    if(terminal)return;
    if(result.done!==true||result.model!==model||typeof result.response!=='string'||!result.response.trim()||result.response.length>48000||remoteMetadata(result))throw fail('AI_EXECUTION_FAILED',message('AI_EXECUTION_FAILED'));
    const text=redactAIChannelText(result.response);
    for(let offset=0;offset<text.length;offset+=2000){if(terminal)return;onEvent({kind:'message',itemId:'ollama_'+offset,text:text.slice(offset,offset+2000)});}
    finish('completed','AI_COMPLETED','本地模型已回复，仅提供文字建议，未执行文件或命令。');
   }catch(error){if(!terminal)finish('failed',messages[error.code]?error.code:'AI_EXECUTION_FAILED',message(error.code));}
  })();
  return job;
 }
 return {configuration:{workspace:cwd,model},loginStatus,run,get busy(){return Boolean(active);},cancel:code=>active?.cancel(code),async close(){if(active){const job=active;job.cancel('AI_CANCELLED');await job.done;}}};
}
