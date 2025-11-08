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

// Helper: ESI fallback for average price (global, not region-specific)
async function fetchEsiAveragePrice(typeId){
  const url = 'https://esi.evetech.net/latest/markets/prices/';
  const res = await fetch(url, {cache:'no-store'});
  if(!res.ok) throw new Error(`ESI prices HTTP ${res.status}`);
  const arr = await res.json();
  const rec = arr.find(x => x.type_id === typeId);
  // ESI returns { adjusted_price, average_price } or undefined
  return rec && typeof rec.average_price === 'number' ? rec.average_price : null;
}

async function fetchPlexISK(){
  const region = validateInputs();               // your existing validator
  const url = `https://market.fuzzwork.co.uk/aggregates/?region=${region}&types=${PLEX_TYPE}`;

  // Try Fuzzwork first
  let fwVal = null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok) throw new Error(`Fuzzwork HTTP ${res.status}`);
    const data = await res.json();
    const plex = data && data[String(PLEX_TYPE)];
    const sell = plex && plex.sell ? plex.sell : null;
    if (sell){
      const map = { median: sell.median, avg: sell.avg, min: sell.min };
      fwVal = map[SOURCE.value];
    }
  } catch (e) {
    // swallow; we’ll try fallback below
    console.warn('Fuzzwork error:', e);
  }

  // Accept Fuzzwork if it's a real number > 0
  if (typeof fwVal === 'number' && isFinite(fwVal) && fwVal > 0){
    plexISK = fwVal;
    LAST.textContent = `PLEX sell ${SOURCE.value} (Fuzzwork, region ${region}) at ${new Date().toLocaleString()}`;
    return;
  }

  // Fallback: ESI average price (global)
  const esiAvg = await fetchEsiAveragePrice(PLEX_TYPE);
  if (typeof esiAvg === 'number' && isFinite(esiAvg) && esiAvg > 0){
    plexISK = esiAvg;
    LAST.textContent = `PLEX average_price (ESI global fallback) at ${new Date().toLocaleString()}`;
    return;
  }

  // If still nothing, throw a helpful error
  throw new Error(
    `PLEX price unavailable from Fuzzwork (zeros) and ESI fallback. 
Try again later, or set a manual override for now.`
  );
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
