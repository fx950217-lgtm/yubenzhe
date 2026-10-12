import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dataURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const deploymentModule=dataURL(await readFile(new URL('../src/deployment-config.js',import.meta.url),'utf8'));
const feeModule=dataURL(await readFile(new URL('../src/wallet-fees.js',import.meta.url),'utf8'));
const src=(await readFile(new URL('../src/bill-center.js',import.meta.url),'utf8')).replace("import './bill-center.css';",'').replace("'./wallet-fees.js'",JSON.stringify(feeModule)).replace("'./deployment-config.js'",JSON.stringify(deploymentModule));
const {collectBills,mountBillCenter}=await import(dataURL(src));
test('chain ledger ignores removed platform and demo sources without executing their readers',()=>{
 const hash='0x'+'a'.repeat(64);let oldReads=0;
 const {items,errors}=collectBills({chain:()=>[{hash,amount:'1.25',status:'pending',broadcastUncertain:true,createdAt:1}],draft:()=>{oldReads++;return [{amount:'300'}]},demo:()=>{oldReads++;return [{amount:'99'}]}});
 assert.equal(oldReads,0);assert.equal(errors.length,0);assert.equal(items.length,1);assert.equal(items[0].type,'chain');assert.equal(items[0].status,'广播状态待核实');assert.equal(items[0].hash,hash);
});
test('unreadable chain storage reports failure instead of an empty success',()=>{const {items,errors}=collectBills({chain:()=>{throw new Error('损坏')}});assert.equal(items.length,0);assert.deepEqual(errors,[{type:'chain',message:'损坏'}]);});
test('untrusted hashes never become transaction links',()=>{const {items}=collectBills({chain:()=>[{hash:'javascript:alert(1)',status:'failed',amount:'2'}]});assert.equal(items[0].hash,null);assert.equal(items[0].status,'链上执行失败');});

function mountHarness(t,rows,{onRefresh=async()=>{}}={}){
 const container={innerHTML:'',onclick:null};
 const cleanup=mountBillCenter(container,{sources:{chain:()=>rows},onBack(){},onRefresh});t.after(cleanup);
 const click=(selector,dataset)=>container.onclick({target:{closest:value=>value===selector?{dataset}:null}});
 return {container,open:id=>click('[data-bill-id]',{billId:'chain:'+id}),list:()=>click('[data-bill]',{bill:'list'}),refresh:()=>click('[data-bill]',{bill:'refresh'})};
}

test('transfer list and details explicitly distinguish actual, estimated and unverified fees',async t=>{
 const rows=[
  {id:'actual',amount:'2',status:'confirmed',actualGasFee:'0.000021',gasFee:'0.0001',createdAt:3},
  {id:'quote',amount:'3',status:'pending',gasFee:'0.000063',createdAt:2},
  {id:'unknown',amount:'4',status:'pending',broadcastUncertain:true,createdAt:1},
 ];
 const fees=['手续费 0.000021 tBNB · 实际','手续费 0.000063 tBNB · 预估','手续费待核实 · 查看链上回执'];
 const {items,errors}=collectBills({chain:()=>rows});assert.equal(errors.length,0);assert.deepEqual(items.map(item=>item.fee),fees);
 const app=mountHarness(t,rows);
 for(const fee of fees)assert.ok(app.container.innerHTML.includes(fee));
 assert.equal([...app.container.innerHTML.matchAll(/class="bill-fee"/g)].length,3);
 assert.doesNotMatch(app.container.innerHTML,/手续费 \$0\.01/);
 for(let i=0;i<rows.length;i++){
  await app.open(rows[i].id);
  assert.match(app.container.innerHTML,/<dt>网络费用<\/dt>/);
  assert.ok(app.container.innerHTML.includes('<dd>'+fees[i]+'</dd>'));
  assert.doesNotMatch(app.container.innerHTML,/手续费 \$0\.01/);
  await app.list();
 }
});

test('refreshing a selected transfer replaces its estimate with the confirmed receipt fee',async t=>{
 const hash='0x'+'b'.repeat(64),rows=[{id:'confirmed-after-refresh',hash,amount:'1',status:'pending',gasFee:'0.00008',createdAt:1}];
 const calls=[],app=mountHarness(t,rows,{onRefresh:async value=>{calls.push(value);rows[0]={...rows[0],status:'confirmed',actualGasFee:'0.000042'};}});
 await app.open(rows[0].id);assert.match(app.container.innerHTML,/手续费 0\.00008 tBNB · 预估/);
 await app.refresh();assert.deepEqual(calls,[hash]);
 assert.match(app.container.innerHTML,/链上已确认/);assert.match(app.container.innerHTML,/手续费 0\.000042 tBNB · 实际/);
 assert.doesNotMatch(app.container.innerHTML,/0\.00008|手续费 \$0\.01/);
 await app.list();assert.match(app.container.innerHTML,/class="bill-fee">手续费 0\.000042 tBNB · 实际/);
});

test('malicious stored fee and transaction text stay inert in both list and detail views',async t=>{
 const rows=[{id:'unsafe',hash:'javascript:alert(1)',amount:'<img src=x onerror=alert(1)>',to:'<script>alert(1)</script>',actualGasFee:'0.01<svg onload=alert(1)>',gasFee:'<img src=x onerror=alert(1)>',status:'failed',createdAt:1}];
 const app=mountHarness(t,rows);
 assert.match(app.container.innerHTML,/手续费待核实 · 查看链上回执/);
 assert.match(app.container.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(app.container.innerHTML,/<img|<script|<svg|javascript:|手续费 \$0\.01/);
 await app.open('unsafe');
 assert.match(app.container.innerHTML,/<dd>手续费待核实 · 查看链上回执<\/dd>/);
 assert.match(app.container.innerHTML,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(app.container.innerHTML,/<img|<script|<svg|javascript:|href=|手续费 \$0\.01/);
});

test('distribution approvals are not mislabeled as native transfers and unknown states remain explicit',()=>{const {items}=collectBills({chain:()=>[{hash:'0x'+'c'.repeat(64),kind:'distribution',action:'approve',title:'授权本次测试代币',tokenAmount:'5.0',tokenSymbol:'TST',amount:'0.0',status:'unknown',gasFee:'0.0001'}]});assert.equal(items[0].title,'授权本次测试代币');assert.equal(items[0].asset,'TST');assert.equal(items[0].amount,'5.0');assert.equal(items[0].direction,'neutral');assert.equal(items[0].status,'广播状态待核实');assert.match(items[0].detail,/授权不等于转账/);});
