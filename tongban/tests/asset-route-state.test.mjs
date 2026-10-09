import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isAppView,hashForView} from '../src/app-navigation.js';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
test('asset tabs replace the same subpage history while bill history retains its own origin',()=>{
 const writes=[],navigation=[];
 const ctx={currentView:'wallet',assetTab:'chain',routeOptions:{},billReturn:{view:'mine',options:{}},isAppView,hashForView,document:{querySelector:()=>({})},renderWallet:()=>{},history:{replaceState:(state,_title,hash)=>writes.push({state,hash})},navigate:(view,options)=>navigation.push({view,options})};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function restoreRouteOptions('),source.indexOf('\nfunction openScan')),ctx);
 vm.runInContext(source.slice(source.indexOf('function switchAssetTab('),source.indexOf('\nfunction openDiscoverProfile')),ctx);
 ctx.openPlatform();assert.equal(ctx.assetTab,'platform');assert.equal(navigation.length,0);assert.equal(writes[0].hash,'#mine/assets');
 ctx.openBillCenter();assert.equal(navigation[0].options.returnTo.view,'wallet');assert.equal(navigation[0].options.returnTo.options.assetTab,'platform');
 ctx.currentView='bills';ctx.restoreRouteOptions({returnTo:{view:'messages',options:{}}});assert.equal(ctx.billReturn.view,'messages');
 ctx.restoreRouteOptions(navigation[0].options);assert.equal(ctx.billReturn.view,'wallet');assert.equal(ctx.billReturn.options.assetTab,'platform');
 ctx.restoreRouteOptions({returnTo:{view:'bills'}});assert.equal(ctx.billReturn.view,'mine');
 ctx.currentView='wallet';ctx.restoreRouteOptions({assetTab:'chain'});assert.equal(ctx.assetTab,'chain');
});
