import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const css = await readFile(new URL('../src/theme-skins.css', import.meta.url), 'utf8');
// Preserve stylesheet order and selector specificity, including grouped :root
// rules. A later plain :root must not overwrite a more specific theme selector.
function splitTopLevel(source, separator) {
  const parts=[];let start=0,depth=0,quote='';
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(quote){if(char==='\\')i++;else if(char===quote)quote='';continue;}
    if(char==='"'||char==="'"){quote=char;continue;}
    if(char==='('||char==='[')depth++;
    else if(char===')'||char===']')depth--;
    else if(char===separator&&!depth){parts.push(source.slice(start,i).trim());start=i+1;}
  }
  parts.push(source.slice(start).trim());return parts.filter(Boolean);
}
function parseRules(source) {
  const rules=[],clean=source.replace(/\/\*[\s\S]*?\*\//g,'');
  function walk(part,conditions=[]){
    let start=0;
    while(start<part.length){
      const open=part.indexOf('{',start);if(open<0)break;
      const selector=part.slice(start,open).trim();let depth=1,quote='',end=open+1;
      for(;end<part.length&&depth;end++){
        const char=part[end];
        if(quote){if(char==='\\')end++;else if(char===quote)quote='';continue;}
        if(char==='"'||char==="'")quote=char;
        else if(char==='{')depth++;
        else if(char==='}')depth--;
      }
      assert.equal(depth,0,'unbalanced CSS rule: '+selector);
      const body=part.slice(open+1,end-1);
      if(selector.startsWith('@'))walk(body,[...conditions,selector]);
      else{
        const declarations=splitTopLevel(body,';').map(text=>{
          const colon=text.indexOf(':');if(colon<0)return null;
          const raw=text.slice(colon+1).trim(),important=/\s*!important\s*$/i.test(raw);
          return {name:text.slice(0,colon).trim(),value:raw.replace(/\s*!important\s*$/i,'').trim(),important};
        }).filter(Boolean);
        rules.push({selectors:splitTopLevel(selector,','),declarations,conditions});
      }
      start=end;
    }
  }
  walk(clean);return rules;
}
const rules=parseRules(css);
function rootSpecificity(selector,theme){
  if(selector===':root')return 1;
  if(selector===':root[data-theme]')return theme===null?0:2;
  const exact=selector.match(/^:root\[data-theme=["']([^"']+)["']\]$/);
  return exact&&exact[1]===theme?2:0;
}
function rootPalette(sourceRules,theme){
  const values=new Map();
  for(const rule of sourceRules){
    const specificity=Math.max(0,...rule.selectors.map(selector=>rootSpecificity(selector,theme)));
    if(!specificity)continue;
    assert.equal(rule.conditions.length,0,'conditional root tokens require an explicit environment in this test');
    for(const declaration of rule.declarations.filter(item=>item.name.startsWith('--'))){
      const old=values.get(declaration.name);
      if(!old||Number(declaration.important)>Number(old.important)||(declaration.important===old.important&&specificity>=old.specificity))values.set(declaration.name,{...declaration,specificity});
    }
  }
  return Object.fromEntries([...values].map(([key,value])=>[key,value.value]));
}
const palettes=Object.fromEntries(['light','dark','eyecare'].map(theme=>[theme,rootPalette(rules,theme)]));
function resolve(palette, name, seen = new Set()) {
  assert(!seen.has(name), 'theme token cycle: ' + name);
  seen.add(name);
  const value = palette[name];
  assert(value, 'missing theme token: ' + name);
  const reference = value.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]+))?\)$/);
  return reference ? (palette[reference[1]] ? resolve(palette, reference[1], seen) : reference[2]?.trim()) : value;
}
function channels(value) {
  if(/^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(value)){
    const hex=value.length===4?value.slice(1).split('').map(v=>v+v).join(''):value.slice(1);
    return [...hex.match(/../g).map(v=>parseInt(v,16)),1];
  }
  const match=value.match(/^rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)$/);
  assert(match,'unsupported contrast color '+value);return match.slice(1).map(Number);
}
function composite(foreground,background) {
  return foreground.slice(0,3).map((n,i)=>n*foreground[3]+background[i]*(1-foreground[3]));
}
function luminance(rgb) {
  const values=rgb.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
  return values[0]*.2126+values[1]*.7152+values[2]*.0722;
}
function contrast(a,b) {
  const background=channels(b);assert.equal(background[3],1,'surface must be opaque for contrast');
  const values=[luminance(composite(channels(a),background)),luminance(background)];
  return (Math.max(...values)+.05)/(Math.min(...values)+.05);
}
function expectPairs(id,pairs,minimum=4.5){
  const failures=[];
  for(const [foreground,background]of pairs){
    const ratio=contrast(resolve(palettes[id],foreground),resolve(palettes[id],background));
    if(ratio<minimum)failures.push(`${id}: ${foreground} on ${background} = ${ratio.toFixed(3)}:1; requires ${minimum}:1`);
  }
  assert.equal(failures.length,0,failures.join('\n'));
}
function declarationsFor(selector,{mobile=false}={}){
  const values=new Map();
  for(const rule of rules){
    if(!rule.selectors.includes(selector))continue;
    if(rule.conditions.length&&!(mobile&&rule.conditions.every(condition=>condition.replace(/\s/g,'')==='@media(max-width:700px)')))continue;
    for(const declaration of rule.declarations){const old=values.get(declaration.name);if(!old||declaration.important||!old.important)values.set(declaration.name,declaration);}
  }
  return Object.fromEntries([...values].map(([key,value])=>[key,value.value]));
}
test('root token evaluation respects grouped selectors, source order, specificity and important declarations',()=>{
  const sample=parseRules(':root,:root[data-theme="light"]{--a:red;--b:blue}:root[data-theme="dark"]{--a:black;--b:white}:root{--a:green}:root,:root[data-theme]{--b:purple}:root[data-theme="dark"]{--c:gold!important}:root[data-theme]{--c:silver}');
  assert.deepEqual(rootPalette(sample,'dark'),{'--a':'black','--b':'purple','--c':'gold'});
  assert.deepEqual(rootPalette(sample,'light'),{'--a':'red','--b':'purple','--c':'silver'});
  assert.deepEqual(rootPalette(sample,null),{'--a':'green','--b':'purple'});
});
for (const id of Object.keys(palettes)) {
  test(id + ': body, secondary and input hints meet 4.5:1 on standard surfaces', () => {
    expectPairs(id,['--text','--text-2','--muted','--faint'].flatMap(foreground=>['--paper','--paper-2','--bg','--lime'].map(background=>[foreground,background])));
  });
  test(id + ': tinted and semantic controls remain readable', () => {
    expectPairs(id,[['--deep','--lime'],['--danger','--danger-bg'],['--success-text','--success-bg'],['--warning-text','--warning-bg'],['--on-coral','--coral'],['--packet-on','--packet-surface'],['--packet-footer-ink','--packet-footer'],['--ai-blue','--ai-blue-bg'],['--human-green','--human-green-bg']]);
  });
  test(id+': solid brand action labels meet normal-text contrast without oversized bold workarounds',()=>{
    for(const selector of ['.primary','.mine-page.mine-brand-page .mine-primary','.wh button.wh-primary','.live-social .live-primary','.fv-form button[type=submit]','.community-button:not(.secondary)','.work-primary','.tk-primary']){
      const style=declarationsFor(selector);
      assert.equal(style['font-size'],'var(--fs-b)',selector);
      assert.equal(style['font-weight'],'600',selector);
      assert.equal(style.color,'var(--on-primary)',selector);
      assert.equal(style.background,'var(--primary-bg)',selector);
    }
    expectPairs(id,[['--on-primary','--primary-bg']]);
  });
}
test('the approved mobile tokens are exact by default and defined for all three skins',()=>{
  const fixed={'--brand':'#6C5CE7','--brand-hi':'#5B4CD6','--success':'#00A870','--warning':'#ED7B2F','--error':'#E34D59','--info':'#378ADD','--up':'#E34D59','--down':'#00A870','--fs-xs':'10px','--fs-s':'12px','--fs-b':'14px','--fs-m':'16px','--fs-l':'20px','--fs-xl':'24px','--fs-2xl':'28px','--r-s':'6px','--r-m':'12px','--r-l':'16px','--r-full':'999px','--sp-1':'4px','--sp-2':'8px','--sp-3':'12px','--sp-4':'16px','--sp-6':'24px'};
  for(const [id,palette] of Object.entries(palettes)){
    for(const [name,value] of Object.entries(fixed))assert.equal(resolve(palette,name).toLowerCase(),value.toLowerCase(),id+': '+name);
    for(const name of ['--brand-1','--brand-2','--success-1','--warning-1','--error-1','--info-1','--t1','--t2','--t3','--t4','--bg-page','--bg-container','--bg-2','--bg-3','--border','--border-2'])assert(resolve(palette,name),id+': '+name);
    assert.equal(resolve(palette,'--radius-m'),'12px');
  }
  const light={'--brand-1':'#EFECFE','--brand-2':'#C9C2F8','--success-1':'#E6F5EF','--warning-1':'#FEF0E6','--error-1':'#FDECEE','--info-1':'#EAF2FC','--t1':'rgba(0,0,0,.90)','--t2':'rgba(0,0,0,.60)','--t3':'rgba(0,0,0,.40)','--t4':'rgba(0,0,0,.26)','--bg-page':'#F3F3F5','--bg-container':'#fff','--bg-2':'#F5F5F7','--bg-3':'#EDEDF0','--border':'rgba(0,0,0,.08)','--border-2':'rgba(0,0,0,.14)'};
  for(const [name,value] of Object.entries(light))assert.equal(resolve(palettes.light,name).toLowerCase(),value.toLowerCase(),name);
  for(const name of ['--bg-page','--bg-container','--t1'])assert.equal(new Set(Object.values(palettes).map(p=>resolve(p,name))).size,3,name+' must adapt to all skins');
});

test('packet red and coral semantics are fixed across all three skins', () => {
  for (const name of ['--coral', '--on-coral', '--packet-red', '--packet-deep', '--packet-gold', '--packet-surface', '--packet-on', '--packet-footer', '--packet-footer-ink']) {
    assert.equal(new Set(Object.values(palettes).map(palette => resolve(palette, name).toLowerCase())).size, 1, name + ' must not change with the skin');
  }
});
test('Chinese and English typography uses the new font stack, token sizes and 1.8 stroke',()=>{
  const font='-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei","Source Han Sans CN",sans-serif';
  for(const palette of Object.values(palettes))assert.equal(resolve(palette,'--font-cn').replace(/\s/g,''),font.replace(/\s/g,''));
  assert.equal(parseFloat(declarationsFor('body')['letter-spacing']),.5);
  assert.equal(parseFloat(declarationsFor('[lang="en"]')['letter-spacing']),-.7);
  assert.equal(declarationsFor('h1')['font-size'],'var(--fs-l)');
  assert.equal(declarationsFor('h1')['text-transform'],'none');
  for(const selector of ['.section-head h2','.wh-section h2','.wb-recent h2']){const style=declarationsFor(selector);assert.equal(style['font-size'],'var(--fs-s)');assert.equal(parseFloat(style['letter-spacing']),.5);}
  assert.equal(declarationsFor('.bottom-nav .nav-item',{mobile:true})['font-size'],'var(--fs-xs)');
  assert.equal(declarationsFor('svg')['stroke-width'],'1.8');
  assert.equal(declarationsFor('.bill-amount')['font-family'],'var(--font-number)');
  assert.equal(declarationsFor('.bill-amount')['font-variant-numeric'],'tabular-nums');
});
test('only the approved hero gradient remains a shared decoration; actions use solid brand',()=>{
  const normalize=value=>value.replace(/\s/g,'').toLowerCase();
  for(const palette of Object.values(palettes)){
    assert.equal(normalize(resolve(palette,'--hero-bg')),'linear-gradient(140deg,#1b1b1f,#2d2a3e)');
    assert.equal(resolve(palette,'--primary-bg').toLowerCase(),'#6c5ce7');
  }
  for(const selector of ['.balance-card','.wallet-page .balance-card','.mine-home-profile','.setup-card'])assert.equal(declarationsFor(selector)['background-image'],'none',selector+' must not retain an obsolete decorative gradient');
});
test('theme stylesheet parses for the oldest supported WebKit target', async () => {
  const output = await transform(css, {loader:'css', target:'safari15.4', logLevel:'silent'});
  assert.equal(output.warnings.length, 0);
});
