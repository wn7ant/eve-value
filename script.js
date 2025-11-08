// EVE Value Calculator — ESI-only + omega.json (no fallbacks)
// Data sources:
// - Cash packs: packs.json (you maintain)
// - Omega plans: omega.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const TBODY       = document.getElementById('tableBody');   // PLEX packs tbody
const OMEGA_BODY  = document.getElementById('omegaBody');   // Omega tbody
const YEAR        = document.getElementById('year');
const LAST        = document.getElementById('lastUpdate');
const PREVIEW     = document.getElementById('packsPreview'); // optional JSON preview section

if (YEAR) YEAR.textContent = new Date().getFullYear();

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true; // hide the “Edit your pack data” preview block
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];            // from packs.json
let omegaPlans = [];       // from omega.json
let plexISK = null;        // ISK per PLEX (from ESI prices)
let bestUSDperPLEX = null; // computed from the PLEX table (lowest $/PLEX)

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  if (!TBODY) return;
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function showOmegaStatus(msg, isError = false) {
  if (!OMEGA_BODY) return;
  OMEGA_BODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
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

async function loadJSON(url) {
  // Cache-bust to avoid stale GitHub Pages caches
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${url} JSON parse error: ${e.message}`);
  }
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  packs = await loadJSON('packs.json');
  if (!Array.isArray(packs) || !packs.length) {
    throw new Error('packs.json is empty or not an array.');
  }
  if (HIDE_PACKS_PREVIEW) {
    if (PREVIEW) {
      const sec = PREVIEW.closest('.section');
      if (sec) sec.style.display = 'none';
    }
  } else if (PREVIEW) {
    PREVIEW.textContent = JSON.stringify(packs, null, 2);
  }
}

async function loadOmegaPlans() {
  omegaPlans = await loadJSON('omega.json');
  if (!Array.isArray(omegaPlans) || !omegaPlans.length) {
    throw new Error('omega.json is empty or not an array.');
  }
  // expected shape per row: { "label": "1 month", "cash_usd": 19.99, "plex_cost": 500 }
}

// ESI prices: returns array {type_id, average_price, adjusted_price}
async function fetchPLEXFromESIPrices() {
  const data = await loadJSON(ESI_PRICES_URL);
  if (!Array.isArray(data) || !data.length) throw new Error('ESI prices returned an empty array.');
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);
  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = (Number.isFinite(avg) && avg > 0) ? avg
                : ((Number.isFinite(adj) && adj > 0) ? adj : NaN);
  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price missing or zero in ESI prices.');
  }
  plexISK = chosen;
  if (LAST) LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`;
}

// -------------------- Render: PLEX table --------------------
function computeRows() {
  if (!TBODY) return;
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    const cashPerISK = price / (p.plex_amount * plexISK);
    return { ...p, price, perPLEX, cashPerISK };
  });

  const perPLEXArr    = rows.map(r => r.perPLEX);
  const cashPerISKArr = rows.map(r => r.cashPerISK);
  const bestPerPLEXIdx    = indexOfStrictMin(perPLEXArr);
  const bestCashPerISKIdx = indexOfStrictMin(cashPerISKArr);

  // Save best $/PLEX for Omega calculations
  bestUSDperPLEX = rows[bestPerPLEXIdx].perPLEX;

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestCashPerISKIdx);

    // Pill to the LEFT, number right-aligned (CSS handles layout)
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

// -------------------- Render: Omega table --------------------
function computeOmega() {
  if (!OMEGA_BODY) return;
  if (!omegaPlans.length) {
    showOmegaStatus('No Omega data.');
    return;
  }
  if (!Number.isFinite(bestUSDperPLEX) || bestUSDperPLEX <= 0) {
    showOmegaStatus('Waiting for best $/PLEX from packs…');
    return;
  }

  // Build rows with cash vs via-PLEX costs
  const rows = omegaPlans.map(o => {
    const cashUSD = Number(o.cash_usd);
    const plexCost = Number(o.plex_cost);
    const viaPLEXusd = plexCost * bestUSDperPLEX; // use best $/PLEX from packs table
    return { label: o.label, cashUSD, plexCost, viaPLEXusd };
  });

  // Pick exactly one “best” row: the smallest viaPLEXusd
  const bestIdx = indexOfStrictMin(rows.map(r => r.viaPLEXusd));

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const isBest = (i === bestIdx);
    // Pill only on the best via-PLEX USD cell
    const viaPlexCell = `${isBest ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.viaPLEXusd, 2)}</span>`;
    return `
      <tr${isBest ? ' class="highlight"' : ''}>
        <td>${r.label}</td>
        <td class="num">$${fmt(r.cashUSD, 2)}</td>
        <td class="num">${fmt(r.plexCost, 0)} PLEX</td>
        <td class="num leftpill">${viaPlexCell}</td>
      </tr>`;
  }).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    showOmegaStatus('Loading Omega plans…');
    await loadPacks();             // packs.json
    await loadOmegaPlans();        // omega.json
    await fetchPLEXFromESIPrices();// plexISK
    computeRows();                 // packs table (also sets bestUSDperPLEX)
    computeOmega();                // omega table
  } catch (e) {
    console.error(e);
    // Decide which table to show error in based on where we are
    if (!packs.length) showStatus(`Error: ${e.message}`, true);
    else if (!omegaPlans.length) showOmegaStatus(`Error: ${e.message}`, true);
    else showStatus(`Error: ${e.message}`, true);
  }
}

const refreshBtn = document.getElementById('refresh');
if (refreshBtn) refreshBtn.addEventListener('click', refresh);

// Auto-run on load
refresh();