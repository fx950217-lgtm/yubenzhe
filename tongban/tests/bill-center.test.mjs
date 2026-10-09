import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const src=(await readFile(new URL('../src/bill-center.js',import.meta.url),'utf8')).replace("import './bill-center.css';",'');
const {collectBills}=await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
test('bills keep draft and demo money distinct from confirmed chain transfers',()=>{
 const hash='0x'+'a'.repeat(64);
 const {items,errors}=collectBills({chain:()=>[{hash,amount:'1.25',status:'pending',broadcastUncertain:true,createdAt:1}],draft:()=>[{id:'d',direction:'deposit',amount:'300',asset:'USDT',createdAt:3,status:'completed'}],demo:()=>[{id:'r',amount:'0.01',asset:'tBNB',direction:'in',createdAt:2}]});
 assert.equal(errors.length,0);assert.deepEqual(items.map(x=>x.type),['draft','demo','chain']);
 assert.equal(items[0].status,'未提交 · 未扣款');assert.equal(items[0].direction,'none');
 assert.equal(items[1].demo,true);assert.match(items[1].detail,/不代表真实资金/);
 assert.equal(items[2].status,'广播状态待核实');assert.equal(items[2].hash,hash);
});
test('unreadable source does not hide other records or masquerade as empty ledger',()=>{
 const {items,errors}=collectBills({chain:()=>{throw new Error('损坏')},draft:()=>[{id:'d',direction:'withdraw',amount:'2',asset:'tBNB'}]});
 assert.equal(items.length,1);assert.equal(errors[0].type,'chain');assert.equal(errors[0].message,'损坏');
});
test('untrusted hashes never become transaction links',()=>{
 const {items}=collectBills({chain:()=>[{hash:'javascript:alert(1)',status:'failed',amount:'2'}]});
 assert.equal(items[0].hash,null);assert.equal(items[0].status,'链上执行失败');
});
