const decode=s=>String(s??'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
// Minimal DOM that parses actual rendered controls and dispatches their handlers.
export class AccountElement {
 constructor(tag='root',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.disabled=false;this.isConnected=true;this.value=attrs.value??'';this.defaultValue=this.value;this.dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));this.textContent='';}
 get elements(){return Object.fromEntries(this.querySelectorAll('input').map(n=>[n.attrs.name,n]));}
 reset(){this.querySelectorAll('input').forEach(n=>n.value=n.defaultValue);}
 set innerHTML(html){this.html=html;this.replaceChildren();const stack=[this];for(const token of html.match(/<[^>]+>|[^<]+/g)??[]){if(token.startsWith('</')){stack.pop();continue;}if(!token.startsWith('<')){stack.at(-1).textContent+=decode(token);continue;}const match=/^<([\w-]+)([^>]*)>/.exec(token);if(!match)continue;const attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],decode(m[2]??'')]));const n=new AccountElement(match[1],attrs);stack.at(-1).children.push(n);if(!['input','img','hr','br'].includes(match[1]))stack.push(n);}}
 replaceChildren(){const detach=n=>{n.isConnected=false;n.children.forEach(detach);};this.children.forEach(detach);this.children=[];}
 matches(selector){if(selector[0]==='.')return (this.attrs.class??'').split(' ').includes(selector.slice(1));if(selector[0]==='['){const m=/^\[([^=\]]+)(?:=([^\]]+))?\]$/.exec(selector);return m&&Object.hasOwn(this.attrs,m[1])&&(m[2]===undefined||this.attrs[m[1]]===m[2].replace(/^"|"$/g,''));}return this.tag===selector;}
 querySelectorAll(selector){const selectors=selector.split(',');return this.children.flatMap(n=>[...(selectors.some(s=>n.matches(s))?[n]:[]),...n.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
