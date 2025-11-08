// EVE Value Calculator — ESI-only version
// - Cash packs: packs.json (you maintain)
// - PLEX → ISK: ESI markets orders (sell) with pagination & 5th-percentile price
//
// DOM elements expected in index.html:
// - select#region (value is region_id, default 10000002 = The Forge)
// - button#refresh
// - table#valueTable > tbody#tableBody
// - small#lastUpdate
// - span#year
// - pre > code#packsPreview (optional preview of packs.json)

const TABLE = document.getElementById('valueTable');
const TBODY = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR = document.getElementById('year');
const LAST = document.getElementById('lastUpdate');
const REGION = document.getElementById('region');

if (YEAR) YEAR.textContent = new Date().getFullYear();

const ESI_BASE = 'https://esi.evetech.net/latest';
const PLEX_TYPE = 44992;           // PLEX type id
let packs = [];
let plexISK = null;                // ISK per 1 PLEX (from ESI)
let lastDiag = '';                 // diagnostics text

// ---------- Utilities ----------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  const row = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
  TBODY.innerHTML = row;
}

function validateInputs() {
  if (!REGION) return 10000002; // fallback to The Forge if missing in DOM
  const regionVal = REGION.value && REGION.value.trim();
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  return Number(regionVal);
}

// Robust percentile (p in [0,1]); returns a number or null
function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  if (p <= 0) return a[0];
  if (p >= 1) return a[a.length - 1];
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const w = idx - lo;
  return a[lo] * (1 - w) + a[hi] * w;
}

// ---------- Data loaders ----------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json fetch failed (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// Fetch ALL sell orders for PLEX in a region, handling pagination
async function fetchESISellPrices(regionId) {
  // First page to read X-Pages
  const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${PLEX_TYPE}&page=1`;
  const first = await fetch(url, { cache: 'no-store' });
  if (!first.ok) throw new Error(`ESI orders fetch failed (HTTP ${first.status})`);

  const pages = Number(first.headers.get('X-Pages')) || 1;
  let prices = [];

  const firstData = await first.json();
  // Each entry: { price, is_buy_order:false, type_id, location_id, volume_remain, ... }
  prices.push(...firstData.map(o => Number(o.price)).filter(v => isFinite(v) && v > 0));

  if (pages > 1) {
    const promises = [];
    for (let p = 2; p <= pages; p++) {
      const purl = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${PLEX_TYPE}&page=${p}`;
      promises.push(fetch(purl, { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(`ESI page ${p} failed (HTTP ${r.status})`);
        return r.json();
      }));
    }
    const all = await Promise.all(promises);
    for (const arr of all) {
      prices.push(...arr.map(o => Number(o.price)).filter(v => isFinite(v) && v > 0));
    }
  }

  return prices;
}

// Decide on a representative ISK-per-PLEX from sell orders.
// We use the 5th percentile of sell prices to avoid a single super-cheap outlier.
function representativeSellPrice(prices) {
  if (!prices.length) return null;
  // Require at least 10 orders before using percentile; otherwise use median
  if (prices.length >= 10) {
    return percentile(prices, 0.05);
  }
  return percentile(prices, 0.5); // median for very small samples
}

// ---------- Rendering ----------
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

// ---------- Orchestrator ----------
async function refresh() {
  showStatus('Loading…');
  try {
    const regionId = validateInputs();

    // Load packs and fetch ESI orders
    await loadPacks();
    const prices = await fetchESISellPrices(regionId);

    if (!prices.length) {
      throw new Error('No valid sell prices returned by ESI (prices array is empty).');
    }

    const min = Math.min(...prices);
    const med = percentile(prices, 0.5);
    const p05 = representativeSellPrice(prices);

    plexISK = p05;
    lastDiag = `ESI sell orders: n=${prices.length} | min=${fmt(min,2)} | median=${fmt(med,2)} | p5=${fmt(p05,2)} (ISK/PLEX) | region=${regionId}`;
    if (LAST) LAST.textContent = `${lastDiag} — ${new Date().toLocaleString()}`;

    if (!isFinite(plexISK) || plexISK <= 0) {
      throw new Error('Price feed returned zero or non-finite value after processing.');
    }

    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
    if (LAST) LAST.textContent = `Failed: ${e.message} — ${new Date().toLocaleString()}`;
  }
}

// Events
const REFRESH_BTN = document.getElementById('refresh');
if (REFRESH_BTN) REFRESH_BTN.addEventListener('click', refresh);
if (REGION) REGION.addEventListener('change', refresh);

// Initial load
refresh();
