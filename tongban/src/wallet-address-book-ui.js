import {createWalletAddressBook,ADDRESS_BOOK_KEY} from './wallet-address-book.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mountWalletAddressBook(root,{book=createWalletAddressBook(),onSelect=()=>{},events=globalThis.window}={}){
 let active=true,busy=false,editing=null,confirming=null,error='';
 function render(){
  if(!active)return;let rows=[],unavailable=false;const writable=book.isWritable?.()!==false,disabled=busy?' disabled':'';
  try{rows=book.list();}catch(e){error=e.message;unavailable=true;}
  root.innerHTML='<section class="wallet-address-book" aria-busy="'+busy+'"><p class="modal-copy">仅保存在这台设备，不会上传。选择地址后仍需核对网络、地址和金额。</p>'+(error?'<p class="form-error" role="alert">'+esc(error)+'</p>':'')+
   (!writable?'<p class="modal-copy" role="status">当前设备暂不支持安全保存地址簿；可以选用已有地址，或在转账页手动填写收款地址。</p>':'')+
   (unavailable?'':'<div class="address-book-list">'+rows.map(row=>'<article class="address-book-entry"><strong>'+esc(row.name)+'</strong><code>'+esc(row.address)+'</code>'+(row.note?'<p>'+esc(row.note)+'</p>':'')+'<div class="address-book-actions">'+(writable&&confirming===row.id?'<span>删除此地址记录？</span><button type="button" data-ab-delete="'+esc(row.id)+'"'+disabled+'>确认删除</button><button type="button" data-ab-cancel-delete'+disabled+'>取消</button>':'<button type="button" data-ab-select="'+esc(row.id)+'"'+disabled+'>选用</button>'+(writable?'<button type="button" data-ab-edit="'+esc(row.id)+'"'+disabled+'>编辑</button><button type="button" data-ab-confirm="'+esc(row.id)+'"'+disabled+'>删除</button>':''))+'</div></article>').join('')+(!rows.length?'<p class="modal-copy">还没有保存的地址。</p>':'')+'</div>'+
   (!writable?'':editing?'<form data-address-book-form><label class="field">备注名<input name="name" value="'+esc(editing.name)+'" maxlength="40" required autocomplete="off"'+disabled+'></label><label class="field">EVM 公开地址<input name="address" value="'+esc(editing.address)+'" required autocomplete="off" autocapitalize="off" spellcheck="false"'+disabled+'></label><label class="field">备注（可选）<input name="note" value="'+esc(editing.note)+'" maxlength="160" autocomplete="off"'+disabled+'></label><div class="address-book-actions"><button type="submit"'+disabled+'>'+(busy?'正在保存…':'保存到本机')+'</button><button type="button" data-ab-cancel-edit'+disabled+'>取消编辑</button></div></form>':'<button type="button" class="secondary" data-ab-add'+disabled+'>添加地址</button>'))+'</section>';
  const one=s=>root.querySelector(s),all=s=>root.querySelectorAll(s);
  const click=(node,fn)=>node?.addEventListener('click',()=>{if(active&&!busy)return fn();});
  click(one('[data-ab-add]'),()=>{editing={name:'',address:'',note:''};error='';confirming=null;render();});
  click(one('[data-ab-cancel-edit]'),()=>{editing=null;error='';render();});
  click(one('[data-ab-cancel-delete]'),()=>{confirming=null;render();});
  for(const node of all('[data-ab-edit]'))click(node,()=>{editing={...rows.find(r=>r.id===node.dataset.abEdit)};confirming=null;error='';render();});
  for(const node of all('[data-ab-confirm]'))click(node,()=>{confirming=node.dataset.abConfirm;editing=null;render();});
  for(const node of all('[data-ab-delete]'))click(node,async()=>{
   const row=rows.find(r=>r.id===node.dataset.abDelete);busy=true;render();
   try{await book.remove(row.id,row.revision);if(!active)return;confirming=null;error='';}catch(e){if(!active)return;error=e.message;}finally{busy=false;if(active)render();}
  });
  for(const node of all('[data-ab-select]'))node.addEventListener('click',()=>{
   if(!active||busy)return;try{const shown=rows.find(r=>r.id===node.dataset.abSelect),fresh=book.list().find(r=>r.id===shown.id);if(!fresh||fresh.revision!==shown.revision)throw Error('地址记录已改变，请重新选择。');onSelect(fresh.address);error='';}catch(e){error=e.message;render();}
  });
  const form=one('[data-address-book-form]');if(form)form.addEventListener('submit',async e=>{
   e.preventDefault();if(!active||busy)return;const values=form.elements,draft={name:values.name.value,address:values.address.value,note:values.note.value},options=editing.id?{id:editing.id,revision:editing.revision}:{};
   editing={...editing,...draft};busy=true;render();
   try{await book.save(draft,options);if(!active)return;editing=null;error='';}catch(e){if(!active)return;error=e.message;}finally{busy=false;if(active)render();}
  });
 }
 function onStorage(event){if(!active||busy||event.key!==ADDRESS_BOOK_KEY&&event.key!==null)return;editing=null;confirming=null;error='地址簿已在其他窗口更新，请重新核对。';render();}
 events?.addEventListener('storage',onStorage);render();
 return()=>{active=false;events?.removeEventListener('storage',onStorage);};
}
