import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_DEPLOYMENT,publicDeploymentFromEnvironment} from '../src/deployment-config.js';
import {NETWORK} from '../src/wallet.js';
test('native public access requires an explicit build-time enum; old builds remain gated',()=>{
 assert.equal(publicDeploymentFromEnvironment().accessMode,'internal-preview');
 assert.equal(publicDeploymentFromEnvironment({YBZ_ACCESS_MODE:'public'}).accessMode,'public');
 for(const value of ['true','false','PUBLIC','off'])assert.throws(()=>publicDeploymentFromEnvironment({YBZ_ACCESS_MODE:value}),/YBZ_ACCESS_MODE/);
});
test('build-time deployment URLs are configurable without changing testnet identity',()=>{const c=publicDeploymentFromEnvironment({YBZ_PREVIEW_ORIGIN:'https://preview.example.test',BSC_TESTNET_RPC_URLS:'["https://rpc.example.test/testnet"]',BSC_TESTNET_EXPLORER_URL:'https://explorer.example.test',BSC_TESTNET_FAUCET_URL:'https://faucet.example.test/docs',OLLAMA_DOWNLOAD_URL:'https://downloads.example.test/model'});assert.equal(c.previewOrigin,'https://preview.example.test');assert.deepEqual(c.rpcUrls,['https://rpc.example.test/testnet']);assert.equal(c.explorerUrl,'https://explorer.example.test');assert.equal(NETWORK.chainId,97);assert.equal(NETWORK.symbol,'tBNB');assert.equal(PUBLIC_DEPLOYMENT.previewOrigin,'https://66.42.56.29');});
test('public configuration rejects credentials, token-bearing queries and invalid preview origins',()=>{for(const origin of ['http://preview.example.test','https://user:secret@preview.example.test','https://preview.example.test/path','https://preview.example.test?key=private'])assert.throws(()=>publicDeploymentFromEnvironment({YBZ_PREVIEW_ORIGIN:origin}));assert.throws(()=>publicDeploymentFromEnvironment({BSC_TESTNET_RPC_URLS:'[]'}));assert.throws(()=>publicDeploymentFromEnvironment({BSC_TESTNET_RPC_URLS:'["https://rpc.example.test?secret=x"]'}));});
