// EVE Value Calculator — static, GitHub Pages friendly
// Primary source: CUSTOM JSON orders endpoint that returns sell orders with "price"
//   -> Paste your working URL into CUSTOM_SOURCE_URL below.
// Fallback: Adam4Eve market_prices (derived from ESI)
// Manual override: window.setManualPLEX(iskPerPLEX)

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');      // UI only; not required by custom source
const SOURCE  = document.getElementById('plexSource');   // 'median' | 'avg' | 'min' (used as aggregation hint)
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
// 1) PASTE YOUR WORKING ORDERS URL HERE (must return a JSON array of objects with a "price" field)
const CUSTOM_SOURCE_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';

// How to aggregate sell prices from the custom orders array.
// Options: 'median' | 'avg' | 'min' (lowest)
const CUSTOM_AGGREGATION = 'median';

// Adam4Eve fallback (no auth, normal browser UA)
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
  // Use UI selector if present; else use CUSTOM_AGGREGATION default
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

// Parse a generic orders array (objects with a numeric "price" field).
function parseOrdersArray(arr) {
  // Filter only valid numeric prices and positive volumes, if present
  const sellPrices = arr
    .filter(o => o && typeof o.price !== 'undefined' && isFinite(Number(o.price)))
    .map(o => Number(o.price))
    .filter(p => p > 0);

  if (!sellPrices.length) {
    throw new Error('No valid sell prices returned by custom source (prices array is empty).');
  }

  // Aggregate
  const chosen = pickAggregation(sellPrices, uiAgg());
  if (!isFinite(chosen) || chosen <= 0) {
    throw new Error('Custom source aggregation produced an invalid value.');
  }
  return chosen;
}

// Primary: fetch from your custom JSON orders endpoint
async function fetchPLEXfromCustom() {
  if (!CUSTOM_SOURCE_URL || CUSTOM_SOURCE_URL.startsWith('<<')) {
    throw new Error('CUSTOM_SOURCE_URL is not set. Paste your working URL into script.js.');
  }
  const res = await fetch(CUSTOM_SOURCE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Custom source HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Custom source did not return a JSON array.');
  }
  const price = parseOrdersArray(data);
  plexISK = price;
  LAST && (LAST.textContent = `PLEX via Custom Source (${uiAgg()}): ${new Date().toLocaleString()}`);
}

// Fallback: Adam4Eve lowest sell
async function fetchPLEXfromA4E(regionId) {
  // regionId not strictly required for A4E as we can pass locationID
  const url = `${A4E_BASE}/market_prices?locationID=${encodeURIComponent(regionId || '10000002')}&typeID=${TYPE_PLEX}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Adam4Eve HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('Adam4Eve returned empty array.');
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX) || data[0];
  const sell = Number(row.sell_price);
  if (!isFinite(sell) || sell <= 0) throw new Error('Adam4Eve sell_price is missing or zero.');
  plexISK = sell;
  LAST && (LAST.textContent = `PLEX via Adam4Eve (lowest sell): ${new Date().toLocaleString()}`);
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

    // Try your custom source first
    try {
      await fetchPLEXfromCustom();
    } catch (customErr) {
      console.warn('Custom source failed:', customErr);
      // Fallback to Adam4Eve
      const fallbackRegion = (REGION && /^\d+$/.test(REGION.value)) ? REGION.value : '10000002';
      await fetchPLEXfromA4E(fallbackRegion);
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