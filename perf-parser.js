// Parses the "Technician Performance" Google Sheet tabs (as CSV text) into the model
// used by performance.html.  Shared by the browser and build-snapshot.js (Node).
//
// Note: the gviz CSV endpoint infers a type per column and blanks out cells that
// don't fit (e.g. text headers in a numeric column), so every tab is parsed by
// row *pattern*, never by header text.
(function (root) {
  const SHEET_ID = '1QZtGnVHCCoNpvX0IW-8Rq_E8WyjrU6UqZvSGo2yhMnk';
  const TABS = ['Daily Work Orders by Zone', 'Work Order Rolling Trends', 'Daily Input Log', 'Performance Trends', 'Work Order Daily Log', 'Estimation & Tech Tally'];

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
      else if (!kpi && !clean(r[1]) && isNum(r[2]) && clean(r[3]).includes('%')) kpi = { comp: num(r[2]), rate: pct(r[3]), r7: pct(r[4]), r30: pct(r[5]) };
    }
    if (kpi) kpi.newWos = daily.reduce((s, x) => s + x.newWos, 0);
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

  // --- Work Order Daily Log: one day's jobs with estimated vs actual hours ---
  function parseDailyLog(rows) {
    let date = '';
    const jobs = [];
    for (const r of rows) {
      const m = clean(r[0]).match(/Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (m) date = usDate(m[1]);
      if (/^\d+-\d+$/.test(clean(r[1]))) {
        jobs.push({ tech: clean(r[0]), wo: clean(r[1]), estLevel: num(clean(r[2]).replace(/\D/g, '')), target: num(r[3]), clockIn: clean(r[4]), clockOut: clean(r[5]),
          actual: num(r[6]), inWindow: /^y/i.test(clean(r[7])), landed: num(clean(r[8]).replace(/\D/g, '')) });
      }
    }
    return { date, jobs };
  }

  // --- Estimation & Tech Tally ---
  function parseTally(rows) {
    const levels = [], techs = [];
    let overall = null, teamLevels = null, teamTechs = null;
    for (const r of rows) {
      const a = clean(r[0]);
      if (!overall && a === 'Level 1' && isNum(r[4]) && clean(r[10]).includes('%')) {
        overall = { assigned: num(r[4]), completed: num(r[7]), matchRate: pct(r[10]), avgVariance: num(r[13]) };
      }
      if (/^Level \d$/.test(a) && num(r[1]) > 0 && clean(r[6]).includes('%')) {
        levels.push({ level: num(a.replace(/\D/g, '')), target: num(r[1]), assigned: num(r[2]), completed: num(r[3]), inWindow: num(r[4]), variance: num(r[5]), acc: pct(r[6]) });
      }
      if (/^Team Total/i.test(a) && isNum(r[2])) teamLevels = { assigned: num(r[2]), completed: num(r[3]), inWindow: num(r[4]), variance: num(r[5]), acc: pct(r[6]) };
      const name = clean(r[8]);
      if (name && name !== 'Technician' && isNum(r[9]) && clean(r[15]).includes('%')) {
        const t = { name, assigned: num(r[9]), completed: num(r[10]), target: num(r[11]), logged: num(r[12]), net: num(r[13]), avg: num(r[14]), acc: pct(r[15]) };
        if (/^Team Total/i.test(name)) teamTechs = t; else techs.push(t);
      }
    }
    return { levels, techs, overall: overall || {}, teamLevels, teamTechs };
  }

  function buildModel(texts) {
    const get = tab => parseCSV(texts[tab] || '');
    const perf = parsePerformance(get('Performance Trends'));
    const rolling = parseRolling(get('Work Order Rolling Trends'));
    const inputLog = parseInputLog(get('Daily Input Log'));
    const zoneDaily = parseZoneDaily(get('Daily Work Orders by Zone'));
    const dailyLog = parseDailyLog(get('Work Order Daily Log'));
    const tally = parseTally(get('Estimation & Tech Tally'));
    return { perf, rolling, inputLog, zoneDaily, dailyLog, tally };
  }

  const api = { SHEET_ID, TABS, csvUrl, parseCSV, buildModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LionPerf = api;
})(this);
