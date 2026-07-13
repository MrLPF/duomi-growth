/* ====================================================================
       儿童成长记录 - 主脚本
       功能：数据录入、记录列表（含编辑删除）、成长曲线图、localStorage持久化
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

    // ========== localStorage 数据操作 ==========

    /** 获取所有成长记录 */
    function getRecords() {
      try {
        const data = localStorage.getItem('childGrowthRecords');
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    }

    /** 保存所有成长记录 */
    function saveRecords(records) {
      localStorage.setItem('childGrowthRecords', JSON.stringify(records));
    }

    /** 获取宝宝信息 */
    function getChildInfo() {
      try {
        const data = localStorage.getItem('childGrowthInfo');
        return data ? JSON.parse(data) : null;
      } catch (e) {
        return null;
      }
    }

    /** 保存宝宝信息 */
    function saveChildInfo(info) {
      localStorage.setItem('childGrowthInfo', JSON.stringify(info));
    }

    // ========== 路由与导航 ==========

    let currentPage = 'milk';

    /** 页面导航函数 */
    function navigateTo(page) {
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

      // 使用requestAnimationFrame触发淡入效果
      const targetSection = document.getElementById('page-' + page);
      if (targetSection) {
        // 先设为display:block但opacity:0
        targetSection.style.display = 'block';
        targetSection.style.opacity = '0';
        // 下一帧添加active使其淡入
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            targetSection.classList.add('active');
            targetSection.style.opacity = '';
            targetSection.style.display = '';
          });
        });
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
      if (hash !== currentPage) {
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

