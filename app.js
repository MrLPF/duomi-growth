(function () {
    'use strict';

    /* ====================================================================
       儿童成长记录 - 主脚本
       功能：数据录入、记录列表（含编辑删除）、成长曲线图、加密保险箱适配
    ==================================================================== */

    // ========== 常量与工具函数 ==========

    /** 生成简易UUID */
    function generateId() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    /** 获取今天的日期字符串 YYYY-MM-DD */
    function getTodayStr() {
      const d = new Date();
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }

    /**
     * 根据出生日期和记录日期计算年龄
     * 返回 "X岁Y月" 格式
     */
    function calcAge(birthDateStr, recordDateStr) {
      if (!birthDateStr || !recordDateStr) return '--';
      const birth = new Date(birthDateStr);
      const record = new Date(recordDateStr);

      if (record < birth) return '--';

      let years = record.getFullYear() - birth.getFullYear();
      let months = record.getMonth() - birth.getMonth();

      // 如果记录日期的天数小于出生日期的天数，月份减1
      if (record.getDate() < birth.getDate()) {
        months--;
      }

      // 修正月份为负的情况
      if (months < 0) {
        years--;
        months += 12;
      }

      // 如果年龄为0岁，只显示月数
      if (years === 0) {
        return months + '月';
      }
      return years + '岁' + months + '月';
    }

    /** 显示Toast提示 */
    function showToast(message, duration) {
      duration = duration || 2000;
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(function () {
        toast.classList.remove('show');
      }, duration);
    }

    function createElement(tagName, className, text) {
      const node = document.createElement(tagName);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    function appendChildren(parent) {
      for (let i = 1; i < arguments.length; i++) {
        const child = arguments[i];
        if (child) parent.appendChild(child);
      }
      return parent;
    }

    function createActionButton(label, className, action, valueName, value) {
      const button = createElement('button', className, label);
      button.type = 'button';
      button.dataset.action = action;
      if (valueName && value !== undefined) button.dataset[valueName] = String(value);
      return button;
    }

    function createEmptyState(icon, message, buttonLabel, action) {
      const wrapper = createElement('div', 'empty-state');
      appendChildren(
        wrapper,
        createElement('div', 'empty-state-icon', icon),
        createElement('div', 'empty-state-text', message),
        createActionButton(buttonLabel, 'empty-state-btn', action)
      );
      return wrapper;
    }

    function reportSaveError(error) {
      console.error('保存失败:', error);
      showToast('保存失败，请重试或重新加载页面', 3500);
    }

    // ========== 加密保险箱数据适配 ==========

    /** 获取所有成长记录 */
    function getRecords() {
      return typeof window.getRecords === 'function' ? window.getRecords() : [];
    }

    /** 保存所有成长记录 */
    async function saveRecords(records) {
      if (typeof window.saveRecords !== 'function') throw new Error('加密保险箱尚未解锁');
      await window.saveRecords(records);
    }

    /** 获取宝宝信息 */
    function getChildInfo() {
      return typeof window.getChildInfo === 'function' ? window.getChildInfo() : null;
    }

    /** 保存宝宝信息 */
    async function saveChildInfo(info) {
      if (typeof window.saveChildInfo !== 'function') throw new Error('加密保险箱尚未解锁');
      await window.saveChildInfo(info);
    }

    // ========== 路由与导航 ==========

    let currentPage = 'milk';
    let appActive = false;
    let listenersBound = false;

    /** 页面导航函数 */
    function navigateTo(page) {
      if (!appActive) return;
      if (!['milk', 'list', 'chart'].includes(page)) page = 'milk';
      currentPage = page;

      // 更新hash
      window.location.hash = page;

      // 切换导航高亮
      document.querySelectorAll('.nav-tab').forEach(function (tab) {
        tab.classList.toggle('active', tab.getAttribute('data-page') === page);
      });

      // 切换页面显示
      document.querySelectorAll('.page-section').forEach(function (section) {
        section.classList.remove('active');
      });

      const targetSection = document.getElementById('page-' + page);
      if (targetSection) {
        targetSection.classList.add('active');
      }

      // 页面切换时刷新对应内容
      if (page === 'list') {
        renderList();
      } else if (page === 'chart') {
        renderChart();
      } else if (page === 'milk') {
        renderMilkList();
      }
    }

    /** 监听hash变化 */
    window.addEventListener('hashchange', function () {
      const hash = window.location.hash.replace('#', '') || 'milk';
      if (appActive && hash !== currentPage) {
        navigateTo(hash);
      }
    });

    // ========== 表单验证工具 ==========

    /**
     * 通用表单验证
     * @param {Object} config - 验证配置
     * config.fields: [{ id, errorId, rules: [{test, msg}] }]
     * @returns {boolean}
     */
    function validateForm(config) {
      let valid = true;

      config.fields.forEach(function (field) {
        const input = document.getElementById(field.id);
        const errorEl = document.getElementById(field.errorId);
        const value = input.value.trim();

        // 清除之前的错误状态
        input.classList.remove('error');
        errorEl.textContent = '';
        errorEl.classList.remove('show');

        // 逐条检查规则
        for (let i = 0; i < field.rules.length; i++) {
          const rule = field.rules[i];
          if (!rule.test(value, input)) {
            input.classList.add('error');
            errorEl.textContent = rule.msg;
            errorEl.classList.add('show');
            valid = false;
            break;
          }
        }
      });

      return valid;
    }

    /** 清除表单所有错误状态 */
    function clearFormErrors(config) {
      config.fields.forEach(function (field) {
        const input = document.getElementById(field.id);
        const errorEl = document.getElementById(field.errorId);
        input.classList.remove('error');
        errorEl.textContent = '';
        errorEl.classList.remove('show');
      });
    }

    // ========== 成长记录列表 ==========

    let listCurrentPage = 1;
    const PAGE_SIZE = 10;

    /** 渲染列表页面 */
    function renderList() {
      const container = document.getElementById('listContent');
      const records = getRecords();
      container.replaceChildren();

      // 按记录日期降序排序（最新在前）
      records.sort(function (a, b) {
        return b.recordDate.localeCompare(a.recordDate);
      });

      // 空状态
      if (records.length === 0) {
        container.appendChild(createEmptyState('🌱🧸', '还没有成长记录哦~ 快来记录宝宝的成长瞬间吧！', '马上记录 ✨', 'open-add'));
        return;
      }

      // 计算分页
      const totalPages = Math.ceil(records.length / PAGE_SIZE);
      if (listCurrentPage > totalPages) listCurrentPage = totalPages;
      if (listCurrentPage < 1) listCurrentPage = 1;

      const startIdx = (listCurrentPage - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, records.length);
      const pageRecords = records.slice(startIdx, endIdx);

      const childInfo = getChildInfo();

      const tableWrapper = createElement('div', 'table-wrapper');
      const table = createElement('table', 'data-table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['序号', '记录日期', '年龄', '身高(cm)', '体重(kg)', '发育水平', '操作'].forEach(function (label) {
        headRow.appendChild(createElement('th', '', label));
      });
      thead.appendChild(headRow);
      const tbody = document.createElement('tbody');

      pageRecords.forEach(function (record, index) {
        const ageStr = calcAge(childInfo ? childInfo.birthDate : '', record.recordDate);
        const globalIndex = startIdx + index + 1;

        const row = document.createElement('tr');
        [globalIndex, record.recordDate, ageStr, Number(record.height).toFixed(1), Number(record.weight).toFixed(2)].forEach(function (value) {
          row.appendChild(createElement('td', '', value));
        });
        const growthCell = document.createElement('td');
        growthCell.appendChild(createGrowthPercentNode(childInfo ? childInfo.birthDate : '', record.recordDate, record.height, record.weight));
        row.appendChild(growthCell);
        const actionsCell = document.createElement('td');
        const actions = createElement('div', 'action-btns');
        appendChildren(
          actions,
          createActionButton('编辑', 'btn btn-sm btn-blue', 'edit-growth', 'id', record.id),
          createActionButton('删除', 'btn btn-sm btn-red', 'delete-growth', 'id', record.id)
        );
        actionsCell.appendChild(actions);
        row.appendChild(actionsCell);
        tbody.appendChild(row);
      });

      appendChildren(table, thead, tbody);
      tableWrapper.appendChild(table);
      container.appendChild(tableWrapper);

      // 分页控件
      const pagination = createElement('div', 'pagination');
      const previous = createActionButton('«', 'page-btn', 'growth-page', 'page', listCurrentPage - 1);
      previous.disabled = listCurrentPage <= 1;
      pagination.appendChild(previous);

      // 页码按钮
      for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 7 && i > 3 && i < totalPages - 1 && Math.abs(i - listCurrentPage) > 1) {
          if (i === 4 || i === totalPages - 2) {
            pagination.appendChild(createElement('span', 'pagination-ellipsis', '...'));
          }
          continue;
        }
        const pageButton = createActionButton(i, 'page-btn' + (i === listCurrentPage ? ' active' : ''), 'growth-page', 'page', i);
        pagination.appendChild(pageButton);
      }

      const next = createActionButton('»', 'page-btn', 'growth-page', 'page', listCurrentPage + 1);
      next.disabled = listCurrentPage >= totalPages;
      pagination.appendChild(next);
      container.appendChild(pagination);
    }

    /** 跳转到指定页 */
    function goListPage(page) {
      listCurrentPage = page;
      renderList();
    }

    /** 删除记录 */
    async function deleteRecord(id) {
      if (!confirm('确定要删除这条记录吗？删除后不可恢复。')) return;

      let records = getRecords();
      records = records.filter(function (r) { return r.id !== id; });
      try {
        await saveRecords(records);
        showToast('✨ 记录已删除');
        renderList();
      } catch (error) {
        reportSaveError(error);
      }
    }

    /** 打开新增记录模态框 */
    function openAddModal() {
      document.getElementById('addModal').classList.add('show');
      // 设置日期最大值为今天
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('addDate').setAttribute('max', today);
      // 清空表单和错误提示
      document.getElementById('addForm').reset();
      clearFormErrors({
        fields: [
          { id: 'addDate', errorId: 'addDateError' },
          { id: 'addHeight', errorId: 'addHeightError' },
          { id: 'addWeight', errorId: 'addWeightError' }
        ]
      });
      // 聚焦到日期输入框
      setTimeout(function() { document.getElementById('addDate').focus(); }, 100);
    }

    /** 关闭新增记录模态框 */
    function closeAddModal() {
      document.getElementById('addModal').classList.remove('show');
      clearFormErrors({
        fields: [
          { id: 'addDate', errorId: 'addDateError' },
          { id: 'addHeight', errorId: 'addHeightError' },
          { id: 'addWeight', errorId: 'addWeightError' }
        ]
      });
    }

    /** 新增模态框遮罩点击处理 */
    function handleAddModalOverlayClick(event) {
      if (event.target === event.currentTarget) {
        closeAddModal();
      }
    }

    /** 处理新增记录提交 */
    async function handleAddSubmit(event) {
      event.preventDefault();

      // 表单验证
      const today = new Date().toISOString().split('T')[0];
      const valid = validateForm({
        fields: [
          {
            id: 'addDate',
            errorId: 'addDateError',
            rules: [
              { test: function(v) { return v.trim() !== ''; }, msg: '请选择记录日期' },
              { test: function(v) { return v <= today; }, msg: '日期不能是未来日期' }
            ]
          },
          {
            id: 'addHeight',
            errorId: 'addHeightError',
            rules: [
              { test: function(v) { return v.trim() !== ''; }, msg: '请输入身高' },
              { test: function(v) { return v > 0 && v <= 250; }, msg: '身高需在 1-250 cm 之间' }
            ]
          },
          {
            id: 'addWeight',
            errorId: 'addWeightError',
            rules: [
              { test: function(v) { return v.trim() !== ''; }, msg: '请输入体重' },
              { test: function(v) { return v > 0 && v <= 200; }, msg: '体重需在 0.1-200 kg 之间' }
            ]
          }
        ]
      });

      if (!valid) return;

      const date = document.getElementById('addDate').value;
      const height = parseFloat(document.getElementById('addHeight').value);
      const weight = parseFloat(document.getElementById('addWeight').value);

      // 生成记录
      const newRecord = {
        id: generateId(),
        recordDate: date,
        height: height,
        weight: weight
      };

      const records = getRecords();
      records.push(newRecord);
      try {
        await saveRecords(records);
        closeAddModal();
        showToast('✨ 记录添加成功');
        renderList();
      } catch (error) {
        reportSaveError(error);
      }
    }

    /** 打开编辑模态框 */
    function openEditModal(id) {
      const records = getRecords();
      const record = records.find(function (r) { return r.id === id; });
      if (!record) return;

      // 填充表单
      document.getElementById('editId').value = record.id;
      document.getElementById('editDate').value = record.recordDate;
      document.getElementById('editHeight').value = record.height;
      document.getElementById('editWeight').value = record.weight;

      // 清除之前的错误
      clearFormErrors(editValidationConfig);

      // 显示模态框
      const modal = document.getElementById('editModal');
      modal.classList.add('show');
    }

    /** 关闭编辑模态框 */
    function closeEditModal() {
      const modal = document.getElementById('editModal');
      modal.classList.remove('show');
    }

    /** 点击遮罩层关闭编辑模态框 */
    function handleModalOverlayClick(e) {
      if (e.target === e.currentTarget) {
        closeEditModal();
      }
    }

    /** 编辑表单验证配置 */
    const editValidationConfig = {
      fields: [
        {
          id: 'editDate',
          errorId: 'editDateError',
          rules: [
            { test: function (v) { return v.length > 0; }, msg: '请选择记录日期' },
            { test: function (v) { return v <= getTodayStr(); }, msg: '记录日期不能是未来日期' }
          ]
        },
        {
          id: 'editHeight',
          errorId: 'editHeightError',
          rules: [
            { test: function (v) { return v.length > 0; }, msg: '请输入身高' },
            { test: function (v) { return !isNaN(v) && Number(v) >= 1 && Number(v) <= 250; }, msg: '身高需在1-250cm之间' }
          ]
        },
        {
          id: 'editWeight',
          errorId: 'editWeightError',
          rules: [
            { test: function (v) { return v.length > 0; }, msg: '请输入体重' },
            { test: function (v) { return !isNaN(v) && Number(v) >= 0.1 && Number(v) <= 200; }, msg: '体重需在0.1-200kg之间' }
          ]
        }
      ]
    };

    /** 处理编辑表单提交 */
    async function handleEditSubmit(e) {
      e.preventDefault();

      if (!validateForm(editValidationConfig)) return;

      const id = document.getElementById('editId').value;
      let records = getRecords();
      const index = records.findIndex(function (r) { return r.id === id; });

      if (index === -1) return;

      // 更新记录
      records[index].recordDate = document.getElementById('editDate').value;
      records[index].height = parseFloat(document.getElementById('editHeight').value);
      records[index].weight = parseFloat(document.getElementById('editWeight').value);

      try {
        await saveRecords(records);
        closeEditModal();
        showToast('✨ 记录修改成功');
        renderList();
      } catch (error) {
        reportSaveError(error);
      }
    }

    // ========== 页面3：成长曲线图 ==========

    let growthChart = null;

    /**
     * WHO参考标准（近似值）
     * 键为月龄，值为 { avgHeight(cm), avgWeight(kg) }
     * 基于 WHO 儿童生长标准 50th 百分位（中位数）
     */
    const whoReference = {
      0:  { avgHeight: 50, avgWeight: 3.3 },
      1:  { avgHeight: 54.7, avgWeight: 4.5 },
      2:  { avgHeight: 58.4, avgWeight: 5.6 },
      3:  { avgHeight: 61.4, avgWeight: 6.4 },
      4:  { avgHeight: 63.9, avgWeight: 7.0 },
      5:  { avgHeight: 65.9, avgWeight: 7.5 },
      6:  { avgHeight: 67.6, avgWeight: 7.9 },
      8:  { avgHeight: 70.6, avgWeight: 8.6 },
      10: { avgHeight: 73.3, avgWeight: 9.2 },
      12: { avgHeight: 75.7, avgWeight: 9.8 },
      15: { avgHeight: 79.1, avgWeight: 10.5 },
      18: { avgHeight: 82.3, avgWeight: 11.0 },
      21: { avgHeight: 85.1, avgWeight: 11.5 },
      24: { avgHeight: 87.8, avgWeight: 12.0 },
      30: { avgHeight: 93.0, avgWeight: 13.1 },
      36: { avgHeight: 96.1, avgWeight: 14.1 },
      42: { avgHeight: 99.9, avgWeight: 15.1 },
      48: { avgHeight: 103.3, avgWeight: 16.0 },
      54: { avgHeight: 106.9, avgWeight: 17.0 },
      60: { avgHeight: 110.0, avgWeight: 18.0 },
      72: { avgHeight: 116.0, avgWeight: 20.0 },
      84: { avgHeight: 122.0, avgWeight: 22.0 },
      96: { avgHeight: 128.0, avgWeight: 24.5 },
      108: { avgHeight: 133.5, avgWeight: 27.0 },
      120: { avgHeight: 138.6, avgWeight: 30.0 },
      132: { avgHeight: 143.8, avgWeight: 33.5 },
      144: { avgHeight: 149.6, avgWeight: 37.5 },
      156: { avgHeight: 156.0, avgWeight: 42.0 },
      168: { avgHeight: 162.0, avgWeight: 47.0 },
      180: { avgHeight: 168.0, avgWeight: 52.5 }
    };

    /**
     * 根据出生日期和记录日期，查找对应的 WHO 50th 百分位参考值
     * 返回 { months: number, avgHeight: number, avgWeight: number } 或 null
     */
    function getWhoForAge(birthDateStr, recordDateStr) {
      if (!birthDateStr || !recordDateStr) return null;
      var birth = new Date(birthDateStr);
      var record = new Date(recordDateStr);
      if (record < birth) return null;

      var months = (record.getFullYear() - birth.getFullYear()) * 12 +
        (record.getMonth() - birth.getMonth());
      if (record.getDate() < birth.getDate()) months--;
      months = Math.max(0, months);

      // 在 WHO 表中找最近的月龄
      var ageKeys = Object.keys(whoReference).map(Number).sort(function (a, b) { return a - b; });
      var closestKey = ageKeys[0];
      var minDiff = Math.abs(months - closestKey);
      for (var i = 1; i < ageKeys.length; i++) {
        var diff = Math.abs(months - ageKeys[i]);
        if (diff < minDiff) {
          minDiff = diff;
          closestKey = ageKeys[i];
        }
      }

      var ref = whoReference[closestKey];
      return { months: months, closestMonth: closestKey, avgHeight: ref.avgHeight, avgWeight: ref.avgWeight };
    }

    /**
     * 计算发育水平百分比标签
     * 返回如 "身高88% 体重92%" 的可读字符串
     */
    function createGrowthPercentNode(birthDateStr, recordDateStr, height, weight) {
      var who = getWhoForAge(birthDateStr, recordDateStr);
      if (!who) return createElement('span', 'pct-na', '--');

      var hPct = Math.round((height / who.avgHeight) * 100);
      var wPct = Math.round((weight / who.avgWeight) * 100);

      // 根据百分比选择颜色/标签
      function pctClass(pct) {
        if (pct >= 90) return 'pct-good';
        if (pct >= 75) return 'pct-normal';
        return 'pct-low';
      }
      function pctIcon(pct) {
        if (pct >= 95) return '🌟';
        if (pct >= 90) return '😊';
        if (pct >= 75) return '👌';
        return '💪';
      }

      return createElement(
        'span',
        'pct-tag ' + pctClass(Math.min(hPct, wPct)),
        pctIcon(Math.min(hPct, wPct)) + ' ' + hPct + '% / ' + wPct + '%'
      );
    }

    /** 渲染图表 */
    function renderChart() {
      const records = getRecords();
      const childInfo = getChildInfo();
      const canvas = document.getElementById('growthChart');

      // 销毁旧图表
      if (growthChart) {
        growthChart.destroy();
        growthChart = null;
      }

      // 空状态
      if (records.length === 0) {
        canvas.classList.add('chart-canvas-hidden');
        const parent = canvas.parentElement;
        // 移除可能存在的空状态元素
        const existingEmpty = parent.querySelector('.empty-state');
        if (existingEmpty) existingEmpty.remove();

        const emptyDiv = createEmptyState('🌱🧸', '还没有数据哦，快来记录宝宝的成长吧~', '马上记录 ✨', 'open-add');
        parent.appendChild(emptyDiv);
        return;
      }

      canvas.classList.remove('chart-canvas-hidden');
      // 移除空状态元素
      const emptyStateEl = canvas.parentElement.querySelector('.empty-state');
      if (emptyStateEl) emptyStateEl.remove();

      // 按日期升序排列（时间轴从旧到新）
      records.sort(function (a, b) {
        return a.recordDate.localeCompare(b.recordDate);
      });

      // 提取数据
      const labels = records.map(function (r) { return r.recordDate; });
      const heightData = records.map(function (r) { return r.height; });
      const weightData = records.map(function (r) { return r.weight; });

      // 构建WHO参考线数据
      const whoHeightData = [];
      const whoWeightData = [];

      if (childInfo && childInfo.birthDate) {
        const birthDate = new Date(childInfo.birthDate);

        records.forEach(function (r) {
          const recordDate = new Date(r.recordDate);
          // 计算月龄
          let months = (recordDate.getFullYear() - birthDate.getFullYear()) * 12 +
            (recordDate.getMonth() - birthDate.getMonth());
          if (recordDate.getDate() < birthDate.getDate()) months--;
          months = Math.max(0, months);

          // 查找最近的WHO参考值（取最近的月龄）
          const ageKeys = Object.keys(whoReference).map(Number).sort(function (a, b) { return a - b; });
          let closestKey = ageKeys[0];
          let minDiff = Math.abs(months - closestKey);
          for (let i = 1; i < ageKeys.length; i++) {
            const diff = Math.abs(months - ageKeys[i]);
            if (diff < minDiff) {
              minDiff = diff;
              closestKey = ageKeys[i];
            }
          }

          const ref = whoReference[closestKey];
          whoHeightData.push(ref.avgHeight);
          whoWeightData.push(ref.avgWeight);
        });
      }

      // 构建数据集
      const datasets = [
        {
          label: '身高 (cm)',
          data: heightData,
          borderColor: '#FF9EBB',
          backgroundColor: 'rgba(255, 158, 187, 0.1)',
          borderWidth: 2.5,
          pointBackgroundColor: '#FF9EBB',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.3,
          yAxisID: 'yHeight'
        },
        {
          label: '体重 (kg)',
          data: weightData,
          borderColor: '#87CEEB',
          backgroundColor: 'rgba(135, 206, 235, 0.1)',
          borderWidth: 2.5,
          pointBackgroundColor: '#87CEEB',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.3,
          yAxisID: 'yWeight'
        }
      ];

      // 如果有WHO参考数据，添加参考线
      if (whoHeightData.length > 0) {
        datasets.push({
          label: 'WHO身高参考 (cm)',
          data: whoHeightData,
          borderColor: '#FF9EBB',
          borderWidth: 1,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          tension: 0.3,
          yAxisID: 'yHeight'
        });
        datasets.push({
          label: 'WHO体重参考 (kg)',
          data: whoWeightData,
          borderColor: '#87CEEB',
          borderWidth: 1,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          tension: 0.3,
          yAxisID: 'yWeight'
        });
      }

      // 创建图表
      const ctx = canvas.getContext('2d');
      growthChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                usePointStyle: true,
                padding: 16,
                font: { size: 13 }
              }
            },
            tooltip: {
              backgroundColor: 'rgba(93, 78, 96, 0.85)',
              titleFont: { size: 13 },
              bodyFont: { size: 13 },
              padding: 12,
              cornerRadius: 12,
              callbacks: {
                title: function (tooltipItems) {
                  return '日期: ' + tooltipItems[0].label;
                },
                label: function (context) {
                  let label = context.dataset.label || '';
                  let value = context.parsed.y;
                  if (label.includes('身高')) {
                    return label + ': ' + value.toFixed(1) + ' cm';
                  } else {
                    return label + ': ' + value.toFixed(2) + ' kg';
                  }
                },
                afterBody: function (tooltipItems) {
                  // 在tooltip底部显示年龄信息和发育水平
                  if (childInfo && childInfo.birthDate) {
                    var dateLabel = tooltipItems[0].label;
                    var ageStr = calcAge(childInfo.birthDate, dateLabel);

                    // 查找对应的记录数据
                    var sortedRecords = getRecords().sort(function (a, b) {
                      return a.recordDate.localeCompare(b.recordDate);
                    });
                    var matchedRecord = null;
                    for (var i = 0; i < sortedRecords.length; i++) {
                      if (sortedRecords[i].recordDate === dateLabel) {
                        matchedRecord = sortedRecords[i];
                        break;
                      }
                    }

                    var lines = ['年龄: ' + ageStr];
                    if (matchedRecord) {
                      var who = getWhoForAge(childInfo.birthDate, dateLabel);
                      if (who) {
                        var hPct = Math.round((matchedRecord.height / who.avgHeight) * 100);
                        var wPct = Math.round((matchedRecord.weight / who.avgWeight) * 100);
                        lines.push('');
                        lines.push('WHO参考: ' + who.avgHeight + 'cm / ' + who.avgWeight + 'kg');
                        lines.push('发育水平: 身高' + hPct + '% 体重' + wPct + '%');
                      }
                    }
                    return lines;
                  }
                  return [];
                }
              }
            }
          },
          scales: {
            x: {
              title: {
                display: true,
                text: '日期',
                color: '#A99BAA',
                font: { size: 13 }
              },
              ticks: {
                color: '#A99BAA',
                font: { size: 11 },
                maxRotation: 45
              },
              grid: {
                color: 'rgba(240, 224, 232, 0.5)'
              }
            },
            yHeight: {
              type: 'linear',
              position: 'left',
              title: {
                display: true,
                text: '身高 (cm)',
                color: '#FF9EBB',
                font: { size: 13 }
              },
              ticks: {
                color: '#FF9EBB',
                font: { size: 11 }
              },
              grid: {
                color: 'rgba(240, 224, 232, 0.5)'
              }
            },
            yWeight: {
              type: 'linear',
              position: 'right',
              title: {
                display: true,
                text: '体重 (kg)',
                color: '#87CEEB',
                font: { size: 13 }
              },
              ticks: {
                color: '#87CEEB',
                font: { size: 11 }
              },
              grid: {
                drawOnChartArea: false
              }
            }
          }
        }
      });
    }

    // ========== 宝宝信息设置 ==========

    /** 显示宝宝信息设置模态框 */
    function showChildInfoModal() {
      const childInfo = getChildInfo();
      document.getElementById('childName').value = childInfo ? childInfo.childName : '';
      document.getElementById('childBirthDate').value = childInfo ? childInfo.birthDate : '';

      // 首次访问时不显示取消按钮
      const cancelBtn = document.getElementById('childInfoCancelBtn');
      cancelBtn.hidden = !childInfo;

      // 清除错误
      clearFormErrors(childInfoValidationConfig);

      const modal = document.getElementById('childInfoModal');
      modal.classList.add('show');
    }

    /** 关闭宝宝信息设置模态框 */
    function closeChildInfoModal() {
      const modal = document.getElementById('childInfoModal');
      modal.classList.remove('show');
    }

    /** 点击遮罩层关闭宝宝信息模态框 */
    function handleChildInfoOverlayClick(e) {
      if (e.target === e.currentTarget) {
        closeChildInfoModal();
      }
    }

    /** 宝宝信息表单验证配置 */
    const childInfoValidationConfig = {
      fields: [
        {
          id: 'childName',
          errorId: 'childNameError',
          rules: [
            { test: function (v) { return v.length > 0; }, msg: '请输入宝宝姓名' }
          ]
        },
        {
          id: 'childBirthDate',
          errorId: 'childBirthDateError',
          rules: [
            { test: function (v) { return v.length > 0; }, msg: '请选择出生日期' },
            { test: function (v) { return v <= getTodayStr(); }, msg: '出生日期不能是未来日期' }
          ]
        }
      ]
    };

    /** 处理宝宝信息表单提交 */
    async function handleChildInfoSubmit(e) {
      e.preventDefault();

      if (!validateForm(childInfoValidationConfig)) return;

      const info = {
        childName: document.getElementById('childName').value.trim(),
        birthDate: document.getElementById('childBirthDate').value
      };

      try {
        await saveChildInfo(info);
        updateNavTitle();
        closeChildInfoModal();
        showToast('✨ 宝宝信息已保存');
      } catch (error) {
        reportSaveError(error);
      }
    }

    /** 更新导航栏标题 */
    function updateNavTitle() {
      const childInfo = getChildInfo();
      const navTitle = document.getElementById('navTitle');
      if (childInfo && childInfo.childName) {
        navTitle.textContent = childInfo.childName + ' 的成长记录 🌱';
      } else {
        navTitle.textContent = '多米的成长记录 🌱';
      }
    }

    // ========== 每日喝奶记录 ==========

    /** 获取所有喝奶记录 */
    function getMilkRecords() {
      return typeof window.getMilkRecords === 'function' ? window.getMilkRecords() : [];
    }

    /** 保存所有喝奶记录 */
    async function saveMilkRecords(records) {
      if (typeof window.saveMilkRecords !== 'function') throw new Error('加密保险箱尚未解锁');
      await window.saveMilkRecords(records);
    }

    /** 打开喝奶记录模态框 */
    function openMilkModal() {
      document.getElementById('milkModal').classList.add('show');
      var today = getTodayStr();
      document.getElementById('milkDate').setAttribute('max', today);
      document.getElementById('milkDate').value = today;
      var now = new Date();
      var hours = String(now.getHours()).padStart(2, '0');
      var mins = String(now.getMinutes()).padStart(2, '0');
      document.getElementById('milkTime').value = hours + ':' + mins;
      document.getElementById('milkAmount').value = '';
      clearFormErrors({
        fields: [
          { id: 'milkDate', errorId: 'milkDateError' },
          { id: 'milkTime', errorId: 'milkTimeError' },
          { id: 'milkAmount', errorId: 'milkAmountError' }
        ]
      });
      setTimeout(function() { document.getElementById('milkAmount').focus(); }, 100);
    }

    /** 关闭喝奶记录模态框 */
    function closeMilkModal() {
      document.getElementById('milkModal').classList.remove('show');
    }

    /** 喝奶模态框遮罩点击 */
    function handleMilkOverlayClick(event) {
      if (event.target === event.currentTarget) {
        closeMilkModal();
      }
    }

    /** 处理喝奶记录提交 */
    async function handleMilkSubmit(event) {
      event.preventDefault();

      var today = getTodayStr();
      var valid = validateForm({
        fields: [
          { id: 'milkDate', errorId: 'milkDateError', rules: [
            { test: function(v) { return v.length > 0; }, msg: '请选择日期' },
            { test: function(v) { return v <= today; }, msg: '日期不能是未来日期' }
          ]},
          { id: 'milkTime', errorId: 'milkTimeError', rules: [
            { test: function(v) { return v.length > 0; }, msg: '请选择时间' }
          ]},
          { id: 'milkAmount', errorId: 'milkAmountError', rules: [
            { test: function(v) { return v.length > 0; }, msg: '请输入喝奶量' },
            { test: function(v) { return Number(v) >= 1 && Number(v) <= 500; }, msg: '喝奶量需在 1-500 ml 之间' }
          ]}
        ]
      });

      if (!valid) return;

      var newRecord = {
        id: generateId(),
        milkDate: document.getElementById('milkDate').value,
        milkTime: document.getElementById('milkTime').value,
        milkAmount: parseInt(document.getElementById('milkAmount').value),
        milkType: document.querySelector('input[name="milkType"]:checked').value
      };

      var records = getMilkRecords();
      records.push(newRecord);
      try {
        await saveMilkRecords(records);
        closeMilkModal();
        showToast('✨ 喝奶记录已保存');
        renderMilkList();
      } catch (error) {
        reportSaveError(error);
      }
    }

    /** 删除喝奶记录 */
    async function deleteMilkRecord(id) {
      if (!confirm('确定要删除这条喝奶记录吗？')) return;
      var records = getMilkRecords().filter(function(r) { return r.id !== id; });
      try {
        await saveMilkRecords(records);
        showToast('✨ 记录已删除');
        renderMilkList();
      } catch (error) {
        reportSaveError(error);
      }
    }

    /** 打开修改喝奶记录模态框 */
    function openEditMilkModal(id) {
      var records = getMilkRecords();
      var record = null;
      for (var i = 0; i < records.length; i++) {
        if (records[i].id === id) { record = records[i]; break; }
      }
      if (!record) return;

      document.getElementById('editMilkId').value = record.id;
      document.getElementById('editMilkDate').value = record.milkDate;
      document.getElementById('editMilkTime').value = record.milkTime;
      document.getElementById('editMilkAmount').value = record.milkAmount;

      var radios = document.querySelectorAll('input[name="editMilkType"]');
      for (var j = 0; j < radios.length; j++) {
        radios[j].checked = (radios[j].value === record.milkType);
      }

      document.getElementById('editMilkModal').classList.add('show');
    }

    /** 关闭修改喝奶记录模态框 */
    function closeEditMilkModal() {
      document.getElementById('editMilkModal').classList.remove('show');
    }

    /** 修改喝奶模态框遮罩点击 */
    function handleEditMilkOverlayClick(event) {
      if (event.target === event.currentTarget) {
        closeEditMilkModal();
      }
    }

    /** 处理修改喝奶记录提交 */
    async function handleEditMilkSubmit(event) {
      event.preventDefault();

      var today = getTodayStr();
      var valid = validateForm({
        fields: [
          { id: 'editMilkDate', errorId: 'editMilkDateError', rules: [
            { test: function(v) { return v.length > 0; }, msg: '请选择日期' },
            { test: function(v) { return v <= today; }, msg: '日期不能是未来日期' }
          ]},
          { id: 'editMilkTime', errorId: 'editMilkTimeError', rules: [
            { test: function(v) { return v.length > 0; }, msg: '请选择时间' }
          ]},
          { id: 'editMilkAmount', errorId: 'editMilkAmountError', rules: [
            { test: function(v) { return v.length > 0; }, msg: '请输入喝奶量' },
            { test: function(v) { return Number(v) >= 1 && Number(v) <= 500; }, msg: '喝奶量需在 1-500 ml 之间' }
          ]}
        ]
      });

      if (!valid) return;

      var editId = document.getElementById('editMilkId').value;
      var records = getMilkRecords();
      for (var i = 0; i < records.length; i++) {
        if (records[i].id === editId) {
          records[i].milkDate = document.getElementById('editMilkDate').value;
          records[i].milkTime = document.getElementById('editMilkTime').value;
          records[i].milkAmount = parseInt(document.getElementById('editMilkAmount').value);
          records[i].milkType = document.querySelector('input[name="editMilkType"]:checked').value;
          break;
        }
      }
      try {
        await saveMilkRecords(records);
        closeEditMilkModal();
        showToast('✨ 喝奶记录已更新');
        renderMilkList();
      } catch (error) {
        reportSaveError(error);
      }
    }

    /** 渲染喝奶记录列表 */
    function renderMilkList() {
      var container = document.getElementById('milkListContent');
      var summaryContainer = document.getElementById('milkTodaySummary');
      var allRecords = getMilkRecords();
      container.replaceChildren();
      summaryContainer.replaceChildren();

      // 获取筛选日期（默认今天）
      var filterDate = document.getElementById('milkFilterDate').value;
      if (!filterDate) {
        filterDate = getTodayStr();
        document.getElementById('milkFilterDate').value = filterDate;
      }

      // 计算今日/筛选日期总量
      var dayRecords = allRecords.filter(function(r) { return r.milkDate === filterDate; });
      dayRecords.sort(function(a, b) { return a.milkTime.localeCompare(b.milkTime); });

      var dayTotal = 0;
      var breastTotal = 0, formulaTotal = 0;
      dayRecords.forEach(function(r) {
        dayTotal += r.milkAmount;
        if (r.milkType === 'breast') {
          breastTotal += r.milkAmount;
        } else {
          formulaTotal += r.milkAmount;
        }
      });
      var dayCount = dayRecords.length;

      // 渲染当日总量卡片（所有动态值通过 textContent 写入）
      if (dayCount > 0) {
        const summaryInner = createElement('div', 'milk-summary-inner');
        const summaryInfo = createElement('div', 'milk-summary-info');
        const summaryTotal = createElement('div', 'milk-summary-total', dayTotal + ' ');
        summaryTotal.appendChild(createElement('span', 'milk-summary-unit', 'ml'));
        appendChildren(
          summaryInfo,
          createElement('div', 'milk-summary-label', filterDate + ' 喝奶总量'),
          summaryTotal
        );
        appendChildren(
          summaryInner,
          createElement('div', 'milk-summary-icon', '🍼'),
          summaryInfo,
          createElement('div', 'milk-summary-count', '共 ' + dayCount + ' 次')
        );

        const typeSummary = createElement('div', 'milk-type-summary');
        function createTypeSummary(icon, label, amount) {
          const item = createElement('div', 'milk-type-summary-item');
          appendChildren(
            item,
            createElement('span', 'milk-type-summary-icon', icon),
            createElement('span', 'milk-type-summary-text', label),
            createElement('span', 'milk-type-summary-val', amount + ' ml')
          );
          return item;
        }
        appendChildren(
          typeSummary,
          createTypeSummary('🤱', '母乳', breastTotal),
          createElement('div', 'milk-type-summary-divider'),
          createTypeSummary('🍼', '奶粉', formulaTotal)
        );
        appendChildren(summaryContainer, summaryInner, typeSummary);
      }

      // 空状态
      if (dayRecords.length === 0) {
        container.appendChild(createEmptyState('🍼🧸', '这一天还没有喝奶记录哦~', '马上记录 ✨', 'open-milk'));
        return;
      }

      const list = createElement('div', 'milk-record-list');
      var runningTotal = 0;
      dayRecords.forEach(function(record) {
        runningTotal += record.milkAmount;
        const item = createElement('div', 'milk-record-item');
        const left = createElement('div', 'milk-record-left');
        left.appendChild(createElement('div', 'milk-record-time', '⏰ ' + record.milkTime));

        const center = createElement('div', 'milk-record-center');
        const amount = createElement('div', 'milk-record-amount', record.milkAmount + ' ');
        amount.appendChild(createElement('span', 'milk-record-unit', 'ml'));
        appendChildren(
          center,
          amount,
          createElement(
            'div',
            'milk-record-type ' + (record.milkType === 'breast' ? 'type-breast' : 'type-formula'),
            record.milkType === 'breast' ? '🤱 母乳' : '🍼 奶粉'
          )
        );

        const right = createElement('div', 'milk-record-right');
        appendChildren(
          right,
          createElement('div', 'milk-record-running', '累计 ' + runningTotal + ' ml'),
          createActionButton('修改', 'btn btn-sm btn-blue', 'edit-milk', 'id', record.id),
          createActionButton('删除', 'btn btn-sm btn-red', 'delete-milk', 'id', record.id)
        );
        appendChildren(item, left, center, right);
        list.appendChild(item);
      });
      container.appendChild(list);
    }

    function closeModalById(id) {
      const modal = document.getElementById(id);
      if (modal) modal.classList.remove('show');
    }

    function bindAppEvents() {
      if (listenersBound) return;
      listenersBound = true;

      document.getElementById('addForm').addEventListener('submit', handleAddSubmit);
      document.getElementById('editForm').addEventListener('submit', handleEditSubmit);
      document.getElementById('childInfoForm').addEventListener('submit', handleChildInfoSubmit);
      document.getElementById('milkForm').addEventListener('submit', handleMilkSubmit);
      document.getElementById('editMilkForm').addEventListener('submit', handleEditMilkSubmit);
      document.getElementById('milkFilterDate').addEventListener('change', function () {
        if (appActive) renderMilkList();
      });

      document.addEventListener('click', function (event) {
        if (!appActive) return;

        const navButton = event.target.closest('.nav-tab[data-page]');
        if (navButton) {
          navigateTo(navButton.dataset.page);
          return;
        }

        const closeButton = event.target.closest('[data-close-modal]');
        if (closeButton) {
          closeModalById(closeButton.dataset.closeModal);
          return;
        }

        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;
        const action = actionButton.dataset.action;
        if (action === 'open-add') openAddModal();
        else if (action === 'open-milk') openMilkModal();
        else if (action === 'edit-growth') openEditModal(actionButton.dataset.id);
        else if (action === 'delete-growth') void deleteRecord(actionButton.dataset.id);
        else if (action === 'growth-page') goListPage(Number(actionButton.dataset.page));
        else if (action === 'edit-milk') openEditMilkModal(actionButton.dataset.id);
        else if (action === 'delete-milk') void deleteMilkRecord(actionButton.dataset.id);
      });

      document.getElementById('openAddModalBtn').addEventListener('click', openAddModal);
      document.getElementById('openMilkModalBtn').addEventListener('click', openMilkModal);
      document.getElementById('childInfoBtn').addEventListener('click', showChildInfoModal);
      document.getElementById('securityMenuBtn').addEventListener('click', function () {
        if (window.DuomiVault && typeof window.DuomiVault.openSecurityMenu === 'function') {
          window.DuomiVault.openSecurityMenu();
        }
      });

      document.querySelectorAll('.modal-overlay').forEach(function (modal) {
        modal.addEventListener('click', function (event) {
          if (event.target === modal) closeModalById(modal.id);
        });
      });

      document.addEventListener('keydown', function (event) {
        if (!appActive || event.key !== 'Escape') return;
        document.querySelectorAll('.modal-overlay.show').forEach(function (modal) {
          closeModalById(modal.id);
        });
      });
    }

    // ========== 由保险箱控制的初始化与锁定清理 ==========

    function initializeGrowthApp() {
      bindAppEvents();
      appActive = true;
      // 设置日期选择器的最大值为今天
      const today = getTodayStr();
      ['editDate', 'addDate', 'childBirthDate', 'milkDate', 'editMilkDate', 'milkFilterDate'].forEach(function (id) {
        document.getElementById(id).setAttribute('max', today);
      });

      // 更新导航栏标题
      updateNavTitle();

      // 检查是否首次访问（无宝宝信息）
      const childInfo = getChildInfo();
      if (!childInfo) {
        showChildInfoModal();
      }

      // 根据hash导航到对应页面
      const hash = window.location.hash.replace('#', '') || 'milk';
      navigateTo(hash);
    }

    function resetGrowthAppForLock() {
      appActive = false;
      currentPage = 'milk';
      listCurrentPage = 1;
      if (growthChart) {
        growthChart.destroy();
        growthChart = null;
      }
      ['listContent', 'milkListContent', 'milkTodaySummary'].forEach(function (id) {
        document.getElementById(id).replaceChildren();
      });
      const canvas = document.getElementById('growthChart');
      canvas.classList.remove('chart-canvas-hidden');
      const chartEmptyState = canvas.parentElement.querySelector('.empty-state');
      if (chartEmptyState) chartEmptyState.remove();
      const context = canvas.getContext && canvas.getContext('2d');
      if (context) context.clearRect(0, 0, canvas.width, canvas.height);
      ['addForm', 'editForm', 'childInfoForm', 'milkForm', 'editMilkForm'].forEach(function (id) {
        document.getElementById(id).reset();
      });
      document.getElementById('milkFilterDate').value = '';
      document.querySelectorAll('.modal-overlay.show').forEach(function (modal) {
        modal.classList.remove('show');
      });
      document.querySelectorAll('.form-input.error').forEach(function (input) {
        input.classList.remove('error');
      });
      document.querySelectorAll('.error-msg').forEach(function (message) {
        message.textContent = '';
        message.classList.remove('show');
      });
      document.getElementById('navTitle').textContent = '多米的成长记录 🌱';
      const toast = document.getElementById('toast');
      toast.textContent = '';
      toast.classList.remove('show');
    }

    window.initializeGrowthApp = initializeGrowthApp;
    window.resetGrowthAppForLock = resetGrowthAppForLock;

    // 注册 Service Worker 实现PWA离线使用
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
          .then((registration) => {
            console.log('Service Worker 注册成功:', registration.scope);
          })
          .catch((error) => {
            console.log('Service Worker 注册失败:', error);
          });
      });
    }
})();
