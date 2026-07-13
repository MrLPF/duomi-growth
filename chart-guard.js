(function () {
  const originalRenderChart = window.renderChart;

  window.renderChart = function () {
    if (typeof window.Chart !== 'undefined') {
      return originalRenderChart();
    }

    const canvas = document.getElementById('growthChart');
    if (!canvas) return;

    canvas.style.display = 'none';
    const parent = canvas.parentElement;
    let notice = parent.querySelector('.chart-load-notice');

    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'empty-state chart-load-notice';
      notice.innerHTML =
        '<div class="empty-state-icon">📈</div>' +
        '<div class="empty-state-text">成长曲线组件暂未加载。请联网后重新打开或刷新页面。</div>' +
        '<button class="empty-state-btn" type="button" onclick="location.reload()">重新加载</button>';
      parent.appendChild(notice);
    }
  };
})();
