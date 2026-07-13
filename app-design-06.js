    // ========== 宝宝信息设置 ==========

    /** 显示宝宝信息设置模态框 */
    function showChildInfoModal() {
      const childInfo = getChildInfo();
      document.getElementById('childName').value = childInfo ? childInfo.childName : '';
      document.getElementById('childBirthDate').value = childInfo ? childInfo.birthDate : '';

      const cancelBtn = document.getElementById('childInfoCancelBtn');
      cancelBtn.style.display = childInfo ? 'inline-flex' : 'none';
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
    function handleChildInfoSubmit(e) {
      e.preventDefault();

      if (!validateForm(childInfoValidationConfig)) return;

      const info = {
        childName: document.getElementById('childName').value.trim(),
        birthDate: document.getElementById('childBirthDate').value
      };

      saveChildInfo(info);
      updateNavTitle();
      closeChildInfoModal();
      showToast('✨ 宝宝信息已保存');
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

