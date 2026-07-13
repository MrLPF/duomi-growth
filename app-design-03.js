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
    function handleEditSubmit(e) {
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

      saveRecords(records);
      closeEditModal();
      showToast('✨ 记录修改成功');
      renderList();
    }

