import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const setupSource = source.slice(source.indexOf('function beginWalletSetup('), source.indexOf('\nfunction backupModal('));

function harness({ honorEpoch = true } = {}) {
  let epoch = 0, release, pending, backupCount = 0, restoreCount = 0, resumed = 0;
  const password = { value: 'synthetic-test-only' }, repeat = { value: 'synthetic-test-only' }, importButton = {};
  const form = { isConnected: true, querySelector: selector => selector === '#password' ? password : repeat };
  const dialog = { open: false };
  const scope = {
    walletIntent: null, backupPhrase: '', modalCleanup: null, dialog,
    currentView: 'messages', icon: () => '', state: () => ({ exists: false }), walletProblem: () => false,
    layout: () => {}, refreshBalance: () => {}, toast: () => {},
    wallet: {
      cancelCreation() { epoch++; },
      createWallet() {
        const startEpoch = epoch;
        return new Promise(resolve => { release = resolve; }).then(() => {
          if (honorEpoch && epoch !== startEpoch) throw new Error('创建已取消');
          return { phrase: 'synthetic phrase that must never replace the restore screen' };
        });
      },
    },
    showModal(_title, _html, setup, cleanup) {
      dialog.open = true; scope.modalCleanup = cleanup;
      setup({ querySelector: selector => selector === '#import-wallet' ? importButton : form });
    },
    restoreModal() {
      // Like the shared modal, replacing a screen runs any remaining cleanup.
      scope.modalCleanup?.(); scope.modalCleanup = null;
      form.isConnected = false; restoreCount++;
    },
    backupModal() { backupCount++; },
    closeModal() { dialog.open = false; scope.modalCleanup?.(); scope.modalCleanup = null; form.isConnected = false; },
    busyForm(_form, job) { pending = job(); },
  };
  vm.createContext(scope); vm.runInContext(setupSource, scope);
  const after = () => { resumed++; };
  return {
    scope, form, password, repeat, after,
    start: () => scope.beginWalletSetup(after),
    submit() { form.onsubmit({ preventDefault() {}, target: form }); return pending; },
    restore: () => importButton.onclick(), complete: () => release(), cancel: () => scope.closeModal(),
    counts: () => ({ epoch, backupCount, restoreCount, resumed }),
  };
}

test('switching from pending creation to restore cancels its epoch while preserving the intended next screen', async () => {
  const app = harness(); app.start();
  const creation = app.submit();
  assert.equal(app.password.value, ''); assert.equal(app.repeat.value, '');
  app.restore();
  assert.equal(app.counts().epoch, 1);
  assert.equal(app.scope.walletIntent, app.after);
  app.complete();
  await assert.rejects(creation, /创建已取消/);
  assert.equal(app.counts().backupCount, 0);
  assert.equal(app.counts().restoreCount, 1);
  assert.equal(app.counts().resumed, 0);
  assert.equal(app.scope.backupPhrase, '');
});

test('even a stale successful creation result cannot replace the restore form or expose its phrase', async () => {
  const app = harness({ honorEpoch: false }); app.start();
  const creation = app.submit(); app.restore(); app.complete(); await creation;
  assert.equal(app.counts().backupCount, 0);
  assert.equal(app.scope.backupPhrase, '');
  assert.equal(app.scope.walletIntent, app.after);
  assert.equal(app.counts().resumed, 0);
});

test('closing creation clears the pending intent and suppresses any stale completion', async () => {
  const app = harness({ honorEpoch: false }); app.start();
  const creation = app.submit(); app.cancel(); app.complete(); await creation;
  assert.equal(app.scope.walletIntent, null);
  assert.equal(app.counts().epoch, 1);
  assert.equal(app.counts().backupCount, 0);
  assert.equal(app.counts().resumed, 0);
});
