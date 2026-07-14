(function () {
  'use strict';

  const DB_NAME = 'duomi-growth-vault-v2';
  const DB_VERSION = 1;
  const ACCOUNT_STORE = 'account';
  const VAULT_STORE = 'vault';
  const PRIMARY_ID = 'primary';
  const LEGACY_DB_NAME = 'duomi-growth-secure';
  const LEGACY_STORE = 'kv';
  const LEGACY_KEYS = ['childGrowthInfo', 'childGrowthRecords', 'childMilkRecords'];
  const FORMAT_VERSION = 2;
  const BACKUP_FORMAT = 'duomi-growth-encrypted-backup';
  const PASSWORD_ITERATIONS = 600000;
  const IDLE_LOCK_MS = 15 * 60 * 1000;
  const BACKGROUND_LOCK_MS = 5 * 60 * 1000;
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const tabId = makeUuid();

  let database = null;
  let account = null;
  let encryptedVaultRecord = null;
  let sessionKey = null;
  let sessionKeyBytes = null;
  let sessionVault = emptyVault();
  let sessionRevision = 0;
  let writeQueue = Promise.resolve();
  let idleTimer = null;
  let backgroundTimer = null;
  let storageIsPersistent = false;
  let pendingSetup = null;
  let pendingBackup = null;
  let ui = null;
  let cancelRecoveryDialog = null;
  let cancelActionDialog = null;

  const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('duomi-growth-vault-v2')
    : null;

  class RevisionConflictError extends Error {
    constructor() {
      super('数据已在另一个标签页中更新，请重新加载后继续。');
      this.name = 'RevisionConflictError';
    }
  }

  class SessionInitializationError extends Error {
    constructor() {
      super('账户数据已安全保存，但主界面初始化失败。请刷新后使用密码解锁');
      this.name = 'SessionInitializationError';
    }
  }

  function emptyVault() {
    return { childInfo: null, growthRecords: [], milkRecords: [], version: FORMAT_VERSION };
  }

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function makeUuid() {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = globalThis.crypto
      ? crypto.getRandomValues(new Uint8Array(16))
      : Uint8Array.from({ length: 16 }, function () { return Math.floor(Math.random() * 256); });
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  function toBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function fromBase64(value) {
    if (typeof value !== 'string') throw new Error('加密字段格式无效');
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let result = '';
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return result;
  }

  function normalizeRecoveryCode(value) {
    return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z2-7]/g, '');
  }

  function base32Decode(value) {
    const normalized = normalizeRecoveryCode(value);
    if (normalized.length !== 32) throw new Error('恢复码应为 8 组、共 32 个字符');
    let bits = 0;
    let buffer = 0;
    const result = [];
    for (const character of normalized) {
      const index = BASE32_ALPHABET.indexOf(character);
      if (index < 0) throw new Error('恢复码包含无效字符');
      buffer = (buffer << 5) | index;
      bits += 5;
      if (bits >= 8) {
        result.push((buffer >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    if (result.length !== 20) throw new Error('恢复码长度无效');
    return new Uint8Array(result);
  }

  function formatRecoveryCode(value) {
    const normalized = normalizeRecoveryCode(value);
    return normalized.match(/.{1,4}/g).join('-');
  }

  function normalizeUsername(value) {
    const normalized = String(value || '').trim().normalize('NFKC');
    const length = Array.from(normalized).length;
    if (length < 1 || length > 30) throw new Error('用户名应为 1–30 个字符');
    return normalized;
  }

  function validatePassword(value) {
    const length = Array.from(String(value || '')).length;
    if (length < 10 || length > 128) throw new Error('密码应为 10–128 个字符');
  }

  function normalizeVault(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('保险箱结构无效');
    const childInfo = value.childInfo == null ? null : validateChildInfo(value.childInfo);
    const growthRecords = validateGrowthRecords(value.growthRecords == null ? [] : value.growthRecords);
    const milkRecords = validateMilkRecords(value.milkRecords == null ? [] : value.milkRecords);
    return { childInfo, growthRecords, milkRecords, version: FORMAT_VERSION };
  }

  function validateChildInfo(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('宝宝资料格式无效');
    if (typeof value.childName !== 'string' || typeof value.birthDate !== 'string') throw new Error('宝宝资料字段无效');
    return { childName: value.childName, birthDate: value.birthDate };
  }

  function validateGrowthRecords(value) {
    if (!Array.isArray(value)) throw new Error('成长记录格式无效');
    return value.map(function (record) {
      if (!record || typeof record !== 'object') throw new Error('成长记录条目无效');
      const height = Number(record.height);
      const weight = Number(record.weight);
      if (typeof record.id !== 'string' || typeof record.recordDate !== 'string' || !Number.isFinite(height) || !Number.isFinite(weight)) {
        throw new Error('成长记录字段无效');
      }
      return { id: record.id, recordDate: record.recordDate, height, weight };
    });
  }

  function validateMilkRecords(value) {
    if (!Array.isArray(value)) throw new Error('喝奶记录格式无效');
    return value.map(function (record) {
      if (!record || typeof record !== 'object') throw new Error('喝奶记录条目无效');
      const milkAmount = Number(record.milkAmount);
      if (
        typeof record.id !== 'string' ||
        typeof record.milkDate !== 'string' ||
        typeof record.milkTime !== 'string' ||
        !Number.isFinite(milkAmount) ||
        !['breast', 'formula'].includes(record.milkType)
      ) {
        throw new Error('喝奶记录字段无效');
      }
      return {
        id: record.id,
        milkDate: record.milkDate,
        milkTime: record.milkTime,
        milkAmount,
        milkType: record.milkType
      };
    });
  }

  function canonicalVault(value) {
    return JSON.stringify(normalizeVault(value));
  }

  function openDatabase() {
    if (database) return Promise.resolve(database);
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        const next = request.result;
        if (!next.objectStoreNames.contains(ACCOUNT_STORE)) next.createObjectStore(ACCOUNT_STORE, { keyPath: 'id' });
        if (!next.objectStoreNames.contains(VAULT_STORE)) next.createObjectStore(VAULT_STORE, { keyPath: 'id' });
      };
      request.onsuccess = function () {
        database = request.result;
        database.onversionchange = function () {
          database.close();
          database = null;
          void lockNow('应用数据结构已更新，请重新加载。');
        };
        resolve(database);
      };
      request.onerror = function () { reject(request.error || new Error('无法打开本机保险箱')); };
      request.onblocked = function () { reject(new Error('请关闭其他旧版本页面后重试')); };
    });
  }

  async function storeGet(storeName, id) {
    const db = await openDatabase();
    return new Promise(function (resolve, reject) {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function putAccount(value) {
    const db = await openDatabase();
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(ACCOUNT_STORE, 'readwrite');
      transaction.objectStore(ACCOUNT_STORE).put(value);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error || new Error('账户写入失败')); };
      transaction.onabort = function () { reject(transaction.error || new Error('账户写入中止')); };
    });
  }

  async function putAccountAndVault(accountRecord, vaultRecord) {
    const db = await openDatabase();
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction([ACCOUNT_STORE, VAULT_STORE], 'readwrite');
      transaction.objectStore(ACCOUNT_STORE).put(accountRecord);
      transaction.objectStore(VAULT_STORE).put(vaultRecord);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error || new Error('保险箱写入失败')); };
      transaction.onabort = function () { reject(transaction.error || new Error('保险箱写入中止')); };
    });
  }

  async function clearV2Database() {
    const db = await openDatabase();
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction([ACCOUNT_STORE, VAULT_STORE], 'readwrite');
      transaction.objectStore(ACCOUNT_STORE).clear();
      transaction.objectStore(VAULT_STORE).clear();
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error || new Error('删除账户失败')); };
      transaction.onabort = function () { reject(transaction.error || new Error('删除账户中止')); };
    });
  }

  async function writeVaultWithRevision(expectedRevision, record) {
    const db = await openDatabase();
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(VAULT_STORE, 'readwrite');
      const store = transaction.objectStore(VAULT_STORE);
      let conflict = false;
      const request = store.get(PRIMARY_ID);
      request.onsuccess = function () {
        const current = request.result;
        if (!current || current.accountId !== record.accountId || current.revision !== expectedRevision) {
          conflict = true;
          transaction.abort();
          return;
        }
        store.put(record);
      };
      request.onerror = function () { transaction.abort(); };
      transaction.oncomplete = function () { resolve(); };
      transaction.onabort = function () {
        reject(conflict ? new RevisionConflictError() : (transaction.error || new Error('保存事务已中止')));
      };
      transaction.onerror = function () {
        reject(transaction.error || new Error('保存事务失败'));
      };
    });
  }

  async function derivePasswordKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function deriveRecoveryKey(codeBytes, salt, info) {
    const material = await crypto.subtle.importKey('raw', codeBytes, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function importDataKey(bytes) {
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  function wrappingAad(accountId, kind) {
    return encoder.encode('duomi-growth:v2:dek:' + accountId + ':' + kind);
  }

  function vaultAad(accountId, revision) {
    return encoder.encode('duomi-growth:v2:vault:' + accountId + ':' + revision);
  }

  async function encryptBytes(bytes, key, additionalData) {
    const iv = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData },
      key,
      bytes
    );
    return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
  }

  async function decryptBytes(payload, key, additionalData) {
    if (!payload || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
      throw new Error('加密包格式无效');
    }
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv), additionalData },
      key,
      fromBase64(payload.ciphertext)
    );
    return new Uint8Array(clear);
  }

  async function createPasswordWrap(password, accountId, keyBytes) {
    const salt = randomBytes(16);
    const key = await derivePasswordKey(password, salt, PASSWORD_ITERATIONS);
    return {
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: PASSWORD_ITERATIONS,
        salt: toBase64(salt)
      },
      wrappedKey: await encryptBytes(keyBytes, key, wrappingAad(accountId, 'password'))
    };
  }

  async function createRecoveryWrap(code, accountId, keyBytes) {
    const salt = randomBytes(16);
    const info = 'duomi-growth-v2-recovery:' + accountId;
    const key = await deriveRecoveryKey(base32Decode(code), salt, info);
    return {
      kdf: { name: 'HKDF', hash: 'SHA-256', salt: toBase64(salt), info },
      wrappedKey: await encryptBytes(keyBytes, key, wrappingAad(accountId, 'recovery'))
    };
  }

  async function unwrapWithPassword(accountRecord, password) {
    const kdf = accountRecord.passwordKdf;
    if (!kdf || kdf.name !== 'PBKDF2') throw new Error('密码派生参数无效');
    const key = await derivePasswordKey(password, fromBase64(kdf.salt), Number(kdf.iterations));
    return decryptBytes(accountRecord.passwordWrappedKey, key, wrappingAad(accountRecord.accountId, 'password'));
  }

  async function unwrapWithRecovery(accountRecord, code) {
    const kdf = accountRecord.recoveryKdf;
    if (!kdf || kdf.name !== 'HKDF') throw new Error('恢复码派生参数无效');
    const key = await deriveRecoveryKey(base32Decode(code), fromBase64(kdf.salt), kdf.info);
    return decryptBytes(accountRecord.recoveryWrappedKey, key, wrappingAad(accountRecord.accountId, 'recovery'));
  }

  async function encryptVault(value, key, accountId, revision) {
    const iv = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: vaultAad(accountId, revision) },
      key,
      encoder.encode(canonicalVault(value))
    );
    return {
      id: PRIMARY_ID,
      version: FORMAT_VERSION,
      accountId,
      revision,
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
      updatedAt: new Date().toISOString()
    };
  }

  async function decryptVault(record, key) {
    if (
      !record ||
      record.version !== FORMAT_VERSION ||
      typeof record.accountId !== 'string' ||
      !Number.isInteger(record.revision) ||
      typeof record.iv !== 'string' ||
      typeof record.ciphertext !== 'string'
    ) {
      throw new Error('保险箱格式无效');
    }
    const clear = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(record.iv),
        additionalData: vaultAad(record.accountId, record.revision)
      },
      key,
      fromBase64(record.ciphertext)
    );
    return normalizeVault(JSON.parse(decoder.decode(clear)));
  }

  function validateAccountRecord(value) {
    if (
      !value ||
      value.version !== FORMAT_VERSION ||
      typeof value.accountId !== 'string' ||
      typeof value.username !== 'string' ||
      !value.passwordKdf ||
      !value.passwordWrappedKey ||
      !value.recoveryKdf ||
      !value.recoveryWrappedKey
    ) {
      throw new Error('账户元数据无效');
    }
    if (
      value.passwordKdf.name !== 'PBKDF2' ||
      value.passwordKdf.hash !== 'SHA-256' ||
      Number(value.passwordKdf.iterations) !== PASSWORD_ITERATIONS ||
      value.recoveryKdf.name !== 'HKDF' ||
      value.recoveryKdf.hash !== 'SHA-256' ||
      value.recoveryKdf.info !== 'duomi-growth-v2-recovery:' + value.accountId
    ) {
      throw new Error('账户密钥派生参数无效');
    }
    if (fromBase64(value.passwordKdf.salt).length !== 16 || fromBase64(value.recoveryKdf.salt).length !== 16) {
      throw new Error('账户盐值长度无效');
    }
    [value.passwordWrappedKey, value.recoveryWrappedKey].forEach(function (wrapped) {
      if (!wrapped || fromBase64(wrapped.iv).length !== 12 || fromBase64(wrapped.ciphertext).length < 48) {
        throw new Error('账户包裹密钥格式无效');
      }
    });
    normalizeUsername(value.username);
    return value;
  }

  function hasPlaintextLegacyKeys() {
    return LEGACY_KEYS.some(function (key) { return localStorage.getItem(key) !== null; });
  }

  function readLegacyJsonStrict(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error('旧数据 ' + key + ' 已损坏，原数据未被修改');
    }
  }

  function readPlaintextLegacyVault() {
    return normalizeVault({
      childInfo: readLegacyJsonStrict('childGrowthInfo', null),
      growthRecords: readLegacyJsonStrict('childGrowthRecords', []),
      milkRecords: readLegacyJsonStrict('childMilkRecords', []),
      version: FORMAT_VERSION
    });
  }

  function removePlaintextLegacyKeys() {
    LEGACY_KEYS.forEach(function (key) { localStorage.removeItem(key); });
  }

  async function legacySecureDatabaseExists() {
    if (typeof indexedDB.databases === 'function') {
      try {
        const databases = await indexedDB.databases();
        return databases.some(function (entry) { return entry.name === LEGACY_DB_NAME; });
      } catch (error) {
        console.warn('无法列出旧保险箱数据库', error);
      }
    }
    return new Promise(function (resolve) {
      let created = false;
      const request = indexedDB.open(LEGACY_DB_NAME);
      request.onupgradeneeded = function () {
        created = true;
        request.transaction.abort();
      };
      request.onsuccess = function () {
        const oldDb = request.result;
        const exists = !created && oldDb.objectStoreNames.contains(LEGACY_STORE);
        oldDb.close();
        resolve(exists);
      };
      request.onerror = function () { resolve(false); };
    });
  }

  async function readLegacySecureValue(key) {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(LEGACY_DB_NAME);
      request.onupgradeneeded = function () {
        request.transaction.abort();
      };
      request.onsuccess = function () {
        const oldDb = request.result;
        if (!oldDb.objectStoreNames.contains(LEGACY_STORE)) {
          oldDb.close();
          reject(new Error('未找到旧版保险箱'));
          return;
        }
        const transaction = oldDb.transaction(LEGACY_STORE, 'readonly');
        const getRequest = transaction.objectStore(LEGACY_STORE).get(key);
        getRequest.onsuccess = function () {
          const result = getRequest.result;
          oldDb.close();
          resolve(result || null);
        };
        getRequest.onerror = function () {
          oldDb.close();
          reject(getRequest.error);
        };
      };
      request.onerror = function () { reject(request.error || new Error('无法读取旧版保险箱')); };
    });
  }

  async function decryptLegacySecureVault(password) {
    const auth = await readLegacySecureValue('auth');
    const legacyVault = await readLegacySecureValue('vault');
    if (!auth || !legacyVault || !auth.salt || !auth.verifier) throw new Error('旧版保险箱不完整');
    const key = await derivePasswordKey(password, fromBase64(auth.salt), Number(auth.iterations || PASSWORD_ITERATIONS));
    const verifierClear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(auth.verifier.iv) },
      key,
      fromBase64(auth.verifier.ciphertext)
    );
    const verifier = JSON.parse(decoder.decode(verifierClear));
    if (!verifier || verifier.ok !== true) throw new Error('旧密码错误');
    const vaultClear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(legacyVault.iv) },
      key,
      fromBase64(legacyVault.ciphertext)
    );
    return normalizeVault(JSON.parse(decoder.decode(vaultClear)));
  }

  function deleteLegacySecureDatabase() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      request.onsuccess = function () { resolve(); };
      request.onerror = function () { reject(request.error || new Error('无法删除历史保险箱')); };
      request.onblocked = function () { reject(new Error('历史保险箱正在其他页面中使用')); };
    });
  }

  function element(tagName, options) {
    const node = document.createElement(tagName);
    const config = options || {};
    if (config.id) node.id = config.id;
    if (config.className) node.className = config.className;
    if (config.text !== undefined) node.textContent = String(config.text);
    if (config.type) node.type = config.type;
    if (config.name) node.name = config.name;
    if (config.value !== undefined) node.value = config.value;
    if (config.placeholder) node.placeholder = config.placeholder;
    if (config.autocomplete) node.autocomplete = config.autocomplete;
    if (config.required) node.required = true;
    if (config.hidden) node.hidden = true;
    if (config.minLength) node.minLength = config.minLength;
    if (config.maxLength) node.maxLength = config.maxLength;
    if (config.accept) node.accept = config.accept;
    if (config.href) node.href = config.href;
    if (config.target) node.target = config.target;
    if (config.rel) node.rel = config.rel;
    if (config.attributes) {
      Object.entries(config.attributes).forEach(function (entry) { node.setAttribute(entry[0], entry[1]); });
    }
    const children = Array.prototype.slice.call(arguments, 2);
    children.flat().forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function field(labelText, input) {
    return element('label', { className: 'vault-field' }, element('span', { text: labelText }), input);
  }

  function button(text, className, type) {
    return element('button', { text, className: className || 'vault-button', type: type || 'button' });
  }

  function buildUi() {
    const originWarning = element('aside', { id: 'vaultOriginWarning', className: 'vault-origin-warning', hidden: true });
    originWarning.append(
      element('span', { text: '这里是预览地址，与正式域名使用不同的本机数据空间。' }),
      element('a', { text: '前往 duomi.933520.xyz', href: 'https://duomi.933520.xyz/', target: '_self' })
    );

    const message = element('p', { id: 'vaultGateMessage', className: 'vault-message', attributes: { 'aria-live': 'polite' } });

    const setupSource = element('select', { id: 'vaultSetupSource', className: 'vault-input' });
    const oldPassword = element('input', {
      id: 'vaultLegacyPassword', className: 'vault-input', type: 'password', autocomplete: 'current-password',
      placeholder: '仅在迁移旧保险箱时需要'
    });
    const setupForm = element('form', { id: 'vaultSetupForm', className: 'vault-panel', hidden: true },
      element('h1', { text: '创建本机账户' }),
      element('p', { className: 'vault-lead', text: '数据不上云，只保存在当前浏览器。清除站点数据、使用无痕模式或更换设备都会丢失记录，请务必保存恢复码并导出备份。' }),
      field('本机用户名', element('input', {
        id: 'vaultSetupUsername', className: 'vault-input', type: 'text', required: true,
        minLength: 1, maxLength: 30, autocomplete: 'username', placeholder: '例如：多米妈妈'
      })),
      field('密码（10–128 个字符）', element('input', {
        id: 'vaultSetupPassword', className: 'vault-input', type: 'password', required: true,
        minLength: 10, maxLength: 128, autocomplete: 'new-password'
      })),
      field('确认密码', element('input', {
        id: 'vaultSetupConfirm', className: 'vault-input', type: 'password', required: true,
        minLength: 10, maxLength: 128, autocomplete: 'new-password'
      })),
      element('div', { id: 'vaultLegacySourceArea', className: 'vault-legacy-area', hidden: true },
        field('旧数据来源', setupSource),
        element('div', { id: 'vaultLegacyPasswordArea', hidden: true }, field('旧版保险箱密码', oldPassword)),
        element('p', { className: 'vault-note', text: '如果两套旧数据同时存在，必须选择其中一套；系统不会自动合并。' })
      ),
      button('生成恢复码并继续', 'vault-button vault-primary', 'submit'),
      button('从 .duomi 加密备份恢复', 'vault-button vault-secondary', 'button')
    );
    setupForm.lastElementChild.id = 'vaultSetupRestore';

    const unlockForm = element('form', { id: 'vaultUnlockForm', className: 'vault-panel', hidden: true },
      element('div', { className: 'vault-lock-icon', text: '🔐' }),
      element('h1', { text: '解锁本机账户' }),
      element('p', { className: 'vault-username-label', text: '本机用户名' }),
      element('strong', { id: 'vaultUnlockUsername', className: 'vault-username' }),
      field('密码', element('input', {
        id: 'vaultUnlockPassword', className: 'vault-input', type: 'password', required: true,
        maxLength: 128, autocomplete: 'current-password'
      })),
      button('解锁', 'vault-button vault-primary', 'submit'),
      element('div', { className: 'vault-inline-actions' },
        button('忘记密码', 'vault-link-button'),
        button('恢复备份', 'vault-link-button'),
        button('删除本机账户', 'vault-link-button vault-danger-text')
      )
    );
    const unlockActions = unlockForm.querySelectorAll('.vault-link-button');
    unlockActions[0].id = 'vaultForgotPassword';
    unlockActions[1].id = 'vaultUnlockRestore';
    unlockActions[2].id = 'vaultDeleteLocked';

    const recoveryForm = element('form', { id: 'vaultRecoveryForm', className: 'vault-panel', hidden: true },
      element('h1', { text: '用恢复码重置密码' }),
      element('p', { className: 'vault-lead', text: '恢复码只能解锁仍在此浏览器中的保险箱，不能找回已经丢失的备份文件。' }),
      field('恢复码', element('input', {
        id: 'vaultRecoveryCode', className: 'vault-input vault-monospace', type: 'text', required: true,
        autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
      })),
      field('新密码（10–128 个字符）', element('input', {
        id: 'vaultRecoveryPassword', className: 'vault-input', type: 'password', required: true,
        minLength: 10, maxLength: 128, autocomplete: 'new-password'
      })),
      field('确认新密码', element('input', {
        id: 'vaultRecoveryConfirm', className: 'vault-input', type: 'password', required: true,
        minLength: 10, maxLength: 128, autocomplete: 'new-password'
      })),
      button('重置密码并解锁', 'vault-button vault-primary', 'submit'),
      button('返回解锁', 'vault-button vault-secondary')
    );
    recoveryForm.lastElementChild.id = 'vaultRecoveryBack';

    const restoreFile = element('input', { id: 'vaultBackupFile', className: 'vault-input', type: 'file', accept: '.duomi,application/json' });
    const restoreCredential = element('input', { id: 'vaultRestoreCredential', className: 'vault-input', type: 'password', required: true, autocomplete: 'off' });
    const restoreForm = element('form', { id: 'vaultRestoreForm', className: 'vault-panel', hidden: true },
      element('h1', { text: '恢复加密备份' }),
      element('p', { className: 'vault-lead', text: '先验证备份和凭据，再以单个事务替换本机账户；验证失败不会影响现有数据。' }),
      field('选择 .duomi 文件', restoreFile),
      element('p', { id: 'vaultBackupSummary', className: 'vault-note', text: '尚未选择文件' }),
      field('验证方式', element('select', { id: 'vaultRestoreMode', className: 'vault-input' },
        element('option', { text: '使用密码', value: 'password' }),
        element('option', { text: '使用恢复码', value: 'recovery' })
      )),
      field('密码或恢复码', restoreCredential),
      button('验证并恢复', 'vault-button vault-primary', 'submit'),
      button('返回', 'vault-button vault-secondary')
    );
    restoreForm.lastElementChild.id = 'vaultRestoreBack';

    const gateCard = element('section', { className: 'vault-gate-card' }, setupForm, unlockForm, recoveryForm, restoreForm, message);
    const gate = element('div', { id: 'vaultGate', className: 'vault-gate', attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '本机加密账户' } }, gateCard);

    const recoveryCode = element('code', { id: 'vaultRecoveryCodeDisplay', className: 'vault-recovery-code' });
    const recoveryConfirmForm = element('form', {
      id: 'vaultRecoveryConfirmForm',
      className: 'vault-dialog-card',
      attributes: { novalidate: '' }
    },
      element('h2', { id: 'vaultRecoveryTitle', text: '保存恢复码' }),
      element('p', { className: 'vault-note', text: '恢复码只显示在这里，不会上传或写入磁盘。请单独抄写或保存在安全位置。' }),
      recoveryCode,
      element('div', { id: 'vaultRecoveryGroupFields', className: 'vault-confirm-groups' }),
      element('label', { className: 'vault-check-row' },
        element('input', { id: 'vaultRecoverySaved', type: 'checkbox', required: true }),
        element('span', { text: '我已将恢复码单独保存' })
      ),
      element('p', {
        id: 'vaultRecoveryConfirmMessage',
        className: 'vault-message',
        attributes: { 'aria-live': 'assertive' }
      }),
      button('确认恢复码', 'vault-button vault-primary', 'submit'),
      button('取消', 'vault-button vault-secondary')
    );
    recoveryConfirmForm.noValidate = true;
    recoveryConfirmForm.lastElementChild.id = 'vaultRecoveryConfirmCancel';
    const recoveryOverlay = element('div', { id: 'vaultRecoveryOverlay', className: 'vault-dialog-overlay', hidden: true, attributes: { role: 'dialog', 'aria-modal': 'true' } }, recoveryConfirmForm);

    const securityStatus = element('p', { id: 'vaultSecurityStatus', className: 'vault-note' });
    const securityCard = element('section', { className: 'vault-dialog-card vault-security-card' },
      element('div', { className: 'vault-dialog-heading' },
        element('h2', { text: '账户与安全' }),
        button('×', 'vault-close-button')
      ),
      securityStatus,
      element('div', { className: 'vault-menu-grid' },
        button('立即锁定', 'vault-menu-button'),
        button('修改密码', 'vault-menu-button'),
        button('修改用户名', 'vault-menu-button'),
        button('重新生成恢复码', 'vault-menu-button'),
        button('导出加密备份', 'vault-menu-button'),
        button('恢复加密备份', 'vault-menu-button'),
        button('永久删除本机账户', 'vault-menu-button vault-danger')
      ),
      element('p', { className: 'vault-note', text: '密码、恢复码和业务明文不会写入磁盘。浏览器数据被清除后，只能依靠已导出的 .duomi 文件恢复。' })
    );
    securityCard.querySelector('.vault-close-button').id = 'vaultSecurityClose';
    const menuButtons = securityCard.querySelectorAll('.vault-menu-button');
    ['vaultLockNow', 'vaultChangePassword', 'vaultChangeUsername', 'vaultRegenerateRecovery', 'vaultExportBackup', 'vaultImportBackup', 'vaultDeleteAccount'].forEach(function (id, index) {
      menuButtons[index].id = id;
    });
    const securityOverlay = element('div', { id: 'vaultSecurityOverlay', className: 'vault-dialog-overlay', hidden: true, attributes: { role: 'dialog', 'aria-modal': 'true' } }, securityCard);

    const actionForm = element('form', { id: 'vaultActionForm', className: 'vault-dialog-card' },
      element('h2', { id: 'vaultActionTitle' }),
      element('div', { id: 'vaultActionFields' }),
      element('p', { id: 'vaultActionMessage', className: 'vault-message', attributes: { 'aria-live': 'polite' } }),
      button('确认', 'vault-button vault-primary', 'submit'),
      button('取消', 'vault-button vault-secondary')
    );
    actionForm.lastElementChild.id = 'vaultActionCancel';
    const actionOverlay = element('div', { id: 'vaultActionOverlay', className: 'vault-dialog-overlay', hidden: true, attributes: { role: 'dialog', 'aria-modal': 'true' } }, actionForm);

    const backupPrompt = element('div', { id: 'vaultBackupPrompt', className: 'vault-dialog-overlay', hidden: true, attributes: { role: 'dialog', 'aria-modal': 'true' } },
      element('section', { className: 'vault-dialog-card' },
        element('h2', { text: '账户已创建' }),
        element('p', { className: 'vault-lead', text: '数据已写入并重新解密校验。请立即下载加密备份；恢复码本身不能替代丢失的备份文件。' }),
        button('立即下载 .duomi 备份', 'vault-button vault-primary'),
        button('进入应用（稍后备份）', 'vault-button vault-secondary')
      )
    );
    const promptButtons = backupPrompt.querySelectorAll('button');
    promptButtons[0].id = 'vaultBackupNow';
    promptButtons[1].id = 'vaultBackupLater';

    document.body.prepend(originWarning);
    document.body.append(gate, recoveryOverlay, securityOverlay, actionOverlay, backupPrompt);
    document.body.classList.add('secure-locked');

    ui = {
      originWarning,
      gate,
      message,
      setupForm,
      unlockForm,
      recoveryForm,
      restoreForm,
      setupSource,
      oldPassword,
      recoveryOverlay,
      recoveryConfirmForm,
      securityOverlay,
      securityStatus,
      actionOverlay,
      actionForm,
      backupPrompt
    };
    bindUiEvents();
    updateOriginWarning();
  }

  function setGateMessage(message, isError) {
    ui.message.textContent = message || '';
    ui.message.classList.toggle('vault-error', Boolean(isError));
  }

  function setGateMode(mode, message) {
    ['setupForm', 'unlockForm', 'recoveryForm', 'restoreForm'].forEach(function (key) {
      ui[key].hidden = key !== mode + 'Form';
    });
    ui.gate.hidden = false;
    document.body.classList.add('secure-locked');
    setGateMessage(message || '', false);
    if (mode === 'unlock' && account) {
      document.getElementById('vaultUnlockUsername').textContent = account.username;
      document.getElementById('vaultUnlockPassword').value = '';
    }
    const firstInput = ui[mode + 'Form'].querySelector('input:not([type="file"]), select');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 30);
  }

  function hideGate() {
    ui.gate.hidden = true;
    document.body.classList.remove('secure-locked');
    setGateMessage('', false);
  }

  function updateOriginWarning() {
    const isPreview = location.hostname.endsWith('.pages.dev');
    ui.originWarning.hidden = !isPreview;
  }

  async function refreshLegacySourceUi() {
    const plaintext = hasPlaintextLegacyKeys();
    const secure = await legacySecureDatabaseExists();
    const area = document.getElementById('vaultLegacySourceArea');
    const passwordArea = document.getElementById('vaultLegacyPasswordArea');
    ui.setupSource.replaceChildren();
    if (plaintext && secure) {
      ui.setupSource.append(
        element('option', { text: '请选择一套旧数据（禁止自动合并）', value: '' }),
        element('option', { text: '旧版明文记录', value: 'plaintext' }),
        element('option', { text: '历史单密码保险箱', value: 'secure-v1' })
      );
      area.hidden = false;
    } else if (plaintext) {
      ui.setupSource.append(element('option', { text: '旧版明文记录（将自动加密迁移）', value: 'plaintext' }));
      area.hidden = false;
    } else if (secure) {
      ui.setupSource.append(element('option', { text: '历史单密码保险箱', value: 'secure-v1' }));
      area.hidden = false;
    } else {
      ui.setupSource.append(element('option', { text: '创建空白保险箱', value: 'empty' }));
      area.hidden = true;
    }
    passwordArea.hidden = ui.setupSource.value !== 'secure-v1';
  }

  function bindUiEvents() {
    ui.setupSource.addEventListener('change', function () {
      document.getElementById('vaultLegacyPasswordArea').hidden = ui.setupSource.value !== 'secure-v1';
    });
    ui.setupForm.addEventListener('submit', beginSetup);
    document.getElementById('vaultSetupRestore').addEventListener('click', function () { showRestoreMode('setup'); });
    document.getElementById('vaultRecoverySaved').addEventListener('change', function () {
      if (!this.checked) return;
      this.removeAttribute('aria-invalid');
      const feedback = document.getElementById('vaultRecoveryConfirmMessage');
      feedback.textContent = '';
      feedback.classList.remove('vault-error');
    });
    ui.unlockForm.addEventListener('submit', handleUnlock);
    document.getElementById('vaultForgotPassword').addEventListener('click', function () { setGateMode('recovery'); });
    document.getElementById('vaultUnlockRestore').addEventListener('click', function () { showRestoreMode('unlock'); });
    document.getElementById('vaultDeleteLocked').addEventListener('click', deleteLockedAccount);
    ui.recoveryForm.addEventListener('submit', handleRecoveryReset);
    document.getElementById('vaultRecoveryBack').addEventListener('click', function () { setGateMode('unlock'); });
    ui.restoreForm.addEventListener('submit', handleRestore);
    document.getElementById('vaultRestoreBack').addEventListener('click', function () { setGateMode(account ? 'unlock' : 'setup'); });
    document.getElementById('vaultBackupFile').addEventListener('change', handleBackupSelection);
    document.getElementById('vaultRestoreMode').addEventListener('change', function () {
      const input = document.getElementById('vaultRestoreCredential');
      input.type = this.value === 'password' ? 'password' : 'text';
      input.placeholder = this.value === 'password' ? '备份密码' : '8 组恢复码';
    });
    document.getElementById('vaultSecurityClose').addEventListener('click', closeSecurityMenu);
    document.getElementById('vaultLockNow').addEventListener('click', function () { closeSecurityMenu(); void lockNow('已手动锁定。'); });
    document.getElementById('vaultChangePassword').addEventListener('click', changePassword);
    document.getElementById('vaultChangeUsername').addEventListener('click', changeUsername);
    document.getElementById('vaultRegenerateRecovery').addEventListener('click', regenerateRecoveryCode);
    document.getElementById('vaultExportBackup').addEventListener('click', function () { void exportBackup(); });
    document.getElementById('vaultImportBackup').addEventListener('click', async function () {
      closeSecurityMenu();
      await lockNow('恢复备份前已安全锁定当前会话。', false);
      showRestoreMode('unlock');
    });
    document.getElementById('vaultDeleteAccount').addEventListener('click', deleteUnlockedAccount);
    ui.securityOverlay.addEventListener('click', function (event) { if (event.target === ui.securityOverlay) closeSecurityMenu(); });
    document.getElementById('vaultBackupNow').addEventListener('click', async function () {
      await exportBackup();
      ui.backupPrompt.hidden = true;
    });
    document.getElementById('vaultBackupLater').addEventListener('click', function () { ui.backupPrompt.hidden = true; });
  }

  async function beginSetup(event) {
    event.preventDefault();
    const submit = ui.setupForm.querySelector('[type="submit"]');
    submit.disabled = true;
    setGateMessage('正在校验旧数据并准备加密保险箱…');
    try {
      const username = normalizeUsername(document.getElementById('vaultSetupUsername').value);
      const password = document.getElementById('vaultSetupPassword').value;
      const confirmation = document.getElementById('vaultSetupConfirm').value;
      validatePassword(password);
      if (password !== confirmation) throw new Error('两次输入的密码不一致');
      const source = ui.setupSource.value;
      if (!source) throw new Error('检测到两套旧数据，请明确选择其中一套');
      let initialVault = emptyVault();
      if (source === 'plaintext') initialVault = readPlaintextLegacyVault();
      if (source === 'secure-v1') {
        const oldPasswordValue = ui.oldPassword.value;
        if (!oldPasswordValue) throw new Error('请输入历史保险箱的旧密码');
        initialVault = await decryptLegacySecureVault(oldPasswordValue);
      }
      const accountId = makeUuid();
      const keyBytes = randomBytes(32);
      const key = await importDataKey(keyBytes);
      const passwordWrap = await createPasswordWrap(password, accountId, keyBytes);
      const recoveryRaw = base32Encode(randomBytes(20));
      const recoveryWrap = await createRecoveryWrap(recoveryRaw, accountId, keyBytes);
      const now = new Date().toISOString();
      const accountRecord = {
        id: PRIMARY_ID,
        version: FORMAT_VERSION,
        accountId,
        username,
        createdAt: now,
        updatedAt: now,
        passwordKdf: passwordWrap.kdf,
        passwordWrappedKey: passwordWrap.wrappedKey,
        recoveryKdf: recoveryWrap.kdf,
        recoveryWrappedKey: recoveryWrap.wrappedKey,
        migrationSource: source
      };
      const vaultRecord = await encryptVault(initialVault, key, accountId, 1);
      pendingSetup = { accountRecord, vaultRecord, keyBytes, key, initialVault, source };
      const confirmed = await confirmRecoveryCode(recoveryRaw, '保存本机账户恢复码', false);
      if (!confirmed) throw new Error('必须确认恢复码才能创建账户');
      setGateMessage('恢复码已确认，正在写入并重新校验本机账户…');
      await commitSetup();
      ui.setupForm.reset();
    } catch (error) {
      console.error(error);
      if (pendingSetup && pendingSetup.keyBytes) pendingSetup.keyBytes.fill(0);
      pendingSetup = null;
      setGateMessage(error.message || '创建账户失败，旧数据未被修改', true);
    } finally {
      submit.disabled = false;
    }
  }

  async function commitSetup() {
    const staged = pendingSetup;
    if (!staged) throw new Error('账户创建状态已失效，请重试');
    let storedAccount;
    let storedVault;
    let decrypted;
    try {
      await putAccountAndVault(staged.accountRecord, staged.vaultRecord);
      storedAccount = validateAccountRecord(await storeGet(ACCOUNT_STORE, PRIMARY_ID));
      storedVault = await storeGet(VAULT_STORE, PRIMARY_ID);
      decrypted = await decryptVault(storedVault, staged.key);
      if (storedAccount.accountId !== staged.accountRecord.accountId || canonicalVault(decrypted) !== canonicalVault(staged.initialVault)) {
        throw new Error('迁移后的数据比对失败');
      }
    } catch (error) {
      await clearV2Database().catch(function () {});
      throw new Error((error && error.message ? error.message : '迁移失败') + '；旧数据保持不变');
    }
    if (staged.source === 'plaintext') removePlaintextLegacyKeys();
    account = storedAccount;
    encryptedVaultRecord = storedVault;
    pendingSetup = null;
    await startSession(storedAccount, storedVault, staged.keyBytes, staged.key, decrypted);
    ui.backupPrompt.hidden = false;
  }

  async function handleUnlock(event) {
    event.preventDefault();
    const password = document.getElementById('vaultUnlockPassword').value;
    const submit = ui.unlockForm.querySelector('[type="submit"]');
    submit.disabled = true;
    setGateMessage('正在解锁…');
    try {
      const storedAccount = validateAccountRecord(await storeGet(ACCOUNT_STORE, PRIMARY_ID));
      const storedVault = await storeGet(VAULT_STORE, PRIMARY_ID);
      const keyBytes = await unwrapWithPassword(storedAccount, password);
      const key = await importDataKey(keyBytes);
      const decrypted = await decryptVault(storedVault, key);
      if (storedVault.accountId !== storedAccount.accountId) throw new Error('账户与保险箱不匹配');
      account = storedAccount;
      encryptedVaultRecord = storedVault;
      await askOtherTabsToLock(storedAccount.accountId);
      await startSession(storedAccount, storedVault, keyBytes, key, decrypted);
      ui.unlockForm.reset();
    } catch (error) {
      console.error(error);
      setGateMessage(error instanceof SessionInitializationError ? error.message : '密码错误，或本机保险箱已损坏。', true);
    } finally {
      submit.disabled = false;
    }
  }

  async function handleRecoveryReset(event) {
    event.preventDefault();
    const recoveryCode = document.getElementById('vaultRecoveryCode').value;
    const password = document.getElementById('vaultRecoveryPassword').value;
    const confirmation = document.getElementById('vaultRecoveryConfirm').value;
    const submit = ui.recoveryForm.querySelector('[type="submit"]');
    submit.disabled = true;
    setGateMessage('正在验证恢复码…');
    let keyBytes = null;
    try {
      validatePassword(password);
      if (password !== confirmation) throw new Error('两次输入的新密码不一致');
      const storedAccount = validateAccountRecord(await storeGet(ACCOUNT_STORE, PRIMARY_ID));
      const storedVault = await storeGet(VAULT_STORE, PRIMARY_ID);
      keyBytes = await unwrapWithRecovery(storedAccount, recoveryCode);
      const key = await importDataKey(keyBytes);
      const decrypted = await decryptVault(storedVault, key);
      const wrap = await createPasswordWrap(password, storedAccount.accountId, keyBytes);
      const nextAccount = Object.assign({}, storedAccount, {
        passwordKdf: wrap.kdf,
        passwordWrappedKey: wrap.wrappedKey,
        updatedAt: new Date().toISOString()
      });
      await putAccount(nextAccount);
      account = nextAccount;
      encryptedVaultRecord = storedVault;
      await askOtherTabsToLock(nextAccount.accountId);
      await startSession(nextAccount, storedVault, keyBytes, key, decrypted);
      keyBytes = null;
      ui.recoveryForm.reset();
      await showNotice('密码已重置', '请立即导出一份新的加密备份。');
    } catch (error) {
      console.error(error);
      if (keyBytes) keyBytes.fill(0);
      setGateMessage(error.message || '恢复码错误或数据已损坏', true);
    } finally {
      submit.disabled = false;
    }
  }

  function showRestoreMode(fromMode) {
    ui.restoreForm.dataset.returnMode = fromMode || (account ? 'unlock' : 'setup');
    pendingBackup = null;
    document.getElementById('vaultBackupFile').value = '';
    document.getElementById('vaultBackupSummary').textContent = '尚未选择文件';
    document.getElementById('vaultRestoreCredential').value = '';
    setGateMode('restore');
  }

  async function handleBackupSelection(event) {
    const file = event.target.files && event.target.files[0];
    pendingBackup = null;
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 5 MB，已拒绝读取');
      const parsed = JSON.parse(await file.text());
      validateBackup(parsed);
      pendingBackup = parsed;
      document.getElementById('vaultBackupSummary').textContent = '账户：' + parsed.account.username + '；备份时间：' + parsed.createdAt;
      setGateMessage('备份格式有效，请输入密码或恢复码完成验证。');
    } catch (error) {
      event.target.value = '';
      document.getElementById('vaultBackupSummary').textContent = '文件无效';
      setGateMessage(error.message || '无法读取备份文件', true);
    }
  }

  function validateBackup(value) {
    if (!value || value.format !== BACKUP_FORMAT || value.version !== FORMAT_VERSION || !value.account || !value.vault) {
      throw new Error('不是有效的多米 .duomi 备份');
    }
    validateAccountRecord(value.account);
    if (value.vault.accountId !== value.account.accountId) throw new Error('备份中的账户与保险箱不匹配');
    return value;
  }

  async function verifyBackup(value, mode, credential) {
    validateBackup(value);
    const keyBytes = mode === 'recovery'
      ? await unwrapWithRecovery(value.account, credential)
      : await unwrapWithPassword(value.account, credential);
    const key = await importDataKey(keyBytes);
    const decrypted = await decryptVault(value.vault, key);
    return { keyBytes, key, decrypted };
  }

  async function handleRestore(event) {
    event.preventDefault();
    const submit = ui.restoreForm.querySelector('[type="submit"]');
    submit.disabled = true;
    setGateMessage('正在验证备份完整性…');
    let verified = null;
    try {
      if (!pendingBackup) throw new Error('请先选择有效的 .duomi 文件');
      const mode = document.getElementById('vaultRestoreMode').value;
      const credential = document.getElementById('vaultRestoreCredential').value;
      if (!credential) throw new Error('请输入备份密码或恢复码');
      verified = await verifyBackup(pendingBackup, mode, credential);
      if (account && !confirm('恢复备份会替换当前浏览器中的本机账户和数据，确定继续吗？')) {
        verified.keyBytes.fill(0);
        return;
      }
      const previousAccount = await storeGet(ACCOUNT_STORE, PRIMARY_ID);
      const previousVault = await storeGet(VAULT_STORE, PRIMARY_ID);
      try {
        const restoredAccount = Object.assign({}, pendingBackup.account, { id: PRIMARY_ID });
        const restoredVault = Object.assign({}, pendingBackup.vault, { id: PRIMARY_ID });
        await putAccountAndVault(restoredAccount, restoredVault);
        const check = await decryptVault(await storeGet(VAULT_STORE, PRIMARY_ID), verified.key);
        if (canonicalVault(check) !== canonicalVault(verified.decrypted)) throw new Error('恢复后的数据比对失败');
        account = restoredAccount;
        encryptedVaultRecord = restoredVault;
        await askOtherTabsToLock(restoredAccount.accountId);
        await startSession(restoredAccount, restoredVault, verified.keyBytes, verified.key, check);
        verified = null;
        pendingBackup = null;
        ui.restoreForm.reset();
        await showNotice('备份恢复成功', '本机账户和加密记录已通过完整性校验。');
      } catch (writeError) {
        if (previousAccount && previousVault) await putAccountAndVault(previousAccount, previousVault).catch(function () {});
        if (!previousAccount && !previousVault) await clearV2Database().catch(function () {});
        clearSessionMemory();
        account = previousAccount || null;
        encryptedVaultRecord = previousVault || null;
        if (previousAccount) {
          setGateMode('unlock');
        } else {
          await refreshLegacySourceUi();
          setGateMode('setup');
        }
        if (writeError instanceof SessionInitializationError) {
          throw new Error('主界面初始化失败，备份恢复已回滚；原账户和数据未被修改');
        }
        throw writeError;
      }
    } catch (error) {
      console.error(error);
      if (verified && verified.keyBytes) verified.keyBytes.fill(0);
      setGateMessage(error.message || '备份验证失败，当前账户未被修改', true);
    } finally {
      submit.disabled = false;
    }
  }

  async function startSession(accountRecord, vaultRecord, keyBytes, key, clearVault) {
    clearSessionMemory();
    account = accountRecord;
    encryptedVaultRecord = vaultRecord;
    sessionKeyBytes = new Uint8Array(keyBytes);
    sessionKey = key;
    sessionVault = normalizeVault(clearVault);
    sessionRevision = vaultRecord.revision;
    writeQueue = Promise.resolve();
    try {
      if (typeof window.initializeGrowthApp === 'function') window.initializeGrowthApp();
    } catch (error) {
      console.error('主界面初始化失败', error);
      if (typeof window.resetGrowthAppForLock === 'function') {
        try { window.resetGrowthAppForLock(); } catch (resetError) { console.error(resetError); }
      }
      clearSessionMemory();
      if (keyBytes && typeof keyBytes.fill === 'function') keyBytes.fill(0);
      account = accountRecord;
      encryptedVaultRecord = vaultRecord;
      setGateMode('unlock', '账户数据已安全保存，但主界面初始化失败。请刷新页面后使用密码解锁，数据不会丢失。');
      throw new SessionInitializationError();
    }
    hideGate();
    void requestPersistentStorage();
    resetIdleTimer();
    if (channel) channel.postMessage({ type: 'session-open', tabId, accountId: accountRecord.accountId });
  }

  function clearSessionMemory() {
    if (sessionKeyBytes) sessionKeyBytes.fill(0);
    sessionKeyBytes = null;
    sessionKey = null;
    sessionVault = emptyVault();
    sessionRevision = 0;
    encryptedVaultRecord = null;
  }

  async function lockNow(message, broadcast) {
    const lockedAccountId = account && account.accountId;
    await writeQueue.catch(function () {});
    clearTimeout(idleTimer);
    clearTimeout(backgroundTimer);
    idleTimer = null;
    backgroundTimer = null;
    clearSessionMemory();
    scrubSecurityUiForLock();
    if (typeof window.resetGrowthAppForLock === 'function') window.resetGrowthAppForLock();
    account = await storeGet(ACCOUNT_STORE, PRIMARY_ID).catch(function () { return account; });
    setGateMode(account ? 'unlock' : 'setup', message || '应用已锁定。');
    if (broadcast !== false && channel && lockedAccountId) {
      channel.postMessage({ type: 'session-locked', tabId, accountId: lockedAccountId });
    }
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    if (!sessionKey || document.hidden) return;
    idleTimer = setTimeout(function () { void lockNow('已闲置 15 分钟，应用已自动锁定。'); }, IDLE_LOCK_MS);
  }

  function scrubSecurityUiForLock() {
    if (!ui) return;
    if (cancelRecoveryDialog) cancelRecoveryDialog();
    if (cancelActionDialog) cancelActionDialog();
    ui.securityOverlay.hidden = true;
    ui.recoveryOverlay.hidden = true;
    ui.actionOverlay.hidden = true;
    ui.backupPrompt.hidden = true;
    pendingBackup = null;
    document.getElementById('vaultRecoveryCodeDisplay').textContent = '';
    document.getElementById('vaultRecoveryGroupFields').replaceChildren();
    document.getElementById('vaultActionFields').replaceChildren();
    document.getElementById('vaultActionMessage').textContent = '';
    [ui.unlockForm, ui.recoveryForm, ui.restoreForm, ui.actionForm].forEach(function (form) { form.reset(); });
  }

  function handleVisibilityChange() {
    clearTimeout(backgroundTimer);
    if (!sessionKey) return;
    if (document.hidden) {
      backgroundTimer = setTimeout(function () { void lockNow('应用在后台停留超过 5 分钟，已自动锁定。'); }, BACKGROUND_LOCK_MS);
    } else {
      resetIdleTimer();
    }
  }

  async function requestPersistentStorage() {
    storageIsPersistent = false;
    if (!navigator.storage) return;
    try {
      if (typeof navigator.storage.persisted === 'function') storageIsPersistent = await navigator.storage.persisted();
      if (!storageIsPersistent && typeof navigator.storage.persist === 'function') storageIsPersistent = await navigator.storage.persist();
    } catch (error) {
      console.warn('持久化存储请求未获授权', error);
    }
  }

  function updateVault(mutator) {
    if (!sessionKey || !account) return Promise.reject(new Error('本机账户已锁定'));
    const task = writeQueue.catch(function () {}).then(async function () {
      if (!sessionKey || !account) throw new Error('本机账户已锁定');
      const nextVault = clone(sessionVault);
      mutator(nextVault);
      const normalized = normalizeVault(nextVault);
      const expectedRevision = sessionRevision;
      const nextRevision = expectedRevision + 1;
      const nextRecord = await encryptVault(normalized, sessionKey, account.accountId, nextRevision);
      await writeVaultWithRevision(expectedRevision, nextRecord);
      sessionVault = normalized;
      sessionRevision = nextRevision;
      encryptedVaultRecord = nextRecord;
      if (channel) channel.postMessage({ type: 'vault-updated', tabId, accountId: account.accountId, revision: nextRevision });
      resetIdleTimer();
    });
    writeQueue = task.catch(function (error) {
      if (error instanceof RevisionConflictError) {
        setTimeout(function () { void lockNow(error.message, false); }, 0);
      }
      return undefined;
    });
    return task;
  }

  async function askOtherTabsToLock(accountId) {
    if (!channel) return;
    const requestId = makeUuid();
    channel.postMessage({ type: 'prepare-unlock', tabId, accountId, requestId });
    await new Promise(function (resolve) { setTimeout(resolve, 350); });
  }

  function bindBroadcastChannel() {
    if (!channel) return;
    channel.addEventListener('message', function (event) {
      const data = event.data || {};
      if (data.tabId === tabId || !data.accountId) return;
      if (data.type === 'prepare-unlock' && sessionKey && account && data.accountId === account.accountId) {
        void lockNow('同一账户已在另一个标签页解锁，本标签页已安全锁定。', false).then(function () {
          channel.postMessage({ type: 'prepared', tabId, accountId: data.accountId, requestId: data.requestId });
        });
      } else if (data.type === 'session-open' && sessionKey && account && data.accountId === account.accountId) {
        void lockNow('同一账户已在另一个标签页解锁，本标签页已安全锁定。', false);
      }
    });
  }

  function confirmRecoveryCode(code, title, allowCancel) {
    const groups = formatRecoveryCode(code).split('-');
    let first = randomBytes(1)[0] % groups.length;
    let second = randomBytes(1)[0] % groups.length;
    if (second === first) second = (second + 3) % groups.length;
    const indices = [first, second].sort(function (a, b) { return a - b; });
    document.getElementById('vaultRecoveryTitle').textContent = title;
    document.getElementById('vaultRecoveryCodeDisplay').textContent = formatRecoveryCode(code);
    const fields = document.getElementById('vaultRecoveryGroupFields');
    fields.replaceChildren();
    indices.forEach(function (index) {
      const input = element('input', {
        className: 'vault-input vault-monospace', type: 'text', required: true,
        maxLength: 4,
        autocomplete: 'off',
        attributes: {
          'data-group-index': String(index),
          autocapitalize: 'characters',
          spellcheck: 'false'
        }
      });
      input.addEventListener('input', function () {
        const normalized = normalizeRecoveryCode(input.value).slice(0, 4);
        if (input.value !== normalized) input.value = normalized;
        input.classList.remove('vault-input-error');
        input.removeAttribute('aria-invalid');
        const feedback = document.getElementById('vaultRecoveryConfirmMessage');
        feedback.textContent = '';
        feedback.classList.remove('vault-error');
      });
      fields.appendChild(field('请输入第 ' + (index + 1) + ' 组', input));
    });
    const savedCheckbox = document.getElementById('vaultRecoverySaved');
    savedCheckbox.checked = false;
    savedCheckbox.removeAttribute('aria-invalid');
    const feedback = document.getElementById('vaultRecoveryConfirmMessage');
    feedback.textContent = '';
    feedback.classList.remove('vault-error');
    const cancel = document.getElementById('vaultRecoveryConfirmCancel');
    const confirmButton = ui.recoveryConfirmForm.querySelector('[type="submit"]');
    confirmButton.disabled = false;
    cancel.hidden = !allowCancel;
    ui.recoveryOverlay.hidden = false;
    return new Promise(function (resolve) {
      let settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        ui.recoveryConfirmForm.removeEventListener('submit', submitHandler);
        cancel.removeEventListener('click', cancelHandler);
        ui.recoveryOverlay.hidden = true;
        cancelRecoveryDialog = null;
        resolve(result);
      }
      function submitHandler(event) {
        event.preventDefault();
        const inputs = fields.querySelectorAll('input[data-group-index]');
        const incorrect = Array.from(inputs).filter(function (input) {
          return normalizeRecoveryCode(input.value) !== groups[Number(input.dataset.groupIndex)];
        });
        inputs.forEach(function (input) {
          const invalid = incorrect.includes(input);
          input.classList.toggle('vault-input-error', invalid);
          if (invalid) input.setAttribute('aria-invalid', 'true');
          else input.removeAttribute('aria-invalid');
        });
        if (savedCheckbox.checked) savedCheckbox.removeAttribute('aria-invalid');
        else savedCheckbox.setAttribute('aria-invalid', 'true');
        if (incorrect.length || !savedCheckbox.checked) {
          const problems = [];
          if (incorrect.length) {
            problems.push('请重新核对第 ' + incorrect.map(function (input) { return Number(input.dataset.groupIndex) + 1; }).join('、') + ' 组恢复码');
          }
          if (!savedCheckbox.checked) problems.push('请勾选“我已将恢复码单独保存”');
          feedback.textContent = problems.join('；') + '。';
          feedback.classList.add('vault-error');
          const firstInvalid = incorrect[0] || savedCheckbox;
          if (firstInvalid && typeof firstInvalid.focus === 'function') firstInvalid.focus();
          return;
        }
        confirmButton.disabled = true;
        feedback.textContent = '恢复码确认成功，正在安全保存…';
        feedback.classList.remove('vault-error');
        cleanup(true);
      }
      function cancelHandler() { cleanup(false); }
      ui.recoveryConfirmForm.addEventListener('submit', submitHandler);
      cancel.addEventListener('click', cancelHandler);
      cancelRecoveryDialog = function () { cleanup(false); };
    });
  }

  function openSecurityMenu() {
    if (!sessionKey || !account) return;
    ui.securityStatus.textContent = '本机用户：' + account.username + '；存储持久化：' + (storageIsPersistent ? '已授权' : '未授权，请及时导出备份');
    ui.securityOverlay.hidden = false;
  }

  function closeSecurityMenu() {
    ui.securityOverlay.hidden = true;
  }

  function showActionForm(title, fields, submitText) {
    const container = document.getElementById('vaultActionFields');
    container.replaceChildren();
    document.getElementById('vaultActionTitle').textContent = title;
    document.getElementById('vaultActionMessage').textContent = '';
    const submit = ui.actionForm.querySelector('[type="submit"]');
    submit.textContent = submitText || '确认';
    fields.forEach(function (definition) {
      const input = element('input', {
        className: 'vault-input',
        type: definition.type || 'text',
        name: definition.name,
        value: definition.value || '',
        placeholder: definition.placeholder || '',
        autocomplete: definition.autocomplete || 'off',
        required: definition.required !== false,
        minLength: definition.minLength,
        maxLength: definition.maxLength
      });
      container.appendChild(field(definition.label, input));
    });
    ui.actionOverlay.hidden = false;
    const cancel = document.getElementById('vaultActionCancel');
    return new Promise(function (resolve) {
      let settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        ui.actionForm.removeEventListener('submit', submitHandler);
        cancel.removeEventListener('click', cancelHandler);
        ui.actionOverlay.hidden = true;
        cancelActionDialog = null;
        resolve(result);
      }
      function submitHandler(event) {
        event.preventDefault();
        const result = {};
        new FormData(ui.actionForm).forEach(function (value, key) { result[key] = String(value); });
        cleanup(result);
      }
      function cancelHandler() { cleanup(null); }
      ui.actionForm.addEventListener('submit', submitHandler);
      cancel.addEventListener('click', cancelHandler);
      cancelActionDialog = function () { cleanup(null); };
      const first = container.querySelector('input');
      if (first) setTimeout(function () { first.focus(); }, 30);
    });
  }

  async function showNotice(title, message) {
    const notice = showActionForm(title, [], '知道了');
    document.getElementById('vaultActionMessage').textContent = message;
    await notice;
  }

  async function changeUsername() {
    closeSecurityMenu();
    const values = await showActionForm('修改本机用户名', [
      { name: 'username', label: '新用户名（1–30 个字符）', value: account.username, maxLength: 30, autocomplete: 'username' }
    ], '保存用户名');
    if (!values) return;
    try {
      const username = normalizeUsername(values.username);
      const next = Object.assign({}, account, { username, updatedAt: new Date().toISOString() });
      await putAccount(next);
      account = next;
      document.getElementById('vaultUnlockUsername').textContent = username;
    } catch (error) {
      await showNotice('修改失败', error.message);
    }
  }

  async function changePassword() {
    closeSecurityMenu();
    const values = await showActionForm('修改密码', [
      { name: 'current', label: '当前密码', type: 'password', autocomplete: 'current-password' },
      { name: 'next', label: '新密码（10–128 个字符）', type: 'password', minLength: 10, maxLength: 128, autocomplete: 'new-password' },
      { name: 'confirm', label: '确认新密码', type: 'password', minLength: 10, maxLength: 128, autocomplete: 'new-password' }
    ], '修改密码');
    if (!values) return;
    let checkBytes = null;
    try {
      validatePassword(values.next);
      if (values.next !== values.confirm) throw new Error('两次输入的新密码不一致');
      const storedVault = await storeGet(VAULT_STORE, PRIMARY_ID);
      checkBytes = await unwrapWithPassword(account, values.current);
      const checkKey = await importDataKey(checkBytes);
      await decryptVault(storedVault, checkKey);
      checkBytes.fill(0);
      checkBytes = null;
      const wrap = await createPasswordWrap(values.next, account.accountId, sessionKeyBytes);
      const next = Object.assign({}, account, {
        passwordKdf: wrap.kdf,
        passwordWrappedKey: wrap.wrappedKey,
        updatedAt: new Date().toISOString()
      });
      await putAccount(next);
      account = next;
      await showNotice('密码已修改', '请立即重新导出 .duomi 备份。');
    } catch (error) {
      if (checkBytes) checkBytes.fill(0);
      await showNotice('修改失败', error.message || '当前密码错误');
    }
  }

  async function regenerateRecoveryCode() {
    closeSecurityMenu();
    const code = base32Encode(randomBytes(20));
    try {
      const wrap = await createRecoveryWrap(code, account.accountId, sessionKeyBytes);
      const confirmed = await confirmRecoveryCode(code, '保存新的恢复码', true);
      if (!confirmed) return;
      const next = Object.assign({}, account, {
        recoveryKdf: wrap.kdf,
        recoveryWrappedKey: wrap.wrappedKey,
        updatedAt: new Date().toISOString()
      });
      await putAccount(next);
      account = next;
      await showNotice('恢复码已更新', '旧恢复码已失效，请立即重新导出 .duomi 备份。');
    } catch (error) {
      await showNotice('更新失败', error.message);
    }
  }

  async function exportBackup() {
    try {
      await writeQueue;
      const storedAccount = validateAccountRecord(await storeGet(ACCOUNT_STORE, PRIMARY_ID));
      const storedVault = await storeGet(VAULT_STORE, PRIMARY_ID);
      if (!storedVault) throw new Error('未找到可导出的保险箱');
      const backup = {
        format: BACKUP_FORMAT,
        version: FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        account: storedAccount,
        vault: storedVault
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = element('a', { href: url });
      link.download = 'duomi-' + new Date().toISOString().slice(0, 10) + '.duomi';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      closeSecurityMenu();
      return true;
    } catch (error) {
      console.error(error);
      await showNotice('导出失败', error.message || '请稍后重试');
      return false;
    }
  }

  async function deleteUnlockedAccount() {
    closeSecurityMenu();
    const values = await showActionForm('永久删除本机账户', [
      { name: 'password', label: '当前密码', type: 'password', autocomplete: 'current-password' },
      { name: 'phrase', label: '输入“永久删除”确认', placeholder: '永久删除' }
    ], '永久删除');
    if (!values) return;
    let checkBytes = null;
    try {
      if (values.phrase !== '永久删除') throw new Error('确认文字不正确');
      checkBytes = await unwrapWithPassword(account, values.password);
      const checkKey = await importDataKey(checkBytes);
      await decryptVault(await storeGet(VAULT_STORE, PRIMARY_ID), checkKey);
      checkBytes.fill(0);
      checkBytes = null;
      const shouldDeleteLegacySecure = account.migrationSource === 'secure-v1';
      if (shouldDeleteLegacySecure) await deleteLegacySecureDatabase();
      await clearV2Database();
      if (typeof window.resetGrowthAppForLock === 'function') window.resetGrowthAppForLock();
      clearSessionMemory();
      account = null;
      await refreshLegacySourceUi();
      setGateMode('setup', '本机账户已永久删除。');
    } catch (error) {
      if (checkBytes) checkBytes.fill(0);
      await showNotice('删除失败', error.message || '密码错误');
    }
  }

  async function deleteLockedAccount() {
    const values = await showActionForm('密码和恢复码都丢失了吗？', [
      { name: 'phrase', label: '删除后无法恢复。输入“永久删除”确认', placeholder: '永久删除' }
    ], '删除本机账户');
    if (!values) return;
    if (values.phrase !== '永久删除') {
      setGateMessage('确认文字不正确，账户未删除。', true);
      return;
    }
    try {
      const shouldDeleteLegacySecure = account && account.migrationSource === 'secure-v1';
      if (shouldDeleteLegacySecure) await deleteLegacySecureDatabase();
      await clearV2Database();
      account = null;
      await refreshLegacySourceUi();
      setGateMode('setup', '本机账户已永久删除。');
    } catch (error) {
      setGateMessage(error.message || '删除失败', true);
    }
  }

  async function bootstrap() {
    try {
      if (!globalThis.crypto || !crypto.subtle || !globalThis.indexedDB) throw new Error('当前浏览器不支持安全的本机加密存储');
      buildUi();
      await openDatabase();
      account = await storeGet(ACCOUNT_STORE, PRIMARY_ID);
      if (account) {
        validateAccountRecord(account);
        setGateMode('unlock');
      } else {
        await refreshLegacySourceUi();
        setGateMode('setup');
      }
      bindBroadcastChannel();
      if (navigator.storage && typeof navigator.storage.persisted === 'function') {
        storageIsPersistent = await navigator.storage.persisted().catch(function () { return false; });
      }
    } catch (error) {
      console.error(error);
      if (!ui) buildUi();
      setGateMode('setup', error.message || '无法初始化本机保险箱');
      ui.setupForm.querySelectorAll('input, select, button').forEach(function (control) { control.disabled = true; });
    }
  }

  window.getRecords = function () {
    return sessionKey ? clone(sessionVault.growthRecords) : [];
  };
  window.saveRecords = function (records) {
    return updateVault(function (vault) { vault.growthRecords = validateGrowthRecords(records); });
  };
  window.getChildInfo = function () {
    return sessionKey ? clone(sessionVault.childInfo) : null;
  };
  window.saveChildInfo = function (value) {
    return updateVault(function (vault) { vault.childInfo = value == null ? null : validateChildInfo(value); });
  };
  window.getMilkRecords = function () {
    return sessionKey ? clone(sessionVault.milkRecords) : [];
  };
  window.saveMilkRecords = function (records) {
    return updateVault(function (vault) { vault.milkRecords = validateMilkRecords(records); });
  };

  window.DuomiVault = {
    openSecurityMenu,
    lock: function () { return lockNow('应用已锁定。'); },
    exportBackup,
    isUnlocked: function () { return Boolean(sessionKey); },
    version: FORMAT_VERSION
  };

  ['pointerdown', 'touchstart', 'keydown'].forEach(function (eventName) {
    document.addEventListener(eventName, function () { if (sessionKey) resetIdleTimer(); }, { passive: true });
  });
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else void bootstrap();
})();
