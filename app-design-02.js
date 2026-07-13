    // ========== 成长记录列表 ==========

    let listCurrentPage = 1;
    const PAGE_SIZE = 10;

    /** 渲染列表页面 */
    function renderList() {
      const container = document.getElementById('listContent');
      const records = getRecords();

      // 按记录日期降序排序（最新在前）
      records.sort(function (a, b) {
        return b.recordDate.localeCompare(a.recordDate);
      });

      // 空状态
      if (records.length === 0) {
        container.innerHTML =
          '<div class="empty-state">' +
          '  <div class="empty-state-icon">🌱🧸</div>' +
          '  <div class="empty-state-text">还没有成长记录哦~ 快来记录宝宝的成长瞬间吧！</div>' +
          '  <button class="empty-state-btn" onclick="openAddModal()">马上记录 ✨</button>' +
          '</div>';
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

      // 构建表格HTML
      let html = '<div class="table-wrapper"><table class="data-table">';
      html += '<thead><tr>';
      html += '<th>序号</th><th>记录日期</th><th>年龄</th><th>身高(cm)</th><th>体重(kg)</th><th>发育水平</th><th>操作</th>';
      html += '</tr></thead><tbody>';

      pageRecords.forEach(function (record, index) {
        const ageStr = calcAge(childInfo ? childInfo.birthDate : '', record.recordDate);
        const globalIndex = startIdx + index + 1;

        html += '<tr>';
        html += '<td>' + globalIndex + '</td>';
        html += '<td>' + record.recordDate + '</td>';
        html += '<td>' + ageStr + '</td>';
        html += '<td>' + record.height.toFixed(1) + '</td>';
        html += '<td>' + record.weight.toFixed(2) + '</td>';
        html += '<td>' + calcGrowthPercentLabel(childInfo ? childInfo.birthDate : '', record.recordDate, record.height, record.weight) + '</td>';
        html += '<td><div class="action-btns">';
        html += '<button class="btn btn-sm btn-blue" onclick="openEditModal(\'' + record.id + '\')">编辑</button>';
        html += '<button class="btn btn-sm btn-red" onclick="deleteRecord(\'' + record.id + '\')">删除</button>';
        html += '</div></td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';

      // 分页控件
      html += '<div class="pagination">';
      // 上一页按钮
      html += '<button class="page-btn" ' + (listCurrentPage <= 1 ? 'disabled' : '') + ' onclick="goListPage(' + (listCurrentPage - 1) + ')">&laquo;</button>';

      // 页码按钮
      for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 7 && i > 3 && i < totalPages - 1 && Math.abs(i - listCurrentPage) > 1) {
          if (i === 4 || i === totalPages - 2) {
            html += '<span style="padding: 0 4px; color: #A99BAA;">...</span>';
          }
          continue;
        }
        html += '<button class="page-btn ' + (i === listCurrentPage ? 'active' : '') + '" onclick="goListPage(' + i + ')">' + i + '</button>';
      }

      // 下一页按钮
      html += '<button class="page-btn" ' + (listCurrentPage >= totalPages ? 'disabled' : '') + ' onclick="goListPage(' + (listCurrentPage + 1) + ')">&raquo;</button>';
      html += '</div>';

      container.innerHTML = html;
    }

    /** 跳转到指定页 */
    function goListPage(page) {
      listCurrentPage = page;
      renderList();
    }

    /** 删除记录 */
    function deleteRecord(id) {
      if (!confirm('确定要删除这条记录吗？删除后不可恢复。')) return;

      let records = getRecords();
      records = records.filter(function (r) { return r.id !== id; });
      saveRecords(records);

      showToast('✨ 记录已删除');
      renderList();
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
    function handleAddSubmit(event) {
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

      // 保存到 localStorage
      const records = getRecords();
      records.push(newRecord);
      saveRecords(records);

      // 关闭模态框并刷新列表
      closeAddModal();
      showToast('✨ 记录添加成功');
      renderList();
    }

