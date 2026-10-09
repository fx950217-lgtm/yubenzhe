import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const authorizeSource = source.slice(source.indexOf('function authorizePacket('), source.indexOf('\nfunction clearModal('));
function harness({exists=true,unlocked=false,verify=async()=>({verified:true})}={}) {
  let cleanup, submitJob, cancelCount=0, verificationCount=0;
  const form={elements:{password:{value:''}},isConnected:true};
  const dialog={open:false,querySelector:()=>form};
  const scope={Promise,Number,Error,viewRevision:1,dialog,modalCleanup:null,
    state:()=>({exists,unlocked}),walletProblem:()=>false,
    wallet:{verifyPassword:async password=>{verificationCount++;return verify(password)},cancelCreation:()=>cancelCount++},
    demoAmount:value=>String(value/1e6),esc:String,walletStart:()=>{},
    showModal:(_title,_html,setup,onCleanup)=>{dialog.open=true;form.isConnected=true;cleanup=onCleanup;scope.modalCleanup=onCleanup;setup({querySelector:()=>form})},
    closeModal:()=>{dialog.open=false;form.isConnected=false;scope.modalCleanup?.()},
    busyForm:(_form,job)=>{submitJob=job()},
  };
  vm.createContext(scope);vm.runInContext(authorizeSource,scope);
  return {scope,form,start:input=>scope.authorizePacket({totalUnits:10000,currency:'tBNB',chatName:'测试好友',...input}),
    submit:password=>{form.elements.password.value=password;form.onsubmit({preventDefault(){},target:form});return submitJob},
    cancel:()=>scope.closeModal(),counts:()=>({cancelCount,verificationCount})};
}

test('packet confirmation requires a wallet and valid amount before requesting a password',async()=>{
  const noWallet=harness({exists:false});assert.equal(await noWallet.start(),false);assert.equal(noWallet.counts().verificationCount,0);
  const app=harness();await assert.rejects(app.start({totalUnits:NaN}),/金额无效/);assert.equal(app.counts().verificationCount,0);
});
test('wrong password never grants permission and the input is cleared',async()=>{
  const app=harness({verify:async()=>{throw new Error('密码错误')}});const pending=app.start();
  await assert.rejects(app.submit('wrong-test-password'),/密码错误/);assert.equal(app.form.elements.password.value,'');
  app.cancel();assert.equal(await pending,false);assert.equal(app.counts().verificationCount,1);
});
test('each packet gets a new verification even if the wallet is already available',async()=>{
  const app=harness({unlocked:true});const pending=app.start();await app.submit('test-only-credential');assert.equal(await pending,true);
  assert.equal(app.counts().verificationCount,1);assert.equal(app.form.elements.password.value,'');assert.equal(app.scope.dialog.open,false);
  const second=app.start();await app.submit('test-only-credential');assert.equal(await second,true);assert.equal(app.counts().verificationCount,2);
});
test('closing during asynchronous password checking cannot authorize a packet',async()=>{
  let complete;const app=harness({verify:()=>new Promise(resolve=>{complete=resolve})});const pending=app.start();
  const submit=app.submit('test-only-credential');app.cancel();assert.equal(await pending,false);
  complete({verified:true});await submit;assert.ok(app.counts().cancelCount>0);
});
test('abort revokes in-flight packet confirmation',async()=>{
  let complete;const app=harness({verify:()=>new Promise(resolve=>{complete=resolve})});const controller=new AbortController();
  const pending=app.start({signal:controller.signal});const submit=app.submit('test-only-credential');
  controller.abort();assert.equal(await pending,false);complete({verified:true});await submit;
  assert.equal(app.scope.dialog.open,false);
});
test('navigation revokes a password verification even when no abort signal is provided',async()=>{
  let complete;const app=harness({verify:()=>new Promise(resolve=>{complete=resolve})});const pending=app.start();
  const submit=app.submit('test-only-credential');app.scope.viewRevision++;
  complete({verified:true});await submit;assert.equal(await pending,false);
});
test('an already cancelled request never opens a password prompt',async()=>{
  const app=harness();const controller=new AbortController();controller.abort();
  assert.equal(await app.start({signal:controller.signal}),false);assert.equal(app.scope.dialog.open,false);assert.equal(app.counts().verificationCount,0);
});
test('actual wallet-lock event handler cancels pending authorization',async()=>{
  const app=harness();let onLock;
  app.scope.window={addEventListener:(_event,handler)=>{onLock=handler}};
  app.scope.backupPhrase='';app.scope.currentView='messages';app.scope.layout=()=>{};
  app.scope.dialog.close=()=>{app.scope.dialog.open=false};
  app.scope.clearModal=()=>app.scope.modalCleanup?.();
  const handler=source.split('\n').find(line=>line.startsWith("window.addEventListener('tongban:wallet-locked'"));
  vm.runInContext(handler,app.scope);
  const pending=app.start();onLock();assert.equal(await pending,false);assert.equal(app.scope.dialog.open,false);
});
