// EVE Value Calculator — ESI-only (GitHub Pages friendly, no backend)
// Data sources (in order):
// 1) ESI orders: lowest SELL price for PLEX in selected region (paginated)
// 2) ESI market history: latest day's average price (fallback)
// 3) Manual override: window.setManualPLEX(iskPerPLEX)
//
// Notes:
// - Region selector uses numeric region IDs (e.g., 10000002 = The Forge/Jita)
// - type_id for PLEX = 44992
// - Works when hosted (GitHub Pages/Netlify/etc.). If you open index.html as file://
//   the browser may block fetches; test via your hosted URL.

const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');      // select; default 10000002
const SOURCE  = document.getElementById('plexSource');   // kept for UI label
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

const TYPE_PLEX = 44992;
const ESI_BASE  = 'https://esi.evetech.net/latest';

let packs = [];
let plexISK = null;

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function validateInputs() {
  const regionVal = REGION ? REGION.value : '10000002';
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  if (SOURCE && !['median', 'avg', 'min'].includes(SOURCE.value)) {
    // Only affects label; computations use lowest sell from ESI
    throw new Error(`Unknown plexSource "${SOURCE.value}"`);
  }
  return Number(regionVal);
}

async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// ---------- ESI helpers ----------
async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return { data: await res.json(), headers: res.headers };
}

// Pull SELL orders for PLEX in the region, across pages. Return lowest price.
async function fetchPlexFromESIOrders(regionId) {
  const base = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${TYPE_PLEX}`;
  // First page to discover pagination
  const { data: page1, headers } = await fetchJSON(`${base}&page=1`);
  if (!Array.isArray(page1)) throw new Error('ESI orders response malformed.');

  // Collect prices from page 1
  let prices = page1.filter(o => o && o.price > 0).map(o => Number(o.price));

  // How many pages?
  const totalPages = Number(headers.get('X-Pages')) || 1;

  // Fetch remaining pages (cap to protect the browser; PLEX usually small)
  const maxPages = Math.min(totalPages, 10);
  const promises = [];
  for (let p = 2; p <= maxPages; p++) {
    promises.push(fetchJSON(`${base}&page=${p}`).then(({ data }) => {
      if (Array.isArray(data)) {
        for (const o of data) {
          if (o && o.price > 0) prices.push(Number(o.price));
        }
      }
    }));
  }
  if (promises.length) await Promise.all(promises);

  // Keep only finite positive numbers
  prices = prices.filter(v => isFinite(v) && v > 0);
  if (!prices.length) throw new Error('No valid sell prices returned by ESI (prices array is empty).');

  const lowest = Math.min(...prices);
  plexISK = lowest;
  LAST && (LAST.textContent = `PLEX lowest SELL from ESI orders @ region ${regionId} at ${new Date().toLocaleString()}`);
}

// Fallback: daily history (latest candle’s average) for PLEX in the region
async function fetchPlexFromESIHistory(regionId) {
  const url = `${ESI_BASE}/markets/${regionId}/history/?type_id=${TYPE_PLEX}`;
  const { data } = await fetchJSON(url);
  if (!Array.isArray(data) || !data.length) throw new Error('ESI history returned empty array.');
  const last = data[data.length - 1];
  const avg = Number(last.average);
  if (!isFinite(avg) || avg <= 0) throw new Error('ESI history average is missing or zero.');
  plexISK = avg;
  LAST && (LAST.textContent = `PLEX latest daily average from ESI history @ region ${regionId} at ${new Date().toLocaleString()}`);
}

// ---------- Compute / Render ----------
function computeRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK)      { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    const cashPerISK = price / (p.plex_amount * plexISK);
    return { ...p, price, perPLEX, cashPerISK };
  });

  const bestPerPLEX    = Math.min(...rows.map(r => r.perPLEX));
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

// Manual override: in the console run window.setManualPLEX(5400000)
window.setManualPLEX = function(iskPerPLEX) {
  const v = Number(iskPerPLEX);
  if (!isFinite(v) || v <= 0) {
    alert('Invalid manual ISK/PLEX value.');
    return;
  }
  plexISK = v;
  LAST && (LAST.textContent = `Manual override: ISK/PLEX = ${fmt(v,0)} at ${new Date().toLocaleString()}`);
  computeRows();
};

// ---------- Refresh flow ----------
async function refresh() {
  try {
    showStatus('Loading…');
    const regionId = validateInputs();
    await loadPacks();
    try {
      // Primary: orderbook lowest sell
      await fetchPlexFromESIOrders(regionId);
    } catch (e1) {
      console.warn('ESI orders failed; falling back to history', e1);
      // Fallback: daily history avg
      await fetchPlexFromESIHistory(regionId);
    }
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);
refresh(); // auto-run