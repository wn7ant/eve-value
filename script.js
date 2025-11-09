// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Tables are INDEPENDENT. Omega "best" does not affect Packs "best".
// Data sources:
//  - packs.json               (you maintain)
//  - omega.json               (you maintain)
//  - ESI markets/prices       (average_price or adjusted_price for PLEX)

// -------------------- DOM --------------------
const TBODY      = document.getElementById('tableBody');   // packs tbody
const OMEGA_BODY = document.getElementById('omegaBody');   // omega tbody
const YEAR       = document.getElementById('year');
const LAST       = document.getElementById('lastUpdate');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX      = 44992;

// -------------------- State --------------------
let packs = [];          // from packs.json
let omegaPlans = [];     // from omega.json
let plexISK = null;      // ISK per 1 PLEX (from ESI)
let bestDollarPerPLEX = null; // computed from packs table ONLY

// -------------------- Utils --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function showPacksStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function showOmegaStatus(msg, isError = false) {
  OMEGA_BODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function indexOfStrictMin(arr) {
  let idx = 0, val = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < val - 1e-9) { idx = i; val = v; }
  }
  return idx;
}

// -------------------- Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
}
async function loadOmega() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}
// ESI prices: array of {type_id, average_price, adjusted_price}
async function fetchPLEXFromESIPrices() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  const row = Array.isArray(data) ? data.find(d => Number(d.type_id) === TYPE_PLEX) : null;
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);
  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = Number.isFinite(avg) && avg > 0 ? avg
                : (Number.isFinite(adj) && adj > 0 ? adj : NaN);
  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price missing or zero in ESI prices.');
  }
  plexISK = chosen; // ISK per PLEX
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Packs table --------------------
function renderPacks() {
  if (!packs.length) { showPacksStatus('No packs loaded.'); return; }
  if (!plexISK) { showPacksStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    // $ per Billion ISK = ($/PLEX) * (1e9 / ISK_per_PLEX)
    const dollarsPerBillion = perPLEX * (1_000_000_000 / plexISK);
    return { ...p, price, perPLEX, dollarsPerBillion };
  });

  // Compute bests for this table ONLY
  const perPLEXArr = rows.map(r => r.perPLEX);
  const dollarsPerBillionArr = rows.map(r => r.dollarsPerBillion);
  const bestPerPLEXIdx = indexOfStrictMin(perPLEXArr);
  const bestDollarPerBillionIdx = indexOfStrictMin(dollarsPerBillionArr);
  // Expose best $/PLEX for Omega calculations (but don’t affect the packs pills)
  bestDollarPerPLEX = rows[bestPerPLEXIdx].perPLEX;

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestDollarPerBillionIdx);

    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    const perBICell   = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.dollarsPerBillion, 2)} / 1B \u01B5</span>`;

    // Row highlight if either metric is best
    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td class="left">${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num is-cash">$${fmt(r.price, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num leftpill">${perBICell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega table --------------------
// Expected omega.json items can be either:
//  { "label":"1 Month",  "months":1,  "cash_usd":20,  "plex":500 }
//  or legacy keys:       "plex_cost" instead of "plex"
function monthsFrom(o) {
  if (Number.isFinite(o.months)) return Number(o.months);
  const m = String(o.label || '').match(/(\d+)\s*month/i);
  return m ? Number(m[1]) : 1;
}
function renderOmega() {
  if (!omegaPlans.length) { showOmegaStatus('No omega data.'); return; }
  if (!bestDollarPerPLEX) { showOmegaStatus('Waiting for pack $/PLEX…'); return; }

  const rows = omegaPlans.map(o => {
    const months = monthsFrom(o);
    const cash   = Number(o.cash_usd);
    const plex   = Number(o.plex ?? o.plex_cost);
    const cashPerMonth = cash / months;
    // PLEX exchange per month = (best $/PLEX) * (PLEX) / months
    const plexExchangePerMonth = (bestDollarPerPLEX * plex) / months;
    return { label: o.label, months, cash, plex, cashPerMonth, plexExchangePerMonth };
  });

  const bestIdx = indexOfStrictMin(rows.map(r => r.plexExchangePerMonth));

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const isBest = (i === bestIdx);
    const plexCell = `<span class="numv is-plex">${fmt(r.plex, 0)}</span>`;
    const cashMoCell = `<span class="numv is-cash">$${fmt(r.cashPerMonth, 2)}</span>`;
    const exchCell = `${isBest ? '<span class="pill best">Best</span>' : ''}<span class="numv is-cash">$${fmt(r.plexExchangePerMonth, 2)}</span>`;
    const rowClass = isBest ? ' class="highlight"' : '';
    return `<tr${rowClass}>
      <td class="left">${r.label}</td>
      <td class="num is-cash">$${fmt(r.cash, 2)}</td>
      <td class="num">${plexCell}</td>
      <td class="num leftpill">${cashMoCell}</td>
      <td class="num leftpill">${exchCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showPacksStatus('Loading…');
    showOmegaStatus('Loading…');
    await loadPacks();                // 1) packs
    await fetchPLEXFromESIPrices();   // 2) ESI price once
    renderPacks();                    // 3) render packs (sets bestDollarPerPLEX)
    await loadOmega();                // 4) omega plans
    renderOmega();                    // 5) render omega
  } catch (e) {
    console.error(e);
    showPacksStatus(`Error: ${e.message}`, true);
    showOmegaStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);
// Auto-run
refresh();