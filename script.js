// EVE Value Calculator — static, GitHub Pages friendly
// Sources (in order):
// 1) CUSTOM_SOURCE_URL (you paste a working JSON endpoint)
//    - If it's an orders array: uses item.price
//    - If it's ESI /markets/prices: uses average_price for type_id 44992
// 2) ESI Jita orders (page 1) for PLEX
// 3) Adam4Eve market_prices fallback
//
// Manual override: in console -> window.setManualPLEX(iskPerPLEX)

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');      // UI-only
const SOURCE  = document.getElementById('plexSource');   // 'median' | 'avg' | 'min'
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
// PASTE YOUR working JSON URL HERE. It must be HTTPS and CORS-allowed.
// If it's an orders array, each object must have a numeric .price.
// If it's ESI /markets/prices, we’ll pick the entry with type_id === 44992.
const CUSTOM_SOURCE_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';

// Aggregation for orders arrays: 'median' | 'avg' | 'min'
const CUSTOM_AGGREGATION = 'median';

// Constants
const TYPE_PLEX = 44992;
const A4E_BASE  = 'https://api.adam4eve.eu/v1';

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per PLEX

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function median(nums) {
  if (!nums.length) return NaN;
  const v = nums.slice().sort((a,b)=>a-b);
  const mid = Math.floor(v.length/2);
  return v.length % 2 ? v[mid] : (v[mid-1]+v[mid])/2;
}

function average(nums) {
  if (!nums.length) return NaN;
  return nums.reduce((a,b)=>a+b,0)/nums.length;
}

function pickAggregation(prices, mode) {
  if (!prices.length) return NaN;
  switch (mode) {
    case 'min':   return Math.min(...prices);
    case 'avg':   return average(prices);
    case 'median':
    default:      return median(prices);
  }
}

function uiAgg() {
  const v = SOURCE && ['median','avg','min'].includes(SOURCE.value) ? SOURCE.value : CUSTOM_AGGREGATION;
  return v;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// Detect & parse common shapes
function parseOrdersArray(arr) {
  const prices = arr
    .map(o => Number(o && o.price))
    .filter(x => Number.isFinite(x) && x > 0);
  if (!prices.length) throw new Error('No valid .price values in orders array.');
  return pickAggregation(prices, uiAgg());
}

function parseMarketsPricesArray(arr) {
  // ESI /markets/prices returns objects with {type_id, average_price, adjusted_price}
  const row = arr.find(o => Number(o.type_id) === TYPE_PLEX);
  if (!row) throw new Error('ESI /markets/prices did not include PLEX (type_id 44992).');
  const avg = Number(row.average_price);
  if (!Number.isFinite(avg) || avg <= 0) throw new Error('ESI /markets/prices has no positive average_price for PLEX.');
  return avg;
}

// 1) Custom source (orders array OR ESI markets/prices array)
async function fetchPLEXfromCustom() {
  if (!CUSTOM_SOURCE_URL || CUSTOM_SOURCE_URL.startsWith('<<')) {
    throw new Error('CUSTOM_SOURCE_URL is not set in script.js.');
  }
  const res = await fetch(CUSTOM_SOURCE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Custom source HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Custom source did not return a JSON array.');

  // Try orders-array shape first (.price)
  let v = NaN;
  try { v = parseOrdersArray(data); } catch { /* ignore, try prices shape */ }
  if (!Number.isFinite(v) || v <= 0) {
    // Try ESI /markets/prices shape (average_price)
    v = parseMarketsPricesArray(data);
  }
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error('Custom source produced no usable price.');
  }
  plexISK = v;
  LAST && (LAST.textContent = `PLEX via Custom Source (${uiAgg()} or avg): ${fmt(v,0)} ISK @ ${new Date().toLocaleString()}`);
}

// 2) ESI Jita (The Forge) orders page 1 – light, safe for front-end
async function fetchPLEXfromESI() {
  const url = 'https://esi.evetech.net/latest/markets/10000002/orders/?order_type=sell&type_id=44992&datasource=tranquility&page=1';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('No valid sell prices returned by ESI (prices array is empty).');
  const price = parseOrdersArray(arr);
  plexISK = price;
  LAST && (LAST.textContent = `PLEX via ESI (Jita page 1, ${uiAgg()}): ${fmt(price,0)} ISK @ ${new Date().toLocaleString()}`);
}

// 3) Adam4Eve fallback (lowest sell)
async function fetchPLEXfromA4E() {
  const url = `${A4E_BASE}/market_prices?locationID=10000002&typeID=${TYPE_PLEX}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Adam4Eve HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('Adam4Eve returned empty array.');
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX) || data[0];
  const sell = Number(row.sell_price);
  if (!isFinite(sell) || sell <= 0) throw new Error('Adam4Eve sell_price is missing or zero.');
  plexISK = sell;
  LAST && (LAST.textContent = `PLEX via Adam4Eve (lowest sell): ${fmt(sell,0)} ISK @ ${new Date().toLocaleString()}`);
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
    const bestPillA = isBestA ? '<span class="pill best">Best</span> ' : '';
    const bestPillB = isBestB ? '<span class="pill best">Best</span> ' : '';
    return `<tr${bestClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      <td class="num">${bestPillA}$${fmt(r.perPLEX, 4)}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num">${bestPillB}$${fmt(r.cashPerISK, 9)}</td>
    </tr>`;
  }).join('');
}

// -------------------- Manual Override --------------------
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

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    await loadPacks();

    // Try custom first
    try {
      await fetchPLEXfromCustom();
    } catch (customErr) {
      console.warn('Custom source failed:', customErr?.message || customErr);
      try {
        await fetchPLEXfromESI(); // Jita page 1
      } catch (esiErr) {
        console.warn('ESI fallback failed:', esiErr?.message || esiErr);
        await fetchPLEXfromA4E(); // final fallback
      }
    }

    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();