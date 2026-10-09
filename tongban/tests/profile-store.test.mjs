import test from 'node:test';
import assert from 'node:assert/strict';
import {getLocalProfile,saveLocalProfile,PROFILE_AVATARS} from '../src/profile-store.js';
const storage=()=>{const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,v)=>data.set(key,v),data}};
test('local profile is separate from wallet identity and saves editable fields only',()=>{
 const store=storage();store.setItem('tongban.wallet.vault','untouched');
 assert.equal(getLocalProfile(store).localId,'本机体验档案');
 const p=saveLocalProfile({nickname:'  新朋友  ',bio:'一起去海边',avatar:PROFILE_AVATARS[1],address:'fake',localId:'verified'},store);
 assert.equal(p.nickname,'新朋友');assert.equal(p.localId,'本机体验档案');assert.equal(p.address,undefined);
 assert.deepEqual(getLocalProfile(store),p);assert.equal(store.getItem('tongban.wallet.vault'),'untouched');
});
test('invalid and corrupted profiles do not overwrite existing user data',()=>{
 const store=storage();
 assert.throws(()=>saveLocalProfile({nickname:'',bio:'',avatar:'🌱'},store),/昵称/);
 assert.throws(()=>saveLocalProfile({nickname:'愚笨者',bio:'',avatar:'<script>'},store),/头像/);
 assert.throws(()=>saveLocalProfile({nickname:'愚笨者',bio:'x'.repeat(81),avatar:'🌱'},store),/签名/);
 store.setItem('tongban.profile.v1','corrupt');
 assert.throws(()=>getLocalProfile(store),/无法读取/);
 assert.throws(()=>saveLocalProfile({nickname:'有效昵称',bio:'',avatar:'🌱'},store),/无法读取/);
 assert.equal(store.getItem('tongban.profile.v1'),'corrupt');
});
test('profile save failure is explicit rather than an optimistic success',()=>{
 const store={getItem:()=>null,setItem:()=>{throw new Error('quota')}};
 assert.throws(()=>saveLocalProfile({nickname:'朋友',bio:'',avatar:'🌱'},store),/没有保存/);
});
