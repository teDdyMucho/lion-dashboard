// Parses the "Technician Performance" Google Sheet tabs (as CSV text) into the model
// used by performance.html.  Shared by the browser and build-snapshot.js (Node).
//
// Note: the gviz CSV endpoint infers a type per column and blanks out cells that
// don't fit (e.g. text headers in a numeric column), so every tab is parsed by
// row *pattern*, never by header text.
(function (root) {
  const SHEET_ID = '1QZtGnVHCCoNpvX0IW-8Rq_E8WyjrU6UqZvSGo2yhMnk';
  const TABS = ['Daily Work Orders by Zone', 'Work Order Rolling Trends', 'Daily Input Log', 'Performance Trends'];

  function csvUrl(tab) {
    return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
      '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(tab) + '&_=' + Date.now();
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  const clean = v => String(v == null ? '' : v).trim();
  const num = v => { const n = parseFloat(clean(v).replace(/[,%]/g, '').replace(/hrs?$/, '')); return isNaN(n) ? 0 : n; };
  const isNum = v => /^-?[\d,]*\.?\d+$/.test(clean(v));
  const pct = v => { const s = clean(v); if (!s) return null; const n = parseFloat(s.replace(/[,%]/g, '')); return isNaN(n) ? null : (s.includes('%') ? n / 100 : n > 1.5 ? n / 100 : n); };
  const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null;
  const usDate = v => { const m = clean(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  const anyDate = v => isoDate(v) || usDate(v);

  // --- Performance Trends: team daily rows + per-technician summary ---
  function parsePerformance(rows) {
    const daily = [], techs = [];
    let team = null, latestDate = '', period = null;
    for (const r of rows) {
      const d = isoDate(r[0]);
      if (d && clean(r[1])) {
        daily.push({ date: d, dow: clean(r[1]), sched: num(r[2]), comp: num(r[3]), rate: pct(r[4]), r7: pct(r[5]), r30: pct(r[6]), status: clean(r[7]) });
      } else if (!clean(r[0]) && /Days?$/i.test(clean(r[1])) && isNum(r[2])) {
        period = { label: clean(r[1]), sched: num(r[2]), comp: num(r[3]), rate: pct(r[4]), r7: pct(r[5]), r30: pct(r[6]), status: clean(r[7]) };
      }
      if (!latestDate && isoDate(r[4]) && clean(r[2]).includes('%')) latestDate = isoDate(r[4]);
      const name = clean(r[9]);
      if (name && isNum(r[10]) && name !== 'Technician') {
        const t = { name, sched: num(r[10]), comp: num(r[11]), rate: pct(r[12]), r7: pct(r[13]), r30: pct(r[14]), status: clean(r[15]) };
        if (/^Team Total/i.test(name)) team = t; else techs.push(t);
      }
    }
    return { daily, techs, team, latestDate, period };
  }

  // --- Work Order Rolling Trends: new vs completed per day ---
  function parseRolling(rows) {
    const daily = [];
    let kpi = null;
    for (const r of rows) {
      const d = isoDate(r[1]);
      if (d) daily.push({ date: d, newWos: num(r[2]), comp: num(r[3]), rate: pct(r[4]), r7: pct(r[5]), r30: pct(r[6]) });
      else if (!kpi && !clean(r[1]) && isNum(r[2])) {
        // Summary row: one or two plain numbers (completed, or new + completed) followed by percent cells (overall, 7-day, 30-day).
        const cells = r.slice(2).map(clean).filter(Boolean);
        const nums = cells.filter(v => isNum(v) && !v.includes('%')).map(num);
        const rates = cells.filter(v => v.includes('%')).map(pct);
        if (rates.length) kpi = { newWos: nums.length > 1 ? nums[0] : null, comp: nums[nums.length - 1] || 0, rate: rates[0], r7: rates[1], r30: rates[2] };
      }
    }
    if (kpi && kpi.newWos == null) kpi.newWos = daily.reduce((s, x) => s + x.newWos, 0);
    return { daily, kpi: kpi || {} };
  }

  // --- Daily Input Log: per technician per day ---
  function parseInputLog(rows) {
    const log = [];
    for (const r of rows) {
      const d = isoDate(r[0]);
      if (d && clean(r[1])) log.push({ date: d, tech: clean(r[1]), sched: num(r[2]), comp: num(r[3]), rate: pct(r[4]), notes: clean(r[5]) });
    }
    return log;
  }

  // --- Daily Work Orders by Zone: date blocks of Zone rows ---
  function parseZoneDaily(rows) {
    const list = [];
    let date = null;
    for (const r of rows) {
      const d = anyDate(r[0]);
      if (d) { date = d; continue; }
      const z = clean(r[0]).match(/^Zone\s*(\d+)$/i);
      if (z && date) list.push({ date, zone: 'Zone ' + z[1], newWos: num(r[1]), comp: num(r[2]) });
    }
    return { list };
  }

  function buildModel(texts) {
    const get = tab => parseCSV(texts[tab] || '');
    const perf = parsePerformance(get('Performance Trends'));
    const rolling = parseRolling(get('Work Order Rolling Trends'));
    const inputLog = parseInputLog(get('Daily Input Log'));
    const zoneDaily = parseZoneDaily(get('Daily Work Orders by Zone'));
    return { perf, rolling, inputLog, zoneDaily };
  }

  const api = { SHEET_ID, TABS, csvUrl, parseCSV, buildModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LionPerf = api;
})(this);
