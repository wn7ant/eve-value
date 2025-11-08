// EVE Value Calculator — GitHub Pages friendly, no backend
// Data sources (in order):
// 1) Adam4Eve market_prices (derived from ESI)  https://api.adam4eve.eu/v1
// 2) ESI region sell orders (fallback)          https://esi.evetech.net/latest
//
// What it computes and displays per cash pack:
// - $/PLEX  (uses sale_price_usd if present)
// - ISK/PLEX (from A4E or ESI)
// - $/ISK   (cash / (PLEX * ISK/PLEX))
//
// ---------------------------------------------------- DOM
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');      // <select> numeric region id (e.g., 10000002)
const SOURCE  = document.getElementById('plexSource');  // kept for UI consistency only
const PREVIEW = document.getElementById('packsPreview');

// Optional inline debug console (hidden by default)
let DBG_ENABLED = false;
const dbg = (...args) => { if (DBG_ENABLED) console.log('[EVE-VAL]', ...args); };

YEAR && (YEAR.textContent = new Date().getFullYear());

// ---------------------------------------------------- Constants
const TYPE_PLEX   = 44992;
const A4E_BASE    = 'https://api.adam4eve.eu/v1';
const ESI_BASE    = 'https://esi.evetech.net/latest';

// ---------------------------------------------------- State
let packs = [];
let plexISK = null; // number: ISK per 1 PLEX

// ---------------------------------------------------- Helpers
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
  // Keep plexSource for UI parity (doesn't affect A4E/ESI choice)
  if (SOURCE && !['median', 'avg', 'min'].includes(SOURCE.value)) {
    throw new Error(`Unknown plexSource "${SOURCE.value}"`);
  }
  return Number(regionVal);
}

// ---------------------------------------------------- Data Loads
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// --------------- A4E primary feed (lowest sell)
async function fetchPlexFromA4E(regionId) {
  // /v1/market_prices?locationID=<regionID>&typeID=<csv>
  const url = `${A4E_BASE}/market_prices?locationID=${encodeURIComponent(regionId)}&typeID=${TYPE_PLEX}`;
  dbg('A4E URL:', url);
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      // Friendly UA helps a few community APIs
      'Accept': 'application/json',
      'User-Agent': 'eve-value-static/1.0 (+github-pages)'
    }
  });
  if (!res.ok) {
    throw new Error(`Adam4Eve market_prices HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    throw new Error('Adam4Eve market_prices returned an empty array.');
  }
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX) || data[0];
  const sell = Number(row.sell_price);
  dbg('A4E row:', row);
  if (!isFinite(sell) || sell <= 0) {
    throw new Error('Adam4Eve sell_price missing or zero.');
  }
  plexISK = sell;
  LAST && (LAST.textContent =
    `PLEX lowest sell fetched ${new Date().toLocaleString()} via Adam4Eve (region ${regionId})`);
}

// --------------- ESI fallback (walk pages, collect sell prices, take min)
async function fetchPlexFromESI_MinSell(regionId) {
  // ESI: /markets/{region_id}/orders/?order_type=sell&type_id=44992&page=N
  // We must page until empty or until X-Pages is exhausted.
  let page = 1;
  let pagesCap = 15; // safety cap
  const prices = [];

  while (page <= pagesCap) {
    const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${TYPE_PLEX}&page=${page}`;
    dbg('ESI URL:', url);
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'eve-value-static/1.0 (+github-pages)'
      }
    });

    if (res.status === 404) {
      // Region may have no market for this type
      break;
    }
    if (!res.ok) {
      throw new Error(`ESI orders HTTP ${res.status} (page ${page})`);
    }

    // pages count if provided
    const pagesHdr = res.headers.get('X-Pages');
    if (pagesHdr && /^\d+$/.test(pagesHdr)) {
      pagesCap = Math.min(pagesCap, Number(pagesHdr));
    }

    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      // no more orders
      break;
    }

    for (const o of arr) {
      const p = Number(o.price);
      if (isFinite(p) && p > 0) prices.push(p);
    }

    page += 1;
  }

  dbg('ESI collected prices:', prices.length);
  if (!prices.length) {
    throw new Error('No valid sell prices returned by ESI (prices array is empty).');
  }

  const minSell = Math.min(...prices);
  plexISK = minSell;
  LAST && (LAST.textContent =
    `PLEX min sell fetched ${new Date().toLocaleString()} via ESI (region ${regionId})`);
}

// ---------------------------------------------------- Compute/Render
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

// ---------------------------------------------------- Manual override (optional)
// In browser console:  setManualPLEX(5_400_000)
window.setManualPLEX = function(iskPerPLEX) {
  const v = Number(iskPerPLEX);
  if (!isFinite(v) || v <= 0) {
    alert('Invalid manual ISK/PLEX value.');
    return;
  }
  plexISK = v;
  LAST && (LAST.textContent =
    `Manual override: ISK/PLEX = ${fmt(v,0)} at ${new Date().toLocaleString()}`);
  computeRows();
};

// ---------------------------------------------------- Refresh flow
async function refresh() {
  try {
    showStatus('Loading…');
    const regionId = validateInputs();
    await loadPacks();

    // Try A4E first
    try {
      await fetchPlexFromA4E(regionId);
    } catch (a4eErr) {
      dbg('A4E failed, falling back to ESI:', a4eErr.message);
      await fetchPlexFromESI_MinSell(regionId);
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

// ---------------------------------------------------- Optional: quick debug toggle via URL
// Append ?debug=1 to enable console logs
(function() {
  const u = new URL(location.href);
  if (u.searchParams.get('debug') === '1') {
    DBG_ENABLED = true;
    console.log('[EVE-VAL] Debug enabled');
  }
})();