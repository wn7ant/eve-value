// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const PREVIEW = document.getElementById('packsPreview');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true; // set true to hide the "Edit your pack data" preview block
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
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function indexOfStrictMin(arr) {
  // Choose exactly ONE "best" row: the first strictly-smallest value
  // If values tie exactly, the earlier row wins (stable/consistent)
  let bestIdx = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < bestVal - 1e-9) { // strict with a tiny epsilon
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

  if (HIDE_PACKS_PREVIEW) {
    // Hide the preview section entirely if present
    const sec = PREVIEW?.closest('.section');
    if (sec) sec.style.display = 'none';
  } else {
    if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
  }
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
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
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

  // Pick exactly one “best” row per metric
  const perPLEXArr    = rows.map(r => r.perPLEX);
  const cashPerISKArr = rows.map(r => r.cashPerISK);
  const bestPerPLEXIdx    = indexOfStrictMin(perPLEXArr);
  const bestCashPerISKIdx = indexOfStrictMin(cashPerISKArr);

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestCashPerISKIdx);

    // Pills appear to the LEFT of the number; numbers stay right-aligned by CSS
    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    const cashPerISKCell = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.cashPerISK, 9)}</span>`;

    // Row highlight if either metric is best
    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num leftpill">${cashPerISKCell}</td>
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

// ======================= Omega Table =======================

const OMEGA_BODY = document.getElementById('omegaBody');
let omegaPlans = [];

async function loadOmegaPlans() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}

function computeOmega() {
  if (!omegaPlans.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="4" class="muted">No Omega data.</td></tr>';
    return;
  }
  if (!plexISK) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="4" class="muted">Waiting for PLEX price…</td></tr>';
    return;
  }

  const rows = omegaPlans.map(o => {
    const plexValueUSD = o.plex_cost * (packs[0].price_usd / packs[0].plex_amount); // uses live pack $/PLEX ratio
    const costViaPLEX = o.plex_cost * plexISK ? o.plex_cost * (1 / plexISK) : Infinity; // ISK conversion if needed
    const cashVsPlexUSD = o.plex_cost * (packs[0].price_usd / packs[0].plex_amount);
    return { ...o, cashVsPlexUSD };
  });

  // Pick exactly one best row: lowest costViaPLEX
  const bestIdx = rows.reduce((b, r, i) =>
    (rows[i].cashVsPlexUSD < rows[b].cashVsPlexUSD ? i : b), 0);

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const isBest = (i === bestIdx);
    return `
      <tr${isBest ? ' class="highlight"' : ''}>
        <td>${r.label}</td>
        <td class="num">$${fmt(r.cash_usd, 2)}</td>
        <td class="num">${fmt(r.plex_cost, 0)} PLEX</td>
        <td class="num">
          ${isBest ? '<span class="pill best">Best</span>' : ''}
          $${fmt(r.cashVsPlexUSD, 2)}
        </td>
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

// Auto-run on load
refresh();