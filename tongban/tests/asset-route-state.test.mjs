import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isAppView,hashForView} from '../src/app-navigation.js';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
test('chain bill return preserves its origin and cannot revive platform tabs',()=>{const navigation=[];const ctx={currentView:'wallet',routeOptions:{},billReturn:{view:'mine',options:{}},isAppView,hashForView,navigate:(view,options)=>navigation.push({view,options})};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function restoreRouteOptions('),source.indexOf('function openScan')),ctx);ctx.openBillCenter();assert.equal(navigation[0].options.returnTo.view,'wallet');ctx.currentView='bills';ctx.restoreRouteOptions({returnTo:{view:'messages',options:{}}});assert.equal(ctx.billReturn.view,'messages');ctx.restoreRouteOptions(navigation[0].options);assert.equal(ctx.billReturn.view,'wallet');ctx.restoreRouteOptions({returnTo:{view:'bills'}});assert.equal(ctx.billReturn.view,'mine');assert.doesNotMatch(source,/switchAssetTab|renderPlatformWallet|assetTab/);});
