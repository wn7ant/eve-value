// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Tables are independent:
//  - Value table BEST: based only on $/PLEX and $/Billion ISK within packs
//  - Omega table BEST: the single row with the LOWEST per-month cost across ALL plans,
//    where per-month is min(cashMonthly, plexMonthly), and
//    plexMonthly = plex_cost * ($/PLEX_best) / months

// -------------------- DOM --------------------
const TBODY        = document.getElementById('tableBody');     // packs/value table body
const YEAR         = document.getElementById('year');
const LAST         = document.getElementById('lastUpdate');
const PREVIEW      = document.getElementById('packsPreview');
const OMEGA_BODY   = document.getElementById('omegaBody');     // omega table body

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true; // true to hide "Edit your pack data" preview block
const ESI_PRICES_URL     = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX          = 44992;
const SCALE_TO_BILLION   = true; // show $/Billion ISK in the value table

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per PLEX (from ESI prices; used only for $/B ISK in the value table)
let omegaPlans = []; // [{label, months, cash_usd, plex_cost}]

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function indexOfStrictMin(arr) {
  // Choose exactly ONE "best" index: first strictly-smallest value (epsilon-guarded)
  let bestIdx = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < bestVal - 1e-9) {
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
    const sec = PREVIEW?.closest('.section');
    if (sec) sec.style.display = 'none';
  } else {
    if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
  }
}

async function loadOmegaPlans() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json(); // expects [{label, months, cash_usd, plex_cost}, ...]
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
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Value Table (Packs) --------------------
function computeValueTable() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK)      { showStatus('Waiting for PLEX price…'); return; }

  // Build rows
  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount; // $/PLEX
    // $ per Billion ISK (if enabled)
    const dollarsPerBillionISK = SCALE_TO_BILLION
      ? (price * 1_000_000_000) / (p.plex_amount * plexISK)
      : price / (p.plex_amount * plexISK);
    return { ...p, price, perPLEX, dollarsPerBillionISK };
  });

  // BEST (exactly one) in each metric
  const perPLEXArr = rows.map(r => r.perPLEX);
  const perBIArr   = rows.map(r => r.dollarsPerBillionISK);
  const bestPerPLEXIdx = indexOfStrictMin(perPLEXArr);
  const bestPerBIIdx   = indexOfStrictMin(perBIArr);

  // Render (NOTE: assuming 5 visible columns since PLEX column may have been removed)
  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestPerBIIdx);

    const perPLEXCell =
      `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;

    const perBICell =
      `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.dollarsPerBillionISK, 4)}</span>`;

    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    // Columns: Quantity | Cash Price | $/PLEX | ISK per PLEX | $/Billion ISK
    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num leftpill">${perBICell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega Table (Independent) --------------------
function computeOmegaTable() {
  if (!omegaPlans.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">No Omega data.</td></tr>';
    return;
  }

  // Best $/PLEX from the packs table (independent of ISK)
  const perPLEXList = packs.map(p => (p.sale_price_usd ?? p.price_usd) / p.plex_amount)
                           .filter(v => Number.isFinite(v) && v > 0);
  if (!perPLEXList.length) {
    OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">Waiting for pack $/PLEX…</td></tr>';
    return;
  }
  const bestDollarPerPLEX = Math.min(...perPLEXList);

  // For each plan, compute:
  //  - cashMonthly = cash_usd / months
  //  - plexMonthly = (plex_cost * $/PLEX_best) / months
  //  - saveVsCashMonthly = cashMonthly - plexMonthly  (positive => PLEX is cheaper per month)
  const rows = omegaPlans.map(o => {
    const cashMonthly = o.cash_usd / o.months;
    const plexMonthly = (o.plex_cost * bestDollarPerPLEX) / o.months;
    const saveVsCashMonthly = cashMonthly - plexMonthly;
    return { ...o, cashMonthly, plexMonthly, saveVsCashMonthly };
  });

  // Pick exactly one BEST row: the plan with the lowest monthly cost across cash/plex
  const bestIdx = indexOfStrictMin(rows.map(r => Math.min(r.cashMonthly, r.plexMonthly)));

  // Render: Columns (as you had)
  // Duration | Cash Price | PLEX Needed | $/PLEX Used | Cost via PLEX | Save vs Cash
  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const isBest = (i === bestIdx);
    const rowClass = isBest ? ' class="highlight"' : '';
    const durationCell = `${isBest ? '<span class="pill best">Best</span>' : ''}<span class="numv">${r.label}</span>`;

    return `
      <tr${rowClass}>
        <td class="leftpill">${durationCell}</td>
        <td class="num">$${fmt(r.cash_usd, 2)} <small class="muted">( $${fmt(r.cashMonthly,2)}/mo )</small></td>
        <td class="num">${fmt(r.plex_cost, 0)} PLEX</td>
        <td class="num">$${fmt(bestDollarPerPLEX, 4)}</td>
        <td class="num">$${fmt(r.plexMonthly, 2)}/mo</td>
        <td class="num">${r.saveVsCashMonthly >= 0 ? '' : '-'}$${fmt(Math.abs(r.saveVsCashMonthly), 2)}/mo</td>
      </tr>`;
  }).join('');
}

// -------------------- Manual Override (kept) --------------------
window.setManualPLEX = function(iskPerPLEX) {
  const v = Number(iskPerPLEX);
  if (!isFinite(v) || v <= 0) {
    alert('Invalid manual ISK/PLEX value.');
    return;
  }
  plexISK = v;
  LAST && (LAST.textContent = `Manual override: ISK/PLEX = ${fmt(v,0)} at ${new Date().toLocaleString()}`);
  computeValueTable();   // only affects value table's $/Billion ISK column
  // Omega is independent of ISK; no re-render needed here for omega
};

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    await Promise.all([loadPacks(), loadOmegaPlans()]);
    await fetchPLEXFromESIPrices(); // only needed for $/Billion ISK column in value table
    computeValueTable();
    computeOmegaTable();
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();