// EVE Value Calculator — ESI version (GitHub Pages safe, no local server needed)

// ----- DOM -----
const TABLE = document.getElementById('valueTable');
const TBODY = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR = document.getElementById('year');
const LAST = document.getElementById('lastUpdate');
const REGION = document.getElementById('region');      // <select>, defaults to 10000002 in index.html
const SOURCE = document.getElementById('plexSource');  // median | avg | min (we still show this to user)

YEAR && (YEAR.textContent = new Date().getFullYear());

// ----- Constants -----
const ESI_BASE = 'https://esi.evetech.net/latest';
const PLEX_TYPE = 44992; // PLEX
const MAX_PAGES = 20;    // safety cap on pagination

let packs = [];
let plexISK = null;

// ----- Utilities -----
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  const row = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
  TBODY.innerHTML = row;
}

function validateInputs() {
  const regionVal = (REGION && REGION.value) ? REGION.value : '10000002'; // default The Forge
  if (!/^\d+$/.test(regionVal)) {
    throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  }
  const src = SOURCE && SOURCE.value ? SOURCE.value : 'median';
  if (!['median', 'avg', 'min'].includes(src)) {
    throw new Error(`Unknown plexSource "${src}"`);
  }
  return { region: Number(regionVal), source: src };
}

// Median helper
function medianOf(sortedNums) {
  if (!sortedNums.length) return null;
  const mid = Math.floor(sortedNums.length / 2);
  return sortedNums.length % 2
    ? sortedNums[mid]
    : (sortedNums[mid - 1] + sortedNums[mid]) / 2;
}

// ----- Data loaders -----
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

async function fetchESISellPrices(regionId, typeId) {
  // ESI endpoint:
  // GET /markets/{region_id}/orders/?order_type=sell&type_id={type_id}&page={n}
  // Returns array of order objects with "price", "is_buy_order": false
  let page = 1;
  const prices = [];

  while (page <= MAX_PAGES) {
    const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=${page}`;
    const res = await fetch(url, { cache: 'no-store' });

    if (res.status === 404) {
      // End of pages or no orders
      break;
    }
    if (!res.ok) {
      throw new Error(`ESI HTTP ${res.status} on page ${page}`);
    }

    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      break; // no more data
    }

    for (const o of arr) {
      // Defensive checks
      if (o && o.price && o.is_buy_order === false && isFinite(o.price) && o.price > 0) {
        prices.push(Number(o.price));
      }
    }

    // ESI uses X-Pages header to indicate total pages; obey if present
    const totalPages = Number(res.headers.get('X-Pages') || '0');
    if (totalPages && page >= totalPages) break;

    page++;
  }

  return prices;
}

async function fetchPlexISK_ESI() {
  const { region, source } = validateInputs();
  // Pull all sell prices and compute a robust statistic
  const prices = await fetchESISellPrices(region, PLEX_TYPE);

  if (!prices.length) {
    throw new Error('No valid sell prices returned by ESI (prices array is empty).');
  }

  prices.sort((a, b) => a - b);

  let value;
  if (source === 'min') {
    value = prices[0];
  } else if (source === 'avg') {
    const sum = prices.reduce((s, v) => s + v, 0);
    value = sum / prices.length;
  } else {
    value = medianOf(prices);
  }

  if (!isFinite(value) || value <= 0) {
    throw new Error('Price feed returned non-positive value after processing.');
  }

  plexISK = value; // ISK per 1 PLEX (sell side estimate)
  if (LAST) LAST.textContent = `PLEX sell ${source} via ESI fetched: ${new Date().toLocaleString()}`;
}

// ----- Compute & render -----
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

async function refresh() {
  showStatus('Loading…');
  try {
    await loadPacks();       // read packs.json
    await fetchPlexISK_ESI(); // fetch PLEX price from ESI
    computeRows();           // render
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

// Wire up refresh button if present
const refreshBtn = document.getElementById('refresh');
if (refreshBtn) refreshBtn.addEventListener('click', refresh);

// Auto-run
refresh();
