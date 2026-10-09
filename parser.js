// Parses the Google Sheet tabs (as CSV text) into the dashboard model.
// Shared by the browser (index.html) and build-snapshot.js (Node).
(function (root) {
  const SHEET_ID = '1IzzcGQLuTks4ZQVuMKr0LVhkYGRLHy2zArsVgsh_ClA';
  const TABS = ['Master Dashboard', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5', 'Zone 6', 'Zone 7', 'Zone 8', 'Zone 9'];

  function csvUrl(tab) {
    return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
      '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(tab) + '&_=' + Date.now();
  }

  // RFC 4180 parser: handles quoted cells, "" escapes and newlines inside cells.
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
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

  const num = v => {
    const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const clean = v => String(v == null ? '' : v).trim();

  function parseMaster(rows) {
    const zones = {};
    let section = 0;
    let kpi = null;
    for (const r of rows) {
      const a = clean(r[0]);
      if (/^ZONE BREAKDOWN/i.test(a)) section = 1;
      else if (/^WORK ORDER COMPLEXITY/i.test(a)) section = 2;
      if (!kpi && /^\d/.test(a) && section === 0) {
        kpi = { totalLvl: num(r[0]), openWos: num(r[2]), dailyCap: num(r[4]), days: num(r[6]), weeks: num(r[8]) };
      }
      const m = a.match(/^Zone\s*(\d+)$/i);
      const isTotal = /^PORTFOLIO TOTAL/i.test(a);
      if (!m && !isTotal) continue;
      const key = m ? 'Zone ' + m[1] : 'TOTAL';
      const z = zones[key] || (zones[key] = { id: key, n: m ? +m[1] : 99 });
      if (section === 1) {
        Object.assign(z, {
          group: clean(r[1]), roster: clean(r[2]), openWos: num(r[3]), totalLvl: num(r[4]),
          dailyCap: num(r[5]), days: num(r[6]), weeks: num(r[7]), over1wk: num(r[8]),
          over2wk: num(r[9]), scheduled: num(r[10]), newWos: num(r[11])
        });
      } else if (section === 2) {
        z.lvl = [num(r[3]), num(r[4]), num(r[5]), num(r[6]), num(r[7])];
      }
    }
    const total = zones.TOTAL;
    delete zones.TOTAL;
    const list = Object.values(zones).sort((x, y) => x.n - y.n);
    return { kpi: kpi || {}, total, zones: list };
  }

  function toDate(s) {
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }

  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  function parseZone(rows) {
    // Right-hand panel: label in one cell, value in the next.
    const panel = {};
    const roster = [];
    let inRoster = false;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i];
      for (let c = 9; c < Math.min(r.length - 1, 16); c++) {
        const label = clean(r[c]);
        if (!label) continue;
        if (c === 10 && label === 'Technician Roster') { inRoster = true; continue; }
        if (c === 10 && /^(Total Tech Capacity|Backlog Status)$/.test(label)) inRoster = false;
        if (c === 10 && inRoster) roster.push({ name: label, cap: num(r[11]) });
        else panel[label] = clean(r[c + 1]);
      }
    }
    const exportDate = toDate(panel['Export Date'] || '');

    const wos = [];
    let created = null, started = false;
    for (const r of rows) {
      const a = clean(r[0]), b = clean(r[1]);
      if (!started) { if (a === 'Property' && b === 'Work Order Number') started = true; continue; }
      if (!b && toDate(a)) { created = toDate(a); continue; }
      if (!/^\d+-\d+$/.test(b)) continue;
      const instr = clean(r[3]);
      const lm = instr.match(/LVL\s*(\d)/i);
      wos.push({
        property: a, wo: b, desc: clean(r[2]), instr, status: clean(r[4]),
        vendor: clean(r[5]), city: clean(r[6]),
        lvl: num(r[7]) || (lm ? +lm[1] : 0),
        created: created ? ymd(created) : '',
        age: created && exportDate ? Math.round((exportDate - created) / 864e5) : null
      });
    }
    return { panel, roster, exportDate: exportDate ? ymd(exportDate) : '', wos };
  }

  // texts: { 'Master Dashboard': csv, 'Zone 1': csv, ... }
  function buildModel(texts) {
    const model = parseMaster(parseCSV(texts['Master Dashboard'] || ''));
    for (const z of model.zones) {
      if (texts[z.id]) Object.assign(z, parseZone(parseCSV(texts[z.id])));
    }
    const dates = model.zones.map(z => z.exportDate).filter(Boolean).sort();
    model.exportDates = { min: dates[0] || '', max: dates[dates.length - 1] || '' };
    return model;
  }

  const api = { SHEET_ID, TABS, csvUrl, parseCSV, buildModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LionParser = api;
})(this);
