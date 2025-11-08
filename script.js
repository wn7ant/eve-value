// EVE Value Calculator (static, no backend)
// Cash packs: packs.json (you maintain)
// PLEX→ISK: Fuzzwork aggregates first; fallback to ESI sell orders if Fuzzwork returns zeros
// Works on GitHub Pages / any static host. For local testing, avoid file:// (use a tiny local server).

const TABLE = document.getElementById('valueTable');
const TBODY = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR = document.getElementById('year');
const LAST = document.getElementById('lastUpdate');
const REGION = document.getElementById('region');
const SOURCE = document.getElementById('plexSource');

YEAR && (YEAR.textContent = new Date().getFullYear());

const FUZZWORK_BASE = 'https://market.fuzzwork.co.uk/aggregates/';
const ESI_BASE = 'https://esi.evetech.net/latest';
const PLEX_TYPE = 44992; // PLEX
let packs = [];
let plexISK = null; // ISK per PLEX (sell side)

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  const row = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
  TBODY.innerHTML = row;
  console[(isError ? 'error' : 'log')](msg);
}

function isLocalFile() {
  return location.protocol === 'file:';
}

// Simple HEAD probe (optional, mainly to give better local-file tips)
async function netProbe() {
  try {
    const res = await fetch(FUZZWORK_BASE, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

function validateInputs() {
  const regionVal = REGION.value;
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  if (!['median', 'avg', 'min'].includes(SOURCE.value)) {
    throw new Error(`Unknown plexSource "${SOURCE.value}"`);
  }
  return Number(regionVal);
}

async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

function extractFromFuzzwork(obj, sourceKey) {
  // obj shape: { "44992": { sell: { median, avg, min, ... }, buy: { ... } } }
  const node = obj && obj[String(PLEX_TYPE)];
  if (!node || !node.sell) return null;
  const { sell } = node;

  // Normalize field names we care about
  const map = {
    median: sell.median,
    avg: sell.avg ?? sell.weightedAverage, // sometimes "avg" may not exist; try weightedAverage
    min: sell.min
  };

  const val = map[sourceKey];
  // Fuzzwork may return 0s during outages; treat 0 as invalid
  if (typeof val !== 'number' || !isFinite(val) || val <= 0) return null;
  return { median: map.median, avg: map.avg, min: map.min };
}

// Fetch from Fuzzwork aggregates
async function tryFuzzwork(region, sourceKey) {
  const url = `${FUZZWORK_BASE}?region=${encodeURIComponent(region)}&types=${PLEX_TYPE}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fuzzwork HTTP ${res.status}`);
  const data = await res.json();
  const vals = extractFromFuzzwork(data, sourceKey);
  if (!vals) return null;
  const chosen = sourceKey === 'avg' ? vals.avg : sourceKey === 'min' ? vals.min : vals.median;
  if (typeof chosen !== 'number' || !isFinite(chosen) || chosen <= 0) return null;
  return { chosen, all: vals, source: 'Fuzzwork' };
}

// Fetch sell orders from ESI and compute stats
async function fetchAllEsiSellOrders(region, typeId, maxPages = 4) {
  // ESI uses pagination via X-Pages header; fetch up to maxPages for speed
  const firstURL = `${ESI_BASE}/markets/${region}/orders/?order_type=sell&type_id=${typeId}&datasource=tranquility&page=1`;
  const firstRes = await fetch(firstURL, { cache: 'no-store' });
  if (!firstRes.ok) throw new Error(`ESI HTTP ${firstRes.status}`);
  const totalPages = Number(firstRes.headers.get('X-Pages')) || 1;
  const first = await firstRes.json();

  const pagesToGet = Math.min(totalPages, maxPages);
  const promises = [];
  for (let p = 2; p <= pagesToGet; p++) {
    const url = `${ESI_BASE}/markets/${region}/orders/?order_type=sell&type_id=${typeId}&datasource=tranquility&page=${p}`;
    promises.push(fetch(url, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`ESI HTTP ${r.status} on page ${p}`);
      return r.json();
    }));
  }
  const rest = (await Promise.all(promises).catch(e => { console.error(e); return []; })).flat();
  return first.concat(rest);
}

function statsFromPrices(prices) {
  if (!prices.length) return null;
  const sorted = prices.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const avg = sorted.reduce((a, b) => a + b, 0) / n;
  const min = sorted[0];
  return { median, avg, min };
}

async function tryEsi(region, sourceKey) {
  const orders = await fetchAllEsiSellOrders(region, PLEX_TYPE, 4);
  const prices = orders
    .map(o => o.price)
    .filter(x => typeof x === 'number' && isFinite(x) && x > 0);

  const s = statsFromPrices(prices);
  if (!s) return null;
  const chosen = sourceKey === 'avg' ? s.avg : sourceKey === 'min' ? s.min : s.median;
  return { chosen, all: s, source: 'ESI' };
}

async function fetchPlexISK() {
  const region = validateInputs(); // throws if bad
  const sourceKey = SOURCE.value;  // 'median' | 'avg' | 'min'

  // Give a helpful tip if running locally via file:// (many browsers block cross-origin fetch)
  if (isLocalFile()) {
    const ok = await netProbe();
    if (!ok) {
      throw new Error(`Running from file:// and cross-origin fetch appears blocked by the browser.\n\nStart a tiny local server and reload:\n\n  python3 -m http.server\n\nThen visit http://localhost:8000/`);
    }
  }

  // 1) Try Fuzzwork
  try {
    const fw = await tryFuzzwork(region, sourceKey);
    if (fw && typeof fw.chosen === 'number' && isFinite(fw.chosen) && fw.chosen > 0) {
      plexISK = fw.chosen;
      LAST && (LAST.textContent = `PLEX sell ${sourceKey} via ${fw.source}: ${new Date().toLocaleString()}`);
      return;
    }
  } catch (e) {
    console.warn('Fuzzwork failed:', e.message);
  }

  // 2) Fallback to ESI
  const esi = await tryEsi(region, sourceKey);
  if (!esi || !(typeof esi.chosen === 'number' && isFinite(esi.chosen) && esi.chosen > 0)) {
    throw new Error('Unable to determine PLEX sell price from Fuzzwork or ESI.');
  }

  plexISK = esi.chosen;
  LAST && (LAST.textContent = `PLEX sell ${sourceKey} via ${esi.source}: ${new Date().toLocaleString()}`);
}

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

async function refresh() {
  showStatus('Loading…');
  try {
    await loadPacks();     // reads packs.json
    await fetchPlexISK();  // Fuzzwork or ESI fallback
    computeRows();         // render
  } catch (e) {
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-refresh on load
refresh();
