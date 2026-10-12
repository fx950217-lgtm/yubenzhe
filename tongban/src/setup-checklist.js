// Official entry pages checked on 2026-10-12. Registration requirements vary.
export const SETUP_CATEGORIES=Object.freeze([
 {id:'email',title:'邮箱',items:[
  {name:'Gmail',url:'https://accounts.google.com/signup',note:'手机号要求：通常可选，风控可能要求手机验证。注册难度：按官方验证流程完成。'},
  {name:'Outlook',url:'https://outlook.com/',note:'手机号要求：可选择邮箱方式注册，额外验证以页面为准。注册难度：按官方验证流程完成。'},
  {name:'Proton Mail',url:'https://proton.me/mail',note:'手机号要求：可能使用验证码、备用邮箱或短信验证，选项以页面为准。注册难度：按官方验证流程完成。'},
  {name:'Zoho Mail',url:'https://www.zoho.com/mail/',note:'手机号要求：个人邮箱注册需要手机接收验证码。注册难度：按官方验证流程完成。'}]},
 {id:'browser',title:'浏览器',items:[
  {name:'Chrome',url:'https://www.google.com/chrome/',note:'从官方页面选择与你的系统兼容的版本。'},
  {name:'Firefox',url:'https://www.firefox.com/',note:'从官方页面选择与你的系统兼容的版本。'},
  {name:'Edge',url:'https://www.microsoft.com/edge/',note:'电脑可能已经安装，请先查看应用列表。'}]},
 {id:'social',title:'社交软件',items:[
  {name:'Telegram',url:'https://telegram.org/apps',note:'按官方流程注册与登录；可用性与验证方式以当地及服务商说明为准。'},
  {name:'WhatsApp',url:'https://www.whatsapp.com/download/',note:'按官方流程注册与登录；可用性与验证方式以当地及服务商说明为准。'},
  {name:'Discord',url:'https://discord.com/download',note:'按官方流程注册与登录；可用性与验证方式以当地及服务商说明为准。'}]},
 {id:'ybz',title:'YBZ 必备',items:[
  {name:'YBZ 电脑版安装工具',url:'./install.html',note:'Windows dev.11 本机审核版，尚未上传公网。安装后在电脑显示机器码，由手机输入配对。安装包不包含 Codex，需你本人安装并登录。'},
  {name:'YBZ 手机端',url:'./install.html',note:'手机可先使用网页版。安卓现有安装包仍为 dev.8；iOS 本轮未更新。'},
  {name:'Node.js',url:'https://nodejs.org/en/download',note:'独立脚本或开发时可选安装。YBZ 电脑版已内置运行环境，无需额外安装 Node.js。'}]}
]);
export function setupChecklistHtml(){return SETUP_CATEGORIES.map(category=>'<section class="wh-setup-category" data-setup-category="'+category.id+'"><div class="wh-section wh-catalog-head"><h2>'+category.title+'</h2></div><div class="wh-catalog">'+category.items.map(item=>'<article class="wh-option"><h3>'+item.name+'</h3><p>'+item.note+'</p><a class="wh-link" href="'+item.url+'" '+(item.url.startsWith('https:')?'target="_blank" rel="noopener noreferrer nofollow"':'')+'>'+(item.url.startsWith('https:')?'打开官方页面':'查看安装版本与状态')+'</a></article>').join('')+'</div></section>').join('');}
