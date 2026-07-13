    /* 页面3：成长曲线图 */

    let growthChart = null;

    /** WHO参考标准（近似值） */
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

    function getWhoForAge(birthDateStr, recordDateStr) {
      if (!birthDateStr || !recordDateStr) return null;
      var birth = new Date(birthDateStr);
      var record = new Date(recordDateStr);
      if (record < birth) return null;

      var months = (record.getFullYear() - birth.getFullYear()) * 12 +
        (record.getMonth() - birth.getMonth());
      if (record.getDate() < birth.getDate()) months--;
      months = Math.max(0, months);

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

    function calcGrowthPercentLabel(birthDateStr, recordDateStr, height, weight) {
      var who = getWhoForAge(birthDateStr, recordDateStr);
      if (!who) return '<span class="pct-na">--</span>';

      var hPct = Math.round((height / who.avgHeight) * 100);
      var wPct = Math.round((weight / who.avgWeight) * 100);

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

      return '<span class="pct-tag ' + pctClass(Math.min(hPct, wPct)) + '">' +
        pctIcon(Math.min(hPct, wPct)) + ' ' + hPct + '% / ' + wPct + '%' +
        '</span>';
    }

