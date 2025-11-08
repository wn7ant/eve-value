// EVE Value Calculator — static, GitHub Pages friendly
// Sources (static):
// - Cash packs: packs.json (you maintain)
// - Omega plans: omega.json (you maintain)
// - PLEX price: ESI markets/prices (single list; we pick PLEX row)

// -------------------- DOM --------------------
var TBODY   = document.getElementById('tableBody');
var OTBODY  = document.getElementById('omegaBody');
var YEAR    = document.getElementById('year');
var LAST    = document.getElementById('lastUpdate');
var REGION  = document.getElementById('region');
var SOURCE  = document.getElementById('plexSource');
var PREVIEW = document.getElementById('packsPreview');

if (YEAR) YEAR.textContent = new Date().getFullYear();

// -------------------- Constants --------------------
var TYPE_PLEX = 44992;
var ESI_PRICES_URL = 'https://esi.evetech.net/latest/markets/prices/?datasource=tranquility';

// -------------------- State --------------------
var packs = [];
var omegaPlans = [];
var plexISK = null;       // ISK per 1 PLEX (from ESI prices list)
var bestPerPLEX = null;   // lowest $/PLEX among packs

// -------------------- Helpers --------------------
function fmt(n, digits) {
  if (digits === void 0) digits = 2;
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function showStatus(msg, isError) {
  if (isError === void 0) isError = false;
  TBODY.innerHTML = '<tr><td colspan="6" class="' + (isError ? '' : 'muted') + '">' + msg + '</td></tr>';
}

function showOmegaStatus(msg, isError) {
  if (isError === void 0) isError = false;
  OTBODY.innerHTML = '<tr><td colspan="6" class="' + (isError ? '' : 'muted') + '">' + msg + '</td></tr>';
}

function median(nums) {
  if (!nums.length) return NaN;
  var v = nums.slice().sort(function(a,b){return a-b;});
  var mid = Math.floor(v.length/2);
  return v.length % 2 ? v[mid] : (v[mid-1]+v[mid])/2;
}

function average(nums) {
  if (!nums.length) return NaN;
  var sum = 0;
  for (var i=0;i<nums.length;i++) sum += nums[i];
  return sum / nums.length;
}

function uiAgg() {
  var v = (SOURCE && (SOURCE.value==='median' || SOURCE.value==='avg' || SOURCE.value==='min')) ? SOURCE.value : 'median';
  return v;
}

function pickAggregation(prices, mode) {
  if (!prices.length) return NaN;
  if (mode === 'min') return Math.min.apply(Math, prices);
  if (mode === 'avg') return average(prices);
  return median(prices);
}

// -------------------- Data Loads --------------------
function loadJSON(url) {
  return fetch(url, { cache: 'no-store' }).then(function(res){
    if (!res.ok) throw new Error(url + ' HTTP ' + res.status);
    return res.json();
  });
}

function loadPacks() {
  return loadJSON('packs.json').then(function(data){
    packs = data;
    if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
  });
}

function loadOmega() {
  return loadJSON('omega.json').then(function(data){
    omegaPlans = data;
  });
}

// ESI "markets/prices" returns an array of {type_id, average_price?, adjusted_price?}
// We pick the PLEX row and use average_price if present; else adjusted_price.
function fetchPLEXfromESI() {
  return loadJSON(ESI_PRICES_URL).then(function(arr){
    if (!arr || !arr.length) throw new Error('ESI prices returned empty array.');
    var row = null;
    for (var i=0;i<arr.length;i++){
      if (Number(arr[i].type_id) === TYPE_PLEX) { row = arr[i]; break; }
    }
    if (!row) throw new Error('PLEX (type_id 44992) not found in ESI prices.');
    var price = Number(row.average_price || row.adjusted_price || NaN);
    if (!isFinite(price) || price <= 0) throw new Error('PLEX price missing or invalid in ESI.');
    plexISK = price;
    if (LAST) LAST.textContent = 'PLEX from ESI prices at ' + new Date().toLocaleString();
  });
}

// -------------------- Compute/Render: Packs --------------------
function computePackRows() {
  if (!packs.length) { showStatus('No packs loaded.'); return []; }
  if (!plexISK) { showStatus('Waiting for PLEX price…'); return []; }

  var rows = packs.map(function(p){
    var price = (p.sale_price_usd != null ? p.sale_price_usd : p.price_usd);
    var perPLEX = price / p.plex_amount;
    var cashPerISK = price / (p.plex_amount * plexISK);
    return { name:p.name, plex_amount:p.plex_amount, price:price, perPLEX:perPLEX, cashPerISK:cashPerISK, sale:p.sale_price_usd!=null };
  });

  bestPerPLEX = Math.min.apply(Math, rows.map(function(r){return r.perPLEX;}));
  var bestCashPerISK = Math.min.apply(Math, rows.map(function(r){return r.cashPerISK;}));

  TBODY.innerHTML = rows.map(function(r){
    var isBestA = Math.abs(r.perPLEX - bestPerPLEX) < 1e-12;
    var isBestB = Math.abs(r.cashPerISK - bestCashPerISK) < 1e-12;
    var bestClass = (isBestA || isBestB) ? ' class="highlight"' : '';
    // pill left, number right (CSS handles layout)
    return '<tr'+bestClass+'>\
      <td>'+r.name+(r.sale ? ' <span class="pill">Sale</span>' : '')+'</td>\
      <td class="num">$'+fmt(r.price,2)+'</td>\
      <td class="num">'+fmt(r.plex_amount,0)+'</td>\
      <td class="num"><span class="pill best'+(isBestA?'':' hidden')+'">Best</span><span class="numval">$'+fmt(r.perPLEX,4)+'</span></td>\
      <td class="num">'+fmt(plexISK,0)+'</td>\
      <td class="num"><span class="pill best'+(isBestB?'':' hidden')+'">Best</span><span class="numval">$'+fmt(r.cashPerISK,9)+'</span></td>\
    </tr>';
  }).join('');

  return rows;
}

// -------------------- Compute/Render: Omega --------------------
function renderOmegaTable() {
  if (!omegaPlans.length) { showOmegaStatus('No omega plans loaded.'); return; }
  if (!isFinite(bestPerPLEX)) { showOmegaStatus('Waiting for packs to compute best $/PLEX…'); return; }

  // Build rows: cash vs plex route using bestPerPLEX
  var rows = omegaPlans.map(function(o){
    var cash = Number(o.cash_usd);
    var plexNeeded = Number(o.plex_amount);
    var viaPlex = plexNeeded * bestPerPLEX;
    var delta = cash - viaPlex; // positive means PLEX route is cheaper
    return {
      label: o.label,
      months: o.months,
      cash: cash,
      plexNeeded: plexNeeded,
      perPLEXUsed: bestPerPLEX,
      viaPlex: viaPlex,
      save: delta
    };
  });

  // Render
  OTBODY.innerHTML = rows.map(function(r){
    var saveStr = (r.save === 0) ? '$0.00' : (r.save > 0 ? ('+$'+fmt(r.save,2)) : ('-$'+fmt(Math.abs(r.save),2)));
    return '<tr>\
      <td>'+r.label+' ('+r.months+'m)</td>\
      <td class="num">$'+fmt(r.cash,2)+'</td>\
      <td class="num">'+fmt(r.plexNeeded,0)+'</td>\
      <td class="num">$'+fmt(r.perPLEXUsed,4)+'</td>\
      <td class="num">$'+fmt(r.viaPlex,2)+'</td>\
      <td class="num">'+saveStr+'</td>\
    </tr>';
  }).join('');
}

// -------------------- Manual Override (optional) --------------------
window.setManualPLEX = function(iskPerPLEX) {
  var v = Number(iskPerPLEX);
  if (!isFinite(v) || v <= 0) { alert('Invalid manual ISK/PLEX value.'); return; }
  plexISK = v;
  if (LAST) LAST.textContent = 'Manual override: ISK/PLEX = '+fmt(v,0)+' at '+new Date().toLocaleString();
  // Recompute both tables
  computePackRows();
  renderOmegaTable();
};

// -------------------- Refresh Flow --------------------
function refresh() {
  showStatus('Loading…');
  showOmegaStatus('Loading…');
  Promise.resolve()
    .then(loadPacks)
    .then(loadOmega)
    .then(fetchPLEXfromESI)
    .then(function(){
      computePackRows();
      renderOmegaTable();
    })
    .catch(function(e){
      console.error(e);
      showStatus('Error: ' + e.message, true);
      showOmegaStatus('Error: ' + e.message, true);
    });
}

var btn = document.getElementById('refresh');
if (btn) btn.addEventListener('click', refresh);

// Auto-run on load
refresh();