// Parses the Backlog Google Sheet tabs (as CSV text) into the dashboard model.
// Shared by the browser (index.html / zone.html) and build-snapshot.js (Node).
//
// The sheet layout has changed before (columns added, sections renamed), so this
// parser locates things by header text and row pattern instead of fixed positions.
// Note: the gviz CSV endpoint blanks out cells that don't match a column's inferred
// type (e.g. the text roster column on the Master tab), so the roster is read from
// each Zone tab's panel instead.
(function (root) {
  const SHEET_ID = '1IzzcGQLuTks4ZQVuMKr0LVhkYGRLHy2zArsVgsh_ClA';
  const TABS = ['Master Dashboard', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5', 'Zone 6', 'Zone 7', 'Zone 8', 'Zone 9', 'Waiting Work Orders', 'Assessment LVL'];
  const OPTIONAL_TABS = ['Waiting Work Orders', 'Assessment LVL'];   // dashboard still works if these are missing

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

  const clean = v => String(v == null ? '' : v).trim();
  const isNum = v => /^-?[\d,]*\.?\d+%?$/.test(clean(v));
  const num = v => {
    const n = parseFloat(clean(v).replace(/[,%]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  // All numeric cells of a row from a start index, in order.
  const numsFrom = (r, start) => r.slice(start).filter(isNum).map(num);

  function parseMaster(rows) {
    const zones = {};
    let section = 0;
    let kpi = null;
    for (const r of rows) {
      const a = clean(r[0]), A = a.toUpperCase();
      // Section titles (old and new names)
      if (/^ZONE/.test(A) && /BREAKDOWN|BENCHMARK|CAPACITY/.test(A)) { section = 1; continue; }
      if (/LVL BREAKDOWN|COMPLEXITY/.test(A)) { section = 2; continue; }
      if (/STATUS BREAKDOWN/.test(A)) { section = 3; continue; }
      if (/WAITING/.test(A) && /BREAKDOWN/.test(A)) { section = 4; continue; }
      // Any other all-caps title row starts a section we don't know: ignore its rows.
      if (a && a === A && /[A-Z]{4}/.test(A) && !/^ZONE\s*\d|^PORTFOLIO TOTAL/.test(A) && !isNum(a) && r.slice(1).every(v => !clean(v))) { section = 0; continue; }
      if (!kpi && section === 0 && isNum(a)) {
        const n = numsFrom(r, 0);
        kpi = { totalLvl: n[0] || 0, openWos: n[1] || 0, dailyCap: n[2] || 0, days: n[3] || 0, weeks: n[4] || 0 };
      }
      const m = a.match(/^Zone\s*(\d+)$/i);
      const isTotal = /^PORTFOLIO TOTAL/i.test(a);
      if (!m && !isTotal) continue;
      const key = m ? 'Zone ' + m[1] : 'TOTAL';
      const z = zones[key] || (zones[key] = { id: key, n: m ? +m[1] : 99, lvl: [] });
      if (!z.group) z.group = clean(r[1]);
      const n = numsFrom(r, 2);
      if (section === 1) {
        const rosterCell = clean(r[2]);
        if (rosterCell && !isNum(rosterCell)) z.roster = rosterCell;
        Object.assign(z, { openWos: n[0] || 0, totalLvl: n[1] || 0, dailyCap: n[2] || 0, days: n[3] || 0, weeks: n[4] || 0, over1wk: n[5] || 0, over2wk: n[6] || 0 });
        // Old layout carried Scheduled / New here; the new layout has a separate status section.
        if (n.length >= 9) { z.scheduled = n[7]; z.newWos = n[8]; }
      } else if (section === 2) {
        z.openWos = z.openWos || n[0] || 0;
        z.lvl = n.slice(1);
      } else if (section === 3) {
        z.scheduled = n[0] || 0; z.newWos = n[1] || 0; z.urgent = n[2] || 0;
      } else if (section === 4) {
        z.waitingMaster = n[0] || 0; z.waiting1wk = n[1] || 0; z.waiting2wk = n[2] || 0;
      }
    }
    const total = zones.TOTAL;
    delete zones.TOTAL;
    const list = Object.values(zones).sort((x, y) => x.n - y.n);
    // Trim trailing LVL columns that are zero for every zone (but keep at least 5).
    let levels = Math.max(5, ...list.map(z => z.lvl.length));
    while (levels > 5 && list.every(z => !(z.lvl[levels - 1] > 0))) levels--;
    for (const z of list.concat(total ? [total] : [])) { z.lvl = Array.from({ length: levels }, (_, i) => z.lvl[i] || 0); }
    return { kpi: kpi || {}, total, zones: list, levels };
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
    // --- Right-hand panel: find the column holding the labels ("Total LVL Backlog", ...).
    let labelCol = -1;
    for (let i = 0; i < Math.min(rows.length, 25) && labelCol < 0; i++) {
      const c = rows[i].findIndex(v => /^(Total LVL Backlog|Technician Roster|Total Work Orders)$/i.test(clean(v)));
      if (c >= 0) labelCol = c;
    }
    const panel = {}, roster = [];
    if (labelCol >= 0) {
      let inRoster = false;
      for (let i = 0; i < Math.min(rows.length, 25); i++) {
        const r = rows[i];
        for (const c of [labelCol, labelCol + 2]) {
          const label = clean(r[c]);
          if (!label) continue;
          if (c === labelCol && /^Technician Roster$/i.test(label)) { inRoster = true; continue; }
          if (c === labelCol && /^(Total Tech Capacity|Backlog Status)$/i.test(label)) inRoster = false;
          if (c === labelCol && inRoster) roster.push({ name: label, cap: num(r[c + 1]) });
          else panel[label] = clean(r[c + 1]);
        }
      }
    }
    const exportDate = toDate(panel['Export Date'] || '');

    // --- Work order table: map columns by header text so inserted columns don't break us.
    const wos = [];
    let col = null, created = null;
    for (const r of rows) {
      const cells = r.map(clean);
      if (!col) {
        const wi = cells.findIndex(v => /^Work Order Number$/i.test(v));
        if (wi >= 0) {
          const find = re => cells.findIndex(v => re.test(v));
          col = { wo: wi, property: find(/^Property$/i), priority: find(/^Priority$/i), desc: find(/^Job Description$/i), instr: find(/^Instructions$/i),
            status: find(/^Status$/i), vendor: find(/^Vendor$/i), city: find(/^Property City$/i), lvl: find(/^LVL$/i) };
          if (col.property < 0) col.property = 0;
          if (col.lvl < 0) col.lvl = Math.max(col.city, col.vendor, col.status) + 1;
        }
        continue;
      }
      const a = cells[0], b = cells[col.wo];
      if (!b && toDate(a)) { created = toDate(a); continue; }
      if (!/^\d+-\d+$/.test(b)) continue;
      const get = k => col[k] >= 0 ? cells[col[k]] : '';
      const instr = get('instr');
      const lm = instr.match(/LVL\s*(\d)/i);
      wos.push({
        property: get('property'), wo: b, priority: get('priority'), desc: get('desc'), instr, status: get('status'),
        vendor: get('vendor'), city: get('city'),
        lvl: num(get('lvl')) || (lm ? +lm[1] : 0),
        created: created ? ymd(created) : '',
        age: created && exportDate ? Math.round((exportDate - created) / 864e5) : null
      });
    }
    return { panel, roster, exportDate: exportDate ? ymd(exportDate) : '', wos };
  }

  // --- Waiting Work Orders: WOs parked on vendors / parts / approvals.
  // Columns are located by header text; falls back to the known order.
  function parseWaiting(rows) {
    const list = [];
    let col = { zone: 0, property: 1, wo: 2, desc: 3, vendor: 4, notes: 5, start: 6, created: 7 };
    for (const r of rows) {
      const cells = r.map(clean);
      const wi = cells.findIndex(v => /^Work Order Number$/i.test(v));
      if (wi >= 0) {
        const find = (re, dflt) => { const i = cells.findIndex(v => re.test(v)); return i >= 0 ? i : dflt; };
        col = { zone: find(/^Zone$/i, 0), property: find(/^Property$/i, 1), wo: wi, desc: find(/^Job Description$/i, 3), vendor: find(/^Vendor$/i, 4),
          notes: find(/^Status Notes$/i, 5), start: find(/^Scheduled Start$/i, 6), created: find(/^Created Date$/i, 7) };
        continue;
      }
      const wo = cells[col.wo];
      if (!/^\d+-\d+$/.test(wo)) continue;
      const d = s => { const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; };
      const zn = num(cells[col.zone]);
      list.push({ zone: zn ? 'Zone ' + zn : '', property: cells[col.property], wo, desc: cells[col.desc], vendor: cells[col.vendor],
        notes: cells[col.notes], start: d(cells[col.start]), created: d(cells[col.created]) });
    }
    return list;
  }

  // --- Assessment LVL: what each level means (reference table).
  function parseAssessment(rows) {
    const levels = [];
    for (const r of rows) {
      const m = clean(r[0]).match(/^(?:LVL|Level)\s*(\d)$/i);
      if (m) levels.push({ lvl: +m[1], duration: clean(r[1]), scope: clean(r[2]) });
    }
    return levels.sort((a, b) => a.lvl - b.lvl);
  }

  // texts: { 'Master Dashboard': csv, 'Zone 1': csv, ... }
  function buildModel(texts) {
    const model = parseMaster(parseCSV(texts['Master Dashboard'] || ''));
    model.waiting = parseWaiting(parseCSV(texts['Waiting Work Orders'] || ''));
    model.assessment = parseAssessment(parseCSV(texts['Assessment LVL'] || ''));
    const today = ymd(new Date());
    for (const w of model.waiting) w.age = w.created ? Math.round((toDate(today) - toDate(w.created)) / 864e5) : null;
    for (const z of model.zones) {
      if (!texts[z.id]) continue;
      const zt = parseZone(parseCSV(texts[z.id]));
      Object.assign(z, zt);
      // Fill anything the Master tab didn't provide from the zone's own panel.
      const p = zt.panel;
      if (z.scheduled == null) z.scheduled = num(p['Scheduled WOs']);
      if (z.newWos == null) z.newWos = num(p['New WOs']);
      if (z.assigned == null) z.assigned = num(p['Assigned WOs']);
      if (!z.openWos) z.openWos = num(p['Total Work Orders']);
      if (!z.totalLvl) z.totalLvl = num(p['Total LVL Backlog']);
      if (!z.dailyCap) z.dailyCap = num(p['Daily Capacity']);
      if (!z.days) z.days = num(p['Daily Backlog (Days)']);
      if (!z.weeks) z.weeks = num(p['Weekly Backlog (Wks)']);
      if (z.urgent == null) z.urgent = z.wos.filter(w => /urgent|emergency/i.test(w.priority)).length;
    }
    // Waiting count: prefer the Master tab's figure once its formulas are live, else count the Waiting tab rows ourselves.
    for (const z of model.zones) z.waiting = z.waitingMaster || model.waiting.filter(w => w.zone === z.id).length;
    if (model.total) {
      const t = model.total;
      for (const k of ['scheduled', 'newWos', 'urgent', 'assigned', 'waiting']) if (t[k] == null) t[k] = model.zones.reduce((s, z) => s + (z[k] || 0), 0);
      if (!t.roster) t.roster = model.zones.reduce((s, z) => s + (z.roster || []).filter(r => r.cap > 0).length, 0) + ' Roster Technicians';
    }
    const dates = model.zones.map(z => z.exportDate).filter(Boolean).sort();
    model.exportDates = { min: dates[0] || '', max: dates[dates.length - 1] || '' };
    return model;
  }

  const api = { SHEET_ID, TABS, OPTIONAL_TABS, csvUrl, parseCSV, buildModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LionParser = api;
})(this);
