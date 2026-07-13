(function () {
  'use strict';

  let resizeTimer = null;
  let resizeBound = false;

  function range(values, fallbackMin, fallbackMax) {
    const numbers = values.filter(function (value) { return Number.isFinite(value); });
    if (!numbers.length) return { min: fallbackMin, max: fallbackMax };
    let min = Math.min.apply(null, numbers);
    let max = Math.max.apply(null, numbers);
    if (min === max) {
      min -= Math.max(1, min * 0.08);
      max += Math.max(1, max * 0.08);
    }
    const padding = (max - min) * 0.12;
    return { min: Math.max(0, min - padding), max: max + padding };
  }

  function formatDate(value) {
    const parts = String(value || '').split('-');
    return parts.length === 3 ? parts[1] + '/' + parts[2] : String(value || '');
  }

  function drawLine(ctx, points, color, dashed, width) {
    const usable = points.filter(function (point) { return point && Number.isFinite(point.y); });
    if (!usable.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(dashed ? [6, 5] : []);
    usable.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawPoints(ctx, points, color) {
    ctx.save();
    points.forEach(function (point) {
      if (!point || !Number.isFinite(point.y)) return;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });
    ctx.restore();
  }

  function ensureTooltip(parent) {
    let tooltip = parent.querySelector('.native-chart-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'native-chart-tooltip';
      tooltip.hidden = true;
      parent.appendChild(tooltip);
    }
    return tooltip;
  }

  window.renderChart = function renderOfflineChart() {
    const records = getRecords().slice().sort(function (a, b) {
      return a.recordDate.localeCompare(b.recordDate);
    });
    const childInfo = getChildInfo();
    const canvas = document.getElementById('growthChart');
    if (!canvas) return;
    const parent = canvas.parentElement;

    if (growthChart && typeof growthChart.destroy === 'function') growthChart.destroy();
    growthChart = null;

    const oldEmpty = parent.querySelector('.empty-state');
    if (oldEmpty) oldEmpty.remove();

    if (!records.length) {
      canvas.style.display = 'none';
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<div class="empty-state-icon">🌱🧸</div>' +
        '<div class="empty-state-text">还没有数据哦，快来记录宝宝的成长吧~</div>' +
        '<button class="empty-state-btn" onclick="openAddModal()">马上记录 ✨</button>';
      parent.appendChild(empty);
      return;
    }

    canvas.style.display = 'block';
    parent.style.position = 'relative';
    const tooltip = ensureTooltip(parent);
    tooltip.hidden = true;

    const cssWidth = Math.max(320, parent.clientWidth || 760);
    const cssHeight = Math.max(340, Math.min(440, cssWidth * 0.58));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const margin = { top: 58, right: 58, bottom: 52, left: 58 };
    const plotWidth = cssWidth - margin.left - margin.right;
    const plotHeight = cssHeight - margin.top - margin.bottom;
    const heights = records.map(function (record) { return Number(record.height); });
    const weights = records.map(function (record) { return Number(record.weight); });
    const heightRange = range(heights, 40, 120);
    const weightRange = range(weights, 2, 30);

    function xFor(index) {
      return records.length === 1
        ? margin.left + plotWidth / 2
        : margin.left + (index / (records.length - 1)) * plotWidth;
    }
    function yFor(value, valueRange) {
      return margin.top + plotHeight - ((value - valueRange.min) / (valueRange.max - valueRange.min)) * plotHeight;
    }

    ctx.font = '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    for (let step = 0; step <= 5; step++) {
      const ratio = step / 5;
      const y = margin.top + ratio * plotHeight;
      ctx.strokeStyle = 'rgba(240, 224, 232, 0.85)';
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotWidth, y);
      ctx.stroke();

      const heightValue = heightRange.max - ratio * (heightRange.max - heightRange.min);
      const weightValue = weightRange.max - ratio * (weightRange.max - weightRange.min);
      ctx.fillStyle = '#FF7FA6';
      ctx.textAlign = 'right';
      ctx.fillText(heightValue.toFixed(1), margin.left - 8, y);
      ctx.fillStyle = '#5AB9DF';
      ctx.textAlign = 'left';
      ctx.fillText(weightValue.toFixed(1), margin.left + plotWidth + 8, y);
    }

    const labelEvery = Math.max(1, Math.ceil(records.length / 7));
    records.forEach(function (record, index) {
      if (index % labelEvery !== 0 && index !== records.length - 1) return;
      const x = xFor(index);
      ctx.save();
      ctx.translate(x, margin.top + plotHeight + 14);
      ctx.rotate(-Math.PI / 7);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#8B7B88';
      ctx.fillText(formatDate(record.recordDate), 0, 0);
      ctx.restore();
    });

    ctx.save();
    ctx.fillStyle = '#FF7FA6';
    ctx.textAlign = 'left';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText('● 身高 (cm)', margin.left, 18);
    ctx.fillStyle = '#5AB9DF';
    ctx.fillText('● 体重 (kg)', margin.left + 110, 18);
    if (childInfo && childInfo.birthDate) {
      ctx.fillStyle = '#9D8D9B';
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      ctx.fillText('┄ WHO 近似参考', margin.left + 220, 18);
    }
    ctx.restore();

    const heightPoints = records.map(function (record, index) {
      return { x: xFor(index), y: yFor(Number(record.height), heightRange) };
    });
    const weightPoints = records.map(function (record, index) {
      return { x: xFor(index), y: yFor(Number(record.weight), weightRange) };
    });

    if (childInfo && childInfo.birthDate) {
      const whoHeightPoints = [];
      const whoWeightPoints = [];
      records.forEach(function (record, index) {
        const reference = getWhoForAge(childInfo.birthDate, record.recordDate);
        whoHeightPoints.push(reference ? { x: xFor(index), y: yFor(reference.avgHeight, heightRange) } : null);
        whoWeightPoints.push(reference ? { x: xFor(index), y: yFor(reference.avgWeight, weightRange) } : null);
      });
      drawLine(ctx, whoHeightPoints, 'rgba(255,127,166,.55)', true, 1.3);
      drawLine(ctx, whoWeightPoints, 'rgba(90,185,223,.55)', true, 1.3);
    }

    drawLine(ctx, heightPoints, '#FF7FA6', false, 2.6);
    drawLine(ctx, weightPoints, '#5AB9DF', false, 2.6);
    drawPoints(ctx, heightPoints, '#FF7FA6');
    drawPoints(ctx, weightPoints, '#5AB9DF');

    function showTooltip(event) {
      const rect = canvas.getBoundingClientRect();
      const clientX = event.touches && event.touches[0] ? event.touches[0].clientX : event.clientX;
      if (!Number.isFinite(clientX)) return;
      const localX = clientX - rect.left;
      let nearest = 0;
      let distance = Infinity;
      heightPoints.forEach(function (point, index) {
        const current = Math.abs(point.x - localX);
        if (current < distance) {
          distance = current;
          nearest = index;
        }
      });
      const record = records[nearest];
      const age = childInfo && childInfo.birthDate ? calcAge(childInfo.birthDate, record.recordDate) : '--';
      tooltip.innerHTML = '<strong>' + record.recordDate + '</strong>' +
        '<span>年龄：' + age + '</span>' +
        '<span>身高：' + Number(record.height).toFixed(1) + ' cm</span>' +
        '<span>体重：' + Number(record.weight).toFixed(2) + ' kg</span>';
      tooltip.hidden = false;
      const desiredLeft = Math.min(Math.max(8, heightPoints[nearest].x - 70), cssWidth - 155);
      tooltip.style.left = desiredLeft + 'px';
      tooltip.style.top = Math.max(36, Math.min(heightPoints[nearest].y, weightPoints[nearest].y) - 94) + 'px';
    }

    canvas.onpointermove = showTooltip;
    canvas.onclick = showTooltip;
    canvas.onpointerleave = function () { tooltip.hidden = true; };

    growthChart = {
      destroy: function () {
        canvas.onpointermove = null;
        canvas.onclick = null;
        canvas.onpointerleave = null;
        tooltip.hidden = true;
      }
    };

    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          if (typeof currentPage !== 'undefined' && currentPage === 'chart') window.renderChart();
        }, 180);
      });
    }
  };
})();
