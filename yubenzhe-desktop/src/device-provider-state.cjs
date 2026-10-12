'use strict';
// Only public capability metadata crosses into the isolated setup renderer.
// Executable paths and probe output belong to the main/utility processes.
function publicProviders(value){
 if(!Array.isArray(value))return [];
 return value.slice(0,16).filter(item=>item&&typeof item.id==='string'&&item.id.trim()===item.id&&/^[a-z][a-z0-9-]{1,23}$/.test(item.id)).map(item=>({
  id:item.id,name:typeof item.name==='string'?item.name.slice(0,60):item.id,
  installed:item.installed===true,loggedIn:typeof item.loggedIn==='boolean'?item.loggedIn:null,
  version:typeof item.version==='string'?item.version.slice(0,80):null,
  reason:typeof item.reason==='string'?item.reason.slice(0,240):'',
  executionSupported:item.installed===true&&item.executionSupported===true,
  executionMode:item.installed===true&&['tools','chat-only'].includes(item.executionMode)&&item.executionSupported===true?item.executionMode:'disabled'
 }));
}
function normalizeOllamaModel(value){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||value.trim()!==value||value.length>128||!/^([a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(:[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(value)||/cloud/i.test(value))throw Error('只能选择已安装的本机 Ollama 模型名称，不能填写网址、文件路径或云端模型。');
 return value;
}
module.exports={publicProviders,normalizeOllamaModel};
