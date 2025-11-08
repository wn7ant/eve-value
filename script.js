// EVE Value Calculator — ESI-only, GitHub Pages friendly
// Data sources:
// - Cash packs: packs.json (you maintain)
// - Omega plans: omega.json (you maintain)
// - ISK per PLEX: ESI prices endpoint (type_id=44992), uses average_price then adjusted_price

// -------------------- DOM --------------------
const TBODY      = document.getElementById('tableBody');   // packs tbody
const YEAR       = document.getElementById('year');
const LAST       = document.getElementById('lastUpdate');
const PREVIEW    = document.getElementById('packsPreview');
const OMEGA_BODY = document.getElementById('omegaBody');   // omega tbody

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const HIDE_PACKS_PREVIEW = true;
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];
let plexISK = null; // ISK per PLEX from ESI prices
let omegaPlans = [];

// -------------------- Helpers --------------------
function fmt(n, digits = 2){
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function showStatus(msg, isError = false){
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError?'':'muted'}">${msg}</td></tr>`;
}
function indexOfStrictMin(arr){
  let bestIdx = 0, bestVal = arr[0];
  for (let i=1;i<arr.length;i++){
    const v = arr[i];
    if (v < bestVal - 1e-9){ bestVal = v; bestIdx = i; }
  }
  return bestIdx;
}

// -------------------- Loads --------------------
async function loadPacks(){
  const res = await fetch('packs.json', { cache:'no-store' });
  if (!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();

  if (HIDE_PACKS_PREVIEW){
    const sec = PREVIEW?.closest('.section'); if (sec) sec.style.display = 'none';
  } else {
    PREVIEW && (PREVIEW.textContent = JSON.stringify(packs, null, 2));
  }
}
async function loadOmega(){
  const res = await fetch('omega.json', { cache:'no-store' });
  if (!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}
async function fetchPLEXFromESIPrices(){
  const res = await fetch(ESI_PRICES_URL, { cache:'no-store' });
  if (!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  const row = Array.isArray(data) ? data.find(d => Number(d.type_id) === TYPE_PLEX) : null;
  if (!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);
  const avg = Number(row.average_price), adj = Number(row.adjusted_price);
  const chosen = Number.isFinite(avg) && avg>0 ? avg : (Number.isFinite(adj)&&adj>0 ? adj : NaN);
  if (!Number.isFinite(chosen) || chosen<=0) throw new Error('PLEX price missing or zero in ESI prices.');
  plexISK = chosen;
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Packs table --------------------
function computePacksTable(){
  if (!packs.length){ showStatus('No packs loaded.'); return; }
  if (!plexISK){ showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;
    // $ per Billion ISK
    const dollarsPerBillion = (price / (p.plex_amount * plexISK)) * 1_000_000_000;
    return { ...p, price, perPLEX, dollarsPerBillion };
  });

  const perPLEXArr = rows.map(r => r.perPLEX);
  const perBILArr  = rows.map(r => r.dollarsPerBillion);
  const bestPerPLEXIdx = indexOfStrictMin(perPLEXArr);
  const bestPerBilIdx  = indexOfStrictMin(perBILArr);

  TBODY.innerHTML = rows.map((r,i) => {
    const isBestA = i===bestPerPLEXIdx;
    const isBestB = i===bestPerBilIdx;

    const perPLEXCell = `${isBestA ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.perPLEX,4)}</span>`;
    const perBilCell  = `${isBestB ? '<span class="pill best">Best</span>' : ''}<span class="numv">$${fmt(r.dollarsPerBillion,2)} / 1B</span>`;

    const rowClass = (isBestA || isBestB) ? ' class="highlight"' : '';
    return `<tr${rowClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price,2)}</td>
      <td class="num leftpill">${perPLEXCell}</td>
      <td class="num">${fmt(plexISK,0)}</td>
      <td class="num leftpill">${perBilCell}</td>
    </tr>`;
  }).join('');
}

// -------------------- Omega table (6 columns, fixed) --------------------
function computeOmegaTable(){
  if (!OMEGA_BODY) return;
  if (!omegaPlans.length){
    OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">No Omega data.</td></tr>';
    return;
  }
  if (!plexISK){
    OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">Waiting for PLEX price…</td></tr>';
    return;
  }
  if (!packs.length){
    OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">Packs not loaded.</td></tr>';
    return;
  }

  // Best $/PLEX from packs table
  const bestPerPLEX = Math.min(...packs.map(p => (p.sale_price_usd ?? p.price_usd) / p.plex_amount));

  // Build rows — ALWAYS SIX <td> CELLS
  const rows = omegaPlans.map(o => {
    const costViaPLEX = bestPerPLEX * o.plex_cost;     // USD estimate using best $/PLEX
    const saveVsCash  = costViaPLEX - o.cash_usd;      // positive => PLEX costs more than cash
    return { ...o, bestPerPLEX, costViaPLEX, saveVsCash };
  });

  // “Best” pill shown once in the $/PLEX Used column (first row)
  OMEGA_BODY.innerHTML = rows.map((r, idx) => {
    const pill = idx===0 ? '<span class="pill best">Best</span>' : '';
    return `<tr>
      <td>${r.label}</td>
      <td class="num">$${fmt(r.cash_usd,2)}</td>
      <td class="num">${fmt(r.plex_cost,0)} PLEX</td>
      <td class="num leftpill">${pill}<span class="numv">$${fmt(r.bestPerPLEX,3)}</span></td>
      <td class="num">$${fmt(r.costViaPLEX,2)}</td>
      <td class="num">$${fmt(r.saveVsCash,2)}</td>
    </tr>`;
  }).join('');
}

// -------------------- Refresh --------------------
async function refresh(){
  try{
    showStatus('Loading…');
    await Promise.all([loadPacks(), loadOmega()]);
    await fetchPLEXFromESIPrices();
    computePacksTable();
    computeOmegaTable();
  }catch(e){
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
    if (OMEGA_BODY){ OMEGA_BODY.innerHTML = '<tr><td colspan="6" class="muted">Omega failed to load.</td></tr>'; }
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);
refresh();