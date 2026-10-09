'use strict';
// Renderer chooses a model and text, never an address, command, path, or credentials.
const BASE = 'http://127.0.0.1:11434';
const validModel = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(name) && !name.includes('..') && !name.includes('://') && !/(?:[-:]cloud)(?:$|:)/i.test(name);
const remote = value => !!(value?.remote_host || value?.remote_model || value?.details?.remote_host || value?.details?.remote_model);
async function boundedJson(response, limit) {
  if (!response.ok || response.redirected || !response.body) throw Error('本地模型服务暂不可用，请检查 Ollama。');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw Error('本地模型返回内容过大，请缩短任务。'); chunks.push(Buffer.from(value)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
function createLocalAI({ fetchImpl = globalThis.fetch, statusTimeout = 5000, generationTimeout = 120000 } = {}) {
  let active = null;
  async function request(route, { body, signal, limit = 1024 * 1024 } = {}) {
    const response = await fetchImpl(`${BASE}${route}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal, headers: body ? {'Content-Type':'application/json'} : {}, ...(body ? {body:JSON.stringify(body)} : {}) });
    return boundedJson(response, limit);
  }
  async function models(signal) {
    const data = await request('/api/tags', {signal});
    if (!Array.isArray(data.models)) throw Error('Ollama 模型列表无法读取。');
    return data.models.filter(m=>validModel(m.name) && !remote(m) && Number.isSafeInteger(m.size) && m.size>0).slice(0,100).map(m=>({name:m.name,sizeBytes:m.size}));
  }
  async function status() {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),statusTimeout);
    try { return {available:true,models:await models(controller.signal)}; }
    catch { return {available:false,models:[],error:'没有连接到本机 Ollama。请先安装并打开 Ollama，再下载一个本地模型。'}; }
    finally { clearTimeout(timer); }
  }
  async function generate(value) {
    if (!value || !validModel(value.model) || typeof value.prompt!=='string' || !value.prompt.trim() || value.prompt.length>6000 || typeof value.requestId!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value.requestId)) throw Error('请选择本地模型，并填写不超过 6000 字的提示词。');
    if (active) throw Error('已有本地任务运行中，请先完成或取消。');
    const task={id:value.requestId,controller:new AbortController(),cancelled:false};active=task;
    const timer=setTimeout(()=>task.controller.abort(),generationTimeout);
    try {
      const installed=await models(task.controller.signal);
      if(!installed.some(m=>m.name===value.model))throw Error('这个模型没有安装在本机，请刷新列表后选择。');
      const info=await request('/api/show',{body:{model:value.model},signal:task.controller.signal});
      if(remote(info))throw Error('当前入口仅运行本地模型，请选择非云端模型。');
      if(task.controller.signal.aborted)throw Error('cancelled');
      const data=await request('/api/generate',{body:{model:value.model,prompt:value.prompt.trim(),stream:false,think:false,keep_alive:'1m',options:{num_predict:512,num_ctx:4096}},signal:task.controller.signal,limit:128*1024});
      if(task.controller.signal.aborted)throw Error('cancelled');
      if(data.done!==true || typeof data.response!=='string' || !data.response.trim())throw Error('本地模型没有返回完整内容，请换一个模型后重试。');
      return {text:data.response,model:value.model,local:true};
    } catch(error) {
      if(task.controller.signal.aborted) throw Error(task.cancelled?'本地任务已取消。':'本地任务超时，请缩短提示词或选择更小的模型。');
      if(error instanceof Error && /[\u4e00-\u9fff]/.test(error.message))throw error;
      throw Error('本地模型运行失败，请检查 Ollama 和所选模型后重试。');
    } finally { clearTimeout(timer); if(active===task)active=null; }
  }
  function cancel(id) { if(active && (id===undefined || id===active.id)){active.cancelled=true;active.controller.abort();return true;} return false; }
  return {status,generate,cancel};
}
module.exports={createLocalAI};
