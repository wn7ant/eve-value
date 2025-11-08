// script.js — ESI-only version (no Fuzzwork), handles pagination + median
// Requires: index.html has elements with IDs: valueTable, tableBody, packsPreview, year, lastUpdate, region, plexSource, refresh
// packs.json sits next to this file (same folder).

const TABLE = document.getElementById('valueTable');
const TBODY = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR = document.getElementById('year');
const LAST = document.getElementById('lastUpdate');
const REGION = document.getElementById('region');
const SOURCE = document.getElementById('plexSource'); // uses label but value decides how we aggregate
YEAR && (YEAR.textContent = new Date().getFullYear());

// ESI markets (official)
const ESI = 'https://esi.evetech.net/latest/markets';
const PLEX_TYPE = 44992; // PLEX
let packs = [];
let plexISK = null; // ISK per 1 PLEX (derived from sell orders)

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
  if (!Array.isArray(packs) || packs.length === 0) {
    throw new Error('packs.json is empty or not an array.');
  }
}

function numericRegion() {
  const r = REGION ? REGION.value : '10000002';
  if (!/^\d+$/.test(r)) throw new Error(`Region must be numeric (got "${r}")`);
  return Number(r);
}

// Median helper
function median(arr) {
  if (!arr.length) return NaN;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Fetch all pages of sell orders for PLEX from ESI
async function fetchPlexISK_ESI() {
  const region = numericRegion();
  // First request to learn X-Pages
  const base = `${ESI}/${region}/orders/?order_type=sell&type_id=${PLEX_TYPE}`;
  const firstRes = await fetch(base, { cache: 'no-store' });

  if (!firstRes.ok) {
    throw new Error(`ESI orders failed (HTTP ${firstRes.status})`);
  }

  const pagesHeader = firstRes.headers.get('X-Pages');
  const totalPages = Math.max(1, Number(pagesHeader || 1));
  const firstData = await firstRes.json();

  let prices = (Array.isArray(firstData) ? firstData : [])
    .map(o => Number(o.price))
    .filter(v => Number.isFinite(v) && v > 0);

  // Pull the rest (if any)
  const fetches = [];
  for (let p = 2; p <= totalPages; p++) {
    const url = `${base}&page=${p}`;
    fetches.push(fetch(url, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`ESI page ${p} failed (HTTP ${r.status})`);
      return r.json();
    }).then(list => {
      const more = list
        .map(o => Number(o.price))
        .filter(v => Number.isFinite(v) && v > 0);
      prices.push(...more);
    }));
  }

  if (fetches.length) {
    await Promise.all(fetches);
  }

  if (!prices.length) {
    throw new Error('No valid sell prices returned by ESI (prices array is empty).');
  }

  // Choose aggregation based on plexSource: median | avg | min
  const agg = (SOURCE && SOURCE.value) || 'median';
  let value;
  if (agg === 'min') {
    value = Math.min(...prices);
  } else if (agg === 'avg') {
    value = prices.reduce((a, b) => a + b, 0) / prices.length;
  } else {
    value = median(prices);
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Price feed returned zero or invalid value after aggregation.');
  }

  plexISK = value;
  if (LAST) {
    LAST.textContent = `ESI sell ${agg} fetched: ${new Date().toLocaleString()} (orders: ${prices.length}, pages: ${totalPages})`;
  }
}

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
    await loadPacks();
    await fetchPlexISK_ESI();
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run
refresh();
