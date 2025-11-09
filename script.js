// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price
// - Omega plans: omega.json  [ { label, cash_usd, plex_cost }, … ]

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const OMEGA_BODY = document.getElementById('omegaBody');
const YEAR    = document.getElementById('year');
const PLEX_RATE = document.getElementById('plexRate');
const AS_OF  = document.getElementById('asOf');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let omegaPlans = [];
let plexISK = null;       // ISK per 1 PLEX (from ESI)
let bestDollarPerPLEX = null; // best $/PLEX from packs table (for Omega)

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function showOmegaStatus(msg, isError = false) {
  OMEGA_BODY.innerHTML = `<tr><td colspan="5" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function indexOfStrictMin(arr) {
  let iBest = 0, vBest = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < vBest - 1e-9) { vBest = v; iBest = i; }
  }
  return iBest;
}
function monthsFromLabel(label) {
  // "24 Months" -> 24 ; "1 Month" -> 1
  const m = String(label).match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
}
async function loadOmegaPlans() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}
// ESI prices: returns array of {type_id, average_price, adjusted_price}
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

  // Update banner
  if (PLEX_RATE) PLEX_RATE.textContent = fmt(plexISK, 0);
  if (AS_OF) AS_OF.textContent = `as of ${new Date().toLocaleString()}`;
}

// -------------------- Packs Table --------------------
function renderPacksTable() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    // $ per Billion ISK
    const dollarsPerBillion = price / (p.plex_amount * plexISK) * 1_000_000_000;
    return { ...p, price, perPLEX, dollarsPerBillion };
  });

  // Single "best" for each metric
  const perPLEXArr = rows.map(r => r.perPLEX);
  const perBilArr  = rows.map(r => r.dollarsPerBillion);
  const iBestA = indexOfStrictMin(perPLEXArr);
  const iBestB = indexOfStrictMin(perBilArr);

  // Remember best $/PLEX for Omega table
  bestDollarPerPLEX = rows[iBestA].perPLEX;

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === iBestA);
    const isBestB = (i === iBestB);
    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    const perBilCell  = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.dollarsPerBillion, 2)}</span>`;

    return `<tr${rowClass}>
      <td class="left">${r.name || (r.plex_amount + ' PLEX')}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num leftpill">${perBilCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega Table --------------------
function renderOmegaTable() {
  if (!omegaPlans.length) { showOmegaStatus('No omega data.'); return; }
  if (!plexISK || !bestDollarPerPLEX) { showOmegaStatus('Waiting for prices…'); return; }

  // Build rows with monthly math
  const rows = omegaPlans.map(o => {
    const months = monthsFromLabel(o.label);
    const cashPerMonth = o.cash_usd / months;
    // PLEX exchange per month = (best $/PLEX) * plex_needed / months
    const plexExchangePerMonth = bestDollarPerPLEX * (o.plex_cost / months);
    return { ...o, months, cashPerMonth, plexExchangePerMonth };
  });

  // Best markers (lowest in each column)
  const bestCashIdx = indexOfStrictMin(rows.map(r => r.cashPerMonth));
  const bestPlexExIdx = indexOfStrictMin(rows.map(r => r.plexExchangePerMonth));

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const rowClass = (i === bestCashIdx || i === bestPlexExIdx) ? ' class="highlight"' : '';
    const cashCell = `${i === bestCashIdx ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.cashPerMonth,2)}</span>`;
    const plexCell = `${i === bestPlexExIdx ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.plexExchangePerMonth,2)}</span>`;
    return `<tr${rowClass}>
      <td class="left">${r.label}</td>
      <td class="num">$${fmt(r.cash_usd, 2)}</td>
      <td class="num">${fmt(r.plex_cost, 0)}</td>
      <td class="num leftpill">${cashCell}</td>
      <td class="num leftpill">${plexCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading packs…');
    showOmegaStatus('Loading omega plans…');
    await Promise.all([loadPacks(), loadOmegaPlans(), fetchPLEXFromESIPrices()]);
    renderPacksTable();
    renderOmegaTable();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
    showOmegaStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();