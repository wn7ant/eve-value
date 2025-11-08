// EVE Value Calculator — ESI-only (no fallbacks)
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: https://esi.evetech.net/latest/markets/prices/?datasource=tranquility
//   (uses average_price for type_id 44992; falls back to adjusted_price)

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Constants --------------------
const ESI_PRICES = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX  = 44992;

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per 1 PLEX (from ESI prices endpoint)

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

// Build a cell that places an optional pill LEFT and the value RIGHT in one row,
// without needing external CSS tweaks.
function pillValueCell(showPill, valueHtml) {
  const pill = showPill ? '<span class="pill best">Best</span>' : '';
  return `
    <div style="display:flex; align-items:center; gap:8px;">
      ${pill}
      <span style="margin-left:auto; text-align:right; display:inline-block; min-width:8ch;">
        ${valueHtml}
      </span>
    </div>
  `;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

async function fetchPLEXfromESI() {
  const res = await fetch(ESI_PRICES, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    throw new Error('ESI prices returned empty array.');
  }

  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error('PLEX (type_id 44992) not found in ESI prices.');

  // Prefer average_price; fall back to adjusted_price
  const chosen = Number(row.average_price ?? row.adjusted_price);
  if (!isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price from ESI is missing or zero.');
  }

  plexISK = chosen;
  LAST && (LAST.textContent = `PLEX via ESI prices at ${new Date().toLocaleString()}`);
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
      <td class="num">${pillValueCell(isBestA, `$${fmt(r.perPLEX, 4)}`)}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num">${pillValueCell(isBestB, `$${fmt(r.cashPerISK, 9)}`)}</td>
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