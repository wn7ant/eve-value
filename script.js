// EVE Value Calculator — ESI-only, GitHub Pages friendly

// -------------------- DOM --------------------
const TBODY    = document.getElementById('tableBody');   // packs body
const OMEGA    = document.getElementById('omegaBody');   // omega body
const YEAR     = document.getElementById('year');
const PLEXRATE = document.getElementById('plexRate');    // banner number
const ASOF     = document.getElementById('asOf');        // banner timestamp
const REFRESH  = document.getElementById('refresh');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX      = 44992;

// -------------------- State --------------------
let packs = [];
let omegaPlans = [];
let iskPerPLEX = null;      // ISK per 1 PLEX (from ESI prices)
let bestUsdPerPLEX = null;  // lowest $/PLEX across packs (for Omega calc)

// -------------------- Utils --------------------
const fmt = (n, d = 2) =>
  (n === null || n === undefined || Number.isNaN(n))
    ? '—'
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

const dollars = (n, d = 2) => `$${fmt(n, d)}`;

function showPacksStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function showOmegaStatus(msg, isError = false) {
  OMEGA.innerHTML = `<tr><td colspan="5" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

// -------------------- Data Loads --------------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
}

async function loadOmegaPlans() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}

// ESI prices: returns array of { type_id, average_price, adjusted_price } (in ISK)
async function fetchPLEXfromESI() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI prices returned empty array.');

  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);

  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = (Number.isFinite(avg) && avg > 0) ? avg
                : (Number.isFinite(adj) && adj > 0) ? adj
                : NaN;
  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price missing or zero in ESI prices.');
  }

  iskPerPLEX = chosen; // ISK per 1 PLEX
  if (PLEXRATE) PLEXRATE.textContent = fmt(iskPerPLEX, 0);
  if (ASOF) ASOF.textContent = `as of ${new Date().toLocaleString()}`;
}

// -------------------- Packs table --------------------
function renderPacks() {
  if (!packs.length) { showPacksStatus('No packs found.'); return; }
  if (!iskPerPLEX)    { showPacksStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    const dollarsPerBillionISK = price / (p.plex_amount * iskPerPLEX) * 1e9;
    return { name: p.name || `${p.plex_amount} PLEX`, plex: p.plex_amount, price, perPLEX, dollarsPerBillionISK };
  });

  // compute best $/PLEX for Omega calculations
  bestUsdPerPLEX = Math.min(...rows.map(r => r.perPLEX));

  TBODY.innerHTML = rows.map(r => `
    <tr>
      <td class="left">${r.name}</td>
      <td class="num">${dollars(r.price, 2)}</td>
      <td class="num">${dollars(r.perPLEX, 4)}</td>
      <td class="num">${dollars(r.dollarsPerBillionISK, 2)} <span class="is-isk">/ 1B Ƶ</span></td>
    </tr>
  `).join('');
}

// -------------------- Omega table (5 columns) --------------------
// Columns: Duration | $ | PLEX | $/month | PLEX exchange
// $/month = cash_usd / months
// PLEX exchange = (bestUsdPerPLEX * plex_cost) / months
function renderOmega() {
  if (!omegaPlans.length) { showOmegaStatus('No omega plans.'); return; }
  if (!bestUsdPerPLEX)    { showOmegaStatus('Waiting for best $/PLEX from packs…'); return; }

  const rows = omegaPlans.map(o => {
    const months = Number(o.months) || 1;
    const cashPerMonth = o.cash_usd / months;
    const plexPerMonth = (bestUsdPerPLEX * o.plex_cost) / months;
    return {
      label: o.label,
      cash_usd: o.cash_usd,
      plex_cost: o.plex_cost,
      cashPerMonth,
      plexPerMonth
    };
  });

  OMEGA.innerHTML = rows.map(r => `
    <tr>
      <td class="left">${r.label}</td>
      <td class="num">${dollars(r.cash_usd, 0)}</td>
      <td class="num">${fmt(r.plex_cost, 0)}</td>
      <td class="num">${dollars(r.cashPerMonth, r.cashPerMonth < 10 ? 2 : 0)}</td>
      <td class="num">${dollars(r.plexPerMonth, r.plexPerMonth < 10 ? 2 : 0)}</td>
    </tr>
  `).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showPacksStatus('Loading packs…');
    showOmegaStatus('Loading omega plans…');
    await Promise.all([loadPacks(), loadOmegaPlans(), fetchPLEXfromESI()]);
    renderPacks();
    renderOmega();
  } catch (e) {
    console.error(e);
    showPacksStatus(`Error: ${e.message}`, true);
    showOmegaStatus(`Error: ${e.message}`, true);
  }
}

REFRESH && REFRESH.addEventListener('click', refresh);

// Auto-run on load
refresh();