// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Tables are INDEPENDENT:
//  - Value table: picks best $/PLEX from packs.json and ESI prices for ISK/PLEX
//  - Omega table: picks best plan by LOWEST COST PER MONTH (min of cash/mo vs plex/mo)

// -------------------- DOM --------------------
const TBODY        = document.getElementById('tableBody');   // Value table body
const YEAR         = document.getElementById('year');
const LAST         = document.getElementById('lastUpdate');
const PREVIEW      = document.getElementById('packsPreview'); // optional preview block
const OMEGA_BODY   = document.getElementById('omegaBody');    // Omega table body

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true; // hide the JSON preview section
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];           // from packs.json
let plexISK = null;       // ISK per PLEX (from ESI prices endpoint)
let bestUsdPerPLEX = null; // smallest $/PLEX derived from packs

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function indexOfStrictMin(arr) {
  let bestIdx = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < bestVal - 1e-9) { // strict with epsilon
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();

  if (HIDE_PACKS_PREVIEW) {
    const sec = PREVIEW?.closest('.section');
    if (sec) sec.style.display = 'none';
  } else {
    if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
  }
}

// ESI prices: returns array [{type_id, average_price, adjusted_price}, ...]
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

// -------------------- Value Table (PLEX packs) --------------------
function computeValueTable() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;                        // $ / PLEX
    const cashPerBIL_ISK = price / (p.plex_amount * plexISK / 1e9); // $ / Billion ISK
    return { ...p, price, perPLEX, cashPerBIL_ISK };
  });

  // Bests for Value table (independent of Omega)
  const perPLEXArr = rows.map(r => r.perPLEX);
  const cashPerBILArr = rows.map(r => r.cashPerBIL_ISK);
  const bestPerPLEXIdx = indexOfStrictMin(perPLEXArr);
  const bestCashPerBILIdx = indexOfStrictMin(cashPerBILArr);

  // Set global bestUsdPerPLEX for Omega math
  bestUsdPerPLEX = rows[bestPerPLEXIdx].perPLEX;

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestCashPerBILIdx);

    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    const cashPerBILCell = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.cashPerBIL_ISK, 2)}</span>`;

    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <!-- PLEX column removed by request -->
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num leftpill">${cashPerBILCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega Table --------------------
// omega.json expected rows: { "label": "1 Month", "months": 1, "cash_usd": 20, "plex_cost": 500 }
let omegaPlans = [];

async function loadOmegaPlans() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}

function computeOmegaTable() {
  if (!omegaPlans.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="5" class="muted">No Omega data.</td></tr>';
    return;
  }
  if (!Number.isFinite(bestUsdPerPLEX) || bestUsdPerPLEX <= 0) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="5" class="muted">Waiting for best $/PLEX…</td></tr>';
    return;
  }

  // Build per-month metrics
  const rows = omegaPlans.map(o => {
    const cashPerMonth = o.cash_usd / o.months;
    const plexPerMonth = (o.plex_cost * bestUsdPerPLEX) / o.months; // cost in USD per month if buying PLEX at best $/PLEX
    // choose which side is cheaper for this plan (for cell-level pill)
    const cheaperSide = plexPerMonth < cashPerMonth ? 'plex' : 'cash';
    return { ...o, cashPerMonth, plexPerMonth, cheaperSide };
  });

  // Pick the BEST overall plan = lowest of min(cash/mo, plex/mo) across rows
  const planScore = rows.map(r => Math.min(r.cashPerMonth, r.plexPerMonth));
  const bestPlanIdx = indexOfStrictMin(planScore);

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const isBestRow = (i === bestPlanIdx);

    // Per-cell pill: show the pill next to the cheaper value in that best row; others no pill.
    const cashCell = (isBestRow && r.cheaperSide === 'cash')
      ? `<span class="pill best">Best</span><span class="numv">$${fmt(r.cashPerMonth, 2)}</span>`
      : `<span class="numv">$${fmt(r.cashPerMonth, 2)}</span>`;

    const plexCell = (isBestRow && r.cheaperSide === 'plex')
      ? `<span class="pill best">Best</span><span class="numv">$${fmt(r.plexPerMonth, 2)}</span>`
      : `<span class="numv">$${fmt(r.plexPerMonth, 2)}</span>`;

    return `
      <tr${isBestRow ? ' class="highlight"' : ''}>
        <td>${r.label}</td>
        <td class="num">$${fmt(r.cash_usd, 2)}</td>
        <td class="num">${fmt(r.plex_cost, 0)} PLEX</td>
        <td class="num leftpill">${cashCell}</td>
        <td class="num leftpill">${plexCell}</td>
      </tr>`;
  }).join('');
}

// -------------------- Refresh Flow (independent tables) --------------------
async function refresh() {
  try {
    // Value table
    showStatus('Loading…');
    await loadPacks();
    await fetchPLEXFromESIPrices();
    computeValueTable();

    // Omega table (independent, but uses bestUsdPerPLEX from value table)
    OMEGA_BODY && (OMEGA_BODY.innerHTML = '<tr><td colspan="5" class="muted">Loading Omega plans…</td></tr>');
    await loadOmegaPlans();
    computeOmegaTable();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
    if (OMEGA_BODY) {
      OMEGA_BODY.innerHTML = `<tr><td colspan="5">Error: ${e.message}</td></tr>`;
    }
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();