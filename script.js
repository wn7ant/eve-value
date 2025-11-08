// EVE Value Calculator — ESI-only, 4-column Value table
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id = 44992)
//   https://esi.evetech.net/latest/markets/prices/?datasource=tranquility

// -------------------- DOM --------------------
const TBODY = document.getElementById('tableBody');
const YEAR  = document.getElementById('year');
const LAST  = document.getElementById('lastUpdate'); // ok if missing

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per 1 PLEX

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function indexOfStrictMin(arr) {
  let bestIdx = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < bestVal - 1e-9) { // strict with tiny epsilon
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
}

// ESI prices: array of { type_id, average_price, adjusted_price }
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

  // If you still have a small status line, update it (safe if element doesn’t exist)
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Compute/Render --------------------
// Table: Quantity | Cash Price | $/PLEX | $/Billion ISK
function computeRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;                       // $ / PLEX
    const dollarsPerBillion = (perPLEX / plexISK) * 1_000_000_000; // $ / 1B ISK
    return { ...p, price, perPLEX, dollarsPerBillion };
  });

  const perPLEXArr = rows.map(r => r.perPLEX);
  const perBilArr  = rows.map(r => r.dollarsPerBillion);
  const bestPerPLEXIdx = indexOfStrictMin(perPLEXArr);
  const bestPerBilIdx  = indexOfStrictMin(perBilArr);

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestPerBilIdx);

    // pill-left / number-right layout (CSS handles alignment)
    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    const perBilCell  = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.dollarsPerBillion, 2)} / 1B</span>`;

    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';
    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num leftpill">${perBilCell}</td>
    </tr>`;
  }).join('');
}

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