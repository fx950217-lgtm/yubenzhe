import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../src/discover-token.js', import.meta.url), 'utf8'))
  .replace("import './discover-token.css';", '')
  .replace("from './native-runtime.js'", `from '${new URL('../src/native-runtime.js', import.meta.url).href}'`)
  .replace("from 'ethers'", `from '${import.meta.resolve('ethers')}'`);
const { validateTokenBasics, validateTokenRecipient, validateTokenPreparation, tokenParameterDocument, validateIntegrationPreparation, createTokenStudio } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const address = '0x1111111111111111111111111111111111111111';
const token = (extra = {}) => ({ name:'Lime Club', symbol:'lime', supply:'1000000000', address, ownsWallet:true, ...extra });
const record = (id, extra = {}) => ({ id, type:'token', values:token(extra) });

function harness({ records = [], failSave = false, walletAddress = address } = {}) {
  let drafts = structuredClone(records), route = 'token', editingId = null, html = '', writes = 0, walletReads = 0;
  const notices = [], dialogs = [];
  let studio;
  const ctx = {
    getDraft: type => drafts.find(draft => draft.id === editingId && draft.type === type)?.values || {},
    getDraftMeta: type => drafts.find(draft => draft.id === editingId && draft.type === type) || null,
    getDraftKey: type => editingId || `new:${type}`,
    getDrafts: () => structuredClone(drafts),
    getWalletAddress: () => { walletReads++; return walletAddress; },
    validateToken: validateTokenPreparation,
    validateService(type, value) {
      const title = value.title.trim(), details = value.details.trim();
      if (!title || details.length < 10) throw new Error('需求信息不完整');
      return { ...value, title, details };
    },
    saveDraft(type, values) {
      if (failSave) throw new Error('本机草稿没有保存，请检查存储空间。');
      const id = editingId || `saved-${writes + 1}`;
      drafts = [{ id, type, values:structuredClone(values) }, ...drafts.filter(draft => draft.id !== id)];
      editingId = id; writes++; ctx.render(); return id;
    },
    go(next, options = {}) {
      route = next;
      editingId = Object.hasOwn(options, 'draftId') ? options.draftId : drafts.find(draft => draft.type === next)?.id || null;
      ctx.render();
    },
    render() { html = studio.render(route); },
    showDialog: (...args) => dialogs.push(args), closeDialog() {}, toast: text => notices.push(text), onBalance() {},
  };
  studio = createTokenStudio(ctx); ctx.render();
  function form(values, type = route) {
    const error = { textContent:'' }, elements = {};
    const node = { dataset:{ tokenForm:type, tokenKey:ctx.getDraftKey(type) }, elements, querySelector:() => error };
    node.closest = () => node;
    for (const [name,value] of Object.entries(values)) elements[name] = { name, value:typeof value === 'boolean' ? '' : value, checked:value === true, closest:() => node };
    return { node, error };
  }
  return {
    studio, ctx, notices, dialogs, html:() => html, drafts:() => drafts, writes:() => writes, walletReads:() => walletReads,
    go:ctx.go,
    action:(name, dataset = {}) => studio.handleAction(name,{ dataset }),
    input(name, value, extra = {}) { const f=form({ ...extra, [name]:value }); studio.handleInput({ target:f.node.elements[name] }); return f; },
    submit(values = {}, type = route) { const f=form(values,type); assert.equal(studio.handleSubmit({ target:f.node, preventDefault() {} }),true); return f; },
  };
}

test('basic fields reject invalid supply before reaching wallet selection', () => {
  assert.deepEqual(validateTokenBasics(token()), { name:'Lime Club', symbol:'LIME', supply:'1000000000' });
  for (const supply of ['0','01','-1','1.1','1e9','1000000000000001','9'.repeat(80),'']) assert.throws(() => validateTokenBasics(token({ supply })), /固定总量/);
  assert.equal(validateTokenBasics(token({ supply:'1000000000000000' })).supply,'1000000000000000');
  for (const symbol of ['a','1LIME','L-IME','L'.repeat(11)]) assert.throws(() => validateTokenBasics(token({ symbol })), /代币符号/);
  const app=harness();
  assert.match(app.submit(token({ supply:'0' })).error.textContent,/固定总量/);
  assert.match(app.html(),/01 \/ 基础信息/);
  assert.equal(app.writes(),0);
  app.studio.cleanup();
});

test('recipient requires nonzero EVM address and a fresh explicit ownership declaration', () => {
  assert.equal(validateTokenRecipient(token()).address,address);
  for (const invalid of ['0x123','0x0000000000000000000000000000000000000000','https://example.com']) assert.throws(() => validateTokenRecipient(token({ address:invalid })));
  for (const ownsWallet of [false,'true',1,null]) assert.throws(() => validateTokenRecipient(token({ ownsWallet })),/自己控制/);
  const app=harness(); app.submit(token());
  const changed=app.input('address',address,{ ownsWallet:true });
  assert.equal(changed.node.elements.ownsWallet.checked,false);
  assert.match(app.submit({ address, ownsWallet:false }).error.textContent,/自己控制/);
  app.studio.cleanup();
});

test('parameter export strips forged contracts, balances, fees, and live chain claims', () => {
  const document = tokenParameterDocument(token({ chainId:56, network:'mainnet', status:'deployed', contractAddress:address, balance:'99999', serviceFee:'999 USDT', privateKey:'must-not-export' }));
  assert.equal(document.chainId,97); assert.equal(document.network,'BSC Testnet');
  assert.equal(document.status,'not_deployed'); assert.equal(document.contractAddress,null); assert.equal(document.issuedTokens,false);
  assert.deepEqual(document.serviceFee,{ amount:'0',asset:'USDT',charged:false });
  assert.deepEqual(document.networkFee,{ status:'not_connected',amount:null });
  assert.equal(document.privateKey,undefined); assert.equal(document.balance,undefined);
  assert.equal(document.ownership,'user_declared_only');
});

test('integration treats 300 USDT as a separate uncharged service and validates optional deployed contract', () => {
  const base={ title:'Lime Club',details:'用于熟人社区中的红包与服务结算。',relatedDraftId:'token-a',hasContract:false,contractAddress:'' };
  const value=validateIntegrationPreparation(base,[record('token-a')]);
  assert.equal(value.serviceFee,'300 USDT'); assert.equal(value.status,'未提交'); assert.equal(value.contractAddress,'');
  assert.equal(value.settlement,'平台余额'); assert.equal(value.network,'BSC 测试网');
  assert.throws(() => validateIntegrationPreparation({ ...base,contractAddress:address },[record('token-a')]),/已经部署/);
  assert.throws(() => validateIntegrationPreparation({ ...base,hasContract:true },[record('token-a')]),/合约地址/);
  assert.throws(() => validateIntegrationPreparation({ ...base,hasContract:true,contractAddress:'0x0000000000000000000000000000000000000000' },[record('token-a')]),/零地址/);
  assert.throws(() => validateIntegrationPreparation(base,[]),/不存在/);
  assert.equal(validateIntegrationPreparation({ ...base,hasContract:true,contractAddress:address },[record('token-a')]).contractAddress,address);
});

test('three steps save only after preview, then survive a synchronous parent rerender with saved id', () => {
  const app=harness();
  app.submit(token()); assert.match(app.html(),/02 \/ 接收钱包/); assert.equal(app.writes(),0);
  app.action('t-use-wallet'); assert.equal(app.walletReads(),1); assert.match(app.html(),new RegExp(address));
  app.submit({ address,ownsWallet:true }); assert.match(app.html(),/03 \/ 核对预览/); assert.equal(app.writes(),0);
  app.submit(); assert.equal(app.writes(),1);
  assert.match(app.html(),/草稿已保存 · 未部署 · 未扣款/);
  assert.equal(app.drafts()[0].values.status,'未部署'); assert.equal(app.drafts()[0].values.contractAddress,undefined);
  app.studio.cleanup();
});

test('save failure preserves review inputs and never shows saved success', () => {
  const app=harness({ failSave:true });
  app.submit(token()); app.submit({ address,ownsWallet:true });
  const result=app.submit();
  assert.match(result.error.textContent,/没有保存/); assert.equal(app.writes(),0);
  app.ctx.render();
  assert.match(app.html(),/03 \/ 核对预览/); assert.match(app.html(),/Lime Club/);
  assert.doesNotMatch(app.html(),/草稿已保存 · 未部署 · 未扣款/);
  app.studio.cleanup();
});

test('editing sessions are isolated by type and draft id through navigation', () => {
  const app=harness({ records:[record('alpha',{ name:'Alpha Club' }),record('beta',{ name:'Beta Club' })] });
  app.go('token',{ draftId:'alpha' }); app.input('name','Alpha Edited');
  app.go('integration',{ draftId:null }); app.input('title','Independent Request');
  app.go('token',{ draftId:'beta' }); assert.match(app.html(),/value="Beta Club"/);
  app.go('token',{ draftId:'alpha' }); assert.match(app.html(),/value="Alpha Edited"/);
  app.go('integration',{ draftId:null }); assert.match(app.html(),/value="Independent Request"/);
  assert.equal(app.drafts().find(draft => draft.id==='alpha').values.name,'Alpha Club');
  assert.equal(app.writes(),0); app.studio.cleanup();
});

test('projects show only real active token drafts with canonical status and escaped content', () => {
  const app=harness({ records:[record('real',{ name:'<b>real</b>',status:'deployed',contractAddress:address }),{ ...record('hidden'),archivedAt:1 },{ id:'request',type:'integration',values:{ title:'not a token' } }] });
  app.go('token-projects');
  assert.match(app.html(),/&lt;b&gt;real&lt;\/b&gt;/);
  assert.match(app.html(),/data-id="real"/); assert.doesNotMatch(app.html(),/data-id="hidden"|data-id="request"/);
  assert.doesNotMatch(app.html(),new RegExp(address)); assert.match(app.html(),/尚未生成/);
  assert.equal(app.action('unrelated-action'),false); assert.equal(app.action('t-unknown'),false);
  app.studio.cleanup(); assert.equal(app.action('t-new-token'),false);
});

test('missing current wallet only explains next steps and cannot create or unlock one', () => {
  const app=harness({ walletAddress:null }); app.submit(token()); app.action('t-use-wallet');
  assert.match(app.html(),/尚无可读取的本机钱包/); assert.equal(app.walletReads(),1);
  assert.equal(app.writes(),0); assert.match(app.html(),/02 \/ 接收钱包/);
  app.studio.cleanup();
});
