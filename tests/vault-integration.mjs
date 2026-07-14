import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const vaultSource = readFileSync(resolve(root, 'secure-vault.js'), 'utf8');
const appSource = readFileSync(resolve(root, 'app.js'), 'utf8');
const PASSWORD = 'correct horse battery staple';
const NEXT_PASSWORD = 'updated local password 2026';
const RESET_PASSWORD = 'recovered local password 2026';
const FINAL_PASSWORD = 'final local password 2026';
const TODAY = new Date().toISOString().slice(0, 10);

function wait(milliseconds = 0) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitFor(predicate, message, timeout = 15000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(15);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

function setValue(window, selector, value) {
  const input = window.document.querySelector(selector);
  assert(input, `Missing input ${selector}`);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  return input;
}

function submit(window, selector) {
  const form = window.document.querySelector(selector);
  assert(form, `Missing form ${selector}`);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

function click(window, selector) {
  const target = window.document.querySelector(selector);
  assert(target, `Missing target ${selector}`);
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function readStore(indexedDB, storeName) {
  return new Promise((resolvePromise, reject) => {
    const request = indexedDB.open('duomi-growth-vault-v2', 1);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction(storeName, 'readonly').objectStore(storeName).get('primary');
      get.onsuccess = () => {
        db.close();
        resolvePromise(get.result || null);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function createLegacySecureDatabase(indexedDB, password, clearVault) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  async function encryptJson(value) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(value))
    );
    return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
  }
  const auth = {
    version: 1,
    salt: bytesToBase64(salt),
    iterations: 600000,
    verifier: await encryptJson({ ok: true, format: 'duomi-v1' })
  };
  const encryptedVault = await encryptJson(clearVault);
  await new Promise((resolvePromise, reject) => {
    const request = indexedDB.open('duomi-growth-secure', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('kv', 'readwrite');
      transaction.objectStore('kv').put(auth, 'auth');
      transaction.objectStore('kv').put(encryptedVault, 'vault');
      transaction.oncomplete = () => {
        db.close();
        resolvePromise();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function createEnvironment({ indexedDB = new IDBFactory(), seedLocalStorage } = {}) {
  const dom = new JSDOM(html, {
    url: 'https://local-test.invalid/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const downloads = [];
  const consoleErrors = [];

  Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDB });
  Object.defineProperty(window, 'structuredClone', { configurable: true, value: structuredClone });
  Object.defineProperty(window, 'TextEncoder', { configurable: true, value: TextEncoder });
  Object.defineProperty(window, 'TextDecoder', { configurable: true, value: TextDecoder });
  Object.defineProperty(window, 'Blob', { configurable: true, value: Blob });
  Object.defineProperty(window.navigator, 'storage', {
    configurable: true,
    value: {
      persisted: async () => true,
      persist: async () => true
    }
  });
  window.confirm = () => true;
  window.alert = () => {};
  window.console.error = (...args) => consoleErrors.push(args);
  window.URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return `blob:test-${downloads.length}`;
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {} });
  window.Chart = class {
    constructor(_context, config) { this.config = config; }
    destroy() {}
  };

  if (seedLocalStorage) seedLocalStorage(window.localStorage);
  window.eval(vaultSource);
  window.eval(appSource);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await waitFor(
    () => window.document.querySelector('#vaultSetupForm:not([hidden]), #vaultUnlockForm:not([hidden])'),
    'Vault gate did not initialize'
  );
  return { dom, window, indexedDB, downloads, consoleErrors };
}

async function confirmDisplayedRecoveryCode(environment) {
  const { window } = environment;
  await waitFor(() => !window.document.querySelector('#vaultRecoveryOverlay').hidden, 'Recovery confirmation did not open');
  const code = window.document.querySelector('#vaultRecoveryCodeDisplay').textContent;
  const groups = code.split('-');
  assert.equal(groups.length, 8);
  assert.equal(groups.join('').length, 32);
  for (const input of window.document.querySelectorAll('#vaultRecoveryGroupFields input')) {
    input.value = groups[Number(input.dataset.groupIndex)];
  }
  window.document.querySelector('#vaultRecoverySaved').checked = true;
  submit(window, '#vaultRecoveryConfirmForm');
  return code;
}

async function createAccount(environment, { username = '测试用户', password = PASSWORD } = {}) {
  const { window } = environment;
  setValue(window, '#vaultSetupUsername', username);
  setValue(window, '#vaultSetupPassword', password);
  setValue(window, '#vaultSetupConfirm', password);
  submit(window, '#vaultSetupForm');
  const recoveryCode = await confirmDisplayedRecoveryCode(environment);
  await waitFor(() => !window.document.querySelector('#vaultBackupPrompt').hidden, 'Backup prompt did not open');
  click(window, '#vaultBackupLater');
  await waitFor(() => window.DuomiVault.isUnlocked(), 'Account did not unlock after creation');
  return recoveryCode;
}

async function unlock(environment, password, shouldSucceed = true) {
  const { window } = environment;
  setValue(window, '#vaultUnlockPassword', password);
  submit(window, '#vaultUnlockForm');
  if (shouldSucceed) {
    await waitFor(() => window.DuomiVault.isUnlocked(), 'Correct password did not unlock');
  } else {
    await waitFor(() => window.document.querySelector('#vaultGateMessage').textContent.includes('密码错误'), 'Wrong password was not rejected');
    assert.equal(window.DuomiVault.isUnlocked(), false);
  }
}

async function dismissNotice(window, expectedTitle) {
  await waitFor(
    () => !window.document.querySelector('#vaultActionOverlay').hidden && window.document.querySelector('#vaultActionTitle').textContent === expectedTitle,
    `Notice did not open: ${expectedTitle}`
  );
  submit(window, '#vaultActionForm');
  await waitFor(() => window.document.querySelector('#vaultActionOverlay').hidden, `Notice did not close: ${expectedTitle}`);
}

async function addBusinessData(environment) {
  const { window } = environment;
  await waitFor(() => window.document.querySelector('#childInfoModal').classList.contains('show'), 'Baby information modal did not open');
  setValue(window, '#childName', '加密测试宝宝');
  setValue(window, '#childBirthDate', '2024-01-02');
  submit(window, '#childInfoForm');
  await waitFor(() => window.getChildInfo()?.childName === '加密测试宝宝', 'Baby information was not saved');

  click(window, '#openAddModalBtn');
  setValue(window, '#addDate', '2025-02-03');
  setValue(window, '#addHeight', '81.5');
  setValue(window, '#addWeight', '11.25');
  submit(window, '#addForm');
  await waitFor(() => window.getRecords().length === 1, 'Growth record was not saved');

  click(window, '#openMilkModalBtn');
  setValue(window, '#milkDate', TODAY);
  setValue(window, '#milkTime', '08:15');
  setValue(window, '#milkAmount', '180');
  window.document.querySelector('input[name="milkType"][value="formula"]').checked = true;
  submit(window, '#milkForm');
  await waitFor(() => window.getMilkRecords().length === 1, 'Milk record was not saved');

  click(window, '.nav-tab[data-page="list"]');
  assert(window.document.querySelector('#listContent').textContent.includes('2025-02-03'));
  click(window, '.nav-tab[data-page="chart"]');
  assert(window.document.querySelector('#page-chart').classList.contains('active'));
  click(window, '.nav-tab[data-page="milk"]');
  assert(window.document.querySelector('#milkTodaySummary').textContent.includes('180'));
}

async function exportBackup(environment) {
  const { window, downloads } = environment;
  window.DuomiVault.openSecurityMenu();
  click(window, '#vaultExportBackup');
  await waitFor(() => downloads.length > 0, 'Encrypted backup was not generated');
  const text = await downloads.at(-1).text();
  const backup = JSON.parse(text);
  assert.equal(backup.format, 'duomi-growth-encrypted-backup');
  assert.equal(backup.version, 2);
  assert(backup.account.passwordWrappedKey);
  assert(backup.account.recoveryWrappedKey);
  assert(backup.vault.ciphertext);
  for (const secret of ['加密测试宝宝', '2025-02-03', '08:15', PASSWORD]) {
    assert(!text.includes(secret), `Backup leaked plaintext: ${secret}`);
  }
  return { backup, text };
}

async function restoreBackup(environment, backupText, mode, credential) {
  const { window } = environment;
  click(window, '#vaultSetupRestore');
  const fileInput = window.document.querySelector('#vaultBackupFile');
  const backupFile = { size: Buffer.byteLength(backupText), text: async () => backupText };
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [backupFile] });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => window.document.querySelector('#vaultBackupSummary').textContent.includes('测试用户'), 'Backup was not parsed');
  setValue(window, '#vaultRestoreMode', mode);
  setValue(window, '#vaultRestoreCredential', credential);
  submit(window, '#vaultRestoreForm');
  await dismissNotice(window, '备份恢复成功');
  assert.equal(window.getChildInfo().childName, '加密测试宝宝');
  assert.equal(window.getRecords().length, 1);
  assert.equal(window.getMilkRecords().length, 1);
}

async function run() {
  const sharedIndexedDB = new IDBFactory();
  const primary = await createEnvironment({ indexedDB: sharedIndexedDB });
  const recoveryCode = await createAccount(primary);
  await addBusinessData(primary);

  const storedAccount = await readStore(sharedIndexedDB, 'account');
  const storedVault = await readStore(sharedIndexedDB, 'vault');
  assert.equal(storedAccount.passwordKdf.name, 'PBKDF2');
  assert.equal(storedAccount.passwordKdf.iterations, 600000);
  assert.equal(storedAccount.recoveryKdf.name, 'HKDF');
  assert.equal(storedVault.revision, 4);
  const persisted = JSON.stringify({ storedAccount, storedVault });
  for (const plaintext of ['加密测试宝宝', '2025-02-03', '08:15', PASSWORD, recoveryCode]) {
    assert(!persisted.includes(plaintext), `IndexedDB leaked plaintext: ${plaintext}`);
  }

  const { text: backupText } = await exportBackup(primary);

  await primary.window.DuomiVault.lock();
  assert.equal(primary.window.getRecords().length, 0);
  assert.equal(primary.window.document.querySelector('#navTitle').textContent, '多米的成长记录 🌱');
  await unlock(primary, 'definitely wrong password', false);
  await unlock(primary, PASSWORD, true);
  assert.equal(primary.window.getMilkRecords()[0].milkAmount, 180);

  const secondTab = await createEnvironment({ indexedDB: sharedIndexedDB });
  assert.equal(secondTab.window.document.querySelector('#vaultUnlockUsername').textContent, '测试用户');
  await unlock(secondTab, PASSWORD, true);
  const firstTabRecords = primary.window.getRecords();
  firstTabRecords.push({ id: 'tab-a', recordDate: '2025-03-04', height: 82, weight: 11.5 });
  await primary.window.saveRecords(firstTabRecords);
  await assert.rejects(
    secondTab.window.saveRecords([{ id: 'tab-b', recordDate: '2025-03-05', height: 83, weight: 11.8 }]),
    /另一个标签页/
  );
  await waitFor(() => !secondTab.window.DuomiVault.isUnlocked(), 'Stale second tab did not lock');

  primary.window.DuomiVault.openSecurityMenu();
  click(primary.window, '#vaultChangePassword');
  await waitFor(() => !primary.window.document.querySelector('#vaultActionOverlay').hidden, 'Password dialog did not open');
  setValue(primary.window, '#vaultActionForm input[name="current"]', PASSWORD);
  setValue(primary.window, '#vaultActionForm input[name="next"]', NEXT_PASSWORD);
  setValue(primary.window, '#vaultActionForm input[name="confirm"]', NEXT_PASSWORD);
  submit(primary.window, '#vaultActionForm');
  await dismissNotice(primary.window, '密码已修改');
  await primary.window.DuomiVault.lock();
  await unlock(primary, PASSWORD, false);
  await unlock(primary, NEXT_PASSWORD, true);

  await primary.window.DuomiVault.lock();
  click(primary.window, '#vaultForgotPassword');
  setValue(primary.window, '#vaultRecoveryCode', recoveryCode);
  setValue(primary.window, '#vaultRecoveryPassword', RESET_PASSWORD);
  setValue(primary.window, '#vaultRecoveryConfirm', RESET_PASSWORD);
  submit(primary.window, '#vaultRecoveryForm');
  await dismissNotice(primary.window, '密码已重置');
  assert.equal(primary.window.DuomiVault.isUnlocked(), true);
  await primary.window.DuomiVault.lock();
  await unlock(primary, NEXT_PASSWORD, false);
  await unlock(primary, RESET_PASSWORD, true);

  const recoveryWrapBefore = (await readStore(sharedIndexedDB, 'account')).recoveryWrappedKey.ciphertext;
  primary.window.DuomiVault.openSecurityMenu();
  click(primary.window, '#vaultRegenerateRecovery');
  const regeneratedRecoveryCode = await confirmDisplayedRecoveryCode(primary);
  await dismissNotice(primary.window, '恢复码已更新');
  const recoveryWrapAfter = (await readStore(sharedIndexedDB, 'account')).recoveryWrappedKey.ciphertext;
  assert.notEqual(recoveryWrapAfter, recoveryWrapBefore);
  assert.notEqual(regeneratedRecoveryCode, recoveryCode);

  await primary.window.DuomiVault.lock();
  click(primary.window, '#vaultForgotPassword');
  setValue(primary.window, '#vaultRecoveryCode', recoveryCode);
  setValue(primary.window, '#vaultRecoveryPassword', FINAL_PASSWORD);
  setValue(primary.window, '#vaultRecoveryConfirm', FINAL_PASSWORD);
  submit(primary.window, '#vaultRecoveryForm');
  await waitFor(() => primary.window.document.querySelector('#vaultGateMessage').classList.contains('vault-error'), 'Old recovery code was not invalidated');
  assert.equal(primary.window.DuomiVault.isUnlocked(), false);
  setValue(primary.window, '#vaultRecoveryCode', regeneratedRecoveryCode);
  submit(primary.window, '#vaultRecoveryForm');
  await dismissNotice(primary.window, '密码已重置');
  assert.equal(primary.window.DuomiVault.isUnlocked(), true);

  const passwordRestore = await createEnvironment();
  await restoreBackup(passwordRestore, backupText, 'password', PASSWORD);
  const recoveryRestore = await createEnvironment();
  await restoreBackup(recoveryRestore, backupText, 'recovery', recoveryCode);

  const corruptRestore = await createEnvironment();
  const corrupt = JSON.parse(backupText);
  corrupt.vault.ciphertext = `${corrupt.vault.ciphertext.slice(0, -2)}AA`;
  click(corruptRestore.window, '#vaultSetupRestore');
  const corruptInput = corruptRestore.window.document.querySelector('#vaultBackupFile');
  const corruptText = JSON.stringify(corrupt);
  Object.defineProperty(corruptInput, 'files', {
    configurable: true,
    value: [{ size: Buffer.byteLength(corruptText), text: async () => corruptText }]
  });
  corruptInput.dispatchEvent(new corruptRestore.window.Event('change', { bubbles: true }));
  await waitFor(() => corruptRestore.window.document.querySelector('#vaultBackupSummary').textContent.includes('测试用户'), 'Corrupt backup metadata was not read');
  setValue(corruptRestore.window, '#vaultRestoreCredential', PASSWORD);
  submit(corruptRestore.window, '#vaultRestoreForm');
  await waitFor(() => corruptRestore.window.document.querySelector('#vaultGateMessage').classList.contains('vault-error'), 'Corrupt backup was not rejected');
  assert.equal(await readStore(corruptRestore.indexedDB, 'account'), null);

  const migrated = await createEnvironment({
    seedLocalStorage(storage) {
      storage.setItem('childGrowthInfo', JSON.stringify({ childName: '旧数据宝宝', birthDate: '2023-06-01' }));
      storage.setItem('childGrowthRecords', JSON.stringify([{ id: 'old-growth', recordDate: '2024-02-01', height: 70, weight: 8.2 }]));
      storage.setItem('childMilkRecords', JSON.stringify([{ id: 'old-milk', milkDate: TODAY, milkTime: '07:30', milkAmount: 150, milkType: 'breast' }]));
    }
  });
  assert.equal(migrated.window.document.querySelector('#vaultSetupSource').value, 'plaintext');
  await createAccount(migrated, { username: '迁移用户' });
  assert.equal(migrated.window.getChildInfo().childName, '旧数据宝宝');
  assert.equal(migrated.window.getRecords()[0].id, 'old-growth');
  assert.equal(migrated.window.localStorage.getItem('childGrowthInfo'), null);
  assert.equal(migrated.window.localStorage.getItem('childGrowthRecords'), null);
  assert.equal(migrated.window.localStorage.getItem('childMilkRecords'), null);

  const dualSourceIndexedDB = new IDBFactory();
  await createLegacySecureDatabase(dualSourceIndexedDB, 'old vault password 2026', {
    version: 1,
    childInfo: { childName: '旧保险箱宝宝', birthDate: '2022-01-01' },
    growthRecords: [{ id: 'secure-growth', recordDate: '2023-01-01', height: 66, weight: 7.4 }],
    milkRecords: []
  });
  const dualSource = await createEnvironment({
    indexedDB: dualSourceIndexedDB,
    seedLocalStorage(storage) {
      storage.setItem('childGrowthInfo', JSON.stringify({ childName: '未选择的明文宝宝', birthDate: '2021-01-01' }));
      storage.setItem('childGrowthRecords', JSON.stringify([]));
      storage.setItem('childMilkRecords', JSON.stringify([]));
    }
  });
  assert.equal(dualSource.window.document.querySelector('#vaultSetupSource').value, '');
  setValue(dualSource.window, '#vaultSetupUsername', '双来源用户');
  setValue(dualSource.window, '#vaultSetupPassword', PASSWORD);
  setValue(dualSource.window, '#vaultSetupConfirm', PASSWORD);
  submit(dualSource.window, '#vaultSetupForm');
  await waitFor(() => dualSource.window.document.querySelector('#vaultGateMessage').textContent.includes('明确选择'), 'Dual legacy sources did not require an explicit choice');
  assert(dualSource.window.localStorage.getItem('childGrowthInfo'));
  setValue(dualSource.window, '#vaultSetupSource', 'secure-v1');
  setValue(dualSource.window, '#vaultLegacyPassword', 'old vault password 2026');
  submit(dualSource.window, '#vaultSetupForm');
  await confirmDisplayedRecoveryCode(dualSource);
  await waitFor(() => !dualSource.window.document.querySelector('#vaultBackupPrompt').hidden, 'Secure-v1 migration did not finish');
  click(dualSource.window, '#vaultBackupLater');
  assert.equal(dualSource.window.getChildInfo().childName, '旧保险箱宝宝');
  assert.equal(dualSource.window.getRecords()[0].id, 'secure-growth');
  assert(dualSource.window.localStorage.getItem('childGrowthInfo'), 'Unselected plaintext source was unexpectedly removed');
  assert((await dualSourceIndexedDB.databases()).some((entry) => entry.name === 'duomi-growth-secure'), 'Old secure vault was removed before a new backup');

  const failedMigration = await createEnvironment({
    seedLocalStorage(storage) {
      storage.setItem('childGrowthRecords', '{broken-json');
    }
  });
  setValue(failedMigration.window, '#vaultSetupUsername', '失败迁移');
  setValue(failedMigration.window, '#vaultSetupPassword', PASSWORD);
  setValue(failedMigration.window, '#vaultSetupConfirm', PASSWORD);
  submit(failedMigration.window, '#vaultSetupForm');
  await waitFor(() => failedMigration.window.document.querySelector('#vaultGateMessage').textContent.includes('已损坏'), 'Broken legacy data was not rejected');
  assert.equal(failedMigration.window.localStorage.getItem('childGrowthRecords'), '{broken-json');
  assert.equal(await readStore(failedMigration.indexedDB, 'account'), null);

  await primary.window.DuomiVault.lock();
  const reloaded = await createEnvironment({ indexedDB: sharedIndexedDB });
  assert.equal(reloaded.window.DuomiVault.isUnlocked(), false);
  assert.equal(reloaded.window.getRecords().length, 0);
  assert.equal(reloaded.window.document.querySelector('#vaultUnlockUsername').textContent, '测试用户');
  const nativeSetTimeout = reloaded.window.setTimeout.bind(reloaded.window);
  reloaded.window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay === 900000 ? 25 : delay, ...args);
  await unlock(reloaded, FINAL_PASSWORD, true);
  await waitFor(
    () => !reloaded.window.DuomiVault.isUnlocked() && !reloaded.window.document.querySelector('#vaultGate').hidden,
    'Accelerated 15-minute idle lock did not fire'
  );

  const background = await createEnvironment({ indexedDB: sharedIndexedDB });
  await unlock(background, FINAL_PASSWORD, true);
  const backgroundSetTimeout = background.window.setTimeout.bind(background.window);
  background.window.setTimeout = (callback, delay, ...args) => backgroundSetTimeout(callback, delay === 300000 ? 25 : delay, ...args);
  Object.defineProperty(background.window.document, 'hidden', { configurable: true, value: true });
  background.window.document.dispatchEvent(new background.window.Event('visibilitychange'));
  await waitFor(
    () => !background.window.DuomiVault.isUnlocked() && !background.window.document.querySelector('#vaultGate').hidden,
    'Accelerated five-minute background lock did not fire'
  );

  await wait(50);

  for (const environment of [primary, secondTab, passwordRestore, recoveryRestore, corruptRestore, migrated, dualSource, failedMigration, reloaded, background]) {
    for (const args of environment.consoleErrors) {
      const text = args.map((value) => value?.message || String(value)).join(' ');
      assert(
        /operation failed|明确选择|已损坏/i.test(text),
        `Unexpected application console error: ${text}`
      );
    }
    environment.dom.window.close();
  }
  console.log('Vault integration checks passed.');
}

await run();
