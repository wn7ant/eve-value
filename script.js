// script.js — ESI-only version for PLEX→ISK
// - Pulls SELL orders for PLEX (type_id 44992) from ESI
// - Handles pagination via X-Pages header
// - Computes median / average / min price and uses your packs.json for cash packs
// - Designed to run on GitHub Pages (no local server required)

(() => {
  const TABLE = document.getElementById('valueTable');
  const TBODY = document.getElementById('tableBody');
  const PREVIEW = document.getElementById('packsPreview');
  const YEAR = document.getElementById('year');
  const LAST = document.getElementById('lastUpdate');
  const REGION = document.getElementById('region');          // <select> with region id
  const SOURCE = document.getElementById('plexSource');      // median|avg|min
  const REFRESH_BTN = document.getElementById('refresh');

  const ESI_BASE = 'https://esi.evetech.net/latest';
  const PLEX_TYPE = 44992; // PLEX item type_id

  YEAR && (YEAR.textContent = new Date().getFullYear());

  let packs = [];
  let plexISK = null; // computed ISK per 1 PLEX

  // ---------- UI helpers ----------
  function fmt(n, digits = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  function showStatus(msg, isError = false) {
    if (!TBODY) return;
    const row = `<tr><td colspan="6" class="${isError ? '' : 'muted'}">${msg}</td></tr>`;
    TBODY.innerHTML = row;
  }

  // ---------- Stats helpers ----------
  function median(arr) {
    if (!arr.length) return NaN;
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function average(arr) {
    if (!arr.length) return NaN;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  }

  // ---------- Data loaders ----------
  async function loadPacks() {
    const res = await fetch('packs.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load packs.json (HTTP ${res.status})`);
    packs = await res.json();
    if (PREVIEW) PREVIEW.textContent = JSON.stringify(packs, null, 2);
  }

  function getRegionId() {
    // Expect numeric region id (e.g., "10000002" for The Forge/Jita)
    const val = REGION ? REGION.value : '10000002';
    if (!/^\d+$/.test(val)) throw new Error(`Region must be a numeric ID (got "${val}")`);
    return Number(val);
  }

  function getSource() {
    const val = SOURCE ? SOURCE.value : 'median';
    if (!['median', 'avg', 'min'].includes(val)) {
      throw new Error(`Unknown plexSource "${val}"`);
    }
    return val;
  }

  async function fetchAllSellPricesFromESI(regionId) {
    // ESI endpoint (SELL orders for a type within a region) — paginated
    const url = `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${PLEX_TYPE}`;
    // First request: also learn how many pages exist
    const first = await fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
    if (!first.ok) {
      throw new Error(`ESI returned HTTP ${first.status} for ${url}`);
    }
    const xPages = Number(first.headers.get('x-pages')) || 1;
    const page1Data = await first.json();

    // Collect page 1
    let prices = (Array.isArray(page1Data) ? page1Data : [])
      .map(o => Number(o.price))
      .filter(p => Number.isFinite(p) && p > 0);

    // If multiple pages, fetch the rest in parallel (cap to 10 pages for sanity)
    const maxPages = Math.min(xPages, 10);
    if (maxPages > 1) {
      const pagePromises = [];
      for (let p = 2; p <= maxPages; p++) {
        pagePromises.push(
          fetch(`${url}&page=${p}`, { cache: 'no-store', headers: { 'Accept': 'application/json' } })
            .then(r => {
              if (!r.ok) throw new Error(`ESI page ${p} HTTP ${r.status}`);
              return r.json();
            })
            .then(arr => arr.map(o => Number(o.price)).filter(x => Number.isFinite(x) && x > 0))
        );
      }
      const more = await Promise.all(pagePromises);
      for (const arr of more) prices.push(...arr);
    }

    return prices;
  }

  async function fetchPlexISK_ESI() {
    const regionId = getRegionId();
    const prices = await fetchAllSellPricesFromESI(regionId);

    if (!prices.length) {
      throw new Error('No valid sell prices returned by ESI (prices array is empty).');
    }

    const source = getSource();
    let val;
    if (source === 'median') val = median(prices);
    else if (source === 'avg') val = average(prices);
    else val = Math.min(...prices); // min

    if (!Number.isFinite(val) || val <= 0) {
      throw new Error('Price feed returned zero or invalid value after aggregation.');
    }

    plexISK = val;
    if (LAST) LAST.textContent = `PLEX ${source} sell from ESI: ${new Date().toLocaleString()}`;
  }

  // ---------- Table render ----------
  function computeRows() {
    if (!TBODY) return;
    if (!packs.length) {
      showStatus('No packs loaded.');
      return;
    }
    if (!plexISK) {
      showStatus('Waiting for PLEX price…');
      return;
    }

    const rows = packs.map(p => {
      const price = p.sale_price_usd ?? p.price_usd;
      const perPLEX = price / p.plex_amount;
      const cashPerISK = price / (p.plex_amount * plexISK);
      return { ...p, price, perPLEX, cashPerISK };
    });

    const bestPerPLEX = Math.min(...rows.map(r => r.perPLEX));
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

  // ---------- Orchestration ----------
  async function refresh() {
    showStatus('Loading…');
    try {
      await loadPacks();
      await fetchPlexISK_ESI();
      computeRows();
    } catch (e) {
      console.error(e);
      showStatus(`Error: ${e.message}`, true);
    }
  }

  REFRESH_BTN && REFRESH_BTN.addEventListener('click', refresh);
  // Auto-run on load
  refresh();

  // ---------- Optional: expose a quick CURL hint in console ----------
  console.log('If you want to probe ESI manually:');
  console.log("curl -s 'https://esi.evetech.net/latest/markets/10000002/orders/?order_type=sell&type_id=44992' | jq '.[].price'");

})();
