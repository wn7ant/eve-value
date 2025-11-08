// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - Omega plans: omega.json (you maintain)  e.g. [{ "label":"1 Month","cash_usd":19.99,"plex_cost":500 }, ...]
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const TBODY    = document.getElementById('tableBody');   // packs table body
const OMEGA    = document.getElementById('omegaBody');   // omega table body
const YEAR     = document.getElementById('year');
const LAST     = document.getElementById('lastUpdate');
const PREVIEW  = document.getElementById('packsPreview'); // preview block under "Edit your pack data"

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true;
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let omegaPlans = [];
let plexISK = null;          // ISK per PLEX (from ESI prices)
let bestUsdPerPLEX = null;   // Lowest $/PLEX found in packs table

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function showPacksStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function showOmegaStatus(msg, isError = false) {
  OMEGA.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
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

  if (HIDE_PACKS_PREVIEW) {
    const sec = PREVIEW?.closest('.section');
    if (sec) sec.style.display = 'none';
  } else {
    PREVIEW && (PREVIEW.textContent = JSON.stringify(packs, null, 2));
  }
}

async function loadOmegaPlans() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
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
  const chosen = Number.isFinite(avg) && avg > 0 ? avg : (Number.isFinite(adj) && adj > 0 ? adj : NaN);
  if (!Number.isFinite(chosen) || chosen <= 0) throw new Error('PLEX price missing or zero in ESI prices.');

  plexISK = chosen;
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Packs Table --------------------
function renderPacks() {
  if (!packs.length) { showPacksStatus('No packs loaded.'); return; }
  if (!plexISK)      { showPacksStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    const cashPerISK = price / (p.plex_amount * plexISK);
    return { ...p, price, perPLEX, cashPerISK };
  });

  // choose single best per metric
  const perPLEXArr    = rows.map(r => r.perPLEX);
  const cashPerISKArr = rows.map(r => r.cashPerISK);
  const bestPerPLEXIdx    = indexOfStrictMin(perPLEXArr);
  const bestCashPerISKIdx = indexOfStrictMin(cashPerISKArr);

  bestUsdPerPLEX = rows[bestPerPLEXIdx].perPLEX; // for Omega computations

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestCashPerISKIdx);

    // pill on LEFT of the number; number remains right-aligned via CSS (.num .numv)
    const perPLEXCell    = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    const cashPerISKCell = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.cashPerISK, 9)}</span>`;
    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num leftpill">${cashPerISKCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega Table --------------------
// Accepts multiple possible keys for PLEX count to be robust: plex_cost | plex | plexNeeded
function getPlexNeeded(plan) {
  if (Number.isFinite(plan.plex_cost)) return Number(plan.plex_cost);
  if (Number.isFinite(plan.plex)) return Number(plan.plex);
  if (Number.isFinite(plan.plexNeeded)) return Number(plan.plexNeeded);
  return NaN;
}

function renderOmega() {
  if (!omegaPlans.length) { showOmegaStatus('No Omega data.'); return; }
  if (!Number.isFinite(bestUsdPerPLEX)) { showOmegaStatus('Waiting for best $/PLEX from packs…'); return; }

  const rows = omegaPlans.map(o => {
    const plexNeeded = getPlexNeeded(o);
    const viaPLEXusd = Number.isFinite(plexNeeded) ? plexNeeded * bestUsdPerPLEX : NaN;
    const saveVsCash = Number.isFinite(viaPLEXusd) && Number.isFinite(o.cash_usd) ? (o.cash_usd - viaPLEXusd) : NaN;
    return { ...o, plexNeeded, viaPLEXusd, saveVsCash };
  });

  // best = lowest Cost via PLEX (viaPLEXusd)
  const costs = rows.map(r => Number.isFinite(r.viaPLEXusd) ? r.viaPLEXusd : Number.POSITIVE_INFINITY);
  const bestIdx = indexOfStrictMin(costs);

  OMEGA.innerHTML = rows.map((r, i) => {
    const isBest = (i === bestIdx);
    const perPLEXCell = `<span class="numv">$${fmt(bestUsdPerPLEX, 4)}</span>`;
    const viaPLEXCell = `${isBest ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.viaPLEXusd, 2)}</span>`;
    const rowClass = isBest ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td>${r.label}</td>
      <td class="num">$${fmt(r.cash_usd, 2)}</td>
      <td class="num">${Number.isFinite(r.plexNeeded) ? fmt(r.plexNeeded, 0) + ' PLEX' : '— PLEX'}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num leftpill">${viaPLEXCell}</td>
      <td class="num">${Number.isFinite(r.saveVsCash) ? '$' + fmt(r.saveVsCash, 2) : '—'}</td>
    </tr>`;
  }).join('');
}

// -------------------- Refresh --------------------
async function refresh() {
  try {
    showPacksStatus('Loading…');
    showOmegaStatus('Loading Omega plans…');

    await Promise.all([loadPacks(), loadOmegaPlans(), fetchPLEXFromESIPrices()]);

    renderPacks();  // sets bestUsdPerPLEX
    renderOmega();
  } catch (e) {
    console.error(e);
    showPacksStatus(`Error: ${e.message}`, true);
    showOmegaStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);
refresh();