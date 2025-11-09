// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - Omega plans: omega.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const TBODY      = document.getElementById('tableBody');
const YEAR       = document.getElementById('year');
const PLEX_RATE  = document.getElementById('plexRate');
const AS_OF      = document.getElementById('asOf');
const OMEGA_BODY = document.getElementById('omegaBody');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let omegaPlans = [];
let iskPerPlex = null; // numeric ISK per 1 PLEX

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function dollar(n, digits = 2) {
  return `$${fmt(n, digits)}`;
}

function showPacksStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function showOmegaStatus(msg, isError = false) {
  OMEGA_BODY.innerHTML = `<tr><td colspan="5" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function monthsFromLabel(label){
  // expects "1 Month", "3 Months", etc.
  const m = String(label).trim().split(' ')[0];
  const v = Number(m);
  return Number.isFinite(v) && v>0 ? v : 1;
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

  iskPerPlex = chosen;
  // Banner: “PLEX / Ƶ <rate> as of <time>”
  if (PLEX_RATE) PLEX_RATE.textContent = fmt(iskPerPlex, 0);
  if (AS_OF) AS_OF.textContent = `as of ${new Date().toLocaleString()}`;
}

// -------------------- Packs table --------------------
function computePacks() {
  if (!packs.length) { showPacksStatus('No packs loaded.'); return; }
  if (!iskPerPlex)   { showPacksStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    const cashPerBillionISK = price / ( (iskPerPlex * p.plex_amount) / 1_000_000_000 );
    return { ...p, price, perPLEX, cashPerBillionISK };
  });

  // Strictly choose one “best” row per metric
  const bestPerPLEXIdx = rows.map(r => r.perPLEX)
    .reduce((best,i,idx,arr)=> arr[idx]<arr[best]-1e-9 ? idx:best, 0);
  const bestPerBILIdx  = rows.map(r => r.cashPerBillionISK)
    .reduce((best,i,idx,arr)=> arr[idx]<arr[best]-1e-9 ? idx:best, 0);

  TBODY.innerHTML = rows.map((r, i) => {
    const rowClass = (i===bestPerPLEXIdx || i===bestPerBILIdx) ? ' class="highlight"' : '';
    return `<tr${rowClass}>
      <td class="left">${r.name || `${fmt(r.plex_amount,0)} PLEX`}</td>
      <td class="num">${dollar(r.price, 2)}</td>
      <td class="num">${dollar(r.perPLEX, 4)}</td>
      <td class="num">${dollar(r.cashPerBillionISK, 2)} / 1B Ƶ</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega table (5 columns) --------------------
// Columns: Duration | $ | PLEX | $/month | PLEX exchange
function computeOmega() {
  if (!omegaPlans.length) { showOmegaStatus('No omega plans.'); return; }
  if (!iskPerPlex)        { showOmegaStatus('Waiting for PLEX price…'); return; }

  // Best $/PLEX from packs (lowest perPLEX across packs)
  const perPLEXList = packs.map(p => (p.sale_price_usd ?? p.price_usd) / p.plex_amount);
  const bestDollarPerPLEX = Math.min(...perPLEXList);

  const rows = omegaPlans.map(o => {
    const months = Number(o.months ?? monthsFromLabel(o.label));
    const cashUSD = Number(o.cash_usd);
    const plexAmt = Number(o.plex_cost);

    // $/month (cash): cash / months
    const perMonth = cashUSD / months;

    // PLEX exchange cost PER MONTH: (best $/PLEX * plexAmt) / months
    const plexExchangePerMonth = (bestDollarPerPLEX * plexAmt) / months;

    return { label:o.label, cashUSD, plexAmt, perMonth, plexExchangePerMonth };
  });

  // Render with NO currency symbol in cells (minimalist).
  OMEGA_BODY.innerHTML = rows.map(r => `
    <tr>
      <td class="left">${r.label}</td>
      <td>${fmt(r.cashUSD, 0)}</td>
      <td>${fmt(r.plexAmt, 0)}</td>
      <td>${fmt(r.perMonth, 2)}</td>
      <td>${fmt(r.plexExchangePerMonth, 2)}</td>
    </tr>
  `).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showPacksStatus('Loading packs…');
    showOmegaStatus('Loading omega plans…');
    await Promise.all([loadPacks(), loadOmegaPlans()]);
    await fetchPLEXFromESIPrices();
    computePacks();
    computeOmega();
  } catch (e) {
    console.error(e);
    showPacksStatus(`Error: ${e.message}`, true);
    showOmegaStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();