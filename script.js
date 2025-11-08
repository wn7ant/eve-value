// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - Ƶ per PLEX (ISK/PLEX): ESI prices endpoint (type_id=44992), uses average_price then adjusted_price
// Columns shown: Pack, Cash Price, $/PLEX, $/Billion Ƶ (no separate "ISK per PLEX" column)

const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');   // keep if you still show it near Refresh
const PREVIEW = document.getElementById('packsPreview');
const PLEXMETA= document.getElementById('plexMeta');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true; // hides the JSON preview block
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let iskPerPLEX = null; // Ƶ per PLEX (number)

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function showStatus(msg, isError = false) {
  const cols = 4; // value table now has 4 columns
  TBODY.innerHTML = `<tr><td colspan="${cols}" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function indexOfStrictMin(arr) {
  let bestIdx = 0, bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < bestVal - 1e-9) { bestVal = v; bestIdx = i; }
  }
  return bestIdx;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();

  if (HIDE_PACKS_PREVIEW) {
    const sec = PREVIEW?.closest('.section');
    if (sec) sec.style.display = 'none';
  } else {
    if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
  }
}

// ESI prices: array of {type_id, average_price, adjusted_price}
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

  iskPerPLEX = chosen;

  // Print meta line under the "PLEX / Ƶ" heading
  if (PLEXMETA) {
    PLEXMETA.textContent =
      `as of ${new Date().toLocaleString()} — \u01B5/PLEX: ${fmt(iskPerPLEX, 0)}`;
  }

  // If you also keep LAST near the Refresh button, update it too
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Compute/Render (Value table) --------------------
function computeRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!iskPerPLEX)   { showStatus('Waiting for PLEX price…'); return; }

  // rows: compute $/PLEX and $/Billion Ƶ
  const rows = packs.map(p => {
    const cash = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = cash / p.plex_amount;                              // $ per 1 PLEX
    const dollarsPerISK = cash / (p.plex_amount * iskPerPLEX);         // $ per 1 Ƶ
    const dollarsPerBillion = dollarsPerISK * 1_000_000_000;           // $ per 1B Ƶ
    return { ...p, cash, perPLEX, dollarsPerBillion };
  });

  // best markers (exactly one "best" per metric)
  const perPLEXArr   = rows.map(r => r.perPLEX);
  const perBilArr    = rows.map(r => r.dollarsPerBillion);
  const bestPLEXIdx  = indexOfStrictMin(perPLEXArr);
  const bestBilIdx   = indexOfStrictMin(perBilArr);

  TBODY.innerHTML = rows.map((r, i) => {
    const bestA = (i === bestPLEXIdx);
    const bestB = (i === bestBilIdx);

    const perPLEXCell = `${bestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    const perBilCell  = `${bestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.dollarsPerBillion, 2)}</span>`;

    const rowClass = (bestA || bestB) ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.cash, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num leftpill">${perBilCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- (Optional) Manual Override --------------------
window.setManualPLEX = function(iskPerPLEXManual) {
  const v = Number(iskPerPLEXManual);
  if (!isFinite(v) || v <= 0) {
    alert('Invalid manual Ƶ/PLEX value.');
    return;
  }
  iskPerPLEX = v;
  if (PLEXMETA) {
    PLEXMETA.textContent =
      `as of ${new Date().toLocaleString()} — \u01B5/PLEX: ${fmt(iskPerPLEX, 0)}`;
  }
  computeRows();
};

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
refresh();