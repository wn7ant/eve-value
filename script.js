// EVE Value Calculator — ESI (GitHub Pages friendly)
// - Cash packs: packs.json (you maintain)
// - PLEX→ISK from ESI sell orders in a chosen region
// - Supports Min / Median / Avg from the fetched order prices

// ---------- DOM ----------
const TABLE = document.getElementById('valueTable');
const TBODY = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR = document.getElementById('year');
const LAST = document.getElementById('lastUpdate');

const REGION = document.getElementById('region');       // select with numeric region id
const SOURCE = document.getElementById('plexSource');   // select: 'min' | 'median' | 'avg'
const REFRESH_BTN = document.getElementById('refresh');

if (YEAR) YEAR.textContent = new Date().getFullYear();

// ---------- Config ----------
const ESI_BASE = 'https://esi.evetech.net/latest';
const PLEX_TYPE = 44992;
const MAX_ESI_PAGES = 20; // safety cap

// ---------- State ----------
let packs = [];
let plexISK = null; // computed ISK per 1 PLEX

// ---------- Utils ----------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  if (!TBODY) return;
  const row = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
  TBODY.innerHTML = row;
}

function validateInputs() {
  const regionVal = REGION && REGION.value ? REGION.value : '10000002'; // default if missing
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  const sourceVal = SOURCE && SOURCE.value ? SOURCE.value : 'median';
  if (!['median', 'avg', 'min'].includes(sourceVal)) {
    throw new Error(`Unknown plexSource "${sourceVal}"`);
  }
  return { regionId: Number(regionVal), source: sourceVal };
}

function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function average(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ---------- Data loaders ----------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

/**
 * Fetch all sell order pages for PLEX in a region and compute a price
 * according to the selected source (min/median/avg).
 */
async function fetchPlexISKFromESI() {
  const { regionId, source } = validateInputs();

  // First page to read X-Pages
  const firstURL = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${PLEX_TYPE}&page=1`;
  const firstRes = await fetch(firstURL, { cache: 'no-store' });
  if (!firstRes.ok) throw new Error(`ESI HTTP ${firstRes.status} on page 1`);

  const totalPagesHeader = firstRes.headers.get('X-Pages');
  const totalPages = Math.min(Number(totalPagesHeader) || 1, MAX_ESI_PAGES);

  let prices = [];
  const firstData = await firstRes.json();
  prices.push(...(firstData || []).map(o => Number(o.price)).filter(Number.isFinite));

  // Subsequent pages (if any)
  const fetches = [];
  for (let p = 2; p <= totalPages; p++) {
    const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${PLEX_TYPE}&page=${p}`;
    fetches.push(fetch(url, { cache: 'no-store' }).then(async r => {
      if (!r.ok) throw new Error(`ESI HTTP ${r.status} on page ${p}`);
      const data = await r.json();
      return (data || []).map(o => Number(o.price)).filter(Number.isFinite);
    }));
  }
  if (fetches.length) {
    const results = await Promise.all(fetches);
    results.forEach(arr => prices.push(...arr));
  }

  // Guard: empty or all zeros
  prices = prices.filter(v => v > 0);
  if (prices.length === 0) {
    throw new Error('ESI returned no positive sell prices for PLEX in this region.');
  }

  let val;
  if (source === 'min') {
    val = Math.min(...prices);
  } else if (source === 'avg') {
    val = average(prices);
  } else {
    val = median(prices);
  }

  if (!Number.isFinite(val)) {
    throw new Error(`Failed to compute ${source} from ESI prices.`);
  }

  plexISK = val; // ISK per 1 PLEX
  if (LAST) LAST.textContent = `PLEX sell ${source} via ESI @ ${new Date().toLocaleString()}`;
}

// ---------- Table render ----------
function computeRows() {
  if (!TBODY) return;
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

// ---------- Orchestration ----------
async function refresh() {
  showStatus('Loading…');
  try {
    await loadPacks();
    await fetchPlexISKFromESI();
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

if (REFRESH_BTN) {
  REFRESH_BTN.addEventListener('click', refresh);
}

// Auto-run on load
refresh();
