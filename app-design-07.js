    // ========== 每日喝奶记录 ==========

    /** 获取所有喝奶记录 */
    function getMilkRecords() {
      try {
        var data = localStorage.getItem('childMilkRecords');
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    }

    /** 保存所有喝奶记录 */
    function saveMilkRecords(records) {
      localStorage.setItem('childMilkRecords', JSON.stringify(records));
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
    function handleMilkSubmit(event) {
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
      saveMilkRecords(records);

      closeMilkModal();
      showToast('✨ 喝奶记录已保存');
      renderMilkList();
    }

    /** 删除喝奶记录 */
    function deleteMilkRecord(id) {
      if (!confirm('确定要删除这条喝奶记录吗？')) return;
      var records = getMilkRecords().filter(function(r) { return r.id !== id; });
      saveMilkRecords(records);
      showToast('✨ 记录已删除');
      renderMilkList();
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
    function handleEditMilkSubmit(event) {
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
      saveMilkRecords(records);

      closeEditMilkModal();
      showToast('✨ 喝奶记录已更新');
      renderMilkList();
    }

