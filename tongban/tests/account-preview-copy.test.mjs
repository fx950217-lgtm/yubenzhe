import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/account-ui.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('export function accountEmailModeText('),source.indexOf('export function mountAccountGate('));
const {accountEmailModeText}=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'));
test('internal preview explains reserved test addresses and never implies real email delivery',()=>{const text=accountEmailModeText({simulation:true,simulationScope:'internal-preview'});assert.match(text,/example\.test/);assert.match(text,/仅在此页面显示/);assert.match(text,/不发送真实邮件/);assert.doesNotMatch(text,/仅用于本地/);assert.match(source,/tester@example\.test/);});
test('local simulation, disabled delivery and configured delivery remain distinct',()=>{assert.match(accountEmailModeText({simulation:true}),/本机模拟邮件/);assert.match(accountEmailModeText({emailMode:'disabled'}),/尚未启用/);assert.equal(accountEmailModeText({emailMode:'provider'}),'');});
