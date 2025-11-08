// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price
// - Omega plans: omega.json (you maintain)

// -------------------- DOM --------------------
const TBODY    = document.getElementById('tableBody');   // Packs table body
const YEAR     = document.getElementById('year');
const LAST     = document.getElementById('lastUpdate');
const PREVIEW  = document.getElementById('packsPreview'); // optional preview block
const OMEGA_TB = document.getElementById('omegaBody');    // Omega table body

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true; // hide the JSON preview block
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per PLEX (from ESI prices: average_price or adjusted_price)
let omegaPlans = []; // [{label, months, cash_usd, plex_cost}, ...]

// -------------------- Helpers --------------------
function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function indexOfStrictMin(arr) {
  // Choose exactly ONE "best" row: first strictly-smallest value (epsilon guard)
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

// ESI prices: returns array of { type_id, average_price, adjusted_price }
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

async function loadOmegaPlans() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}

// -------------------- Packs Table --------------------
function computeRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    const cashPerISK = price / (p.plex_amount * plexISK); // $ / ISK
    return { ...p, price, perPLEX, cashPerISK };
  });

  // Exactly one best for each metric
  const perPLEXArr    = rows.map(r => r.perPLEX);
  const cashPerISKArr = rows.map(r => r.cashPerISK);
  const bestPerPLEXIdx    = indexOfStrictMin(perPLEXArr);
  const bestCashPerISKIdx = indexOfStrictMin(cashPerISKArr);

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = (i === bestPerPLEXIdx);
    const isBestB = (i === bestCashPerISKIdx);

    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX, 4)}</span>`;
    // Column label likely "$/B ISK" on your page, but the value remains $/ISK; if you’re scaling, do it in HTML/labels/CSS.
    const cashPerISKCell = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.cashPerISK, 9)}</span>`;

    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num leftpill">${cashPerISKCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega Table --------------------
// BEST definition: minimize min(monthly_cash, monthly_via_plex)
// monthly_cash      = cash_usd / months
// monthly_via_plex  = (plex_cost * bestDollarPerPLEX) / months
function bestDollarPerPLEXFromPacks() {
  if (!packs.length) return NaN;
  const perPLEX = packs.map(p => (p.sale_price_usd ?? p.price_usd) / p.plex_amount);
  return Math.min(...perPLEX);
}

function computeOmega() {
  if (!omegaPlans.length) {
    OMEGA_TB.innerHTML = '<tr><td colspan="5" class="muted">No Omega data.</td></tr>';
    return;
  }
  if (!plexISK) {
    OMEGA_TB.innerHTML = '<tr><td colspan="5" class="muted">Waiting for PLEX price…</td></tr>';
    return;
  }

  const bestDollarPerPLEX = bestDollarPerPLEXFromPacks();
  if (!isFinite(bestDollarPerPLEX) || bestDollarPerPLEX <= 0) {
    OMEGA_TB.innerHTML = '<tr><td colspan="5" class="muted">No valid $/PLEX from packs.</td></tr>';
    return;
  }

  // Build rows with totals and monthly metrics
  const rows = omegaPlans.map(o => {
    const months = Number(o.months);
    const cashTotalUSD = Number(o.cash_usd);
    const plexNeeded = Number(o.plex_cost);

    const monthlyCash = cashTotalUSD / months;
    const monthlyViaPlex = (plexNeeded * bestDollarPerPLEX) / months;
    const costViaPlexTotal = plexNeeded * bestDollarPerPLEX;
    const saveVsCash = costViaPlexTotal - cashTotalUSD; // your convention: negative = better than cash

    return {
      ...o,
      monthlyCash,
      monthlyViaPlex,
      costViaPlexTotal,
      saveVsCash,
      usedDollarPerPLEX: bestDollarPerPLEX
    };
  });

  // Decide the single BEST row
  const chooseMetric = rows.map(r => Math.min(r.monthlyCash, r.monthlyViaPlex));
  const bestIdx = indexOfStrictMin(chooseMetric);

  OMEGA_TB.innerHTML = rows.map((r, i) => {
    const isBest = (i === bestIdx);
    return `
      <tr${isBest ? ' class="highlight"' : ''}>
        <td>${isBest ? '<span class="pill best">Best</span>' : ''}<span class="numv">${r.label}</span></td>
        <td class="num">$${fmt(r.cash_usd, 2)}</td>
        <td class="num">${fmt(r.plex_cost, 0)} PLEX</td>
        <td class="num leftpill">
          <span class="numv">$${fmt(r.usedDollarPerPLEX, 4)}</span>
        </td>
        <td class="num">$${fmt(r.costViaPlexTotal, 2)}</td>
        <td class="num">$${fmt(r.saveVsCash, 2)}</td>
      </tr>
    `;
  }).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showStatus('Loading…');
    await loadPacks();
    await loadOmegaPlans();
    await fetchPLEXFromESIPrices();
    computeRows();   // packs table
    computeOmega();  // omega table
  } catch (e) {
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);

// Auto-run on load
refresh();