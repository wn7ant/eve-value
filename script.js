// EVE Value Calculator — single-source (ESI prices), GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: https://esi.evetech.net/latest/markets/prices/?datasource=tranquility
//
// This file focuses on rendering the "Best" pill LEFT of the number,
// with the number RIGHT-aligned in the same cell, and rows kept horizontal.

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';

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

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// ESI prices endpoint returns an array of objects, each with type_id and adjusted_price/average_price.
// We will pick the entry where type_id === 44992 (PLEX) and use average_price if present; else adjusted_price.
async function fetchPLEXfromESI() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI returned empty array.');

  const plexRow = data.find(d => Number(d.type_id) === 44992);
  if (!plexRow) throw new Error('PLEX not found in ESI prices payload.');

  // Choose a price field; average_price is often present; fallback to adjusted_price.
  const candidate = Number(plexRow.average_price ?? plexRow.adjusted_price);
  if (!isFinite(candidate) || candidate <= 0) {
    throw new Error('PLEX price not available or zero from ESI.');
  }

  plexISK = candidate;
  LAST && (LAST.textContent = `PLEX via ESI (avg/adj): ${new Date().toLocaleString()}`);
}

// -------------------- Compute/Render --------------------
function renderBestCell(isBest, valueStr) {
  // Pill left, number right, inside a flex row that fills the cell width
  const pill = isBest ? '<span class="pill best">Best</span>' : '<span class="pill empty">Best</span>';
  return `<span class="cell-split">${pill}<span class="numval">${valueStr}</span></span>`;
}

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
      <td class="num">${renderBestCell(isBestA, `$${fmt(r.perPLEX, 4)}`)}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num">${renderBestCell(isBestB, `$${fmt(r.cashPerISK, 9)}`)}</td>
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

// Auto-run on load
refresh();