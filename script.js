// EVE Value Calculator — GitHub Pages friendly, no backend
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: Adam4Eve market_prices (derived from ESI orderbooks)
//   Docs: https://api.adam4eve.eu/  (send a normal browser User-Agent)  [No auth; ~1 req/5s]

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');      // select; default 10000002 (The Forge)
const SOURCE  = document.getElementById('plexSource');   // median/avg/min (kept for UI consistency)
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Constants --------------------
const TYPE_PLEX = 44992;
const A4E_BASE  = 'https://api.adam4eve.eu/v1';

// -------------------- State --------------------
let packs = [];
let plexISK = null; // number (lowest sell or percentile sell), ISK per 1 PLEX

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function validateInputs() {
  // Region must be numeric (ESI/A4E use numeric region IDs)
  const regionVal = REGION ? REGION.value : '10000002';
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  // SOURCE kept for UI parity; for A4E we use lowest sell; SOURCE only affects the label text.
  if (SOURCE && !['median', 'avg', 'min'].includes(SOURCE.value)) {
    throw new Error(`Unknown plexSource "${SOURCE.value}"`);
  }
  return Number(regionVal);
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// Adam4Eve: lowest sell price (and volumes). Region defaults to The Forge (Jita).
// Endpoint shape: /v1/market_prices?locationID=<regionID>&typeID=<csv>
async function fetchPlexFromA4E(regionId) {
  const url = `${A4E_BASE}/market_prices?locationID=${encodeURIComponent(regionId)}&typeID=${TYPE_PLEX}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`A4E market_prices HTTP ${res.status}`);
  }
  const data = await res.json();
  // data is an array of objects for each typeID
  // Expect: [{ type_id, buy_price, sell_price, buy_volume, sell_volume, lupdate }]
  if (!Array.isArray(data) || !data.length) {
    throw new Error('A4E market_prices returned empty array.');
  }
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX) || data[0];
  const sell = Number(row.sell_price);
  if (!isFinite(sell) || sell <= 0) {
    throw new Error('A4E sell_price is missing or zero.');
  }
  plexISK = sell;
  const srcLabel = SOURCE ? SOURCE.value : 'lowest-sell';
  LAST && (LAST.textContent = `PLEX (${TYPE_PLEX}) lowest sell fetched ${new Date().toLocaleString()} via Adam4Eve; UI source=${srcLabel}`);
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
// Add a global function so you can do: window.setManualPLEX(5_400_000)
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
    const regionId = validateInputs();
    await loadPacks();
    await fetchPlexFromA4E(regionId);
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();
