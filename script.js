// EVE Value Calculator (ESI-based)
// Uses ESI sell orders to estimate ISK/PLEX, then computes $/PLEX and $/ISK.
// Drop-in for your existing index.html and packs.json

// ------ DOM refs ------
const TABLE   = document.getElementById('valueTable');
const TBODY   = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR    = document.getElementById('year');
const LAST    = document.getElementById('lastUpdate');
const REGION  = document.getElementById('region');
const SOURCE  = document.getElementById('plexSource');

if (YEAR) YEAR.textContent = new Date().getFullYear();

// ------ Constants ------
const PLEX_TYPE = 44992; // PLEX type id
const ESI_ORDERS = 'https://esi.evetech.net/latest/markets'; // /{region_id}/orders/?order_type=sell&type_id=44992

// ------ State ------
let packs = [];
let plexISK = null; // chosen ISK price per 1 PLEX (sell side)

// ------ Helpers ------
function fmt(n, digits=2){
  if(n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, {maximumFractionDigits: digits});
}

function showStatus(msg, isError=false){
  const row = `<tr><td colspan="6" class="${isError?'':'muted'}">${msg}</td></tr>`;
  TBODY.innerHTML = row;
}

function median(values){
  if(!values.length) return NaN;
  const arr = values.slice().sort((a,b)=>a-b);
  const mid = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
}

function validateInputs(){
  const regionVal = REGION ? REGION.value : '10000002';
  if(!/^\d+$/.test(regionVal)) throw new Error(`Region must be a numeric ID (got "${regionVal}")`);
  const source = SOURCE ? SOURCE.value : 'median';
  if(!['median','avg','min'].includes(source)) throw new Error(`Unknown plexSource "${source}"`);
  return { region: Number(regionVal), source };
}

// ------ Data loaders ------
async function loadPacks(){
  const res = await fetch('packs.json', {cache:'no-store'});
  if(!res.ok) throw new Error(`packs.json HTTP ${res.status}`);
  packs = await res.json();
  if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

// Fetch ALL sell-order pages for region/type and return an array of prices
async function fetchESISellPrices(regionId, typeId){
  // First request: learn X-Pages
  const firstURL = `${ESI_ORDERS}/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=1`;
  const firstRes = await fetch(firstURL, { cache: 'no-store' });
  if(!firstRes.ok) throw new Error(`ESI HTTP ${firstRes.status} on page 1`);

  const xPages = Number(firstRes.headers.get('x-pages')) || 1;
  const firstData = await firstRes.json();

  // Collect page 1 prices
  let prices = firstData
    .map(o => o && o.price)
    .filter(p => typeof p === 'number' && isFinite(p) && p > 0);

  // If more pages, fetch them (in parallel)
  const tasks = [];
  for (let page = 2; page <= xPages; page++){
    const url = `${ESI_ORDERS}/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=${page}`;
    tasks.push(fetch(url, { cache: 'no-store' }).then(async res => {
      if(!res.ok) throw new Error(`ESI HTTP ${res.status} on page ${page}`);
      const data = await res.json();
      return data
        .map(o => o && o.price)
        .filter(p => typeof p === 'number' && isFinite(p) && p > 0);
    }));
  }

  if(tasks.length){
    const pages = await Promise.all(tasks);
    for (const arr of pages) prices = prices.concat(arr);
  }

  return prices;
}

async function fetchPlexISK(){
  const { region, source } = validateInputs();

  // Pull all sell prices for PLEX in region
  const prices = await fetchESISellPrices(region, PLEX_TYPE);

  if(!prices.length) throw new Error('No valid sell prices returned by ESI (prices array is empty).');

  let val;
  if (source === 'median') val = median(prices);
  else if (source === 'avg') val = prices.reduce((a,b)=>a+b, 0) / prices.length;
  else if (source === 'min') val = Math.min(...prices);

  if (typeof val !== 'number' || !isFinite(val) || val <= 0){
    throw new Error('Price feed returned zero/invalid value from ESI.');
  }

  plexISK = val; // ISK per 1 PLEX (estimated sell side)
  if (LAST) LAST.textContent = `PLEX sell ${source} (ESI) fetched: ${new Date().toLocaleString()}`;
}

// ------ Compute & render ------
function computeRows(){
  if(!packs.length){ showStatus('No packs loaded.'); return; }
  if(!plexISK){ showStatus('Waiting for PLEX price…'); return; }

  const rows = packs.map(p => {
    const price = p.sale_price_usd ?? p.price_usd;
    const perPLEX = price / p.plex_amount;
    const cashPerISK = price / (p.plex_amount * plexISK);
    return {...p, price, perPLEX, cashPerISK};
  });

  const bestPerPLEX    = Math.min(...rows.map(r => r.perPLEX));
  const bestCashPerISK = Math.min(...rows.map(r => r.cashPerISK));

  TBODY.innerHTML = rows.map(r => {
    const isBestA = Math.abs(r.perPLEX - bestPerPLEX) < 1e-12;
    const isBestB = Math.abs(r.cashPerISK - bestCashPerISK) < 1e-12;
    const bestClass = (isBestA || isBestB) ? ' class="highlight"' : '';
    return `<tr${bestClass}>
      <td>${r.name}${r.sale_price_usd ? ' <span class="pill">Sale</span>' : ''}</td>
      <td class="num">$${fmt(r.price, 2)}</td>
      <td class="num">${fmt(r.plex_amount, 0)}</td>
      <td class="num">$${fmt(r.perPLEX, 4)} ${isBestA ? ' <span class="pill best">Best</span>' : ''}</td>
      <td class="num">${fmt(plexISK, 0)}</td>
      <td class="num">$${fmt(r.cashPerISK, 9)} ${isBestB ? ' <span class="pill best">Best</span>' : ''}</td>
    </tr>`;
  }).join('');
}

// ------ Orchestration ------
async function refresh(){
  showStatus('Loading…');
  try{
    await loadPacks();
    await fetchPlexISK();
    computeRows();
  }catch(e){
    console.error(e);
    showStatus(`Error: ${e.message}`, true);
  }
}

// ------ Events ------
const refreshBtn = document.getElementById('refresh');
if (refreshBtn) refreshBtn.addEventListener('click', refresh);

if (REGION) REGION.addEventListener('change', refresh);
if (SOURCE) SOURCE.addEventListener('change', refresh);

// Auto-run on load
document.addEventListener('DOMContentLoaded', refresh);
