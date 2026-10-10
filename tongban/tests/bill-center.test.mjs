import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const src=(await readFile(new URL('../src/bill-center.js',import.meta.url),'utf8')).replace("import './bill-center.css';",'');
const {collectBills}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
test('chain ledger ignores removed platform and demo sources without executing their readers',()=>{
 const hash='0x'+'a'.repeat(64);let oldReads=0;
 const {items,errors}=collectBills({chain:()=>[{hash,amount:'1.25',status:'pending',broadcastUncertain:true,createdAt:1}],draft:()=>{oldReads++;return [{amount:'300'}]},demo:()=>{oldReads++;return [{amount:'99'}]}});
 assert.equal(oldReads,0);assert.equal(errors.length,0);assert.equal(items.length,1);assert.equal(items[0].type,'chain');assert.equal(items[0].status,'广播状态待核实');assert.equal(items[0].hash,hash);
});
test('unreadable chain storage reports failure instead of an empty success',()=>{const {items,errors}=collectBills({chain:()=>{throw new Error('损坏')}});assert.equal(items.length,0);assert.deepEqual(errors,[{type:'chain',message:'损坏'}]);});
test('untrusted hashes never become transaction links',()=>{const {items}=collectBills({chain:()=>[{hash:'javascript:alert(1)',status:'failed',amount:'2'}]});assert.equal(items[0].hash,null);assert.equal(items[0].status,'链上执行失败');});
