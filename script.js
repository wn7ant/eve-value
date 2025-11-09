<!-- script.js (drop-in) -->
<script>
// EVE Value Calculator — ESI-only, static friendly

// -------------------- DOM --------------------
const TBODY   = document.getElementById('tableBody');     // packs table body
const OMEGA_BODY = document.getElementById('omegaBody');  // omega table body
const OMEGA_HEAD = document.querySelector('#omegaTable thead tr');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');

YEAR && (YEAR.textContent = new Date().getFullYear());

// -------------------- Config --------------------
const ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';
const TYPE_PLEX = 44992;

// -------------------- State --------------------
let packs = [];          // from packs.json
let omegaPlans = [];     // from omega.json
let plexISK = null;      // ISK per 1 PLEX (from ESI)
let bestDollarPerPLEX = null; // computed from packs table

// -------------------- Helpers --------------------
const fmt = (n, d=2) => (n===null||n===undefined||Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString(undefined,{maximumFractionDigits:d});
const money = (n, d=2) => '$' + fmt(n, d);

function showPacksStatus(msg, isError=false){
  TBODY.innerHTML = `<tr><td colspan="6" class="${isError?'':'muted'}">${msg}</td></tr>`;
}
function showOmegaStatus(msg, isError=false){
  OMEGA_BODY.innerHTML = `<tr><td colspan="5" class="${isError?'':'muted'}">${msg}</td></tr>`;
}

// choose exactly one strict min index
function strictMinIndex(arr){
  let idx = 0, v = arr[0];
  for(let i=1;i<arr.length;i++){
    if(arr[i] < v - 1e-12){ v = arr[i]; idx = i; }
  }
  return idx;
}

// -------------------- Loads --------------------
async function loadPacks(){
  const res = await fetch('packs.json', {cache:'no-store'});
  if(!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
}
async function loadOmega(){
  const res = await fetch('omega.json', {cache:'no-store'});
  if(!res.ok) throw new Error(`omega.json HTTP ${res.status}`);
  omegaPlans = await res.json();
}

async function fetchPLEXFromESI(){
  const res = await fetch(ESI_PRICES_URL, {cache:'no-store'});
  if(!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const data = await res.json();
  const row = data.find(d => Number(d.type_id) === TYPE_PLEX);
  if(!row) throw new Error(`PLEX (type_id=${TYPE_PLEX}) not found in ESI prices.`);
  const avg = Number(row.average_price);
  const adj = Number(row.adjusted_price);
  const chosen = (Number.isFinite(avg) && avg>0) ? avg : (Number.isFinite(adj) && adj>0 ? adj : NaN);
  if(!Number.isFinite(chosen) || chosen<=0) throw new Error('PLEX ISK price missing/zero in ESI prices.');
  plexISK = chosen;  // ISK per PLEX
  LAST && (LAST.textContent = `PLEX via ESI prices: ${new Date().toLocaleString()}`);
}

// -------------------- Packs table --------------------
function renderPacks(){
  if(!packs.length){ showPacksStatus('No packs loaded.'); return; }
  if(!plexISK){ showPacksStatus('Waiting for PLEX price…'); return; }

  // rows with computed metrics
  const rows = packs.map(p => {
    const price = (p.sale_price_usd ?? p.price_usd);
    const perPLEX = price / p.plex_amount;                        // $/PLEX
    const dollarsPerBillionISK = price / (p.plex_amount * plexISK / 1e9); // $ per 1B ISK
    return {...p, price, perPLEX, dollarsPerBillionISK};
  });

  // bests (packs table only)
  const bestPerPLEXIdx = strictMinIndex(rows.map(r=>r.perPLEX));
  const bestPerBIdx    = strictMinIndex(rows.map(r=>r.dollarsPerBillionISK));
  bestDollarPerPLEX    = rows[bestPerPLEXIdx].perPLEX;  // used by Omega; independent best

  TBODY.innerHTML = rows.map((r, i) => {
    const bestA = (i===bestPerPLEXIdx);
    const bestB = (i===bestPerBIdx);
    const cls   = (bestA||bestB) ? ' class="highlight"' : '';
    return `<tr${cls}>
      <td class="left">${r.name || (r.plex_amount+' PLEX')}</td>
      <td class="num">${money(r.price, 2)}</td>
      <td class="num leftpill">${bestA?'<span class="pill best">Best</span>':''}<span class="numv">${money(r.perPLEX,4)}</span></td>
      <td class="num leftpill">${bestB?'<span class="pill best">Best</span>':''}<span class="numv">${money(r.dollarsPerBillionISK,2)} / 1B \u01B5</span></td>
    </tr>`;
  }).join('');
}

// -------------------- Omega table --------------------
// Rebuild the header to the exact spec (Duration | $ | PLEX | $/month | PLEX exchange)
function ensureOmegaHeader(){
  if(!OMEGA_HEAD) return;
  OMEGA_HEAD.innerHTML = `
    <th class="left">Duration</th>
    <th class="num"><span class="is-cash">$</span></th>
    <th class="num"><span class="is-plex">PLEX</span></th>
    <th class="num"><span class="is-cash">$</span>/month</th>
    <th class="num"><span class="is-plex">PLEX</span> exchange</th>
  `;
}

function monthsFromLabel(label){
  // expects like "1 Month", "24 Months" — fallback to 1 if not found
  const m = String(label||'').match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

function renderOmega(){
  ensureOmegaHeader();

  if(!omegaPlans.length){ showOmegaStatus('No Omega data.'); return; }
  if(!bestDollarPerPLEX){ showOmegaStatus('Waiting for $/PLEX from packs…'); return; }

  // Build normalized rows
  const rows = omegaPlans.map(o => {
    const months = o.months ? Number(o.months) : monthsFromLabel(o.label);
    const cash   = Number(o.cash_usd);
    const plex   = Number(o.plex_cost);

    const cashPerMonth = cash / months;
    const plexExchangePerMonth = (bestDollarPerPLEX * plex) / months;

    return { label: o.label, months, cash, plex, cashPerMonth, plexExchangePerMonth };
  });

  // No “Best” pill logic required (tables are independent), but if desired:
  // choose the single best overall *per-month* across BOTH methods:
  const perMonthArray = rows.map(r => Math.min(r.cashPerMonth, r.plexExchangePerMonth));
  const bestIdx = strictMinIndex(perMonthArray);

  OMEGA_BODY.innerHTML = rows.map((r, i) => {
    const cls = (i===bestIdx) ? ' class="highlight"' : '';
    return `<tr${cls}>
      <td class="left">${r.label}</td>
      <td class="num">${money(r.cash, 2)}</td>
      <td class="num">${fmt(r.plex, 0)}</td>
      <td class="num">${money(r.cashPerMonth, 2)}</td>
      <td class="num">${money(r.plexExchangePerMonth, 2)}</td>
    </tr>`;
  }).join('');
}

// -------------------- Refresh --------------------
async function refresh(){
  try{
    showPacksStatus('Loading…');
    showOmegaStatus('Loading…');
    await Promise.all([loadPacks(), loadOmega(), fetchPLEXFromESI()]);
    renderPacks();   // computes bestDollarPerPLEX
    renderOmega();   // uses bestDollarPerPLEX; tables remain independent
  }catch(e){
    console.error(e);
    showPacksStatus(`Error: ${e.message}`, true);
    showOmegaStatus(`Error: ${e.message}`, true);
  }
}

document.getElementById('refresh')?.addEventListener('click', refresh);
refresh();
</script>