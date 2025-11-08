// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price
//
// Packs table: unchanged (Quantity | Cash Price | $/PLEX | $/Billion ISK)
// Omega table: now 5 columns -> Duration | $ | PLEX | $/month | PLEX exchange

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');

const OMEGA_THEAD = document.querySelector('#omegaTable thead');
const OMEGA_BODY  = document.getElementById('omegaBody');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let plexISK = null;               // ISK per PLEX (from ESI prices)
let bestDollarPerPLEX = null;     // Best $/PLEX from packs table
let omegaPlans = [];

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="5" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function indexOfStrictMin(arr) {
  let bestIdx = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < bestVal - 1e-9) { bestVal = v; bestIdx = i; }
  }
  return bestIdx;
}

function monthsFromLabel(label) {
  // "1 Month", "3 Months", etc. -> 1, 3, ...
  const m = String(label).match(/^(\d+)/);
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

// ESI prices: returns an array with objects {type_id, average_price, adjusted_price}
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
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Packs table (unchanged structure) --------------------
function computePacksTable() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    // $ / Billion ISK -> dollars per (1,000,000,000 ISK)
    const cashPerBillionISK = price / (p.plex_amount * plexISK) * 1_000_000_000;
    return { ...p, price, perPLEX, cashPerBillionISK };
  });

  // Track the single best $/PLEX for later use in Omega
  const perPLEXArr = rows.map(r => r.perPLEX);
  const bestPerPLEXIdx = indexOfStrictMin(perPLEXArr);
  bestDollarPerPLEX = rows[bestPerPLEXIdx]?.perPLEX ?? null;

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);

    // pill left, number right
    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;

    return `<tr${isBestA ? ' class="highlight"' : ''}>
      <td class="left">${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num">$${fmt(r.cashPerBillionISK, 2)} / 1B &#x01B5;</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega table (5 columns) --------------------
function ensureOmegaHeader() {
  if (!OMEGA_THEAD) return;
  OMEGA_THEAD.innerHTML = `
    <tr>
      <th class="left">Duration</th>
      <th class="num"><span class="is-cash">$</span></th>
      <th class="num"><span class="is-plex">PLEX</span></th>
      <th class="num"><span class="is-cash">$</span>/month</th>
      <th class="num">PLEX exchange</th>
    </tr>`;
}

function computeOmega() {
  ensureOmegaHeader();

  if (!omegaPlans.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="5" class="muted">No Omega data.</td></tr>';
    return;
  }
  if (!bestDollarPerPLEX) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="5" class="muted">Waiting for best $/PLEX from packs…</td></tr>';
    return;
  }

  // Build omega rows with new columns
  const rows = omegaPlans.map(o => {
    const months = monthsFromLabel(o.label);
    const cashPerMonth = o.cash_usd / months;                  // $/month
    const plexExchangeUSD = o.plex_cost * bestDollarPerPLEX;   // cost via PLEX using best $/PLEX
    return { ...o, months, cashPerMonth, plexExchangeUSD };
  });

  // Render (no extra “PLEX” word next to numbers in the PLEX column)
  OMEGA_BODY.innerHTML = rows.map(r => `
    <tr>
      <td class="left">${r.label}</td>
      <td class="num">$${fmt(r.cash_usd, 2)}</td>
      <td class="num"><span class="is-plex">${fmt(r.plex_cost, 0)}</span></td>
      <td class="num">$${fmt(r.cashPerMonth, 2)}</td>
      <td class="num">$${fmt(r.plexExchangeUSD, 2)}</td>
    </tr>
  `).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    await Promise.all([loadPacks(), loadOmegaPlans()]);
    await fetchPLEXFromESIPrices();
    computePacksTable();  // packs table (also sets bestDollarPerPLEX)
    computeOmega();       // omega table (uses bestDollarPerPLEX)
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
    if (OMEGA_BODY) OMEGA_BODY.innerHTML = `<tr><td colspan="5" class="muted">Error: ${e.message}</td></tr>`;
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();