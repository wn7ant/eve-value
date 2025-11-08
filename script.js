// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - Omega plans: omega.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const VALUE_TBL = document.getElementById('valueTable');
const TBODY     = document.getElementById('tableBody');
const OMEGA_TBL = document.getElementById('omegaTable');
const OMEGA_BODY= document.getElementById('omegaBody');
const YEAR      = document.getElementById('year');
const LAST      = document.getElementById('lastUpdate');   // we will clear this
const REFRESH   = document.getElementById('refresh');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX      = 44992;

// Inline color tokens (works even if CSS lacks helpers)
const COLOR_DOLLAR = '#8BE28B';    // green
const COLOR_PLEX   = '#F5C84C';    // EVE-like yellow
const COLOR_ISK    = '#4CC2FF';    // light blue

// -------------------- State --------------------
let packs = [];        // from packs.json
let plans = [];        // from omega.json
let plexISK = null;    // ISK per PLEX (number)
let bestDollarPerPLEX = null; // min $/PLEX from packs

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function indexOfStrictMin(arr) {
  let bestIdx = 0, bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < bestVal - 1e-9) { bestVal = v; bestIdx = i; }
  }
  return bestIdx;
}
function monthsFromLabel(label) {
  // e.g., "12 Months" or "1 Month" -> 12 or 1
  const m = String(label).match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
}
async function loadOmega() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  plans = await res.json();
}
async function fetchPLEXFromESIPrices() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI prices returned an empty array.');

  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);

  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = Number.isFinite(avg) && avg > 0 ? avg
                : (Number.isFinite(adj) && adj > 0 ? adj : NaN);

  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price missing or zero in ESI prices.');
  }

  plexISK = chosen;

  // Update the big title: "PLEX / Ƶ <value> as of <time>"
  const h1 = document.querySelector('#calculator h1');
  if (h1) {
    const val = fmt(plexISK, 0);
    const now = new Date().toLocaleString();
    h1.innerHTML =
      `<span style="color:${COLOR_PLEX};font-weight:700">PLEX</span> `
      + `<span style="color:#ffffff;font-weight:700">/</span> `
      + `<span style="color:${COLOR_ISK};font-weight:700">&#x01B5;</span> `
      + `<span>${val}</span> `
      + `<span class="muted">as of ${now}</span>`;
  }
  // Clear the old “last update” line
  if (LAST) LAST.textContent = '';
}

// -------------------- Value Table --------------------
function rewriteValueHeader() {
  const thead = VALUE_TBL.querySelector('thead');
  if (!thead) return;
  thead.innerHTML = `
    <tr>
      <th style="text-align:left">Quantity</th>
      <th class="num">Cash Price</th>
      <th class="num">$ / PLEX</th>
      <th class="num">$ / Billion <span style="color:${COLOR_ISK}">&#x01B5;</span></th>
    </tr>`;
}

function renderValueTable() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  // Compute rows + $/PLEX + $/Billion ISK
  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;                           // $/PLEX
    const dollarPerISK = price / (p.plex_amount * plexISK);          // $/ISK
    const perBillion = dollarPerISK * 1_000_000_000;                 // $/Billion ISK
    return { ...p, price, perPLEX, perBillion };
  });

  // Best markers
  const perPLEXArr    = rows.map(r => r.perPLEX);
  const perBillionArr = rows.map(r => r.perBillion);
  const bestPerPLEXIdx    = indexOfStrictMin(perPLEXArr);
  const bestPerBillionIdx = indexOfStrictMin(perBillionArr);

  // Save global best $/PLEX for Omega table "PLEX exchange"
  bestDollarPerPLEX = rows[bestPerPLEXIdx].perPLEX;

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestPerBillionIdx);
    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    const cellPerPLEX =
      `${isBestA ? '<span class="pill best">Best</span>' : ''}`
      + `<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;

    const cellPerB =
      `${isBestB ? '<span class="pill best">Best</span>' : ''}`
      + `<span class="numv">$${fmt(r.perBillion, 2)}</span>`;

    return `<tr${rowClass}>
      <td style="text-align:left">${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num leftpill">${cellPerPLEX}</td>
      <td class="num leftpill">${cellPerB}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega Table (4 columns) --------------------
function rewriteOmegaHeader() {
  const thead = OMEGA_TBL.querySelector('thead');
  if (!thead) return;
  thead.innerHTML = `
    <tr>
      <th style="text-align:left">Duration</th>
      <th class="num"><strong style="color:${COLOR_DOLLAR}">$</strong></th>
      <th class="num"><strong style="color:${COLOR_PLEX}">PLEX</strong></th>
      <th class="num"><strong>PLEX exchange</strong></th>
    </tr>`;
}

function renderOmegaTable() {
  if (!plans.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="4" class="muted">No Omega data.</td></tr>';
    return;
  }
  if (!plexISK || !Number.isFinite(bestDollarPerPLEX)) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="4" class="muted">Waiting for prices…</td></tr>';
    return;
  }

  // Build rows
  const rows = plans.map(p => {
    const months = monthsFromLabel(p.label);
    const cashUSD = Number(p.cash_usd);
    const plexNeeded = Number(p.plex_cost);

    const cashPerMonth = cashUSD / months;
    const plexExchangeTotalUSD = plexNeeded * bestDollarPerPLEX;    // buy PLEX at best $/PLEX

    return {
      label: p.label,
      cashUSD,
      plexNeeded,
      cashPerMonth,
      plexExchangeTotalUSD,
      months
    };
  });

  // "Best" row is the one with the lowest monthly cost between cash/month and (plexExchangeTotal/mo)
  const monthlyCosts = rows.map(r => Math.min(r.cashPerMonth, r.plexExchangeTotalUSD / r.months));
  const bestIdx = indexOfStrictMin(monthlyCosts);

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const isBest = (i === bestIdx);
    const rowClass = isBest ? ' class="highlight"' : '';

    const plexExchangeCell =
      `${isBest ? '<span class="pill best">Best</span>' : ''}`
      + `<span class="numv">$${fmt(r.plexExchangeTotalUSD, 2)}</span>`;

    return `
      <tr${rowClass}>
        <td style="text-align:left">${r.label}</td>
        <td class="num">$${fmt(r.cashUSD, 2)}</td>
        <td class="num">${fmt(r.plexNeeded, 0)}</td>
        <td class="num leftpill">${plexExchangeCell}</td>
      </tr>`;
  }).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    rewriteValueHeader();
    rewriteOmegaHeader();
    await Promise.all([loadPacks(), loadOmega(), fetchPLEXFromESIPrices()]);
    renderValueTable();
    renderOmegaTable();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
    if (OMEGA_BODY) OMEGA_BODY.innerHTML = `<tr><td colspan="4">Error: ${e.message}</td></tr>`;
  }
}

REFRESH?.addEventListener('click', refresh);

// Auto-run on load
refresh();