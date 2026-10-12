const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function walletManagementHTML(wallets){
 const selected=wallets.find(item=>item.selected);
 return `<p class="modal-copy">钱包和备注只保存在这台设备。切换会锁定钱包，并清除尚未签署的预览。</p>
 <div class="local-wallet-list" aria-label="本机钱包列表">${wallets.map(item=>`<button type="button" class="local-wallet-choice" data-select-wallet="${esc(item.id)}" ${item.selected?'aria-current="true" disabled':''}><span><strong>${esc(item.name)}</strong><small>${esc(item.address)}</small></span><span>${item.selected?'当前':'切换'}</span></button>`).join('')}</div>
 ${selected?`<form data-wallet-rename><label class="field">当前钱包备注<input name="name" maxlength="40" required value="${esc(selected.name)}" autocomplete="off"></label><button type="submit" class="secondary">保存备注</button></form>`:''}
 <p class="form-error" role="alert"></p><button type="button" class="primary" data-add-wallet>新建钱包</button><button type="button" class="secondary" data-import-additional>导入另一个钱包</button>
 ${selected?'<button type="button" class="secondary" data-local-export>导出当前钱包加密备份</button><button type="button" class="secondary" data-local-delete>删除当前本机钱包</button>':''}
 <p class="modal-copy">删除只移除所选钱包在本机的密钥和记录，不影响其他钱包、链上资产或其他设备的备份。</p>`;
}
