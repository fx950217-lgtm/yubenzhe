// Official entry pages checked on 2026-10-12. Registration requirements vary.
const registration='手机号要求：视地区与风控而定；注册难度：依官方验证流程，以官方注册页为准。';
export const SETUP_CATEGORIES=Object.freeze([
 {id:'email',title:'邮箱',items:[
  {name:'Gmail',url:'https://accounts.google.com/signup',note:registration},
  {name:'Outlook',url:'https://www.microsoft.com/microsoft-365/outlook/email-and-calendar-software-microsoft-outlook',note:registration},
  {name:'Proton Mail',url:'https://proton.me/mail',note:registration},
  {name:'Zoho Mail',url:'https://www.zoho.com/mail/',note:registration}]},
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
  {name:'YBZ 手机端',url:'./install.html',note:'手机可先使用网页版。安卓现有安装包仍为 dev.8；iOS 本轮未更新。'}]}
]);
export function setupChecklistHtml(){return SETUP_CATEGORIES.map(category=>'<section class="wh-setup-category" data-setup-category="'+category.id+'"><div class="wh-section wh-catalog-head"><h2>'+category.title+'</h2></div><div class="wh-catalog">'+category.items.map(item=>'<article class="wh-option"><h3>'+item.name+'</h3><p>'+item.note+'</p><a class="wh-link" href="'+item.url+'" '+(item.url.startsWith('https:')?'target="_blank" rel="noopener noreferrer nofollow"':'')+'>'+(category.id==='ybz'?'查看安装版本与状态':'打开官方页面')+'</a></article>').join('')+'</div></section>').join('');}
