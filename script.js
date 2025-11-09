// EVE Value — ESI-only, GitHub Pages friendly
// - Packs: packs.json
// - Omega: omega.json  (with {label, months, cash_usd, plex_cost})
// - PLEX price: ESI /markets/prices (type_id=44992), average_price -> adjusted_price

// ---------------- DOM ----------------
const YEAR      = document.getElementById('year');
const BTN       = document.getElementById('refresh');

// Banner pieces
const PLEX_RATE = document.getElementById('plexRate');
const AS_OF     = document.getElementById('asOf');

// Packs table
const TBODY     = document.getElementById('tableBody');
// Omega table
const OMEGA_TB  = document.getElementById('omegaBody');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------- Config --------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------- State ---------------
let packs = [];           // from packs.json
let omegaPlans = [];      // from omega.json
let plexISK = null;       // ISK per 1 PLEX
let bestUsdPerPLEX = null; // best $/PLEX across packs

// -------------- Helpers -------------
const fmt = (n, d = 2) =>
  (n === null || n === undefined || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

const fmtInt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

function showPacksStatus(msg, isError = false) {
  TBODY.innerHTML = `<tr><td colspan="4" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}
function showOmegaStatus(msg, isError = false) {
  OMEGA_TB.innerHTML = `<tr><td colspan="5" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

// -------------- Loads ----------------
async function loadPacks() {
  const res = await fetch('packs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (!Array.isArray(packs) || packs.length === 0) throw new Error('packs.json is empty.');
}

async function loadOmega() {
  const res = await fetch('omega.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
  if (!Array.isArray(omegaPlans) || omegaPlans.length === 0) {
    throw new Error('omega.json is empty.');
  }
}

async function fetchPLEXFromESI() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI prices returned an empty array.');

  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);

  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = (Number.isFinite(avg) && avg > 0) ? avg
                : (Number.isFinite(adj) && adj > 0 ? adj : NaN);
  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price missing or zero in ESI prices.');
  }
  plexISK = chosen;

  // Banner update
  if (PLEX_RATE) PLEX_RATE.textContent = fmtInt(plexISK);
  if (AS_OF) AS_OF.textContent = `as of ${new Date().toLocaleString()}`;
}

// -------------- Packs render ----------
function renderPacks() {
  if (!packs.length) { showPacksStatus('No packs loaded.'); return; }
  if (!plexISK) { showPacksStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const qty   = Number(p.plex_amount || p.plex || 0);
    const usdPerPLEX = price / qty;
    const usdPerBillion = price * 1e9 / (qty * plexISK);

    return { 
      name: p.name || `${fmtInt(qty)} PLEX`,
      price,
      qty,
      usdPerPLEX,
      usdPerBillion
    };
  });

  bestUsdPerPLEX = Math.min(...rows.map(r => r.usdPerPLEX));

  TBODY.innerHTML = rows.map(r => `
    <tr>
      <td class="left">${r.name}</td>
      <td class="num">${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.usdPerPLEX, 4)}</td>
      <td class="num">${fmt(r.usdPerBillion, 2)}</td>
    </tr>
  `).join('');
}

// -------------- Omega render ----------
function renderOmega() {
  if (!omegaPlans.length) { showOmegaStatus('No omega plans.'); return; }
  if (!plexISK || !Number.isFinite(bestUsdPerPLEX)) {
    showOmegaStatus('Waiting for PLEX price…'); return;
  }

  // Compute each row:
  // $/month = cash_usd / months
  // PLEX exchange (monthly) = (bestUsdPerPLEX * plex_cost) / months
  const rows = omegaPlans.map(o => {
    const perMonthCash = o.cash_usd / o.months;
    const plexMonthly  = (bestUsdPerPLEX * o.plex_cost) / o.months;
    return {
      label: o.label,
      cash_usd: o.cash_usd,
      plex_cost: o.plex_cost,
      perMonthCash,
      plexMonthly
    };
  });

  OMEGA_TB.innerHTML = rows.map(r => `
    <tr>
      <td class="left">${r.label}</td>
      <td class="num">${fmt(r.cash_usd, 0)}</td>
      <td class="num">${fmtInt(r.plex_cost)}</td>
      <td class="num">${fmt(r.perMonthCash, 0)}</td>
      <td class="num">${fmt(r.plexMonthly, 2)}</td>
    </tr>
  `).join('');
}

// -------------- Flow ------------------
async function refresh() {
  try {
    showPacksStatus('Loading packs…');
    showOmegaStatus('Loading omega plans…');

    await Promise.all([loadPacks(), loadOmega(), fetchPLEXFromESI()]);
    renderPacks();
    renderOmega();
  } catch (e) {
    console.error(e);
    showPacksStatus(`Error: ${e.message}`, true);
    showOmegaStatus(`Error: ${e.message}`, true);
  }
}

BTN && BTN.addEventListener('click', refresh);
refresh();