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
function hex(value){
  assert.match(value,/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i,'contrast tokens must be opaque sRGB colors');
  return value.length===4?'#'+value.slice(1).split('').map(char=>char+char).join('').toLowerCase():value.toLowerCase();
}
function luminance(hex) {
  assert.match(hex, /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i, 'contrast tokens must be opaque sRGB colors');
  if(hex.length===4)hex='#'+hex.slice(1).split('').map(char=>char+char).join('');
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
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
    expectPairs(id,[['--deep','--lime'],['--danger','--danger-bg'],['--success','--success-bg'],['--warning','--warning-bg'],['--on-coral','--coral'],['--packet-on','--packet-surface'],['--packet-footer-ink','--packet-footer'],['--ai-blue','--ai-blue-bg'],['--human-green','--human-green-bg']]);
  });
  test(id+': gradient button text meets large bold text contrast at both gradient ends',()=>{
    // The fixed gradient cannot meet 4.5:1 with one small-text color. Require
    // actual >=14pt bold labels before evaluating the applicable 3:1 minimum.
    for(const selector of ['.primary','.mine-page.mine-brand-page .mine-primary','.wh button.wh-primary','.live-social .live-primary','.fv-form button[type=submit]','.community-button:not(.secondary)','.work-primary','.tk-primary']){
      const style=declarationsFor(selector);
      assert.match(style['font-size']||'',/^\d+(?:\.\d+)?px$/,selector+' must declare its readable text size');
      assert(parseFloat(style['font-size'])>=18.667,selector+' must be at least 14pt (18.667px)');
      assert(Number(style['font-weight'])>=700,selector+' must be bold');
      assert.equal(style.color,'var(--on-primary)',selector+' must use the tested label token');
    }
    expectPairs(id,[['--on-primary','--accent'],['--on-primary','--accent-2']],3);
  });
}
test('fixed YBZ brand, radius and AI/human tokens are exact in every skin',()=>{
  const colors={'--ink':'#1B1B1F','--ink-2':'#2D2A3E','--accent':'#6C5CE7','--accent-2':'#A29BFE','--teal':'#00B8A9','--amber':'#FFB020','--green':'#00C48C','--red':'#FF3B30','--grey-1':'#F7F7F9','--grey-2':'#F0F0F5','--grey-3':'#E8E8EE','--ai-blue':'#185FA5','--ai-blue-bg':'#E6F1FB','--human-green':'#0F6E56','--human-green-bg':'#E1F5EE'};
  for(const [id,palette]of Object.entries(palettes)){
    for(const [name,color]of Object.entries(colors))assert.equal(hex(resolve(palette,name)),hex(color),id+': '+name);
    for(const [name,value]of Object.entries({'--radius-s':'8px','--radius-m':'14px','--radius-l':'20px','--radius-xl':'28px'}))assert.equal(resolve(palette,name),value,id+': '+name);
  }
  for(const [name,color]of Object.entries({'--text':'#1A1A1A','--text-2':'#666','--text-3':'#999'}))assert.equal(hex(resolve(palettes.light,name)),hex(color));
  assert.equal(new Set(Object.values(palettes).map(palette=>resolve(palette,'--paper'))).size,3,'skin surfaces must remain distinct');
  assert.equal(new Set(Object.values(palettes).map(palette=>resolve(palette,'--text'))).size,3,'readable text adapts independently of fixed brand ink');
});
test('packet red and coral semantics are fixed across all three skins', () => {
  for (const name of ['--coral', '--on-coral', '--packet-red', '--packet-deep', '--packet-gold', '--packet-surface', '--packet-on', '--packet-footer', '--packet-footer-ink']) {
    assert.equal(new Set(Object.values(palettes).map(palette => hex(resolve(palette, name)))).size, 1, name + ' must not change with the skin');
  }
});
test('Chinese and English typography uses the approved font stack, spacing and tab sizes',()=>{
  const font='-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
  for(const palette of Object.values(palettes))assert.equal(resolve(palette,'--font-cn').replace(/\s/g,''),font.replace(/\s/g,''));
  assert.equal(declarationsFor('body')['font-family'],'var(--font-cn)');
  assert.equal(parseFloat(declarationsFor('body')['letter-spacing']),.5);
  assert.equal(parseFloat(declarationsFor('[lang="en"]')['letter-spacing']),-.7);
  assert.equal(declarationsFor('h1')['font-size'],'29px');
  assert.equal(declarationsFor('h1')['text-transform'],'none');
  for(const selector of ['.section-head h2','.wh-section h2','.wb-recent h2']){const style=declarationsFor(selector);assert.equal(style['font-size'],'12.5px');assert.equal(parseFloat(style['letter-spacing']),.5);}
  assert.equal(declarationsFor('.bottom-nav .nav-item',{mobile:true})['font-size'],'10.5px');
  assert.equal(declarationsFor('svg')['stroke-width'],'2.2');
  assert.equal(declarationsFor('.bill-amount')['font-family'],'var(--font-number)');
  assert.equal(declarationsFor('.bill-amount')['font-variant-numeric'],'tabular-nums');
});
test('the new brand layer defines only the two approved gradient values',()=>{
  const normalize=value=>value.replace(/\s/g,'').toLowerCase();
  const approved=['linear-gradient(140deg,#1B1B1F,#2D2A3E)','linear-gradient(90deg,#6C5CE7,#A29BFE)'].map(normalize);
  for(const palette of Object.values(palettes)){
    assert.equal(normalize(resolve(palette,'--hero-bg')),approved[0]);
    assert.equal(normalize(resolve(palette,'--primary-bg')),approved[1]);
  }
  const marker='/* YBZ design system';assert(css.includes(marker),'new brand layer must be identifiable');
  const brandLayer=css.slice(css.indexOf(marker));
  const gradients=[...brandLayer.matchAll(/(?:repeating-)?(?:linear|radial|conic)-gradient\([^)]*\)/g)].map(match=>normalize(match[0]));
  assert.deepEqual(new Set(gradients),new Set(approved),'no extra decorative gradient values in the new brand layer');
  for(const selector of ['.balance-card','.wallet-page .balance-card','.mine-home-profile','.setup-card'])assert.equal(declarationsFor(selector)['background-image'],'none',selector+' must not retain an old decorative gradient');
});
test('theme stylesheet parses for the oldest supported WebKit target', async () => {
  const output = await transform(css, {loader:'css', target:'safari15.4', logLevel:'silent'});
  assert.equal(output.warnings.length, 0);
});
