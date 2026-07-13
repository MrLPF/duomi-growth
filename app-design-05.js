    /** 渲染图表 */
    function renderChart() {
      const records = getRecords();
      const childInfo = getChildInfo();
      const canvas = document.getElementById('growthChart');

      if (growthChart) {
        growthChart.destroy();
        growthChart = null;
      }

      if (records.length === 0) {
        canvas.style.display = 'none';
        const parent = canvas.parentElement;
        const existingEmpty = parent.querySelector('.empty-state');
        if (existingEmpty) existingEmpty.remove();

        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML =
          '<div class="empty-state-icon">🌱🧸</div>' +
          '<div class="empty-state-text">还没有数据哦，快来记录宝宝的成长吧~</div>' +
          '<button class="empty-state-btn" onclick="openAddModal()">马上记录 ✨</button>';
        parent.appendChild(emptyDiv);
        return;
      }

      canvas.style.display = '';
      const emptyStateEl = canvas.parentElement.querySelector('.empty-state');
      if (emptyStateEl) emptyStateEl.remove();

      records.sort(function (a, b) {
        return a.recordDate.localeCompare(b.recordDate);
      });

      const labels = records.map(function (r) { return r.recordDate; });
      const heightData = records.map(function (r) { return r.height; });
      const weightData = records.map(function (r) { return r.weight; });
      const whoHeightData = [];
      const whoWeightData = [];

      if (childInfo && childInfo.birthDate) {
        const birthDate = new Date(childInfo.birthDate);

        records.forEach(function (r) {
          const recordDate = new Date(r.recordDate);
          let months = (recordDate.getFullYear() - birthDate.getFullYear()) * 12 +
            (recordDate.getMonth() - birthDate.getMonth());
          if (recordDate.getDate() < birthDate.getDate()) months--;
          months = Math.max(0, months);

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
                  if (childInfo && childInfo.birthDate) {
                    var dateLabel = tooltipItems[0].label;
                    var ageStr = calcAge(childInfo.birthDate, dateLabel);
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

