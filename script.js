// EVE Value Calculator — ESI version (no Fuzzwork)
// - Cash packs: packs.json (you maintain)
// - PLEX→ISK: ESI market sell orders for region + type_id=44992 (PLEX)
// - Aggregations: min / avg / median from all sell orders in the region
// - Works on GitHub Pages (static hosting)

const TABLE   = document.getElementById('valueTable');
const TBODY   = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');
const SOURCE  = document.getElementById('plexSource');

if (YEAR) YEAR.textContent = new Date().getFullYear();

const ESI_BASE  = 'https://esi.evetech.net/latest';
const PLEX_TYPE = 44992; // PLEX

let packs = [];
let plexISK = null; // chosen value from {min, avg, median}

// ---------- UI helpers ----------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  const row = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
  TBODY.innerHTML = row;
}

// ---------- Data loading ----------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// Validate inputs and return numeric region
function validateInputs() {
  const regionVal = REGION ? REGION.value : '10000002';
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  const src = SOURCE ? SOURCE.value : 'median';
  if (!['median', 'avg', 'min'].includes(src)) {
    throw new Error(`Unknown plexSource "${src}"`);
  }
  return Number(regionVal);
}

// Fetch all sell orders for (region, type_id) with pagination
async function fetchAllSellOrders(regionId, typeId) {
  const firstUrl = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=1`;
  const firstRes = await fetch(firstUrl, { cache: 'no-store' });
  if (!firstRes.ok) {
    throw new Error(`ESI HTTP ${firstRes.status} for page 1`);
  }
  const totalPages = Number(firstRes.headers.get('X-Pages') || '1');
  let orders = await firstRes.json();

  // If more pages, fetch the rest
  if (totalPages > 1) {
    const pagePromises = [];
    for (let p = 2; p <= totalPages; p++) {
      const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=${p}`;
      pagePromises.push(fetch(url, { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(`ESI HTTP ${r.status} for page ${p}`);
        return r.json();
      }));
    }
    const pages = await Promise.all(pagePromises);
    for (const arr of pages) orders = orders.concat(arr);
  }
  return orders;
}

// Compute min / avg / median from an array of numbers
function stats(prices) {
  if (!prices.length) return { min: null, avg: null, median: null };
  const sorted = prices.slice().sort((a, b) => a - b);
  const min = sorted[0];
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = (sorted.length % 2 === 0) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { min, avg, median };
}

// Fetch PLEX ISK price via ESI (aggregated)
async function fetchPlexISK() {
  const region = validateInputs(); // throws if bad
  const orders = await fetchAllSellOrders(region, PLEX_TYPE);

  // Extract prices; filter out zero / invalid prices defensively
  const prices = orders
    .map(o => Number(o.price))
    .filter(p => Number.isFinite(p) && p > 0);

  if (!prices.length) {
    throw new Error('No valid sell prices returned by ESI (prices array is empty).');
  }

  const s = stats(prices);
  const source = SOURCE ? SOURCE.value : 'median';
  const pick = { min: s.min, avg: s.avg, median: s.median }[source];

  if (typeof pick !== 'number' || !isFinite(pick) || pick <= 0) {
    throw new Error('Price feed returned zero/invalid values after aggregation.');
  }

  plexISK = pick; // ISK per 1 PLEX
  if (LAST) LAST.textContent = `PLEX ${source} from ESI (${orders.length} sell orders) — ${new Date().toLocaleString()}`;
}

// Compute table rows
function computeRows() {
  if (!packs.length) {
    TBODY.innerHTML = '<tr><td colspan="6" class="muted">No packs loaded.</td></tr>';
    return;
  }
  if (!plexISK) {
    TBODY.innerHTML = '<tr><td colspan="6" class="muted">Waiting for PLEX price…</td></tr>';
    return;
  }

  const rows = packs.map(p => {
    const price = p.sale_price_usd ?? p.price_usd;
    const perPLEX = price / p.plex_amount;
    const cashPerISK = price / (p.plex_amount * plexISK);
    return { ...p, price, perPLEX, cashPerISK };
  });

  // Find best values
  const bestPerPLEX = Math.min(...rows.map(r => r.perPLEX));
  const bestCashPerISK = Math.min(...rows.map(r => r.cashPerISK));

  TBODY.innerHTML = rows.map(r => {
    const isBestA = Math.abs(r.perPLEX - bestPerPLEX) < 1e-12;
    const isBestB = Math.abs(r.cashPerISK - bestCashPerISK) < 1e-12;
    const bestClass = (isBestA || isBestB) ? ' class="highlight"' : '';
    return `<tr${bestClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      <td class="num">$${fmt(r.perPLEX, 4)} ${isBestA ? ' <span class="pill best">Best</span>' : ''}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num">$${fmt(r.cashPerISK, 9)} ${isBestB ? ' <span class="pill best">Best</span>' : ''}</td>
    </tr>`;
  }).join('');
}

// Master refresh
async function refresh() {
  showStatus('Loading…');
  try {
    await loadPacks();     // reads packs.json
    await fetchPlexISK();  // pulls ESI orders, computes min/avg/median
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

// Wire up events
const refreshBtn = document.getElementById('refresh');
if (refreshBtn) refreshBtn.addEventListener('click', refresh);
if (REGION) REGION.addEventListener('change', refresh);
if (SOURCE) SOURCE.addEventListener('change', refresh);

// Auto-run on load
refresh();
