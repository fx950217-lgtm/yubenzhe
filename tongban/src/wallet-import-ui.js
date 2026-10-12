const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mountWalletImport(container,{wallet,additional=false,onSuccess=()=>{}}={}){
 let mode='mnemonic',active=true,completed=false,keystore='',preview=null;
 let viewVersion=0,inputVersion=0,fileVersion=0,importing=false;
 function render(){
  const view=++viewVersion;inputVersion++;fileVersion++;keystore='';preview=null;
  container.innerHTML='<p class="modal-copy">选择导入方式。密钥只在本机解析，再使用新的本机密码加密保存。</p><div class="notice warn">当前仅支持 BSC 测试网，请使用无真实资产的测试钱包。导入冷钱包的助记词会使它成为本机热钱包；查看冷钱包请使用“观察地址”。</div><div class="wallet-import-tabs" role="tablist">'+[['mnemonic','助记词'],['private','私钥'],['keystore','加密文件']].map(([key,label])=>'<button type="button" role="tab" aria-selected="'+(mode===key)+'" class="'+(mode===key?'active':'')+'" data-import-mode="'+key+'">'+label+'</button>').join('')+'</div><form data-wallet-import>'+ (mode==='mnemonic'?'<label class="field">助记词<textarea name="phrase" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="用空格分隔英文单词" required></textarea></label><details><summary>高级恢复选项</summary><label class="field">助记词附加口令（可选）<input name="passphrase" type="password" autocomplete="off"><span class="field-hint">这是原钱包的 BIP39 附加口令，不是本机解锁密码；大小写和空格必须一致。</span></label><label class="field">派生路径<input name="path" value="'+esc(wallet.DEFAULT_DERIVATION_PATH)+'" autocomplete="off" spellcheck="false"><span class="field-hint">如原钱包使用其他账户，请填写相同的 EVM 派生路径。</span></label></details>':mode==='private'?'<label class="field">EVM 私钥<input name="privateKey" type="password" autocomplete="off" spellcheck="false" placeholder="64 位十六进制，可带 0x 前缀" required></label>':'<label class="field">JSON 加密密钥库<input name="file" type="file" accept=".json,application/json" required><span class="field-hint">Ethereum V3 Keystore，最大 1 MB。</span></label><label class="field">原加密文件密码<input name="sourcePassword" type="password" autocomplete="off"><span class="field-hint">原备份未设置密码时可留空。</span></label>')+'<label class="field">原钱包地址（可选）<input name="expectedAddress" autocomplete="off" spellcheck="false" placeholder="0x…"><span class="field-hint">有原地址时填写，可防止恢复到错误的账户。</span></label><label class="field">新本机解锁密码<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required placeholder="至少 10 位，包含字母和数字"></label><label class="field">确认新密码<input name="repeat" type="password" autocomplete="new-password" minlength="10" maxlength="256" required></label><p class="form-error" role="alert"></p><button class="secondary" type="button" data-preview-import>核对导入地址</button><div data-import-preview hidden><p class="modal-copy">即将导入这个地址，请与原钱包核对：</p><div class="address" data-derived-address></div><label class="check-label"><input type="checkbox" name="confirmed">我已核对地址，确认导入此账户</label><button type="submit" class="primary">导入并加密保存</button></div></form>';
  const form=container.querySelector('form'),error=form.querySelector('.form-error'),box=form.querySelector('[data-import-preview]'),previewButton=form.querySelector('[data-preview-import]'),submit=form.querySelector('[type=submit]');
  const tabs=[...container.querySelectorAll('[data-import-mode]')];
  const current=()=>active&&!completed&&view===viewVersion&&form.isConnected;
  const fail=e=>{error.textContent=e?.message||String(e);};
  const options=()=>({passphrase:form.elements.passphrase?.value||'',path:form.elements.path?.value||wallet.DEFAULT_DERIVATION_PATH});
  let previewBusy=false,reading=false;
  const previewReady=()=>{previewButton.disabled=importing||previewBusy||reading;};
  function invalidate(){inputVersion++;preview=null;box.hidden=true;form.elements.confirmed.checked=false;}
  function freeze(value){
   for(const control of form.querySelectorAll('input,textarea,button'))control.disabled=value;
   for(const tab of tabs)tab.disabled=value;
   form.setAttribute('aria-busy',String(value));
   if(!value)previewReady();
  }
  for(const tab of tabs)tab.onclick=()=>{
   if(!current()||importing||tab.dataset.importMode===mode)return;
   wallet.cancelCreation();mode=tab.dataset.importMode;render();
  };
  form.addEventListener('input',event=>{
   if(!current()||importing)return;
   if(!['confirmed','password','repeat'].includes(event.target.name))invalidate();
  });
  if(mode==='keystore')form.elements.file.onchange=async()=>{
   if(!current()||importing)return;
   const run=++fileVersion,file=form.elements.file.files?.[0];
   keystore='';invalidate();error.textContent='';reading=false;
   if(!file){previewReady();return;}
   if(file.size>(wallet.MAX_KEYSTORE_BYTES||1024*1024)){fail(new Error('加密文件不能超过 1 MB。'));previewReady();return;}
   reading=true;previewReady();
   try{
    const json=await file.text();
    if(!current()||run!==fileVersion)return;
    if(typeof json!=='string'||new TextEncoder().encode(json).length>(wallet.MAX_KEYSTORE_BYTES||1024*1024))throw new Error();
    JSON.parse(json);keystore=json;
   }catch{if(current()&&run===fileVersion){keystore='';fail(new Error('无法读取有效的 JSON 加密文件。'));}}
   finally{if(current()&&run===fileVersion){reading=false;previewReady();}}
  };
  previewButton.onclick=async()=>{
   if(!current()||importing||previewBusy||reading)return;
   invalidate();const run=inputVersion;previewBusy=true;previewReady();error.textContent='';
   const expected=form.elements.expectedAddress.value.trim();
   try{
    let found;
    if(mode==='mnemonic')found=await wallet.previewMnemonic(form.elements.phrase.value,options());
    else if(mode==='private')found=await wallet.previewPrivateKey(form.elements.privateKey.value);
    else{
     if(!keystore)throw new Error('请先选择有效的 JSON 加密文件。');
     found=await wallet.previewKeystore(keystore,form.elements.sourcePassword.value);
    }
    if(!current()||run!==inputVersion)return;
    if(expected&&expected.toLowerCase()!==found.address.toLowerCase())throw new Error('恢复地址与填写的原钱包地址不一致，请检查助记词、附加口令和派生路径。');
    preview=found;form.querySelector('[data-derived-address]').textContent=found.address;box.hidden=false;
   }catch(e){if(current()&&run===inputVersion)fail(e);}
   finally{if(current()){previewBusy=false;previewReady();}}
  };
  form.onsubmit=async event=>{
   event.preventDefault();if(!current()||importing)return;
   error.textContent='';
   try{
    if(!preview||!form.elements.confirmed.checked)throw new Error('请先核对地址并确认。');
    if(form.elements.password.value!==form.elements.repeat.value)throw new Error('两次输入的新密码不一致。');
    const run=inputVersion,expectedAddress=preview.address,password=form.elements.password.value;
    importing=true;freeze(true);
    if(mode==='mnemonic')await wallet.restoreWallet(form.elements.phrase.value,password,{...options(),expectedAddress,...(additional?{additional:true}:{})});
    else if(mode==='private')await wallet.importPrivateKey(form.elements.privateKey.value,password,{expectedAddress,...(additional?{additional:true}:{})});
    else await wallet.importKeystore(keystore,form.elements.sourcePassword.value,password,{expectedAddress,...(additional?{additional:true}:{})});
    if(!current()||run!==inputVersion)return;
    completed=true;keystore='';preview=null;form.reset();
    // onSuccess may synchronously call cleanup. Mark completion first so cleanup
    // does not cancel the newly imported wallet's successful operation.
    onSuccess();
   }catch(e){if(current())fail(e);}
   finally{importing=false;if(current())freeze(false);}
  };
 }
 render();
 return ()=>{
  if(!active)return;
  active=false;viewVersion++;inputVersion++;fileVersion++;keystore='';preview=null;
  container.replaceChildren();
  if(!completed)wallet.cancelCreation();
 };
}

export function mountWatchWallets(container,{wallet,toast=()=>{}}={}){
 let active=true,version=0;
 function render(){
  const view=++version;let accounts;
  try{accounts=wallet.listWatchWallets();}catch(error){container.innerHTML='<p class="form-error">'+esc(error.message)+'</p>';return;}
  container.innerHTML='<p class="modal-copy">只填写公开地址，就能查看它在 BSC 测试网的 tBNB 资产。不需要助记词或私钥，也不能替该地址签名转账。</p><form data-watch-form><label class="field">公开钱包地址<input name="address" autocomplete="off" spellcheck="false" required placeholder="0x…"></label><label class="field">备注<input name="label" maxlength="40" placeholder="例如：我的冷钱包"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">添加观察地址</button></form><div class="wallet-watch-list" style="margin-top:20px">'+accounts.map(item=>'<article class="wallet-watch-item" data-watch-address="'+esc(item.address)+'"><header><strong>'+esc(item.label||'观察钱包')+'</strong><small>只读</small></header><code>'+esc(item.address)+'</code><footer><span role="status">资产尚未读取</span><button class="subtle-button" data-watch-refresh>刷新</button><button class="subtle-button" data-watch-remove>移除</button></footer></article>').join('')+'</div>';
  const form=container.querySelector('form'),current=()=>active&&view===version;
  form.onsubmit=event=>{
   event.preventDefault();if(!current())return;
   try{wallet.addWatchWallet(form.elements.address.value,form.elements.label.value);render();toast('观察地址已保存');}
   catch(error){form.querySelector('.form-error').textContent=error.message;}
  };
  for(const row of container.querySelectorAll('[data-watch-address]')){
   row.querySelector('[data-watch-remove]').onclick=()=>{
    if(!current())return;
    try{wallet.removeWatchWallet(row.dataset.watchAddress);render();toast('观察地址已移除');}
    catch(error){toast(error.message);}
   };
   row.querySelector('[data-watch-refresh]').onclick=async event=>{
    const button=event.currentTarget||event.target,status=row.querySelector('[role=status]');
    if(!current()||button.disabled)return;
    button.disabled=true;status.textContent='正在读取…';
    try{const balance=await wallet.getWatchBalance(row.dataset.watchAddress);if(current()&&row.isConnected)status.textContent=balance+' tBNB';}
    catch(error){if(current()&&row.isConnected)status.textContent=error.message;}
    finally{if(current()&&button.isConnected)button.disabled=false;}
   };
  }
 }
 render();return ()=>{if(!active)return;active=false;version++;container.replaceChildren();};
}
