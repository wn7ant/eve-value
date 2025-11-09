// EVE Value Calculator — ESI only, GitHub Pages friendly
// Tables:
// 1) Value:  Quantity | Cash Price | $/PLEX | $/Billion Ƶ
// 2) Omega:  Duration | $ | PLEX | $/month | PLEX exchange (=$/PLEX * PLEX / months)

// -------------------- DOM --------------------
const TBODY      = document.getElementById('tableBody');
const OMEGA_BODY = document.getElementById('omegaBody');
const YEAR       = document.getElementById('year');
const LAST       = document.getElementById('lastUpdate'); // we repurpose text into the banner
const BTN        = document.getElementById('refresh');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX      = 44992;

// -------------------- State --------------------
let packs = [];           // from packs.json
let omegaPlans = [];      // from omega.json
let iskPerPLEX = null;    // number (ISK per 1 PLEX)

// -------------------- Helpers --------------------
const fmtNum = (n, d = 2) =>
  (n === null || n === undefined || Number.isNaN(n)) ? '—'
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

const fmtCash = (n, d = 2) => `$${fmtNum(n, d)}`;

function showRowStatus(tbody, msg, isError = false, colspan = 6) {
  tbody.innerHTML = `<tr><td colspan="${colspan}" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
}

function monthsFromLabel(label) {
  // "24 Months" -> 24, "1 Month" -> 1
  const m = String(label).match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// strictly choose one smallest value (first wins on tie within tiny epsilon)
function indexOfStrictMin(arr) {
  let idx = 0, val = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < val - 1e-9) { idx = i; val = v; }
  }
  return idx;
}

// banner update: "PLEX / Ƶ <rate> as of <timestamp>"
function updateBanner(rate) {
  const banner = document.querySelector('.plexrate');
  if (!banner) return;

  const when = new Date();
  const rateStr = fmtNum(rate, 0); // ISK/PLEX is big; 0 decimals looks good

  banner.innerHTML = `
    <span class="plex-word">PLEX</span>
    <span class="slash">/</span>
    <span class="isk-word">&#x01B5;</span>
    <span class="rate">${rateStr}</span>
    <span class="asof">as of ${when.toLocaleString()}</span>
  `;

  // we no longer show trailing status text after the Refresh button
  if (LAST) LAST.textContent = '';
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

async function fetchPLEXFromESIPrices() {
  const res = await fetch(ESI_PRICES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('ESI prices returned empty array.');

  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);

  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = Number.isFinite(avg) && avg > 0 ? avg
                : (Number.isFinite(adj) && adj > 0 ? adj : NaN);

  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error('PLEX price missing or zero in ESI prices.');
  }

  iskPerPLEX = chosen;   // ISK per PLEX
  updateBanner(iskPerPLEX);
}

// -------------------- Render: VALUE table --------------------
function renderValueTable() {
  // Expect columns: Quantity | Cash | $/PLEX | $/Billion Ƶ
  if (!packs.length) { showRowStatus(TBODY, 'No packs loaded.', false, 4); return; }
  if (!iskPerPLEX)   { showRowStatus(TBODY, 'Waiting for PLEX price…', false, 4); return; }

  // compute rows
  const rows = packs.map(p => {
    const cash = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = cash / p.plex_amount;
    const dollarsPerISK = perPLEX / iskPerPLEX;        // $ / ISK
    const dollarsPerBillion = dollarsPerISK * 1_000_000_000; // $ / 1B ISK
    return { name: p.name || `${p.plex_amount} PLEX`, qty: p.plex_amount, cash, perPLEX, dollarsPerBillion };
  });

  // pick one “best” per metric
  const bestPerPLEX    = indexOfStrictMin(rows.map(r => r.perPLEX));
  const bestPerBillion = indexOfStrictMin(rows.map(r => r.dollarsPerBillion));

  TBODY.innerHTML = rows.map((r, i) => {
    const isBestA = i === bestPerPLEX;
    const isBestB = i === bestPerBillion;

    const cellPerPLEX =
      `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmtNum(r.perPLEX, 4)}</span>`;
    const cellPerB =
      `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmtNum(r.dollarsPerBillion, 2)} / 1B &#x01B5;</span>`;

    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td class="left">${r.name}</td>
      <td class="num">${fmtCash(r.cash, 2)}</td>
      <td class="num leftpill">${cellPerPLEX}</td>
      <td class="num leftpill">${cellPerB}</td>
    </tr>`;
  }).join('');
}

// -------------------- Render: OMEGA table --------------------
function renderOmegaTable() {
  // Expect headers: Duration | $ | PLEX | $/month | PLEX exchange
  if (!omegaPlans.length) { showRowStatus(OMEGA_BODY, 'No omega data.', false, 5); return; }
  if (!iskPerPLEX)        { showRowStatus(OMEGA_BODY, 'Waiting for PLEX price…', false, 5); return; }

  // derive $/PLEX from the BEST row in the Value table (lowest $/PLEX)
  const perPLEXFromPacks = (() => {
    if (!packs.length) return null;
    const costs = packs.map(p => (p.sale_price_usd ?? p.price_usd) / p.plex_amount);
    return Math.min(...costs);
  })();

  if (!Number.isFinite(perPLEXFromPacks)) {
    showRowStatus(OMEGA_BODY, 'Cannot derive $/PLEX from packs.', true, 5);
    return;
  }

  // build rows with per-month figures
  const rows = omegaPlans.map(o => {
    const months = monthsFromLabel(o.label);
    const cashPerMonth = o.cash_usd / months;
    const plexPerMonth = (perPLEXFromPacks * o.plex_cost) / months; // PLEX exchange per month
    return { ...o, months, cashPerMonth, plexPerMonth };
  });

  // Best = strictly lowest PLEX-per-month
  const bestIdx = indexOfStrictMin(rows.map(r => r.plexPerMonth));

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const isBest = i === bestIdx;

    const plexPerMonthCell =
      `${isBest ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmtNum(r.plexPerMonth, 2)}</span>`;

    const rowClass = isBest ? ' class="highlight"' : '';

    return `<tr${rowClass}>
      <td class="left">${r.label}</td>
      <td class="num"><span class="is-cash">$</span>${fmtNum(r.cash_usd, 2)}</td>
      <td class="num"><span class="is-plex">${fmtNum(r.plex_cost, 0)}</span></td>
      <td class="num"><span class="is-cash">$</span>${fmtNum(r.cashPerMonth, 2)}</td>
      <td class="num leftpill">${plexPerMonthCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Refresh Flow --------------------
async function refresh() {
  try {
    showRowStatus(TBODY, 'Loading packs…', false, 4);
    showRowStatus(OMEGA_BODY, 'Loading omega plans…', false, 5);
    await Promise.all([loadPacks(), loadOmegaPlans(), fetchPLEXFromESIPrices()]);
    renderValueTable();
    renderOmegaTable();
  } catch (e) {
    console.error(e);
    showRowStatus(TBODY, `Error: ${e.message}`, true, 4);
    showRowStatus(OMEGA_BODY, `Error: ${e.message}`, true, 5);
  }
}

BTN && BTN.addEventListener('click', refresh);

// Auto-run
refresh();