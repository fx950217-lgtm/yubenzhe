import test from 'node:test';
import assert from 'node:assert/strict';
import { walletFeeText } from '../src/wallet-fees.js';

test('a valid receipt fee takes precedence over the original estimate, including an actual zero',()=>{
  assert.equal(walletFeeText({actualGasFee:'0.000042',gasFee:'0.0001'}),'手续费 0.000042 tBNB · 实际');
  assert.equal(walletFeeText({actualGasFee:'0',gasFee:'0.0001'}),'手续费 0 tBNB · 实际');
  assert.equal(walletFeeText({actualGasFee:'0.000000000000000001'}),'手续费 0.000000000000000001 tBNB · 实际');
});

test('older records retain an explicitly labelled estimate when no valid receipt fee exists',()=>{
  assert.equal(walletFeeText({gasFee:'0.000063'}),'手续费 0.000063 tBNB · 预估');
  assert.equal(walletFeeText({actualGasFee:'unknown',gasFee:'0.000063'}),'手续费 0.000063 tBNB · 预估');
  assert.equal(walletFeeText({gasFee:'0.01'}),'手续费 0.01 tBNB · 预估');
});

test('unavailable fees remain unknown for pending, uncertain and confirmed records rather than inventing USD fees',()=>{
  for(const record of [undefined,{}, {status:'pending'}, {broadcastUncertain:true}, {status:'confirmed'}, {gasFee:null}, {actualGasFee:0,gasFee:0}]){
    const text=walletFeeText(record);
    assert.equal(text,'手续费待核实 · 查看链上回执');
    assert.doesNotMatch(text,/\$|0\.01|实际|预估/);
  }
});

test('untrusted fee values cannot inject markup, symbols, exponents or ambiguous numeric formats',()=>{
  const values=['<img src=x onerror=alert(1)>','0.01<script>alert(1)</script>','0.01\n',' 0.01','-1','+1','1e-5','0x10','NaN','Infinity','.1','1.','01','1,000','１', '1'.repeat(31),'0.'+'1'.repeat(19),NaN,Infinity,0.01,{},[],true];
  for(const value of values){
    assert.equal(walletFeeText({actualGasFee:value,gasFee:value}),'手续费待核实 · 查看链上回执');
    assert.equal(walletFeeText({actualGasFee:value,gasFee:'0.0001'}),'手续费 0.0001 tBNB · 预估');
  }
  const record={actualGasFee:'0.0002',gasFee:'<svg onload=alert(1)>'};
  assert.equal(walletFeeText(record),'手续费 0.0002 tBNB · 实际');
  assert.equal(record.gasFee,'<svg onload=alert(1)>','formatting does not change stored records');
});
