// EVE Value Calculator — ESI-only (no fallbacks)
// Data:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI markets/prices (average_price or adjusted_price), no region needed

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Constants --------------------
const TYPE_PLEX = 44992;
const ESI_PRICES = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';

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

// -------------------- Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// Fetch ISK-per-PLEX from ESI markets/prices
// Response is an array of { type_id, average_price, adjusted_price }
async function fetchPLEXfromESI() {
  let res;
  try {
    res = await fetch(ESI_PRICES, { cache: 'no-store' });
  } catch (netErr) {
    // This is a network-layer failure (CORS/extension/VPN/etc.)
    // Show the raw error message for easier troubleshooting.
    throw new Error(`Fetch failed (network/CORS). Details: ${netErr.message}`);
  }

  if (!res.ok) {
    throw new Error(`ESI HTTP ${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('ESI returned non-JSON or unreadable response.');
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ESI returned an empty array for markets/prices.');
  }

  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) {
    // Helpful hint: if you can see 44992 in the raw URL output, but not here,
    // check the browser console for blocked cross-site requests (extensions, VPNs, etc.).
    throw new Error('PLEX (type_id 44992) not found in ESI markets/prices.');
  }

  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = (isFinite(avg) && avg > 0) ? avg
                 : (isFinite(adj) && adj > 0) ? adj
                 : NaN;

  if (!isFinite(chosen) || chosen <= 0) {
    // Include a small snippet to help debug
    const snippet = JSON.stringify({ average_price: row.average_price, adjusted_price: row.adjusted_price });
    throw new Error(`PLEX price in ESI is missing/zero. Raw: ${snippet}`);
  }

  plexISK = chosen;
  LAST && (LAST.textContent = `PLEX via ESI markets/prices at ${new Date().toLocaleString()}`);
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
    await fetchPLEXfromESI();
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();