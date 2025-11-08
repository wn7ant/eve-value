// EVE Value Calculator — ESI-only, GitHub Pages friendly (no backend)
//
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI orderbook (region sell orders, paginated)
//   Example endpoint:
//   https://esi.evetech.net/latest/markets/{region_id}/orders/?order_type=sell&datasource=tranquility&type_id=44992&page=1
//
// Notes:
// - Handles pagination via X-Pages header
// - Picks the *lowest* sell price > 0 (Jita/The Forge by default)
// - Clear, specific error messages shown in the table area
// - No python / local server required for GitHub Pages

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');      // select; default 10000002 (The Forge/Jita)
const SOURCE  = document.getElementById('plexSource');   // kept for UI parity only
const PREVIEW = document.getElementById('packsPreview');

if (YEAR) YEAR.textContent = new Date().getFullYear();

// -------------------- Constants --------------------
const TYPE_PLEX = 44992;
const ESI_BASE  = 'https://esi.evetech.net/latest';

// -------------------- State --------------------
let packs = [];
let plexISK = null; // number, ISK per 1 PLEX (lowest sell)

// -------------------- Helpers --------------------
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
  // Only used for label; pricing uses ESI lowest sell
  if (SOURCE && !['median', 'avg', 'min'].includes(SOURCE.value)) {
    throw new Error(`Unknown plexSource "${SOURCE.value}"`);
  }
  return Number(regionVal);
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  // Cache-bust to avoid aggressive proxy caching
  const res = await fetch('packs.json?cb=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// ESI: pull ALL sell orders for PLEX in a region, page through results,
// and compute the lowest sell price > 0
async function fetchPlexFromESI(regionId) {
  const base =
    `${ESI_BASE}/markets/${encodeURIComponent(regionId)}/orders/` +
    `?order_type=sell&datasource=tranquility&type_id=${TYPE_PLEX}`;

  // First request to learn how many pages there are
  const firstUrl = `${base}&page=1&cb=${Date.now()}`;
  const firstRes = await fetch(firstUrl, { cache: 'no-store', mode: 'cors' });
  if (!firstRes.ok) {
    throw new Error(`ESI HTTP ${firstRes.status} on page 1`);
  }

  const totalPages = Number(firstRes.headers.get('X-Pages')) || 1;
  let orders = await firstRes.json();
  if (!Array.isArray(orders)) orders = [];

  // If more pages, fetch them sequentially (keeps it simple/reliable on mobile)
  for (let p = 2; p <= totalPages; p++) {
    const url = `${base}&page=${p}&cb=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) {
      // If a page vanishes mid-fetch, just stop; we still have earlier data
      break;
    }
    const pageOrders = await res.json();
    if (Array.isArray(pageOrders) && pageOrders.length) {
      orders = orders.concat(pageOrders);
    }
  }

  // Extract valid sell prices (> 0)
  const prices = orders
    .map(o => Number(o.price))
    .filter(n => isFinite(n) && n > 0);

  if (!prices.length) {
    throw new Error('No valid sell prices returned by ESI (prices array is empty).');
  }

  // Lowest sell
  const lowest = Math.min(...prices);
  plexISK = lowest;

  const srcLabel = SOURCE ? SOURCE.value : 'lowest-sell';
  if (LAST) {
    LAST.textContent = `PLEX (${TYPE_PLEX}) lowest sell fetched ${new Date().toLocaleString()} via ESI (region ${regionId}); UI source=${srcLabel}`;
  }
}

// -------------------- Compute/Render --------------------
function computeRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

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

// -------------------- Manual Override (optional) --------------------
// In Safari’s console you can do: window.setManualPLEX(5400000)
window.setManualPLEX = function(iskPerPLEX) {
  const v = Number(iskPerPLEX);
  if (!isFinite(v) || v <= 0) {
    alert('Invalid manual ISK/PLEX value.');
    return;
  }
  plexISK = v;
  if (LAST) LAST.textContent = `Manual override: ISK/PLEX = ${fmt(v,0)} at ${new Date().toLocaleString()}`;
  computeRows();
};

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    const regionId = validateInputs();
    await loadPacks();             // loads packs.json
    await fetchPlexFromESI(regionId); // gets lowest sell from ESI
    computeRows();                 // renders the table
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();