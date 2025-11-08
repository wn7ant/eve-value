// EVE Value Calculator — ESI-only, no fallbacks, GitHub Pages friendly

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const PREVIEW = document.getElementById('packsPreview');
YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Constants --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992; // PLEX

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per PLEX

// -------------------- Layout fixes injected via JS --------------------
(function injectFixes(){
  const css = `
    /* keep table rows horizontal and tidy */
    #valueTable { table-layout: fixed; }
    #valueTable td, #valueTable th { white-space: nowrap; vertical-align: middle; }
    /* split cell: pill left, number right */
    td.split { display: flex; align-items: center; gap: 8px; }
    td.split .left { flex: 0 0 auto; text-align: left; }
    td.split .right { margin-left: auto; text-align: right; width: 100%; }
    /* ensure numeric columns that aren't split still align right */
    td.num { text-align: right; }
  `;
  const el = document.createElement('style');
  el.setAttribute('data-eve-value-fixes','');
  el.textContent = css;
  document.head.appendChild(el);
})();

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

async function fetchPlexFromESI() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI prices returned empty array.');
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error('ESI prices: PLEX (44992) not found.');
  // Prefer average_price; fall back to adjusted_price
  const price = Number(row.average_price || row.adjusted_price);
  if (!isFinite(price) || price <= 0) throw new Error('ESI prices: invalid PLEX price value.');
  plexISK = price;
  LAST && (LAST.textContent = `PLEX ISK/PLEX via ESI prices at ${new Date().toLocaleString()}`);
}

// -------------------- Compute/Render --------------------
function renderRows() {
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

    // helper to render a numeric cell with optional left pill and right number
    const splitCell = (value, isBest, prefix='') => `
      <td class="split">
        <span class="left">${isBest ? '<span class="pill best">Best</span>' : ''}</span>
        <span class="right">${prefix}${fmt(value, prefix ? 4 : 9)}</span>
      </td>
    `;

    return `<tr>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      ${splitCell(r.perPLEX, isBestA, '$')}
      <td class="num">${fmt(plexISK, 0)}</td>
      ${splitCell(r.cashPerISK, isBestB, '$')}
    </tr>`;
  }).join('');
}

// -------------------- Manual Override (optional) --------------------
window.setManualPLEX = function(iskPerPLEX) {
  const v = Number(iskPerPLEX);
  if (!isFinite(v) || v <= 0) { alert('Invalid manual ISK/PLEX value.'); return; }
  plexISK = v;
  LAST && (LAST.textContent = `Manual override: ISK/PLEX = ${fmt(v,0)} at ${new Date().toLocaleString()}`);
  renderRows();
};

// -------------------- Refresh --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    await loadPacks();
    await fetchPlexFromESI();
    renderRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);
refresh();