// Trusted niche search in Shopee Affiliate product_offer.
// Types the keyword, waits, SCRAPES each product card, and FILTERS by niche
// so off-niche results (khan giay, sac, mu bao hiem...) are dropped instead of
// being handed back. Never invents data: returns only cards whose name matches.
//
// Usage:
//   node search-niche-trusted.mjs <pageId> <keyword> [nicheRegex] [port]
// Examples:
//   node search-niche-trusted.mjs <pageId> "nước hoa nam"
//   node search-niche-trusted.mjs <pageId> "nước hoa Dior nam" "nước hoa|perfume|edp|edt|edc|cologne|eau de" 9222
//
// If nicheRegex is omitted, it is derived from the keyword: the first 1-2
// meaningful words become the required token (e.g. "nước hoa nam" -> "nước hoa").
// Built-in synonym packs expand common niches (see NICHE_SYNONYMS).

const pageId = process.argv[2];
const keyword = process.argv[3];
let nicheRegexArg = process.argv[4];
let port = process.argv[5];

// Allow the 4th arg to actually be the port (all digits) when nicheRegex omitted.
if (nicheRegexArg && /^\d+$/.test(nicheRegexArg) && !port) { port = nicheRegexArg; nicheRegexArg = undefined; }
port = port || '9222';

if (!pageId || !keyword) {
  console.error('usage: search-niche-trusted.mjs <pageId> <keyword> [nicheRegex] [port]');
  process.exit(1);
}

// --- Build the niche filter -------------------------------------------------
const NICHE_SYNONYMS = [
  { test: /n(ư|u)(ớ|o)c hoa|perfume|fragrance/i, add: ['nước hoa','nuoc hoa','perfume','fragrance','edp','edt','edc','cologne','eau de','parfum','tinh dầu','tinh dau'] },
  { test: /son|lipstick/i, add: ['son','lipstick','lip','môi'] },
  { test: /serum|kem d(ư|u)(ỡ|o)ng|skincare|m(ỹ|y) ph(ẩ|a)m/i, add: ['serum','kem','dưỡng','duong','skincare','toner','cleanser','sữa rửa','mỹ phẩm'] },
  { test: /gi(à|a)y|sneaker|shoe/i, add: ['giày','giay','sneaker','shoe','dép','sandal'] },
];

function buildRegex() {
  if (nicheRegexArg) {
    try { return new RegExp(nicheRegexArg, 'i'); } catch (e) { /* fall through */ }
  }
  // synonym pack match on the keyword
  for (const s of NICHE_SYNONYMS) {
    if (s.test.test(keyword)) {
      const alt = s.add.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      return new RegExp(alt, 'i');
    }
  }
  // fallback: require the first 1-2 words of the keyword
  const words = keyword.trim().split(/\s+/).filter(Boolean);
  const core = words.slice(0, Math.min(2, words.length)).join(' ');
  return new RegExp(core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}
const nicheRegex = buildRegex();

// --- CDP plumbing -----------------------------------------------------------
const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${pageId}`);
let id = 0;
const pending = new Map();
const send = (method, params) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

ws.onopen = async () => {
  await send('Runtime.enable', {});

  // locate the search input
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const i=[...document.querySelectorAll('input')].find(x=>/tìm kiếm|search/i.test((x.placeholder||'')+(x.getAttribute('aria-label')||'')));if(!i)return null;i.focus();i.select();const b=i.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()` });
  const p = r.result?.result?.value;
  if (!p) { console.log(JSON.stringify({ error: 'search input not found' })); process.exit(1); }

  // click + type keyword
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Runtime.evaluate', { expression: `(()=>{const i=[...document.querySelectorAll('input')].find(x=>/tìm kiếm|search/i.test((x.placeholder||'')+(x.getAttribute('aria-label')||'')));const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));s.call(i,${JSON.stringify(keyword)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.focus()})()` });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await new Promise(r => setTimeout(r, 3500));

  // scrape each product card by climbing up from every "Lấy link" button,
  // then filter by the niche regex. Returns clean structured rows.
  const scrapeExpr = `(() => {
    const rx = ${nicheRegex.toString()};
    // Preferred path: Shopee's own card class. index = position in this list,
    // which is exactly what getlink.mjs <pageId> <index> expects.
    const ac = [...document.querySelectorAll('.AffiliateItemCard')];
    if (ac.length) {
      const all = ac.map((card, index) => {
        const href = card.closest('a')?.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '';
        const sourceProductId = (href.match(/product_offer\\/(\\d+)/)||[])[1] || '';
        const name = ((card.querySelector('.ItemCard__contentSection')||{}).innerText || card.innerText || '').split('\\n').map(s=>s.trim()).filter(Boolean).sort((a,b)=>b.length-a.length)[0] || '';
        const text = (card.innerText || '').replace(/\\s+/g, ' ');
        const priceM = text.match(/₫\\s*[\\d.,]+|[\\d.,]+\\s*(?:đ|₫)/);
        const commText = (card.querySelector('.commRate,[class*=commRate],[class*=commission]')?.innerText || '');
        const commM = commText.match(/([\\d.,]+)\\s*%/);
        const soldM = text.match(/(?:đã bán|bán)\\s*([\\d.,]+\\s*k?)/i);
        const imgs = [...card.querySelectorAll('img')].map(i=>i.src).filter(s=>/susercontent/.test(s));
        return { index, sourceProductId, name, price: priceM ? priceM[0] : '', commission: commM ? commM[1] + '%' : '', sold: soldM ? soldM[1] : '', img: imgs[0] || '', onNiche: rx.test(name) };
      });
      const on = all.filter(r => r.onNiche);
      const off = all.filter(r => !r.onNiche);
      return { keyword: ${JSON.stringify(keyword)}, nicheFilter: rx.source, source: 'AffiliateItemCard', totalCards: all.length, onNicheCount: on.length, offNicheDropped: off.length, products: on, droppedSample: off.slice(0,5).map(r=>r.name.slice(0,80)) };
    }
    // Fallback path (selector drift): climb from each "Lấy link" button.
    const btns = [...document.querySelectorAll('button,[role=button],a')].filter(b => /^lấy link$/i.test((b.innerText||'').trim()));
    const seen = new Set();
    const rows = [];
    for (const b of btns) {
      let card = b;
      for (let i = 0; i < 8 && card && card.parentElement; i++) {
        card = card.parentElement;
        const t = (card.innerText || '').trim();
        // a product card typically has a name line + a price (đ) + the button
        if (t.length > 20 && /đ|₫|\\d{3,}/.test(t) && (card.querySelectorAll('img').length)) break;
      }
      if (!card) continue;
      const text = (card.innerText || '').replace(/\\s+/g, ' ').trim();
      if (seen.has(text)) continue; seen.add(text);
      const img = card.querySelector('img');
      // name = the longest line that looks like a product title (contains a
      // niche word), else the longest line overall. Skip badge-only fragments.
      const lines = (card.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);
      const titleCands = lines.filter(l => l.length >= 15 && !/^[\\d.,]+\\s*%?$/.test(l));
      const nicheLines = titleCands.filter(l => rx.test(l));
      const pool = (nicheLines.length ? nicheLines : titleCands);
      const name = pool.sort((a, b) => b.length - a.length)[0] || (lines[0] || '');
      const priceM = text.match(/[\\d.,]+\\s*(?:đ|₫)/);
      const commText = (card.querySelector('.commRate,[class*=commRate],[class*=commission]')?.innerText || '');
        const commM = commText.match(/([\\d.,]+)\\s*%/);
      const onNiche = rx.test(name) || rx.test(text);
      const row = { name, price: priceM ? priceM[0] : '', commission: commM ? commM[1] + '%' : '', img: img ? img.src : '', onNiche };
      // drop junk: no usable title, or title is just a number/percentage
      if (!name || name.length < 15 || /^[\\d.,]+\\s*%?$/.test(name)) continue;
      rows.push(row);
    }
    const onNiche = rows.filter(r => r.onNiche);
    const offNiche = rows.filter(r => !r.onNiche);
    return {
      keyword: ${JSON.stringify(keyword)},
      nicheFilter: rx.source,
      totalCards: rows.length,
      onNicheCount: onNiche.length,
      offNicheDropped: offNiche.length,
      products: onNiche,
      droppedSample: offNiche.slice(0, 5).map(r => r.name)
    };
  })()`;

  const o = await send('Runtime.evaluate', { returnByValue: true, expression: scrapeExpr });
  const val = o.result?.result?.value;
  console.log(JSON.stringify(val || { error: 'scrape failed' }, null, 2));
  ws.close();
  process.exit(0);
};
setTimeout(() => { console.log(JSON.stringify({ error: 'TIMEOUT' })); process.exit(1); }, 20000);
