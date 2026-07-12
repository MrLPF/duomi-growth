const DB_NAME='duomi-growth-db';
const DB_VERSION=1;
const STORE='vault';
const META_KEY='meta';
const DATA_KEY='records';
const enc=new TextEncoder();
const dec=new TextDecoder();
let sessionKey=null;
let inactivityTimer=null;
let currentData={profile:{name:'',birthday:''},records:[]};

const $=s=>document.querySelector(s);
const app=$('#app');

function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)));}
function unb64(str){return Uint8Array.from(atob(str),c=>c.charCodeAt(0));}
function randomBytes(n){const a=new Uint8Array(n);crypto.getRandomValues(a);return a;}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbGet(key){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbSet(key,value){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function dbClear(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}

async function deriveKey(password,salt,iterations=310000){const base=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encryptJson(value,key){const iv=randomBytes(12);const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(value)));return {iv:b64(iv),ciphertext:b64(ciphertext)};}
async function decryptJson(payload,key){const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv)},key,unb64(payload.ciphertext));return JSON.parse(dec.decode(clear));}
async function createVault(password){const salt=randomBytes(16);const iterations=310000;const key=await deriveKey(password,salt,iterations);const check=await encryptJson({ok:true},key);await dbSet(META_KEY,{version:1,salt:b64(salt),iterations,check});sessionKey=key;await migrateLegacy();await saveData();}
async function unlock(password){const meta=await dbGet(META_KEY);if(!meta)return false;try{const key=await deriveKey(password,unb64(meta.salt),meta.iterations);await decryptJson(meta.check,key);sessionKey=key;const payload=await dbGet(DATA_KEY);currentData=payload?await decryptJson(payload,key):{profile:{name:'',birthday:''},records:[]};resetLockTimer();return true;}catch{return false;}}
async function saveData(){if(!sessionKey)throw new Error('locked');await dbSet(DATA_KEY,await encryptJson(currentData,sessionKey));resetLockTimer();}
function lock(){sessionKey=null;currentData={profile:{name:'',birthday:''},records:[]};clearTimeout(inactivityTimer);renderLock();}
function resetLockTimer(){clearTimeout(inactivityTimer);inactivityTimer=setTimeout(lock,5*60*1000);}
['click','touchstart','keydown'].forEach(e=>document.addEventListener(e,()=>sessionKey&&resetLockTimer(),{passive:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&sessionKey)resetLockTimer();});

async function migrateLegacy(){const raw=localStorage.getItem('duomiData')||localStorage.getItem('growthData');if(raw){try{const parsed=JSON.parse(raw);currentData=parsed.profile||parsed.records?parsed:{profile:{name:'',birthday:''},records:Array.isArray(parsed)?parsed:[]};localStorage.removeItem('duomiData');localStorage.removeItem('growthData');}catch{}}}

function renderSetup(){app.innerHTML=`<section class="card auth"><h1>创建本地保险箱</h1><p>主密码只用于本机数据加密，不会上传。忘记后无法找回。</p><form id="setup-form"><label>主密码<input id="pw1" type="password" minlength="8" required autocomplete="new-password"></label><label>确认密码<input id="pw2" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary">创建并进入</button></form><p class="hint">建议至少 8 位，并定期导出加密备份。</p></section>`;$('#setup-form').onsubmit=async e=>{e.preventDefault();const a=$('#pw1').value,b=$('#pw2').value;if(a!==b)return alert('两次密码不一致');await createVault(a);renderMain();};}
function renderLock(){app.innerHTML=`<section class="card auth"><h1>多米成长记录</h1><p>请输入主密码解锁本机数据。</p><form id="unlock-form"><label>主密码<input id="pw" type="password" required autocomplete="current-password"></label><button class="primary">解锁</button></form><button id="import-on-lock" class="ghost">从加密备份恢复</button><p class="hint">Pages 地址可以公开，但你的记录只以密文保存在当前设备。</p></section>`;$('#unlock-form').onsubmit=async e=>{e.preventDefault();if(await unlock($('#pw').value))renderMain();else alert('密码错误或数据已损坏');};$('#import-on-lock').onclick=()=>$('#backup-input').click();}
function renderMain(){const rows=currentData.records.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.height||'')}</td><td>${escapeHtml(r.weight||'')}</td><td>${escapeHtml(r.note||'')}</td><td><button class="danger tiny" data-id="${r.id}">删除</button></td></tr>`).join('');app.innerHTML=`<header class="topbar"><div><p class="eyebrow">离线 · 本地加密</p><h1>多米成长记录</h1></div><button id="lock-btn" class="ghost">锁定</button></header><section class="card"><h2>基本信息</h2><div class="grid"><label>姓名<input id="name" value="${escapeAttr(currentData.profile.name||'')}"></label><label>生日<input id="birthday" type="date" value="${escapeAttr(currentData.profile.birthday||'')}"></label></div><button id="save-profile" class="primary">保存信息</button></section><section class="card"><h2>新增记录</h2><form id="record-form" class="grid"><label>日期<input id="date" type="date" required value="${new Date().toISOString().slice(0,10)}"></label><label>身高（cm）<input id="height" type="number" step="0.1" min="0"></label><label>体重（kg）<input id="weight" type="number" step="0.1" min="0"></label><label class="wide">备注<textarea id="note" rows="3"></textarea></label><button class="primary wide">添加记录</button></form></section><section class="card"><div class="section-head"><h2>历史记录</h2><span>${currentData.records.length} 条</span></div><div class="table-wrap"><table><thead><tr><th>日期</th><th>身高</th><th>体重</th><th>备注</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">暂无记录</td></tr>'}</tbody></table></div></section><section class="card"><h2>备份与恢复</h2><div class="actions"><button id="export-btn" class="primary">导出加密备份</button><button id="import-btn" class="ghost">导入加密备份</button><button id="reset-btn" class="danger">清除本机数据</button></div><p class="hint">备份文件仍需要原主密码才能解密。</p></section>`;
$('#lock-btn').onclick=lock;$('#save-profile').onclick=async()=>{currentData.profile={name:$('#name').value.trim(),birthday:$('#birthday').value};await saveData();alert('已保存');};$('#record-form').onsubmit=async e=>{e.preventDefault();currentData.records.push({id:crypto.randomUUID(),date:$('#date').value,height:$('#height').value,weight:$('#weight').value,note:$('#note').value.trim()});await saveData();renderMain();};document.querySelectorAll('[data-id]').forEach(b=>b.onclick=async()=>{if(confirm('确定删除这条记录？')){currentData.records=currentData.records.filter(r=>r.id!==b.dataset.id);await saveData();renderMain();}});$('#export-btn').onclick=exportBackup;$('#import-btn').onclick=()=>$('#backup-input').click();$('#reset-btn').onclick=async()=>{if(confirm('这会永久删除当前设备上的全部数据，确定继续？')){await dbClear();location.reload();}};}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escapeAttr(v){return escapeHtml(v);}
async function exportBackup(){const meta=await dbGet(META_KEY),data=await dbGet(DATA_KEY);const blob=new Blob([JSON.stringify({format:'duomi-encrypted-backup',version:1,createdAt:new Date().toISOString(),meta,data},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`duomi-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}
async function importBackup(file){const text=await file.text();const obj=JSON.parse(text);if(obj.format!=='duomi-encrypted-backup'||!obj.meta||!obj.data)throw new Error('无效备份');await dbSet(META_KEY,obj.meta);await dbSet(DATA_KEY,obj.data);lock();alert('备份已导入，请使用原主密码解锁');}

window.addEventListener('DOMContentLoaded',async()=>{if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.id='backup-input';input.hidden=true;input.onchange=async()=>{try{if(input.files[0])await importBackup(input.files[0]);}catch(e){alert('导入失败：'+e.message);}finally{input.value='';}};document.body.appendChild(input);const meta=await dbGet(META_KEY);meta?renderLock():renderSetup();});
