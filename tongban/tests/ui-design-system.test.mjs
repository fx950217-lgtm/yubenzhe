import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {transform} from 'esbuild';

const directory=new URL('../src/',import.meta.url);
const files=(await readdir(directory)).filter(name=>name.endsWith('.css'));
const styles=await Promise.all(files.map(async name=>({name,css:await readFile(new URL(name,directory),'utf8')})));
const theme=styles.find(file=>file.name==='theme-skins.css').css;
const declarations=(source,property)=>[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(new RegExp('(?:^|[;{])\\s*'+property+'\\s*:\\s*([^;}]+)','g'))].map(match=>match[1].replace(/\s*!important\s*$/,'').trim());

test('consumer styles use only the two approved font weights, including obsolete reachable views',()=>{
 const invalid=[];
 for(const {name,css} of styles)for(const value of declarations(css,'font-weight'))if(!['400','600','inherit'].includes(value))invalid.push(name+': '+value);
 assert.deepEqual(invalid,[]);
 assert.match(theme,/:where\(h1,h2,h3,h4,h5,h6,strong,b\)\{font-weight:600\}/,'browser bold defaults must also be normalized');
});

test('every explicit consumer text size uses the shared scale and every line height is size plus eight',()=>{
 const invalid=[];
 for(const {name,css} of styles){
  for(const value of declarations(css,'font-size'))if(value!=='inherit'&&!/^var\(--fs-(?:xs|s|b|m|l|xl|2xl|num)\)$/.test(value))invalid.push(name+': font-size '+value);
  for(const value of declarations(css,'line-height'))if(value.replace(/\s/g,'')!=='calc(1em+8px)')invalid.push(name+': line-height '+value);
  for(const value of declarations(css,'font'))invalid.push(name+': shorthand could reset typography '+value);
 }
 assert.deepEqual(invalid,[]);
 assert.match(theme,/:where\(\*,\*::before,\*::after\)\{line-height:calc\(1em \+ 8px\)\}/,'inherited line height must be recomputed for each element');
});

test('small controls keep a forty-four-pixel target without enlarging their icon artwork',()=>{
 assert.match(theme,/--touch-target:44px/);
 assert.match(theme,/:where\(button,a\[href\],input:not\(\[type=hidden\]\),textarea,select,summary,\[role=button\],\[role=tab\]\)\{min-height:var\(--touch-target\)!important\}/);
 assert.match(theme,/button:has\(>svg:only-child\)[^}]+min-width:var\(--touch-target\)!important/);
 assert.match(theme,/--icon-size:24px;--icon-tile-size:32px/);
 assert.match(theme,/:where\(\.ui-icon-tile\)\{[^}]*width:var\(--icon-tile-size\)[^}]*height:var\(--icon-tile-size\)[^}]*border-radius:var\(--r-m\)/);
 for(const {name,css}of styles)for(const value of declarations(css,'stroke-width'))assert.equal(value,'1.8',name);
 assert.match(theme,/stroke-linecap:round;stroke-linejoin:round/);
});

test('secondary text and placeholders use skin-aware opacity tokens instead of fixed gray labels',()=>{
 const invalid=[];for(const {name,css}of styles)for(const color of declarations(css,'color'))if(/^#(?:666(?:666)?|999(?:999)?)$/i.test(color))invalid.push(name+': '+color);
 assert.deepEqual(invalid,[]);
 assert.match(theme,/--text:var\(--t1\);--text-2:var\(--t2\);--text-3:var\(--t3\);--muted:var\(--t2\)/);
 assert.match(theme,/:where\(input,textarea\)::placeholder\{color:var\(--t4\);opacity:1\}/);
});

test('runtime desktop and management styles do not retain forbidden 500 or 700 weights',async()=>{
 const invalid=[];
 for(const folder of ['../../yubenzhe-desktop/src/','../../yubenzhe-deploy/ui/']){
  const dir=new URL(folder,import.meta.url);for(const name of await readdir(dir))if(/\.(?:css|html|tsx)$/.test(name)){
   const source=await readFile(new URL(name,dir),'utf8');if(/font-weight\s*:\s*(?:500|700)(?!\d)/.test(source))invalid.push(folder+name);
  }
 }
 assert.deepEqual(invalid,[]);
});

test('all consumer styles still parse for the supported WebKit version after token normalization',async()=>{
 for(const {name,css}of styles){const result=await transform(css,{loader:'css',target:'safari15.4',logLevel:'silent'});assert.deepEqual(result.warnings,[],name);}
});
