# Lion Maintenance Dashboard

A simple two-page web dashboard fed by two Google Sheets:

| Page | Source sheet | What it answers |
|---|---|---|
| **Backlog** (`index.html`) | Portfolio Maintenance & Backlog | How much repair work is waiting per zone, and how many days to clear it |
| **Performance** (`performance.html`) | Technician Performance / Work Order Trends | Are scheduled jobs getting finished, who is slipping, is the backlog shrinking |

Both pages share the sidebar, styling (`styles.css`) and the live-with-offline-fallback loading.

## How to open it

**Option A – live data (recommended)**

1. Double-click `start-dashboard.bat` (needs Node.js installed).
2. Your browser opens `http://localhost:8080` and the page pulls the latest numbers
   straight from the Google Sheet. It refreshes itself every 10 minutes; the
   **Refresh** button pulls immediately.

**Option B – just open the file**

Double-click `index.html`. Browsers block Google Sheets requests from a `file://`
page, so this shows the **offline copy** saved in `snapshot.js` (the pill at the top
says "Offline copy …"). To update the offline copy run `node build-snapshot.js`.

**Option C – host it**

Upload every `.html`, `.css` and `.js` file in this folder to any static host
(GitHub Pages, Netlify, an internal web server). Live loading works from any
`http(s)://` origin.

## Performance page

| Section | Meaning |
|---|---|
| Banner + KPIs | Team completion rate (last 7 days, last 30 days, all time), backlog trend, active technicians |
| Daily team performance | Scheduled vs. finished jobs per working day, with the daily rate above each pair |
| Technicians | One card per tech: all-time rate, last 7 / 30 days, status (High performer ≥ 90% · Consistent 80–89% · Needs support < 80%) |
| New vs. finished | Work orders created vs. closed per day; above 100% means the backlog shrank that day |
| By zone | New vs. finished per zone over the last 7 / 14 / 28 days, with "backlog up/down by N" |
| Time estimates vs. actual | The latest daily log: estimated level vs. clocked hours per job, and accuracy per level |

## Backlog page

| Section | Meaning |
|---|---|
| Headline | One sentence: open work orders and how many working days to finish them, with a status badge |
| 3 big numbers | Open work orders · Days to finish all · Zones behind |
| Zone list | One row per zone, most behind first; bar length = days of work waiting; colour = **Behind / Watch / On track** |
| Click a zone | Opens `zone.html` in a **new tab** listing that zone's open work orders (searchable, filterable, oldest first; click a job to read the full text) |
| More details | Collapsed: charts, the full numbers table (same as the Master Dashboard tab), and a "how to read" guide |

Status thresholds (days to clear): **On track** ≤ 5 · **Watch** 5–10 · **Behind** > 10.
Change `GOOD_MAX` / `WARN_MAX` at the top of the script in `index.html` and `zone.html` to adjust.

## Files

- `index.html` – Backlog page
- `zone.html` – one zone's work orders (`zone.html?zone=Zone%206`)
- `performance.html` – Performance page
- `styles.css` – shared styling
- `parser.js` / `perf-parser.js` – convert each sheet's tabs (CSV) into a data model; shared by browser and Node
- `snapshot.js` / `snapshot-perf.js` – generated offline copies of the data (`node build-snapshot.js`)
- `build-snapshot.js` – regenerates `snapshot.js` and prints a parse check per zone
- `serve.js` / `start-dashboard.bat` – tiny local web server

## Requirements on the sheet

Both sheets must stay **"Anyone with the link can view"** and keep their current layouts:

- Backlog sheet: a `Master Dashboard` tab plus `Zone 1` … `Zone 9` tabs with the capacity
  panel in columns K–N and the AppFolio export in columns A–I.
- Performance sheet: the `Daily Work Orders by Zone`, `Work Order Rolling Trends`,
  `Daily Input Log`, `Performance Trends`, `Work Order Daily Log` and
  `Estimation & Tech Tally` tabs. Rows are recognised by pattern (dates, "Zone N",
  "Level N", technician names), so adding rows is fine; moving columns is not.
