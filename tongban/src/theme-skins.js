/* Three actual skins, with an optional system-following preference. */
const STORAGE_KEY = 'ybz-theme';
const THEMES = Object.freeze([
 Object.freeze({id:'light',label:'白天'}),
 Object.freeze({id:'dark',label:'黑天'}),
 Object.freeze({id:'eyecare',label:'护眼'}),
]);
const normalize = id => id==='system'||THEMES.some(t=>t.id===id) ? id : 'light';
let currentTheme='light',preference='light',persistent=true,disposed=false,stopMedia=null,mediaQuery=null;
// Release an earlier controller if the shell is reinitialized in this document.
window.YBZTheme?.cleanup?.();
try{mediaQuery=window.matchMedia?.('(prefers-color-scheme: dark)')||null;}catch{}
function getTheme(){return currentTheme;}
function getPreference(){return preference;}
function isPersistent(){return persistent;}
function applyTheme(){
 currentTheme=preference==='system' ? (mediaQuery?.matches?'dark':'light') : preference;
 document.documentElement.dataset.theme=currentTheme;
 const meta=document.querySelector?.('meta[name="theme-color"]');
 if(meta&&typeof globalThis.getComputedStyle==='function'){
  const color=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if(color)meta.setAttribute('content',color);
 }
 window.dispatchEvent(new CustomEvent('ybz:theme-changed',{detail:{theme:currentTheme,preference,persistent}}));
 return currentTheme;
}
function onSystemChange(){
 if(!disposed&&preference==='system')applyTheme();
}
function syncMediaListener(){
 if(preference!=='system'||disposed){stopMedia?.();stopMedia=null;return;}
 if(stopMedia||!mediaQuery)return;
 if(typeof mediaQuery.addEventListener==='function'&&typeof mediaQuery.removeEventListener==='function'){
  try{mediaQuery.addEventListener('change',onSystemChange);stopMedia=()=>mediaQuery.removeEventListener('change',onSystemChange);return;}catch{}
 }
 // Safari and older Android WebViews expose only the legacy listener pair.
 if(typeof mediaQuery.addListener==='function'&&typeof mediaQuery.removeListener==='function'){
  try{mediaQuery.addListener(onSystemChange);stopMedia=()=>mediaQuery.removeListener(onSystemChange);}catch{}
 }
}
function applyPreference(id){
 preference=normalize(id);
 syncMediaListener();
 return applyTheme();
}
function setTheme(id){
 if(disposed)return currentTheme;
 const next=normalize(id);
 try{localStorage.setItem(STORAGE_KEY,next);persistent=true;}catch{persistent=false;}
 return applyPreference(next);
}
function cycleTheme(){const i=THEMES.findIndex(t=>t.id===currentTheme);return setTheme(THEMES[(i+1)%THEMES.length].id);}
function onStorage(event){
 if(disposed||event.key!==STORAGE_KEY&&event.key!==null)return;
 // sessionStorage events must never change this device's local preference.
 if(event.storageArea){try{if(event.storageArea!==localStorage)return;}catch{return;}}
 persistent=true;
 applyPreference(event.key===null?null:event.newValue);
}
function cleanup(){
 if(disposed)return;
 disposed=true;stopMedia?.();stopMedia=null;
 window.removeEventListener('storage',onStorage);
}
let saved;
try{saved=localStorage.getItem(STORAGE_KEY);}catch{persistent=false;}
applyPreference(saved);
window.addEventListener('storage',onStorage);
window.YBZTheme=Object.freeze({THEMES,getTheme,getPreference,setTheme,cycleTheme,isPersistent,cleanup});
export {THEMES,getTheme,getPreference,setTheme,cycleTheme,isPersistent,cleanup};
