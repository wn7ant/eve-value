// EVE Value Calculator — static, GitHub Pages friendly (ESI-only)
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI markets/prices (uses average_price for type_id 44992)
//
// NOTE: This version intentionally has no fallbacks.
//       If ESI is up, it works; if ESI is down, it shows an error.

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const PREVIEW = document.getElementById('packsPreview');
YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Constants --------------------
const TYPE_PLEX = 44992;
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';

// -------------------- State --------------------
let packs = [];
let plexISK = null; // number: ISK per 1 PLEX

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  PREVIEW && (PREVIEW.textContent = JSON.stringify(packs, null, 2));
}

// ESI "prices" endpoint contains average_price/adjusted_price per type_id
async function fetchPLEXfromESI() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI returned empty array.');
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error('PLEX (type_id 44992) not found in ESI prices.');
  // Prefer average_price; if missing, try adjusted_price
  const price = Number(row.average_price ?? row.adjusted_price);
  if (!isFinite(price) || price <= 0) {
    throw new Error('ESI price found but not usable (average/adjusted missing or zero).');
  }
  plexISK = price;
  LAST && (LAST.textContent = `PLEX via ESI prices (avg): ${new Date().toLocaleString()}`);
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
    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    // NOTE: pill goes BEFORE the number; number wrapped in .value for right alignment via CSS flex
    const perPLEXCell = `<td class="num num-with-pill">
      ${isBestA ? '<span class="pill best">Best</span>' : ''}
      <span class="value">$${fmt(r.perPLEX, 4)}</span>
    </td>`;

    const cashPerISKCell = `<td class="num num-with-pill">
      ${isBestB ? '<span class="pill best">Best</span>' : ''}
      <span class="value">$${fmt(r.cashPerISK, 9)}</span>
    </td>`;

    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      ${perPLEXCell}
      <td class="num">${fmt(plexISK, 0)}</td>
      ${cashPerISKCell}
    </tr>`;
  }).join('');
}

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
refresh();