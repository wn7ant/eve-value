// EVE Value Calculator — ESI version (drop-in replacement)
// - Cash packs: packs.json (you maintain)
// - PLEX→ISK: ESI sell orders for PLEX (type_id 44992) by region with pagination

const TABLE = document.getElementById('valueTable');
const TBODY = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR = document.getElementById('year');
const LAST = document.getElementById('lastUpdate');
const REGION = document.getElementById('region');
const SOURCE = document.getElementById('plexSource');

if (YEAR) YEAR.textContent = new Date().getFullYear();

const ESI_BASE = 'https://esi.evetech.net/latest';
const PLEX_TYPE = 44992; // PLEX

let packs = [];
let plexISK = null; // ISK per 1 PLEX (derived from chosen sell metric)

// ---------- utilities ----------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  const row = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
  TBODY.innerHTML = row;
}

function validateInputs() {
  const regionVal = REGION?.value ?? '';
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  const src = SOURCE?.value ?? 'median';
  if (!['median', 'avg', 'min'].includes(src)) {
    throw new Error(`Unknown plexSource "${src}"`);
  }
  return { region: Number(regionVal), source: src };
}

function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function average(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ---------- data loaders ----------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

async function fetchAllSellOrders(regionId, typeId) {
  // ESI markets: GET /markets/{region_id}/orders/?order_type=sell&type_id=...
  const firstURL = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}`;
  const first = await fetch(firstURL, { cache: 'no-store' });
  if (!first.ok) throw new Error(`ESI orders page 1 failed (HTTP ${first.status})`);

  const pagesStr = first.headers.get('X-Pages') || first.headers.get('x-pages') || '1';
  const totalPages = Math.max(1, parseInt(pagesStr, 10) || 1);
  const orders = await first.json();

  if (totalPages === 1) return orders;

  // Fetch remaining pages sequentially to respect rate limits (still fast enough)
  for (let p = 2; p <= totalPages; p++) {
    const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=${p}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`ESI orders page ${p} failed (HTTP ${res.status})`);
    const pageOrders = await res.json();
    orders.push(...pageOrders);
  }
  return orders;
}

async function fetchPlexISK_ESI() {
  const { region, source } = validateInputs();

  const orders = await fetchAllSellOrders(region, PLEX_TYPE);

  // Extract numeric prices from active sell orders
  const prices = orders
    .map(o => Number(o.price))
    .filter(v => Number.isFinite(v) && v > 0);

  if (!prices.length) {
    throw new Error(
      'Price feed returned zero orders/prices. ' +
      'Tip: use region 10000002 (The Forge) for Jita.'
    );
  }

  const m = median(prices);
  const avg = average(prices);
  const minP = Math.min(...prices);

  const bySource = { median: m, avg, min: minP };
  const chosen = bySource[source];

  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('Computed PLEX price was invalid.');
  }

  plexISK = chosen; // ISK per 1 PLEX
  if (LAST) LAST.textContent = `PLEX sell ${source} via ESI @ ${new Date().toLocaleString()}`;
}

// ---------- render ----------
function computeRows() {
  if (!packs.length) {
    showStatus('No packs loaded.');
    return;
  }
  if (!plexISK) {
    showStatus('Waiting for PLEX price…');
    return;
  }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
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

// ---------- control flow ----------
async function refresh() {
  showStatus('Loading…');
  try {
    await loadPacks();     // reads packs.json
    await fetchPlexISK_ESI(); // fetches PLEX price via ESI
    computeRows();         // renders table
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load (works fine on GitHub Pages)
refresh();
