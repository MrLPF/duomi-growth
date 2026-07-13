(function () {
  'use strict';

  const DB_NAME = 'duomi-growth-secure';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const AUTH_KEY = 'auth';
  const VAULT_KEY = 'vault';
  const BACKUP_FORMAT = 'duomi-encrypted-backup';
  const ITERATIONS = 600000;
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let db = null;
  let sessionKey = null;
  let vault = emptyVault();
  let persistQueue = Promise.resolve();
  let lockTimer = null;
  let hiddenAt = 0;
  let firstBootResolve = null;
  let firstBootPromise = null;

  function emptyVault() {
    return { version: 1, growthRecords: [], childInfo: null, milkRecords: [] };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeVault(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      version: 1,
      growthRecords: Array.isArray(source.growthRecords) ? source.growthRecords : [],
      childInfo: source.childInfo && typeof source.childInfo === 'object' ? source.childInfo : null,
      milkRecords: Array.isArray(source.milkRecords) ? source.milkRecords : []
    };
  }

  function toBase64(bytes) {
    let binary = '';
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(value);
    const result = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
    return result;
  }

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  function openDb() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = function () {
        db = request.result;
        resolve(db);
      };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function dbGet(key) {
    const database = await openDb();
    return new Promise(function (resolve, reject) {
      const request = database.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function dbPutMany(entries) {
    const database = await openDb();
    return new Promise(function (resolve, reject) {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      entries.forEach(function (entry) { store.put(entry[1], entry[0]); });
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error || new Error('存储事务已中止')); };
    });
  }

  async function deriveKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJson(value, key) {
    const iv = randomBytes(12);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv }, key, encoder.encode(JSON.stringify(value))
    );
    return { iv: toBase64(iv), ciphertext: toBase64(encrypted) };
  }

  async function decryptJson(payload, key) {
    if (!payload || !payload.iv || !payload.ciphertext) throw new Error('加密数据格式错误');
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ciphertext)
    );
    return JSON.parse(decoder.decode(clear));
  }

  function readLegacyJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readLegacyVault() {
    return normalizeVault({
      growthRecords: readLegacyJson('childGrowthRecords', []),
      childInfo: readLegacyJson('childGrowthInfo', null),
      milkRecords: readLegacyJson('childMilkRecords', [])
    });
  }

  function hasLegacyData() {
    return ['childGrowthRecords', 'childGrowthInfo', 'childMilkRecords'].some(function (key) {
      return localStorage.getItem(key) !== null;
    });
  }

  function clearLegacyData() {
    ['childGrowthRecords', 'childGrowthInfo', 'childMilkRecords'].forEach(function (key) {
      localStorage.removeItem(key);
    });
  }

  function schedulePersist() {
    if (!sessionKey) return Promise.reject(new Error('应用当前已锁定'));
    const snapshot = clone(vault);
    const key = sessionKey;
    const task = persistQueue.catch(function () {}).then(async function () {
      const encrypted = await encryptJson(snapshot, key);
      await dbPutMany([[VAULT_KEY, encrypted]]);
    });
    persistQueue = task.catch(function (error) {
      console.error('保存加密数据失败', error);
      showMessage('保存失败，请立即导出备份并重试。', true);
    });
    return task;
  }

  function installStorageAdapters() {
    window.getRecords = function () { return clone(vault.growthRecords) || []; };
    window.saveRecords = function (records) {
      vault.growthRecords = Array.isArray(records) ? clone(records) : [];
      schedulePersist().catch(function () {});
    };
    window.getChildInfo = function () { return clone(vault.childInfo); };
    window.saveChildInfo = function (info) {
      vault.childInfo = info && typeof info === 'object' ? clone(info) : null;
      schedulePersist().catch(function () {});
    };
    window.getMilkRecords = function () { return clone(vault.milkRecords) || []; };
    window.saveMilkRecords = function (records) {
      vault.milkRecords = Array.isArray(records) ? clone(records) : [];
      schedulePersist().catch(function () {});
    };
  }

  function ensureUi() {
    if (document.getElementById('secureGate')) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = [
      '<div id="secureGate" class="secure-gate" role="dialog" aria-modal="true">',
      '  <section class="secure-card">',
      '    <div class="secure-icon">🔐</div>',
      '    <h1>多米成长记录</h1>',
      '    <p id="secureLead">正在准备本机加密空间…</p>',
      '    <form id="secureSetupForm" class="secure-form" hidden>',
      '      <label>设置主密码<input id="secureSetupPassword" type="password" minlength="8" required autocomplete="new-password"></label>',
      '      <label>确认主密码<input id="secureSetupConfirm" type="password" minlength="8" required autocomplete="new-password"></label>',
      '      <button type="submit" class="btn btn-primary">创建本机账户</button>',
      '    </form>',
      '    <form id="secureUnlockForm" class="secure-form" hidden>',
      '      <label>主密码<input id="secureUnlockPassword" type="password" required autocomplete="current-password"></label>',
      '      <button type="submit" class="btn btn-primary">解锁</button>',
      '    </form>',
      '    <button id="secureRestoreButton" type="button" class="btn btn-secondary secure-wide">从加密备份恢复</button>',
      '    <p id="secureMessage" class="secure-message" aria-live="polite"></p>',
      '    <p class="secure-note">密码不会上传，也无法通过邮箱找回。请定期导出加密备份。</p>',
      '  </section>',
      '</div>',
      '<div id="securePanel" class="secure-panel" hidden>',
      '  <section class="secure-card secure-settings">',
      '    <button id="securePanelClose" type="button" class="secure-close" aria-label="关闭">×</button>',
      '    <div class="secure-icon">🛡️</div>',
      '    <h2>数据与安全</h2>',
      '    <p>个人数据仅以密文保存在当前设备。</p>',
      '    <div class="secure-actions">',
      '      <button id="secureExport" type="button" class="btn btn-primary">导出加密备份</button>',
      '      <button id="secureImport" type="button" class="btn btn-secondary">导入加密备份</button>',
      '      <button id="secureChangePassword" type="button" class="btn btn-secondary">修改主密码</button>',
      '      <button id="secureLockNow" type="button" class="btn btn-secondary">立即锁定</button>',
      '    </div>',
      '    <p class="secure-note">GitHub Pages 地址仍可公开访问，但没有主密码无法解密本机记录。</p>',
      '  </section>',
      '</div>',
      '<input id="secureBackupInput" type="file" accept=".duomi,.json,application/json" hidden>'
    ].join('');
    while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);

    document.getElementById('secureSetupForm').addEventListener('submit', handleSetup);
    document.getElementById('secureUnlockForm').addEventListener('submit', handleUnlock);
    document.getElementById('secureRestoreButton').addEventListener('click', function () {
      document.getElementById('secureBackupInput').click();
    });
    document.getElementById('secureBackupInput').addEventListener('change', handleImportFile);
    document.getElementById('securePanelClose').addEventListener('click', closeSecurityPanel);
    document.getElementById('securePanel').addEventListener('click', function (event) {
      if (event.target === event.currentTarget) closeSecurityPanel();
    });
    document.getElementById('secureExport').addEventListener('click', exportBackup);
    document.getElementById('secureImport').addEventListener('click', function () {
      document.getElementById('secureBackupInput').click();
    });
    document.getElementById('secureChangePassword').addEventListener('click', changePassword);
    document.getElementById('secureLockNow').addEventListener('click', function () {
      closeSecurityPanel();
      lock('应用已锁定。');
    });
  }

  function showMessage(message, isError) {
    const target = document.getElementById('secureMessage');
    if (!target) return;
    target.textContent = message || '';
    target.classList.toggle('error', Boolean(isError));
  }

  function showGate(mode, message) {
    ensureUi();
    document.body.classList.add('secure-locked');
    const gate = document.getElementById('secureGate');
    const setup = document.getElementById('secureSetupForm');
    const unlock = document.getElementById('secureUnlockForm');
    gate.hidden = false;
    setup.hidden = mode !== 'setup';
    unlock.hidden = mode !== 'unlock';
    document.getElementById('secureLead').textContent = mode === 'setup'
      ? (hasLegacyData() ? '检测到旧版明文记录。设置密码后将自动加密迁移。' : '首次使用，请创建仅属于此设备的主密码。')
      : '请输入主密码解锁本机加密数据。';
    showMessage(message || '', false);
    setTimeout(function () {
      const input = document.getElementById(mode === 'setup' ? 'secureSetupPassword' : 'secureUnlockPassword');
      if (input) input.focus();
    }, 50);
  }

  function hideGate() {
    const gate = document.getElementById('secureGate');
    if (gate) gate.hidden = true;
    document.body.classList.remove('secure-locked');
  }

  function refreshApp() {
    try {
      if (typeof updateNavTitle === 'function') updateNavTitle();
      if (typeof navigateTo === 'function') navigateTo(window.location.hash.replace('#', '') || 'milk');
    } catch (error) {
      console.warn('刷新界面失败', error);
      location.reload();
    }
  }

  async function handleSetup(event) {
    event.preventDefault();
    const password = document.getElementById('secureSetupPassword').value;
    const confirmation = document.getElementById('secureSetupConfirm').value;
    if (password.length < 8) return showMessage('主密码至少需要 8 位。', true);
    if (password !== confirmation) return showMessage('两次输入的密码不一致。', true);
    showMessage('正在创建加密空间…', false);
    try {
      const salt = randomBytes(16);
      const key = await deriveKey(password, salt, ITERATIONS);
      const migrated = readLegacyVault();
      const auth = {
        version: 1,
        salt: toBase64(salt),
        iterations: ITERATIONS,
        verifier: await encryptJson({ ok: true, format: 'duomi-v1' }, key)
      };
      const encryptedVault = await encryptJson(migrated, key);
      await dbPutMany([[AUTH_KEY, auth], [VAULT_KEY, encryptedVault]]);
      sessionKey = key;
      vault = migrated;
      clearLegacyData();
      navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(function () {});
      unlockCompleted();
    } catch (error) {
      console.error(error);
      showMessage('创建失败：' + error.message, true);
    }
  }

  async function handleUnlock(event) {
    event.preventDefault();
    const password = document.getElementById('secureUnlockPassword').value;
    showMessage('正在解锁…', false);
    try {
      await unlockWithPassword(password);
      document.getElementById('secureUnlockForm').reset();
      unlockCompleted();
    } catch (error) {
      console.error(error);
      showMessage('无法解锁，请检查主密码。', true);
    }
  }

  async function unlockWithPassword(password) {
    const auth = await dbGet(AUTH_KEY);
    if (!auth) throw new Error('未找到本机账户');
    const key = await deriveKey(password, fromBase64(auth.salt), auth.iterations || ITERATIONS);
    const verification = await decryptJson(auth.verifier, key);
    if (!verification || verification.ok !== true) throw new Error('密码错误');
    const encryptedVault = await dbGet(VAULT_KEY);
    const decrypted = encryptedVault ? await decryptJson(encryptedVault, key) : emptyVault();
    sessionKey = key;
    vault = normalizeVault(decrypted);
  }

  function unlockCompleted() {
    hideGate();
    resetLockTimer();
    if (firstBootResolve) {
      const resolve = firstBootResolve;
      firstBootResolve = null;
      resolve();
    } else {
      refreshApp();
    }
  }

  function scrubDecryptedDom() {
    ['listContent', 'milkListContent', 'milkTodaySummary'].forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.replaceChildren();
    });
    ['addForm', 'editForm', 'milkForm', 'editMilkForm', 'childInfoForm'].forEach(function (id) {
      const form = document.getElementById(id);
      if (form && typeof form.reset === 'function') form.reset();
    });
    document.querySelectorAll('.modal-overlay.show').forEach(function (modal) {
      modal.classList.remove('show');
    });
    const canvas = document.getElementById('growthChart');
    if (canvas) {
      const context = canvas.getContext && canvas.getContext('2d');
      if (context) context.clearRect(0, 0, canvas.width, canvas.height);
    }
    const title = document.getElementById('navTitle');
    if (title) title.textContent = '多米的成长记录 🌱';
  }

  function resetLockTimer() {
    if (!sessionKey) return;
    clearTimeout(lockTimer);
    lockTimer = setTimeout(function () { lock('长时间无操作，应用已自动锁定。'); }, AUTO_LOCK_MS);
  }

  function lock(message) {
    sessionKey = null;
    vault = emptyVault();
    clearTimeout(lockTimer);
    scrubDecryptedDom();
    showGate('unlock', message || '');
  }

  async function exportBackup() {
    try {
      await persistQueue;
      const auth = await dbGet(AUTH_KEY);
      const encryptedVault = await dbGet(VAULT_KEY);
      if (!auth || !encryptedVault) throw new Error('没有可导出的加密数据');
      const backup = {
        format: BACKUP_FORMAT,
        version: 1,
        createdAt: new Date().toISOString(),
        auth: auth,
        vault: encryptedVault
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '多米成长记录-加密备份-' + new Date().toISOString().slice(0, 10) + '.duomi';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showMessage('加密备份已导出。', false);
    } catch (error) {
      alert('导出失败：' + error.message);
    }
  }

  async function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup.format !== BACKUP_FORMAT || !backup.auth || !backup.vault) {
        throw new Error('不是有效的多米加密备份');
      }
      const password = prompt('请输入这份备份的原主密码：');
      if (!password) return;
      const key = await deriveKey(password, fromBase64(backup.auth.salt), backup.auth.iterations || ITERATIONS);
      const verification = await decryptJson(backup.auth.verifier, key);
      if (!verification || verification.ok !== true) throw new Error('备份密码错误');
      const importedVault = normalizeVault(await decryptJson(backup.vault, key));
      if (!confirm('导入会覆盖当前设备上的数据，确定继续吗？')) return;
      await dbPutMany([[AUTH_KEY, backup.auth], [VAULT_KEY, backup.vault]]);
      sessionKey = key;
      vault = importedVault;
      clearLegacyData();
      closeSecurityPanel();
      unlockCompleted();
      alert('备份已恢复。');
    } catch (error) {
      alert('导入失败：' + error.message);
    }
  }

  async function changePassword() {
    try {
      await persistQueue;
      const current = prompt('请输入当前主密码：');
      if (!current) return;
      const auth = await dbGet(AUTH_KEY);
      const oldKey = await deriveKey(current, fromBase64(auth.salt), auth.iterations || ITERATIONS);
      const verification = await decryptJson(auth.verifier, oldKey);
      if (!verification || verification.ok !== true) throw new Error('当前密码错误');

      const next = prompt('请输入新的主密码（至少 8 位）：');
      if (!next) return;
      if (next.length < 8) throw new Error('新密码至少需要 8 位');
      const confirmation = prompt('请再次输入新主密码：');
      if (next !== confirmation) throw new Error('两次输入的新密码不一致');

      const salt = randomBytes(16);
      const newKey = await deriveKey(next, salt, ITERATIONS);
      const newAuth = {
        version: 1,
        salt: toBase64(salt),
        iterations: ITERATIONS,
        verifier: await encryptJson({ ok: true, format: 'duomi-v1' }, newKey)
      };
      const newVault = await encryptJson(vault, newKey);
      await dbPutMany([[AUTH_KEY, newAuth], [VAULT_KEY, newVault]]);
      sessionKey = newKey;
      resetLockTimer();
      alert('主密码已修改。请立即导出一份新的加密备份。');
    } catch (error) {
      alert('修改失败：' + error.message);
    }
  }

  function openSecurityPanel() {
    if (!sessionKey) return showGate('unlock', '请先解锁应用。');
    ensureUi();
    document.getElementById('securePanel').hidden = false;
  }

  function closeSecurityPanel() {
    const panel = document.getElementById('securePanel');
    if (panel) panel.hidden = true;
  }

  async function bootstrap() {
    installStorageAdapters();
    ensureUi();
    if (!window.crypto || !crypto.subtle || !window.indexedDB) {
      showGate('setup', '当前浏览器不支持安全加密存储，请使用较新的 Safari 或 Chrome。');
      throw new Error('浏览器缺少 Web Crypto 或 IndexedDB');
    }
    await openDb();
    const auth = await dbGet(AUTH_KEY);
    firstBootPromise = new Promise(function (resolve) { firstBootResolve = resolve; });
    showGate(auth ? 'unlock' : 'setup', '');
    return firstBootPromise;
  }

  ['pointerdown', 'touchstart', 'keydown'].forEach(function (eventName) {
    document.addEventListener(eventName, function () {
      if (sessionKey) resetLockTimer();
    }, { passive: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (!sessionKey) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt && Date.now() - hiddenAt >= AUTO_LOCK_MS) {
      lock('应用离开时间较长，已自动锁定。');
    } else {
      resetLockTimer();
    }
    hiddenAt = 0;
  });

  ensureUi();
  document.body.classList.add('secure-locked');

  window.SecureVault = {
    bootstrap: bootstrap,
    openSecurityPanel: openSecurityPanel,
    lock: lock,
    exportBackup: exportBackup,
    isUnlocked: function () { return Boolean(sessionKey); }
  };
})();
