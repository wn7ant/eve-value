// EVE Value Calculator

// ---- DOM refs
const TABLE   = document.getElementById('valueTable');
const TBODY   = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');
const SOURCE  = document.getElementById('plexSource');
if (YEAR) YEAR.textContent = new Date().getFullYear();

// ---- Constants
const FUZZWORK = 'https://market.fuzzwork.co.uk/aggregates/';
const PLEX_TYPE = 44992; // PLEX type id

// ---- State
let packs = [];
let plexISK = null; // ISK per PLEX

// ---- Utilities
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function ensureManualInput() {
  // Adds a manual PLEX price input under the Refresh button if not present
  if (document.getElementById('manual-plex-wrap')) return;

  const btn = document.getElementById('refresh');
  if (!btn || !btn.parentElement) return;

  const wrap = document.createElement('div');
  wrap.id = 'manual-plex-wrap';
  wrap.style.marginTop = '8px';
  wrap.innerHTML = `
    <label style="display:grid;gap:6px;max-width:320px">
      Manual ISK per PLEX (fallback)
      <input id="manual-plex" type="number" step="1" min="1" placeholder="Enter ISK per 1 PLEX (e.g., 4,000,000)" style="padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:#0a0f14;color:var(--text)">
    </label>
    <button class="btn" id="apply-manual">Use Manual Price</button>
  `;
  btn.parentElement.appendChild(wrap);

  document.getElementById('apply-manual').addEventListener('click', () => {
    const v = Number(document.getElementById('manual-plex').value);
    if (!isFinite(v) || v <= 0) {
      showStatus('Please enter a valid ISK-per-PLEX number.', true);
      return;
    }
    plexISK = v;
    LAST.textContent = `Using manual ISK/PLEX: ${v.toLocaleString()}`;
    computeRows();
  });
}

function validateInputs() {
  const regionVal = REGION ? REGION.value : '10000002';
  if (!/^\d+$/.test(regionVal)) throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  const src = SOURCE ? SOURCE.value : 'median';
  if (!['median', 'avg', 'min'].includes(src)) throw new Error(`Unknown plexSource "${src}"`);
  return { region: Number(regionVal), source: src };
}

// ---- Data
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// ---- Market fetch
async function fetchPlexISK() {
  const { region, source } = validateInputs();
  const url = `${FUZZWORK}?region=${region}&types=${PLEX_TYPE}`;

  let data;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Fuzzwork`);
    data = await res.json();
  } catch (e) {
    throw new Error(`Could not fetch PLEX price: ${e.message}`);
  }

  // Defensive parsing
  const plexObj = data && data[String(PLEX_TYPE)];
  const sell = plexObj && plexObj.sell;
  if (!sell) {
    ensureManualInput();
    throw new Error('PLEX data missing in API response. You can enter a manual ISK/PLEX value below.');
  }

  const map = { median: sell.median, avg: sell.avg, min: sell.min };
  const val = map[source];

  // Some times the endpoint returns zeros across the board; detect that explicitly
  const allZero = ['median', 'avg', 'min', 'weightedAverage', 'max', 'min', 'stddev', 'volume', 'orderCount', 'percentile']
    .every(k => (typeof sell[k] === 'number' ? sell[k] === 0 : true));

  if (!isFinite(val) || val <= 0 || allZero) {
    ensureManualInput();
    throw new Error(
      'Price feed returned zeros. This occasionally happens. ' +
      'Enter a manual ISK per PLEX value below and click “Use Manual Price”.'
    );
  }

  plexISK = val;
  if (LAST) LAST.textContent = `PLEX sell ${source} fetched: ${new Date().toLocaleString()}`;
}

// ---- Render
function computeRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

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

// ---- Orchestration
async function refresh() {
  showStatus('Loading…');
  try {
    await loadPacks();
    await fetchPlexISK();   // may throw & trigger manual input path
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();
