// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Tables shown:
// 1) Value table (Packs): Quantity | Cash Price | $/PLEX | $/Billion ISK
// 2) Omega table (if omega.json exists)
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI /markets/prices (type_id 44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const TBODY       = document.getElementById('tableBody');
const YEAR        = document.getElementById('year');
const LAST        = document.getElementById('lastUpdate'); // we won't use it anymore
const RATE_TITLE  = document.getElementById('rateTitle');  // <h2 id="rateTitle">PLEX / Ƶ …</h2> (optional)
YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX      = 44992;
const HIDE_PACKS_PREVIEW = true;

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per 1 PLEX

// -------------------- Helpers --------------------
const fmt = (n, d = 2) =>
  (n === null || n === undefined || Number.isNaN(n)) ? '—'
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function indexOfStrictMin(arr) {
  let iBest = 0, vBest = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < vBest - 1e-9) { vBest = v; iBest = i; }
  }
  return iBest;
}

// Tiny helpers to color tokens without changing layout rules
const $usd = (n, d = 2) => `<span class="usd">$</span>${fmt(n, d)}`;
const $plex = (txt = 'PLEX') => `<span class="plex">${txt}</span>`;
const $iskZ = () => `<span class="isk">&#x01B5;</span>`; // Ƶ

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();

  // Hide packs preview if it exists
  const preview = document.getElementById('packsPreview');
  if (HIDE_PACKS_PREVIEW) {
    preview?.closest('.section') && (preview.closest('.section').style.display = 'none');
  } else if (preview) {
    preview.textContent = JSON.stringify(packs, null, 2);
  }
}

// ESI prices: array of objects {type_id, average_price, adjusted_price}
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

  // Update the new title line and clear any legacy footer text
  const when = new Date().toLocaleString();
  if (RATE_TITLE) {
    RATE_TITLE.innerHTML =
      `PLEX <span class="sep">/</span> ${$iskZ()} ` +
      `<span class="rate">${fmt(plexISK, 0)}</span> ` +
      `<span class="asof">as of ${when}</span>`;
  }
  if (LAST) LAST.textContent = ''; // suppress old line
}

// -------------------- Packs Table --------------------
function computeValueRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  // Build metrics
  const rows = packs.map(p => {
    const price   = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    // $ per Billion ISK = ($ / ISK) * 1e9 = price / (PLEX * ISK/PLEX) * 1e9
    const perBIL  = (price / (p.plex_amount * plexISK)) * 1e9;
    return { ...p, price, perPLEX, perBIL };
  });

  // Pick exactly one best row for each metric
  const bestPerPLEXIdx = indexOfStrictMin(rows.map(r => r.perPLEX));
  const bestPerBILIdx  = indexOfStrictMin(rows.map(r => r.perBIL));

  // Render 4 columns to match your current header
  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestPerBILIdx);

    const perPLEXCell =
      `${isBestA ? '<span class="pill best">Best</span>' : ''}` +
      `<span class="numv">${$usd(r.perPLEX, 4)}</span>`;

    const perBILCell =
      `${isBestB ? '<span class="pill best">Best</span>' : ''}` +
      `<span class="numv">${$usd(r.perBIL, 2)} <span class="perbil">/ 1B ${$iskZ()}</span></span>`;

    const qtyText = `${fmt(r.plex_amount, 0)} ${$plex()}`;

    return `<tr${(isBestA || isBestB) ? ' class="highlight"' : ''}>
      <td>${qtyText}</td>
      <td class="num">${$usd(r.price, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num leftpill">${perBILCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega Table (optional) --------------------
const OMEGA_BODY = document.getElementById('omegaBody');
let omegaPlans = [];

async function loadOmegaPlans() {
  if (!OMEGA_BODY) return; // page without omega table
  try {
    const res = await fetch('omega.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
    omegaPlans = await res.json();
  } catch {
    omegaPlans = [];
  }
}

function computeOmega() {
  if (!OMEGA_BODY) return;
  if (!omegaPlans.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">No Omega data.</td></tr>';
    return;
  }
  if (!plexISK || !packs.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">Waiting for data…</td></tr>';
    return;
  }

  // Use the best $/PLEX from packs for converting PLEX to USD
  const perPLEXBestUSD = Math.min(...packs.map(p => (p.sale_price_usd ?? p.price_usd) / p.plex_amount));

  const rows = omegaPlans.map(o => {
    const cashUSD      = Number(o.cash_usd);
    const plexNeeded   = Number(o.plex_cost);
    const costViaPLEX  = plexNeeded * perPLEXBestUSD; // USD estimate via best $/PLEX
    const monthlyCash  = cashUSD / Number(o.months);
    const monthlyPLEX  = costViaPLEX / Number(o.months);
    return { ...o, cashUSD, plexNeeded, costViaPLEX, monthlyCash, monthlyPLEX };
  });

  // BEST = lowest monthly cost among (monthlyCash vs monthlyPLEX) across all rows
  const bestIdx = rows.reduce((b, r, i) => {
    const bestOfRow = Math.min(r.monthlyCash, r.monthlyPLEX);
    const bestOfB   = Math.min(rows[b].monthlyCash, rows[b].monthlyPLEX);
    return (bestOfRow < bestOfB - 1e-9) ? i : b;
  }, 0);

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    // We show cash price, PLEX needed, and total cost via PLEX
    return `<tr${i === bestIdx ? ' class="highlight"' : ''}>
      <td>${r.label}</td>
      <td class="num">${$usd(r.cashUSD, 2)}</td>
      <td class="num">${fmt(r.plexNeeded, 0)} ${$plex()}</td>
      <td class="num leftpill">
        ${i === bestIdx ? '<span class="pill best">Best</span>' : ''}
        <span class="numv">${$usd(r.costViaPLEX, 2)}</span>
      </td>
      <td class="num">
        <span class="muted">cash ${$usd(r.monthlyCash,2)} / plex ${$usd(r.monthlyPLEX,2)} per mo</span>
      </td>
    </tr>`;
  }).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    await loadPacks();
    await loadOmegaPlans();
    await fetchPLEXFromESIPrices();
    computeValueRows(); // packs table
    computeOmega();     // omega table (if present)
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);
refresh();