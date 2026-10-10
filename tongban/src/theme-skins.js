/* Three persistent device skins. Loaded after all component CSS. */
const STORAGE_KEY = 'ybz-theme';
const THEMES = Object.freeze([
 Object.freeze({id:'light',label:'白天'}),
 Object.freeze({id:'dark',label:'黑天'}),
 Object.freeze({id:'eyecare',label:'护眼'}),
]);
const normalize = id => THEMES.some(t=>t.id===id) ? id : 'light';
let currentTheme='light',persistent=true;
function getTheme(){return currentTheme;}
function isPersistent(){return persistent;}
function applyTheme(id){
 currentTheme=normalize(id);
 document.documentElement.dataset.theme=currentTheme;
 const meta=document.querySelector?.('meta[name="theme-color"]');
 if(meta&&typeof globalThis.getComputedStyle==='function'){
  const color=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if(color)meta.setAttribute('content',color);
 }
 window.dispatchEvent(new CustomEvent('ybz:theme-changed',{detail:{theme:currentTheme,persistent}}));
 return currentTheme;
}
function setTheme(id){
 const theme=normalize(id);
 try{localStorage.setItem(STORAGE_KEY,theme);persistent=true;}catch{persistent=false;}
 return applyTheme(theme);
}
function cycleTheme(){const i=THEMES.findIndex(t=>t.id===currentTheme);return setTheme(THEMES[(i+1)%THEMES.length].id);}
let saved;
try{saved=localStorage.getItem(STORAGE_KEY);}catch{persistent=false;}
applyTheme(saved);
window.addEventListener('storage',event=>{
 if(event.key===STORAGE_KEY||event.key===null){persistent=true;applyTheme(event.newValue);}
});
window.YBZTheme=Object.freeze({THEMES,getTheme,setTheme,cycleTheme,isPersistent});
export {THEMES,getTheme,setTheme,cycleTheme,isPersistent};
