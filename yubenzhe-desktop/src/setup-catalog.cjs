'use strict';
// Reviewed official landing pages, 2026-10-12. No installer, login automation,
// provider credentials, or arbitrary renderer-supplied URL is accepted here.
const categories=[
 {id:'email',title:'邮箱',items:[
  {id:'gmail',name:'Gmail',url:'https://accounts.google.com/signup',note:'手机号要求：通常可选，风控可能要求手机验证。注册难度：按官方验证流程完成。',sourceUrl:'https://support.google.com/accounts/answer/114129'},
  {id:'outlook',name:'Outlook',url:'https://outlook.com/',note:'手机号要求：可选择邮箱方式注册，额外验证以页面为准。注册难度：按官方验证流程完成。',sourceUrl:'https://support.microsoft.com/en-US/accounts-billing/manage/how-to-create-a-new-microsoft-account'},
  {id:'proton',name:'Proton Mail',url:'https://proton.me/mail',note:'手机号要求：可能使用验证码、备用邮箱或短信验证，选项以页面为准。注册难度：按官方验证流程完成。',sourceUrl:'https://proton.me/support/human-verification'},
  {id:'zoho',name:'Zoho Mail',url:'https://www.zoho.com/mail/',note:'手机号要求：个人邮箱注册需要手机接收验证码。注册难度：按官方验证流程完成。',sourceUrl:'https://www.zoho.com/mail/help/login-to-zoho.html'}]},
 {id:'browser',title:'浏览器',items:[
  {id:'chrome',name:'Chrome',url:'https://www.google.com/chrome/',note:'从官方页面选择适合电脑系统的版本。'},
  {id:'firefox',name:'Firefox',url:'https://www.firefox.com/',note:'从官方页面选择适合电脑系统的版本。'},
  {id:'edge',name:'Edge',url:'https://www.microsoft.com/edge/',note:'电脑可能已安装，请先查看应用列表。'}]},
 {id:'social',title:'社交软件',items:[
  {id:'telegram',name:'Telegram',url:'https://telegram.org/apps',note:'由你本人按官方流程完成安装与账号验证。'},
  {id:'whatsapp',name:'WhatsApp',url:'https://www.whatsapp.com/download/',note:'由你本人按官方流程完成安装与账号验证。'},
  {id:'discord',name:'Discord',url:'https://discord.com/download',note:'由你本人按官方流程完成安装与账号验证。'}]},
 {id:'ai',title:'AI 工具',items:[
  {id:'codex',providerId:'codex',name:'Codex',url:'https://github.com/openai/codex',note:'电脑上的编码智能体。安装与登录由本人完成；是否可执行以设备检测为准。'},
  {id:'claude',providerId:'claude',name:'Claude',url:'https://claude.com/download',note:'电脑上的对话智能体。软件安装不等于设备任务通道已接通。'},
  {id:'workb',providerId:'workb',name:'WorkB / WorkBuddy',url:'https://www.workbuddy.ai/',note:'电脑上的工作助手。软件安装不等于设备任务通道已接通。'},
  {id:'ollama',providerId:'ollama',name:'Ollama',url:'https://ollama.com/download',note:'电脑上的本地模型。模型下载和运行需你在电脑上确认。'}]},
 {id:'ybz',title:'YBZ 必备',items:[
  {id:'ybz-connector',name:'YBZ 电脑连接器',note:'已包含在当前电脑版中。使用上方机器码连接手机；设备仅本人可见。'},
  {id:'nodejs',name:'Node.js',url:'https://nodejs.org/en/download',note:'独立脚本或开发时可选安装。YBZ 电脑版已内置运行环境，无需额外安装 Node.js。'}]}
];
for(const category of categories){for(const item of category.items)Object.freeze(item);Object.freeze(category.items);Object.freeze(category);}
const SETUP_CATALOG=Object.freeze(categories);
function setupToolUrl(id){
 if(typeof id!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(id))throw Error('请选择清单中的官方入口。');
 const item=SETUP_CATALOG.flatMap(category=>category.items).find(tool=>tool.id===id);
 if(!item?.url)throw Error('这个项目无需打开外部页面。');
 const url=new URL(item.url);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw Error('官方入口配置无效。');
 return url.href;
}
module.exports={SETUP_CATALOG,setupToolUrl};
