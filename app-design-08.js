/** 渲染喝奶记录列表 */
function renderMilkList() {
  var container = document.getElementById('milkListContent');
  var summaryContainer = document.getElementById('milkTodaySummary');
  var allRecords = getMilkRecords();

  var filterDate = document.getElementById('milkFilterDate').value;
  if (!filterDate) {
    filterDate = getTodayStr();
    document.getElementById('milkFilterDate').value = filterDate;
  }

  var dayRecords = allRecords.filter(function(r) { return r.milkDate === filterDate; });
  dayRecords.sort(function(a, b) { return a.milkTime.localeCompare(b.milkTime); });

  var dayTotal = 0;
  var breastTotal = 0, formulaTotal = 0;
  dayRecords.forEach(function(r) {
    dayTotal += r.milkAmount;
    if (r.milkType === 'breast') breastTotal += r.milkAmount;
    else formulaTotal += r.milkAmount;
  });
  var dayCount = dayRecords.length;

  if (dayCount > 0) {
    summaryContainer.innerHTML =
      '<div class="milk-summary-inner">' +
        '<div class="milk-summary-icon">🍼</div>' +
        '<div class="milk-summary-info">' +
          '<div class="milk-summary-label">' + filterDate + ' 喝奶总量</div>' +
          '<div class="milk-summary-total">' + dayTotal + ' <span class="milk-summary-unit">ml</span></div>' +
        '</div>' +
        '<div class="milk-summary-count">共 ' + dayCount + ' 次</div>' +
      '</div>' +
      '<div class="milk-type-summary">' +
        '<div class="milk-type-summary-item">' +
          '<span class="milk-type-summary-icon">🤱</span>' +
          '<span class="milk-type-summary-text">母乳</span>' +
          '<span class="milk-type-summary-val">' + breastTotal + ' ml</span>' +
        '</div>' +
        '<div class="milk-type-summary-divider"></div>' +
        '<div class="milk-type-summary-item">' +
          '<span class="milk-type-summary-icon">🍼</span>' +
          '<span class="milk-type-summary-text">奶粉</span>' +
          '<span class="milk-type-summary-val">' + formulaTotal + ' ml</span>' +
        '</div>' +
      '</div>';
  } else {
    summaryContainer.innerHTML = '';
  }

  if (dayRecords.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
      '  <div class="empty-state-icon">🍼🧸</div>' +
      '  <div class="empty-state-text">这一天还没有喝奶记录哦~</div>' +
      '  <button class="empty-state-btn" onclick="openMilkModal()">马上记录 ✨</button>' +
      '</div>';
    return;
  }

  var html = '<div class="milk-record-list">';
  var runningTotal = 0;
  dayRecords.forEach(function(record) {
    runningTotal += record.milkAmount;
    html += '<div class="milk-record-item">';
    html += '  <div class="milk-record-left">';
    html += '    <div class="milk-record-time">⏰ ' + record.milkTime + '</div>';
    html += '  </div>';
    html += '  <div class="milk-record-center">';
    html += '    <div class="milk-record-amount">' + record.milkAmount + ' <span class="milk-record-unit">ml</span></div>';
    html += '    <div class="milk-record-type ' + (record.milkType === 'breast' ? 'type-breast' : 'type-formula') + '">' + (record.milkType === 'breast' ? '🤱 母乳' : '🍼 奶粉') + '</div>';
    html += '  </div>';
    html += '  <div class="milk-record-right">';
    html += '    <div class="milk-record-running">累计 ' + runningTotal + ' ml</div>';
    html += '    <button class="btn btn-sm btn-blue" onclick="openEditMilkModal(\'' + record.id + '\')">修改</button>';
    html += '    <button class="btn btn-sm btn-red" onclick="deleteMilkRecord(\'' + record.id + '\')">删除</button>';
    html += '  </div>';
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (document.getElementById('editMilkModal').classList.contains('show')) closeEditMilkModal();
    if (document.getElementById('milkModal').classList.contains('show')) closeMilkModal();
    if (document.getElementById('addModal').classList.contains('show')) closeAddModal();
    if (document.getElementById('editModal').classList.contains('show')) closeEditModal();
    if (document.getElementById('childInfoModal').classList.contains('show')) closeChildInfoModal();
  }
});

function init() {
  const today = getTodayStr();
  document.getElementById('editDate').setAttribute('max', today);
  document.getElementById('addDate').setAttribute('max', today);
  document.getElementById('childBirthDate').setAttribute('max', today);
  document.getElementById('milkDate').setAttribute('max', today);
  updateNavTitle();
  const childInfo = getChildInfo();
  if (!childInfo) showChildInfoModal();
  const hash = window.location.hash.replace('#', '') || 'milk';
  navigateTo(hash);
}

document.addEventListener('DOMContentLoaded', function () {
  SecureVault.bootstrap()
    .then(init)
    .catch(function (error) {
      console.error('安全存储初始化失败', error);
    });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js?v=20260713archive3', {
      scope: './',
      updateViaCache: 'none'
    })
      .then(function (registration) {
        registration.update().catch(function () {});
        console.log('Service Worker 注册成功:', registration.scope);
      })
      .catch(function (error) {
        console.log('Service Worker 注册失败:', error);
      });
  });
}
