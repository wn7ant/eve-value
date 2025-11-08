// EVE Value Calculator — static, GitHub Pages friendly (ESI-based)
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI region orders (The Forge = 10000002), type_id=44992, lowest sell across all pages

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');      // select; default 10000002 (The Forge)
const SOURCE  = document.getElementById('plexSource');   // kept for UI continuity; not used in ESI calc
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Constants --------------------
const TYPE_PLEX = 44992;
const DEFAULT_REGION = 10000002; // The Forge (Jita)
const ESI_BASE = 'https://esi.evetech.net/latest';

// -------------------- State --------------------
let packs = [];
let plexISK = null; // number, ISK per 1 PLEX (lowest region sell)

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function validateInputs() {
  const regionVal = (REGION && REGION.value) ? REGION.value : String(DEFAULT_REGION);
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be numeric (got "${regionVal}")`);
  }
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

// Fetch all pages of region sell orders for PLEX and return the lowest sell price.
async function fetchPlexFromESI(regionId) {
  // First request: get X-Pages
  const firstURL = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${TYPE_PLEX}&page=1`;
  const firstRes = await fetch(firstURL, { cache: 'no-store', mode: 'cors', headers: { 'Accept': 'application/json' } });
  if (!firstRes.ok) throw new Error(`ESI HTTP ${firstRes.status} on page 1`);
  const pages = Number(firstRes.headers.get('X-Pages')) || 1;

  let prices = [];
  const page1Data = await firstRes.json();
  if (Array.isArray(page1Data)) {
    for (const o of page1Data) if (!o.is_buy_order && o.price > 0) prices.push(Number(o.price));
  }

  // Fetch remaining pages (cap to a sane max to avoid abuse)
  const maxPages = Math.min(pages, 10);
  const fetches = [];
  for (let p = 2; p <= maxPages; p++) {
    const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${TYPE_PLEX}&page=${p}`;
    fetches.push(fetch(url, { cache: 'no-store', mode: 'cors', headers: { 'Accept': 'application/json' } })
      .then(r => {
        if (!r.ok) throw new Error(`ESI HTTP ${r.status} on page ${p}`);
        return r.json();
      })
      .then(arr => {
        if (Array.isArray(arr)) {
          for (const o of arr) if (!o.is_buy_order && o.price > 0) prices.push(Number(o.price));
        }
      })
    );
  }
  if (fetches.length) {
    await Promise.all(fetches);
  }

  // Finalize
  prices = prices.filter(n => Number.isFinite(n) && n > 0);
  if (!prices.length) {
    throw new Error('No valid sell prices returned by ESI (prices array is empty).');
  }
  const lowest = Math.min(...prices);
  plexISK = lowest;
  const srcLabel = SOURCE ? SOURCE.value : 'lowest-sell';
  LAST && (LAST.textContent = `PLEX lowest sell fetched ${new Date().toLocaleString()} via ESI; UI source=${srcLabel}`);
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

    // “Best” pill placed to the LEFT of the number, left-justified in the cell
    const bestTagA = isBestA ? '<span class="pill best">Best</span> ' : '';
    const bestTagB = isBestB ? '<span class="pill best">Best</span> ' : '';

    return `<tr>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      <td class="num left">${bestTagA}$${fmt(r.perPLEX, 4)}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num left">${bestTagB}$${fmt(r.cashPerISK, 9)}</td>
    </tr>`;
  }).join('');
}

// -------------------- Manual Override (optional) --------------------
// Use from console if fetch has issues: window.setManualPLEX(5400000)
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
    await fetchPlexFromESI(regionId);
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();