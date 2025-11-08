// EVE Value Calculator (static, no backend)
// - Cash packs: packs.json (you maintain)
// - PLEX→ISK: Fuzzwork aggregates (Jita region by default)

const TABLE = document.getElementById('valueTable');
const TBODY = document.getElementById('tableBody');
const PREVIEW = document.getElementById('packsPreview');
const YEAR = document.getElementById('year');
const LAST = document.getElementById('lastUpdate');
const REGION = document.getElementById('region');
const SOURCE = document.getElementById('plexSource');

YEAR.textContent = new Date().getFullYear();

const FUZZWORK = 'https://market.fuzzwork.co.uk/aggregates/'; // region, types
const PLEX_TYPE = 44992; // PLEX type id
let packs = [];
let plexISK = null; // per PLEX

function fmt(n, digits=2){
  if(n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, {maximumFractionDigits: digits});
}

async function loadPacks(){
  const res = await fetch('packs.json', {cache:'no-store'});
  packs = await res.json();
  PREVIEW.textContent = JSON.stringify(packs, null, 2);
}

async function fetchPlexISK(){
  const region = REGION.value;
  const url = `${FUZZWORK}?region=${encodeURIComponent(region)}&types=${PLEX_TYPE}`;
  const res = await fetch(url, {cache: 'no-store'});
  const data = await res.json();
  const sell = data[String(PLEX_TYPE)].sell;
  const source = SOURCE.value;
  let val = sell.median;
  if(source === 'avg') val = sell.avg;
  if(source === 'min') val = sell.min;
  plexISK = val; // ISK per 1 PLEX (sell side estimate)
  LAST.textContent = `PLEX sell ${source} fetched: ${new Date().toLocaleString()}`;
}

function computeRows(){
  if(!packs.length){ TBODY.innerHTML = '<tr><td colspan="6" class="muted">No packs loaded.</td></tr>'; return; }
  if(!plexISK){ TBODY.innerHTML = '<tr><td colspan="6" class="muted">Waiting for PLEX price…</td></tr>'; return; }

  // Build rows with metrics
  const rows = packs.map(p => {
    const price = p.sale_price_usd ?? p.price_usd;
    const perPLEX = price / p.plex_amount;
    const cashPerISK = price / (p.plex_amount * plexISK);
    return {...p, price, perPLEX, cashPerISK};
  });

  // Find best values
  const bestPerPLEX = Math.min(...rows.map(r => r.perPLEX));
  const bestCashPerISK = Math.min(...rows.map(r => r.cashPerISK));

  // Render
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

async function refresh(){
  TBODY.innerHTML = '<tr><td colspan="6" class="muted">Loading…</td></tr>';
  try{
    await Promise.all([loadPacks(), fetchPlexISK()]);
    computeRows();
  }catch(e){
    console.error(e);
    TBODY.innerHTML = `<tr><td colspan="6">Error: ${e.message}</td></tr>`;
  }
}

document.getElementById('refresh').addEventListener('click', async ()=>{
  await refresh();
});

// Auto-refresh on load
refresh();
