// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const PLEXRATE = document.getElementById('plexRate');
const ASOF     = document.getElementById('asOf');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per PLEX

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
}

// ESI prices: returns an array with objects {type_id, average_price, adjusted_price}
async function fetchPLEXFromESIPrices() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI prices returned an empty array.');

  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);

  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = Number.isFinite(avg) && avg > 0 ? avg
                : (Number.isFinite(adj) && adj > 0 ? adj : NaN);

  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price missing or zero in ESI prices.');
  }

  plexISK = chosen;

  // Banner update: PLEX / Ƶ RATE and timestamp
  if (PLEXRATE) PLEXRATE.textContent = ` ${fmt(plexISK, 0)}`;
  if (ASOF) ASOF.textContent = `as of ${new Date().toLocaleString()}`;
}

// -------------------- Compute/Render --------------------
function computeRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    // $ per Billion ISK
    const cashPerBillion = (price / (p.plex_amount * plexISK)) * 1_000_000_000;
    return { ...p, price, perPLEX, cashPerBillion };
  });

  TBODY.innerHTML = rows.map(r => {
    return `<tr>
      <td class="left">${r.name || (r.plex_amount ? `${fmt(r.plex_amount,0)} PLEX` : 'Pack')}</td>
      <td class="num">${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.perPLEX, 4)}</td>
      <td class="num">${fmt(r.cashPerBillion, 2)}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega (your current JS may already render this) --------------------
// If you already have omega rendering in another file/version, keep it.
// This script leaves #omegaTable alone unless you hook it up here.

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    await loadPacks();
    await fetchPLEXFromESIPrices();
    computeRows();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();