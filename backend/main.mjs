// Affiliate Control Center — backend (no model turn unless stated).
// Generic product: every shop/niche detail comes from the buyer's own config.
// Data lives in ctx.store (config, scan, batch) and ctx.dataDir (orders, catalog, posts).

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const AppError = (globalThis.aicw && globalThis.aicw.AppError) || class AppError extends Error {
  constructor(message, code, data) { super(message); this.code = code; this.data = data; }
};

// ---------------------------------------------------------------- defaults
const DEFAULT_CONFIG = {
  brand: { name: '', niche: '', audience: '', voice: 'thân thiện, tư vấn thực tế', address: 'anh/chị' },
  niche: { keywords: [], searchTerms: [] },          // filter words + search phrases
  facebook: { pageUrl: '', pageId: '', assetId: '' },
  shopee: { cdpPort: 9222, minCommission: 0 },
  content: { linkPlacement: 'comment', defaultType: 'both', maxPerBatch: 5, autoPublish: false },
  finance: { taxMode: 'individual', pit: 10 },
  schedules: [],
  platforms: [
    { id: 'shopee', name: 'Shopee', region: 'VN', currency: 'VND', enabled: true, connected: true, connector: 'shopee', supports: { search: true, affiliateLink: true, orderSync: true, autoPost: true }, color: '#ee4d2d' },
    { id: 'tiktok', name: 'TikTok Shop', region: 'VN', currency: 'VND', enabled: true, connected: false, connector: 'manual', supports: { search: false, affiliateLink: false, orderSync: false, autoPost: false }, color: '#111827' },
    { id: 'lazada', name: 'Lazada', region: 'VN', currency: 'VND', enabled: false, connected: false, connector: 'manual', supports: { search: false, affiliateLink: false, orderSync: false, autoPost: false }, color: '#2e1a75' },
  ],
};

// Synonym packs: picked automatically from the niche name, buyer can edit.
const PACKS = [
  { test: /n(ư|u)(ớ|o)c hoa|perfume|fragrance/i, words: ['nước hoa', 'nuoc hoa', 'perfume', 'fragrance', 'edp', 'edt', 'cologne', 'eau de', 'parfum', 'tinh dầu'] },
  { test: /m(ỹ|y) ph(ẩ|a)m|skincare|serum|kem/i, words: ['serum', 'kem', 'dưỡng', 'toner', 'sữa rửa mặt', 'mặt nạ', 'skincare', 'mỹ phẩm'] },
  { test: /son|makeup|trang đi(ể|e)m/i, words: ['son', 'lipstick', 'phấn', 'kẻ mắt', 'mascara', 'cushion', 'makeup'] },
  { test: /gi(à|a)y|d(é|e)p|sneaker/i, words: ['giày', 'dép', 'sneaker', 'sandal', 'boot'] },
  { test: /th(ờ|o)i trang|qu(ầ|a)n (á|a)o|(á|a)o|v(á|a)y/i, words: ['áo', 'quần', 'váy', 'đầm', 'set', 'hoodie', 'sơ mi'] },
  { test: /m(ẹ|e) v(à|a) b(é|e)|em b(é|e)|baby/i, words: ['bé', 'sơ sinh', 'tã', 'bỉm', 'sữa', 'bình sữa', 'baby'] },
  { test: /gia d(ụ|u)ng|nh(à|a) b(ế|e)p|b(ế|e)p/i, words: ['nồi', 'chảo', 'máy xay', 'nồi chiên', 'bếp', 'hộp đựng', 'kệ'] },
  { test: /c(ô|o)ng ngh(ệ|e)|(đ|d)i(ệ|e)n tho(ạ|a)i|ph(ụ|u) ki(ệ|e)n/i, words: ['tai nghe', 'sạc', 'cáp', 'ốp', 'loa', 'chuột', 'bàn phím', 'điện thoại'] },
];
function suggestOne(niche) {
  const n = String(niche || '').trim();
  if (!n) return [];
  const pack = PACKS.find(p => p.test.test(n));
  return pack ? pack.words.slice() : [n.toLowerCase()];
}
// Several niches allowed: "nước hoa, mỹ phẩm, giày dép" → one list per niche.
const splitNiches = s => [...new Set(String(s || '').split(/[,;\n|]+/).map(x => x.trim()).filter(Boolean))];
function suggestKeywords(niche) {
  return [...new Set(splitNiches(niche).flatMap(suggestOne))];
}
function nicheList(cfg) { return splitNiches(cfg?.brand?.niche); }
// Search phrases for one niche: the owner's phrases that belong to it, else the niche name itself.
function termsFor(cfg, niche) {
  const all = (cfg.niche.searchTerms || []).map(s => String(s).trim()).filter(Boolean);
  const niches = nicheList(cfg);
  const belongs = (t, n) => { const p = PACKS.find(x => x.test.test(n)); return p ? p.test.test(t) : t.toLowerCase().includes(n.toLowerCase()); };
  const own = all.filter(t => belongs(t, niche) || (niche === niches[0] && !niches.some(n => belongs(t, n))));
  return own.length ? own : [niche];
}

// ---------------------------------------------------------------- helpers
const nowIso = () => new Date().toISOString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
const dataFile = (ctx, name) => path.join(ctx.dataDir, name + '.json');
async function updateCatalogQueue(ctx, catalogId, patch, remove = false) {
  if (!catalogId) return false;
  const rows = await readJson(dataFile(ctx, 'catalog'), []), i = rows.findIndex(x => x.id === catalogId);
  if (i < 0) return false;
  if (remove) rows.splice(i, 1); else { if (patch.retryCount === 'inc') patch = { ...patch, retryCount: (Number(rows[i].retryCount) || 0) + 1 }; Object.assign(rows[i], patch, { updatedAt: nowIso() }); }
  await writeJson(dataFile(ctx, 'catalog'), rows); await ctx.events.emit('acc:changed', { what: 'catalog' }); return true;
}

async function getConfig(ctx) {
  const c = (await ctx.store.get('config')) || null;
  if (!c) return null;
  return deepMerge(structuredClone(DEFAULT_CONFIG), c);
}
function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}
function requireConfig(cfg) {
  if (!cfg || !cfg.brand.name || !cfg.brand.niche) throw new AppError('Chưa thiết lập shop. Mở app và hoàn tất bước Thiết lập.', 'not_configured');
}
function nicheRegexSource(cfg) {
  const words = (cfg.niche.keywords && cfg.niche.keywords.length ? cfg.niche.keywords : suggestKeywords(cfg.brand.niche))
    .map(w => String(w).trim()).filter(Boolean);
  return words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}
function runNode(ctx, script, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(ctx.skillDir, 'scripts', script), ...args.map(String)],
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new AppError(`Script ${script} lỗi: ${(stderr || err.message).slice(0, 300)}`, 'script_failed'));
        resolve(stdout);
      });
  });
}
async function findShopeeTab(port) {
  let tabs;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) });
    tabs = await r.json();
  } catch {
    throw new AppError(`Không kết nối được Chrome Shopee (cổng ${port}). Mở Chrome affiliate theo hướng dẫn ở mục Thiết lập rồi thử lại.`, 'chrome_offline');
  }
  const pages = tabs.filter(t => t.type === 'page');
  const tab = pages.find(t => /affiliate\.shopee\.vn\/offer\/product_offer(?:[/?#]|$)/i.test(t.url))
    || pages.find(t => /affiliate\.shopee\.vn\//i.test(t.url) && !/affiliate\.shopee\.vn\/(?:login|signin)(?:[/?#]|$)/i.test(t.url));
  if (tab) return tab;
  const login = pages.find(t => /(?:affiliate\.shopee\.vn|shopee\.vn)\/(?:buyer\/)?(?:login|signin)(?:[/?#]|$)/i.test(t.url));
  if (login) throw new AppError('Shopee Affiliate đang ở trang đăng nhập. Anh/chị đăng nhập trong Chrome rồi thử lại.', 'shopee_login');
  throw new AppError('Chưa mở trang Shopee Affiliate (offer/product_offer) trong Chrome.', 'shopee_tab_missing');
}
// Run one Shopee search on the affiliate tab and remember which keyword the page now shows.
async function searchPage(ctx, cfg, tab, keyword) {
  const raw = await runNode(ctx, 'search-niche.mjs', [tab.id, keyword, nicheRegexSource(cfg), cfg.shopee.cdpPort], 45000);
  let o; try { o = JSON.parse(raw); } catch { throw new AppError('Không đọc được kết quả quét.', 'scan_parse'); }
  if (o.error) throw new AppError(`Quét lỗi: ${o.error}`, 'scan_failed');
  await ctx.store.set('pageKeyword', keyword);
  return o;
}
const pct = s => { const m = String(s || '').replace(',', '.').match(/[\d.]+/); return m ? Number(m[0]) : 0; };
const money = s => { const d = String(s || '').replace(/[^\d]/g, ''); return d ? Number(d) : 0; };
const platformOf = x => String(x?.platform || (String(x?.source || '').toLowerCase().includes('tiktok') ? 'tiktok' : 'shopee')).toLowerCase();
const platformId = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function normalizePlatforms(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((p, i) => {
    const id = platformId(p.id || p.name || ('platform-' + i)); if (!id || seen.has(id)) return null; seen.add(id);
    const connector = p.connector === 'shopee' && id === 'shopee' ? 'shopee' : 'manual';
    const auto = connector === 'shopee';
    return { id, name: String(p.name || id).trim().slice(0, 60), region: String(p.region || 'GLOBAL').toUpperCase().slice(0, 16), currency: String(p.currency || 'VND').toUpperCase().slice(0, 8),
      enabled: p.enabled !== false, connected: auto ? p.connected !== false : !!p.connected, connector,
      supports: { search: auto, affiliateLink: auto, orderSync: auto, autoPost: auto, ...(p.supports || {}) }, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#64748b' };
  }).filter(Boolean);
}
function getPlatform(cfg, id) { return normalizePlatforms(cfg.platforms).find(p => p.id === platformId(id || 'shopee')); }
const PRODUCT_STOP = new Set('nuoc hoa perfume parfum fragrance nam nu unisex chinh hang auth sale giam gia qua tang chai lo mini full size ml edp edt edc cho cua va co san thom lau hang new'.split(' '));
function productTokens(name) {
  return [...new Set(String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|g|kg|oz|%)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !PRODUCT_STOP.has(t) && !/^\d+$/.test(t)))].sort();
}
function productFingerprint(name) { return productTokens(name).join('-'); }
function isSameProduct(a, b) {
  if (!a || !b || platformOf(a) !== platformOf(b)) return false;
  if (a.sourceProductId && b.sourceProductId && String(a.sourceProductId) === String(b.sourceProductId)) return true;
  if (a.link && b.link && a.link === b.link) return true;
  const fa = a.productFingerprint || productFingerprint(a.name), fb = b.productFingerprint || productFingerprint(b.name);
  if (fa && fa === fb) return true;
  const A = fa.split('-').filter(Boolean), B = fb.split('-').filter(Boolean); if (!A.length || !B.length) return false;
  const hit = A.filter(x => B.includes(x));
  if (hit.length >= 2 && hit.length / Math.min(A.length, B.length) >= 0.75) return true;
  return Math.min(A.length, B.length) === 1 && hit.some(x => x.length >= 7);
}
export const productIdentity = { productTokens, productFingerprint, isSameProduct };
function requireCapability(cfg, id, capability) { const p = getPlatform(cfg, id); if (!p) throw new AppError('Kh?ng t?m th?y s?n.', 'platform_missing'); if (!p.enabled) throw new AppError(`S?n ?${p.name}? ?ang t?t.`, 'platform_disabled'); if (!p.connected || !p.supports?.[capability]) throw new AppError(`S?n ?${p.name}? ch?a h? tr? t?nh n?ng n?y. H?y d?ng thao t?c th? c?ng ho?c c?i connector.`, 'capability_missing'); return p; }
function platformStats(config, orders, posts, catalog) {
  return normalizePlatforms(config.platforms).map(p => {
    const oo = orders.filter(x => platformOf(x) === p.id), pp = posts.filter(x => platformOf(x) === p.id), cc = catalog.filter(x => platformOf(x) === p.id);
    const valid = oo.filter(x => x.status !== 'cancelled');
    return { ...p, metrics: { clicks: null, orders: valid.length, quantity: valid.reduce((s, x) => s + (Number(x.quantity) || 1), 0),
      orderValue: valid.reduce((s, x) => s + (Number(x.orderValue) || 0), 0), commission: valid.reduce((s, x) => s + (Number(x.commission) || 0), 0),
      newBuyers: null, posts: pp.length, catalog: cc.length } };
  });
}

// ---------------------------------------------------------------- commands
export const commands = {
  // Everything the window needs in one call.
  async state(args, ctx) {
    const config = await getConfig(ctx);
    const orders = (await readJson(dataFile(ctx, 'orders'), [])).map(x => ({ platform: platformOf(x), ...x }));
    const catalog = (await readJson(dataFile(ctx, 'catalog'), [])).map(x => ({ platform: platformOf(x), queueStatus: 'ready', retryCount: 0, priority: 0, niche: '', ...x }));
    const posts = (await readJson(dataFile(ctx, 'posts'), [])).map(x => ({ platform: platformOf(x), ...x }));
    const scan = (await ctx.store.get('scan')) || null;
    const batch = (await ctx.store.get('batch')) || null;
    const lastSync = (await ctx.store.get('lastSync')) || null;
    const pit = (config?.finance?.pit ?? 10) / 100;
    const total = orders.reduce((s, o) => s + (o.commission || 0), 0);
    const pending = orders.filter(o => o.status === 'pending').reduce((s, o) => s + (o.commission || 0), 0);
    const paid = orders.filter(o => o.status === 'confirmed' || o.status === 'paid').reduce((s, o) => s + (o.commission || 0), 0);
    return {
      configured: !!(config && config.brand.name && config.brand.niche),
      config: config || structuredClone(DEFAULT_CONFIG),
      suggested: suggestKeywords(config?.brand?.niche),
      niches: nicheList(config),
      totals: { total, pending, paid, net: Math.round(total * (1 - pit)), orders: orders.length, posts: posts.length },
      orders, catalog, posts: posts.slice(0, 100), scan, batch, lastSync,
      platforms: platformStats(config || structuredClone(DEFAULT_CONFIG), orders, posts, catalog),
    };
  },

  async saveConfig(args, ctx) {
    const cur = (await getConfig(ctx)) || structuredClone(DEFAULT_CONFIG);
    const oldNiche = cur.brand.niche, oldAuto = new Set(suggestKeywords(oldNiche));
    const next = deepMerge(cur, args.config || {});
    if (args.config && Array.isArray(args.config.platforms)) next.platforms = normalizePlatforms(args.config.platforms);
    next.brand.niche = splitNiches(next.brand.niche).join(', ');
    const kwGiven = args.config && args.config.niche && Array.isArray(args.config.niche.keywords);
    if (!kwGiven && next.brand.niche !== splitNiches(oldNiche).join(', ')) {
      // niches changed from the quick editor: re-suggest, keep the owner's own extra words
      const own = (cur.niche.keywords || []).filter(w => !oldAuto.has(w));
      next.niche.keywords = [...new Set([...suggestKeywords(next.brand.niche), ...own])];
    }
    if (!next.niche.keywords || !next.niche.keywords.length) next.niche.keywords = suggestKeywords(next.brand.niche);
    next.content.maxPerBatch = Math.max(1, Math.min(10, Number(next.content.maxPerBatch) || 5));
    next.updatedAt = nowIso();
    await ctx.store.set('config', next);
    await ctx.events.emit('acc:changed', { what: 'config' });
    return { ok: true, config: next };
  },

  async savePlatforms(args, ctx) {
    const cfg = await getConfig(ctx); requireConfig(cfg);
    const next = normalizePlatforms(args.platforms);
    if (!next.some(p => p.id === 'shopee')) throw new AppError('Không được xoá Shopee khi connector Shopee đang là nguồn dữ liệu chính.', 'shopee_required');
    const used = new Set();
    for (const file of ['orders', 'catalog', 'posts']) for (const x of await readJson(dataFile(ctx, file), [])) used.add(platformOf(x));
    const removed = normalizePlatforms(cfg.platforms).filter(p => !next.some(n => n.id === p.id) && used.has(p.id));
    if (removed.length) throw new AppError(`Không thể xoá sàn đang có dữ liệu: ${removed.map(p => p.name).join(', ')}. Hãy chuyển dữ liệu hoặc tắt sàn.`, 'platform_in_use');
    cfg.platforms = next; cfg.updatedAt = nowIso(); await ctx.store.set('config', cfg);
    await ctx.events.emit('acc:changed', { what: 'platforms' });
    return next;
  },

  suggest(args) { return { keywords: suggestKeywords(args.niche) }; },

  async openShopeeChrome(args, ctx) {
    const cfg = (await getConfig(ctx)) || structuredClone(DEFAULT_CONFIG), port = cfg.shopee?.cdpPort || 9222;
    const url = 'https://affiliate.shopee.vn/offer/product_offer';
    const profile = path.join(ctx.dataDir, 'chrome-affiliate');
    const q = s => `'${String(s).replace(/'/g, "''")}'`;
    let command;
    if (process.platform === 'win32') command = `$candidates=@($env:LOCALAPPDATA+'\\Google\\Chrome\\Application\\chrome.exe',$env:ProgramFiles+'\\Google\\Chrome\\Application\\chrome.exe',$env:ProgramFiles+' (x86)\\Google\\Chrome\\Application\\chrome.exe');$exe=$candidates|Where-Object{Test-Path $_}|Select-Object -First 1;if(-not $exe){$exe='chrome.exe'};Start-Process $exe -ArgumentList @('--remote-debugging-port=${port}','--user-data-dir=${profile.replace(/'/g, "''")}','${url}')`;
    else if (process.platform === 'darwin') command = `open -na 'Google Chrome' --args --remote-debugging-port=${port} --user-data-dir=${q(profile)} ${q(url)}`;
    else command = `google-chrome --remote-debugging-port=${port} --user-data-dir=${q(profile)} ${q(url)} >/dev/null 2>&1 &`;
    const r = await ctx.host.shell({ command, timeoutSec: 12 });
    if (r && r.exitCode != null && r.exitCode !== 0) throw new AppError(`Không mở được Chrome: ${(r.output || '').slice(-300)}`, 'chrome_launch_failed');
    return { ok: true, port, url, message: `Đã mở Chrome Affiliate ở cổng ${port}. Nếu Shopee hỏi đăng nhập, hãy đăng nhập trong cửa sổ vừa mở.` };
  },

  // Pre-flight: what works on this machine right now.
  async health(args, ctx) {
    const cfg = await getConfig(ctx);
    const out = { configured: !!(cfg && cfg.brand.name && cfg.brand.niche), checks: [] };
    const port = cfg?.shopee?.cdpPort || 9222;
    try { await findShopeeTab(port); out.checks.push({ id: 'shopee', ok: true, text: `Chrome Shopee (cổng ${port}) sẵn sàng` }); }
    catch (e) { out.checks.push({ id: 'shopee', ok: false, text: e.message, code: e.code }); }
    out.checks.push({ id: 'facebook', ok: !!(cfg?.facebook?.pageUrl), text: cfg?.facebook?.pageUrl ? 'Đã khai báo Page Facebook' : 'Chưa khai báo Page Facebook' });
    await new Promise(res => execFile('ffmpeg', ['-version'], { windowsHide: true, timeout: 8000 }, (err) => {
      out.checks.push({ id: 'ffmpeg', ok: !err, text: err ? 'Chưa cài FFmpeg (cần để làm video reel)' : 'FFmpeg sẵn sàng' }); res();
    }));
    return out;
  },

  // Scan Shopee Affiliate for the buyer's niche (long: browser + scrape).
  // Scan Shopee Affiliate. One keyword, one niche, or every niche of the shop (args.niche = 'all').
  // Each niche is searched with its own phrase; results are merged and tagged with their niche.
  async scan(args, ctx) {
    const cfg = await getConfig(ctx); requireConfig(cfg);
    const platform = String(args.platform || 'shopee').toLowerCase(); requireCapability(cfg, platform, 'search');
    const minCommission = Number(args.minCommission ?? cfg.shopee.minCommission ?? 0);
    const niches = nicheList(cfg);
    let plan; // [{ niche, keyword }]
    if (args.keyword && String(args.keyword).trim()) {
      const kw = String(args.keyword).trim();
      plan = [{ niche: niches.find(n => termsFor(cfg, n).includes(kw)) || args.niche && args.niche !== 'all' && args.niche || niches[0], keyword: kw }];
    } else {
      const want = !args.niche || args.niche === 'all' ? niches : (Array.isArray(args.niche) ? args.niche : [args.niche]);
      const rot = (await ctx.store.get('termRotation')) || {};
      plan = want.map(n => { const t = termsFor(cfg, n); const k = (rot[n] || 0) % t.length; rot[n] = k + 1; return { niche: n, keyword: t[k] }; });
      await ctx.store.set('termRotation', rot);
    }
    ctx.job?.progress?.(0.05, 'Kết nối Chrome Shopee…');
    const tab = await findShopeeTab(cfg.shopee.cdpPort);
    const postedRows = (await readJson(dataFile(ctx, 'posts'), [])).map(p => ({ platform: platformOf(p), productFingerprint: p.productFingerprint || productFingerprint(p.name), ...p }));
    const catalogRows = (await readJson(dataFile(ctx, 'catalog'), [])).map(p => ({ platform: platformOf(p), productFingerprint: p.productFingerprint || productFingerprint(p.name), ...p }));
    const products = [], perNiche = [], errors = [];
    let offNicheDropped = 0, droppedSample = [];
    for (let i = 0; i < plan.length; i++) {
      ctx.throwIfCancelled?.();
      const { niche, keyword } = plan[i];
      ctx.job?.progress?.(0.1 + 0.85 * i / plan.length, `[${niche}] tìm “${keyword}”…`);
      try {
        const o = await searchPage(ctx, cfg, tab, keyword);
        offNicheDropped += o.offNicheDropped || 0; droppedSample = droppedSample.concat(o.droppedSample || []).slice(0, 6);
        const list = (o.products || []).filter(p => pct(p.commission) >= minCommission)
          .map(p => { const row = { srcIndex: p.index, sourceProductId: p.sourceProductId || '', platform, niche, keyword, name: String(p.name || '').slice(0, 160), price: p.price, priceValue: money(p.price), commission: p.commission, commissionValue: pct(p.commission), sold: p.sold || '', img: p.img }; row.productFingerprint = productFingerprint(row.name); row.posted = postedRows.some(x => isSameProduct(row, x)); row.catalogued = catalogRows.some(x => isSameProduct(row, x)); return row; })
          .sort((a, b) => b.commissionValue - a.commissionValue);
        perNiche.push({ niche, keyword, count: list.length });
        products.push(...list);
      } catch (e) { errors.push({ niche, keyword, error: String(e.message || e).slice(0, 200) }); perNiche.push({ niche, keyword, count: 0, error: true }); }
    }
    if (!products.length && errors.length === plan.length) throw new AppError(`Quét lỗi: ${errors[0].error}`, 'scan_failed');
    products.forEach((p, k) => { p.index = k; });   // global id inside this scan; srcIndex = card on Shopee page
    const keyword = plan.map(p => p.keyword).join(' · ');
    const scan = { platform, keyword, niches: plan.map(p => p.niche), perNiche, errors, pageId: tab.id, at: nowIso(), onNicheCount: products.length, offNicheDropped, droppedSample, products };
    await ctx.store.set('scan', scan);
    ctx.job?.progress?.(1, `${products.length} sản phẩm đúng ngành`);
    await ctx.events.emit('acc:changed', { what: 'scan' });
    return scan;
  },

  // Real affiliate short link for one product of the last scan (re-opens its search page if needed).
  async getLink(args, ctx) {
    const cfg = await getConfig(ctx); requireConfig(cfg);
    const scan = await ctx.store.get('scan');
    if (!scan) throw new AppError('Chưa có kết quả quét.', 'no_scan');
    const p = (scan.products || []).find(x => x.index === args.index);
    if (!p) throw new AppError('Sản phẩm không còn trong lần quét gần nhất. Quét lại rồi thử.', 'not_in_scan');
    const tab = await findShopeeTab(cfg.shopee.cdpPort);
    let src = p.srcIndex ?? p.index;
    if (p.keyword && (await ctx.store.get('pageKeyword')) !== p.keyword) {
      const o = await searchPage(ctx, cfg, tab, p.keyword);
      const hit = (o.products || []).find(x => String(x.name || '').slice(0, 160) === p.name);
      if (!hit) throw new AppError('Sản phẩm không còn hiện trên Shopee. Quét lại rồi thử.', 'gone');
      src = hit.index;
    }
    const raw = await runNode(ctx, 'getlink.mjs', [tab.id, src, cfg.shopee.cdpPort], 20000);
    let o; try { o = JSON.parse(raw); } catch { throw new AppError('Không lấy được link (trang Shopee đã thay đổi?). Quét lại rồi thử.', 'link_parse'); }
    if (!o.link || !/^https:\/\/s\.shopee\.vn\//.test(o.link)) throw new AppError('Shopee không trả link affiliate cho sản phẩm này.', 'no_link');
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (o.name && p.name && !norm(o.name).includes(norm(p.name).slice(0, 60)) && !norm(p.name).includes(norm(o.name).slice(0, 60)))
      throw new AppError('Tên sản phẩm lúc lấy link không khớp lần quét. App đã chặn để tránh lấy nhầm link.', 'product_mismatch', { scanned: p.name, linked: o.name });
    const scannedRate = pct(p.commission), liveRate = pct(o.commission);
    if (!liveRate) throw new AppError('Không đọc được tỷ lệ hoa hồng thật trên card sản phẩm. App không dùng số đoán.', 'commission_missing');
    if (scannedRate && Math.abs(scannedRate - liveRate) > 0.01)
      throw new AppError(`Hoa hồng thay đổi hoặc bị đọc lệch: quét ${p.commission}, card thật ${o.commission}. Hãy quét lại.`, 'commission_mismatch');
    if (p.sourceProductId && o.sourceProductId && String(p.sourceProductId) !== String(o.sourceProductId))
      throw new AppError('Mã sản phẩm lúc lấy link không khớp lần quét. App đã chặn để tránh nhầm sản phẩm.', 'product_id_mismatch');
    return { index: args.index, sourceProductId: o.sourceProductId || p.sourceProductId || '', link: o.link, name: o.name, commission: o.commission };
  },

  // ---------------- auto-post schedules (cron jobs owned by this app) ----------------
  async listSchedules(args, ctx) {
    const cfg = await getConfig(ctx);
    const live = ctx.schedule ? await ctx.schedule.list().catch(() => []) : [];
    return (cfg?.schedules || []).map(s => ({ ...s, live: live.find(l => l.name === s.id) || null }));
  },

  async saveSchedules(args, ctx) {
    const cfg = await getConfig(ctx); requireConfig(cfg);
    const niches = nicheList(cfg);
    const clean = (args.schedules || []).slice(0, 12).map(s => {
      const time = /^\d{1,2}:\d{2}$/.test(String(s.time || '')) ? s.time : '20:00';
      const days = (Array.isArray(s.days) && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(d => d >= 0 && d <= 6);
      return { platform: getPlatform(cfg, s.platform || 'shopee')?.id || 'shopee', id: /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(s.id || '') ? s.id : 'post-' + uid(), name: String(s.name || '').slice(0, 60) || `Đăng ${time}`,
        time, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
        niches: (s.niches || []).filter(n => niches.includes(n)), perNiche: Math.max(1, Math.min(5, Number(s.perNiche) || 1)),
        type: ['post', 'reel', 'mix', 'both'].includes(s.type) ? s.type : 'both', enabled: s.enabled !== false };
    });
    const old = cfg.schedules || [];
    for (const s of clean) {
      const [h, m] = s.time.split(':').map(Number);
      const dow = s.days.length === 7 ? '*' : s.days.join(',');
      await ctx.schedule.set(s.id, { cron: `${m} ${h} * * ${dow}`, tz: 'Asia/Ho_Chi_Minh', command: 'autoRun', args: { schedule: s.id }, enabled: s.enabled });
    }
    for (const o of old) if (!clean.some(s => s.id === o.id)) await ctx.schedule.remove(o.id).catch(() => {});
    await commands.saveConfig({ config: { schedules: clean } }, ctx);
    return commands.listSchedules({}, ctx);
  },

  // Schedule queue policy: Catalog first. Only scan when the queue cannot fill the requested slots.
  async autoRun(args, ctx) {
    const cfg = await getConfig(ctx); requireConfig(cfg);
    const s = (cfg.schedules || []).find(x => x.id === args.schedule) || { id: 'manual', platform: 'shopee', niches: [], perNiche: 1, type: (cfg.content.defaultType && cfg.content.defaultType !== 'post') ? cfg.content.defaultType : 'both' };
    const platform = s.platform || 'shopee'; requireCapability(cfg, platform, 'autoPost');
    const niches = s.niches && s.niches.length ? s.niches : nicheList(cfg), target = s.perNiche || 1;
    const last = (await ctx.store.get('batch')) || null;
    const staleAfterMs = 2 * 60e3;
    if (last && last.status === 'running' && Date.now() - Date.parse(last.startedAt) < staleAfterMs) return { skipped: true, reason: 'Đang có lượt đăng khác chạy' };
    const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const posts = (await readJson(dataFile(ctx, 'posts'), [])).filter(p => platformOf(p) === platform).map(p => ({ platform, productFingerprint: p.productFingerprint || productFingerprint(p.name), ...p }));
    const catalog = (await readJson(dataFile(ctx, 'catalog'), [])).filter(c => platformOf(c) === platform && (c.queueStatus !== 'posting' || Date.now() - Date.parse(c.lastAttemptAt || 0) >= staleAfterMs) && !posts.some(p => isSameProduct({ platform, productFingerprint: c.productFingerprint || productFingerprint(c.name), ...c }, p)))
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || String(a.addedAt || '').localeCompare(String(b.addedAt || '')));
    let flip = (await ctx.store.get('mixFlip')) || 0; const items = [], used = new Set(), shortage = [];
    // 'both' = mỗi sản phẩm đăng CẢ Reel lẫn bài ảnh; 'mix' = luân phiên; còn lại = 1 định dạng.
    const typesFor = () => s.type === 'both' ? ['reel', 'post'] : s.type === 'mix' ? [flip++ % 2 ? 'reel' : 'post'] : [s.type];
    const mkItem = (c, n, type, index) => ({ catalogId: c.id, ...(index != null ? { index } : {}), platform, sourceProductId: c.sourceProductId || '', productFingerprint: c.productFingerprint || productFingerprint(c.name), niche: c.niche || n, name: c.name, type, price: c.price || '', commission: c.commission || '', img: c.img || '', link: c.link || '' });
    for (const n of niches) {
      const q = catalog.filter(c => !used.has(c.id) && (!c.niche || c.niche === n)).slice(0, target);
      for (const c of q) { used.add(c.id); for (const t of typesFor()) items.push(mkItem(c, n, t)); }
      if (q.length < target) shortage.push({ niche: n, count: target - q.length });
    }
    let scan = null;
    if (shortage.length) {
      requireCapability(cfg, platform, 'search'); requireCapability(cfg, platform, 'affiliateLink');
      ctx.job?.progress?.(0.05, `Catalog thiếu ${shortage.reduce((n,x)=>n+x.count,0)} sản phẩm — bắt đầu quét bù…`);
      scan = await commands.scan({ platform, niche: shortage.map(x => x.niche) }, ctx);
      for (const miss of shortage) {
        const picks = scan.products.filter(p => p.niche === miss.niche && !p.posted && !posts.some(x => isSameProduct(p, x)) && !catalog.some(c => isSameProduct(p, { platform, productFingerprint: c.productFingerprint || productFingerprint(c.name), ...c }))).slice(0, miss.count);
        for (const p of picks) {
          const linkData = await commands.getLink({ index: p.index }, ctx);
          const c = await commands.addToCatalog({ platform, niche: miss.niche, sourceProductId: p.sourceProductId || '', productFingerprint: productFingerprint(p.name), name: p.name, price: p.price || '', commission: linkData.commission || p.commission || '', img: p.img || '', link: linkData.link }, ctx);
          for (const t of typesFor()) items.push({ ...mkItem(c, miss.niche, t, p.index), link: linkData.link, commission: linkData.commission || p.commission || '' });
        }
      }
    } else ctx.job?.progress?.(0.05, `Dùng ${items.length} sản phẩm có sẵn trong Catalog…`);
    await ctx.store.set('mixFlip', flip);
    if (!items.length) return { skipped: true, reason: 'Catalog trống và không tìm được sản phẩm mới phù hợp', perNiche: scan?.perNiche || [] };
    const batch = await commands.postBatch({ items, max: 10, source: s.id }, ctx);
    const done = batch.items.filter(i => i.status === 'done' && i.postUrl || i.postId).length;
    try { await ctx.notify?.(`Lịch “${s.name || s.id}”: đăng ${done}/${batch.items.length} bài · Catalog trước, quét bù sau`); } catch {}
    return { schedule: s.id, posted: done, total: batch.items.length, fromCatalog: items.filter(i => used.has(i.catalogId)).length, scanned: items.filter(i => !used.has(i.catalogId)).length };
  },

  // Record a Facebook post only AFTER it was opened/verified on the Page.
  // Used by this app's postBatch and by manual/cron posting flows so the dashboard count stays correct.
  async recordPost(args, ctx) {
    if (args.published !== true) throw new AppError('Chỉ ghi bài đã đăng và xác minh trên Facebook.', 'not_verified');
    if (!args.postUrl && !args.postId) throw new AppError('Cần URL hoặc ID bài Facebook để chứng minh bài đã đăng.', 'missing_proof');
    const posts = await readJson(dataFile(ctx, 'posts'), []);
    const key = args.postId || args.postUrl;
    const candidate = { platform: String(args.platform || 'shopee').toLowerCase(), sourceProductId: args.sourceProductId || '', productFingerprint: args.productFingerprint || productFingerprint(args.name), name: args.name, link: args.link || '' };
    const same = posts.find(p => (args.postId && p.postId === args.postId) || (args.postUrl && p.postUrl === args.postUrl));
    if (same) return { ...same, duplicate: true };
    const wantType = args.type === 'reel' ? 'reel' : 'post';
    const sameProduct = posts.find(p => isSameProduct(candidate, { platform: platformOf(p), productFingerprint: p.productFingerprint || productFingerprint(p.name), ...p }) && (p.type === 'reel' ? 'reel' : 'post') === wantType);
    if (sameProduct) return { ...sameProduct, duplicate: true, duplicateProduct: true };
    const item = { id: uid(), at: args.at || nowIso(), platform: String(args.platform || 'shopee').toLowerCase(), sourceProductId: args.sourceProductId || '',
      productFingerprint: args.productFingerprint || productFingerprint(args.name), name: String(args.name || '').slice(0, 180) || 'Bài Facebook', type: args.type === 'reel' ? 'reel' : 'post',
      link: args.link || '', price: args.price || '', commission: args.commission || '', postUrl: args.postUrl || '', postId: args.postId || '', published: true, verified: true, source: args.source || 'manual' };
    posts.unshift(item);
    await writeJson(dataFile(ctx, 'posts'), posts);
    await ctx.events.emit('acc:changed', { what: 'posts' });
    return item;
  },

  async addToCatalog(args, ctx) {
    const catalog = await readJson(dataFile(ctx, 'catalog'), []);
    const platform = String(args.platform || 'shopee').toLowerCase();
    const candidate = { platform, sourceProductId: args.sourceProductId || '', productFingerprint: args.productFingerprint || productFingerprint(args.name), name: args.name, link: args.link || '' };
    const existing = catalog.find(x => isSameProduct(candidate, { platform: platformOf(x), productFingerprint: x.productFingerprint || productFingerprint(x.name), ...x }));
    if (existing) return { ...existing, duplicate: true };
    const item = { id: uid(), platform, niche: args.niche || '', sourceProductId: args.sourceProductId || '', productFingerprint: args.productFingerprint || productFingerprint(args.name),
      queueStatus: 'ready', priority: Number(args.priority) || 0, retryCount: 0, lastError: '', lastAttemptAt: '',
      name: args.name, price: args.price || '', commission: args.commission || '', img: args.img || '', link: args.link || '', note: args.note || '', addedAt: nowIso() };
    catalog.unshift(item);
    await writeJson(dataFile(ctx, 'catalog'), catalog);
    await ctx.events.emit('acc:changed', { what: 'catalog' });
    return item;
  },
  async removeFromCatalog(args, ctx) {
    const catalog = (await readJson(dataFile(ctx, 'catalog'), [])).filter(c => c.id !== args.id);
    await writeJson(dataFile(ctx, 'catalog'), catalog);
    await ctx.events.emit('acc:changed', { what: 'catalog' });
    return { ok: true };
  },

  // Orders = real sales confirmed by the buyer or imported from Shopee reports.
  async addOrder(args, ctx) {
    const orders = await readJson(dataFile(ctx, 'orders'), []);
    const rate = Number(args.commissionRate) || 0;
    const value = Number(args.orderValue) || 0;
    const o = { id: uid(), platform: String(args.platform || 'shopee').toLowerCase(), date: args.date || nowIso().slice(0, 10), product: args.product, orderValue: value, commissionRate: rate,
      commission: args.commission != null ? Number(args.commission) : Math.round(value * rate / 100), status: args.status || 'pending', source: args.source || 'manual' };
    orders.push(o);
    await writeJson(dataFile(ctx, 'orders'), orders);
    await ctx.events.emit('acc:changed', { what: 'orders' });
    return o;
  },
  // Pull REAL orders from Shopee's conversion report. Dedup by Shopee order id; updates status of known ones.
  async syncOrders(args, ctx) {
    const cfg = await getConfig(ctx); requireConfig(cfg);
    const platform = String(args.platform || 'shopee').toLowerCase(); requireCapability(cfg, platform, 'orderSync');
    if (platform !== 'shopee') throw new AppError('Connector đồng bộ đơn cho sàn này chưa được cài.', 'connector_missing');
    ctx.job?.progress?.(0.1, 'Mở báo cáo đơn Shopee…');
    await findShopeeTab(cfg.shopee.cdpPort); // checks Chrome + login
    const raw = await runNode(ctx, 'read-conversions.mjs', [cfg.shopee.cdpPort], 90000);
    let o; try { o = JSON.parse(raw); } catch { throw new AppError('Không đọc được báo cáo đơn.', 'report_parse'); }
    if (o.error) throw new AppError(`Đọc báo cáo lỗi: ${o.error}`, 'report_failed');
    const H = (o.headers || []).map(h => h.toLowerCase());
    const col = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
    const c = {
      id: col(/id đơn|mã đơn|order id|order sn|mã đơn hàng/),
      time: col(/thời gian đặt|order time|thời gian/),
      status: col(/trạng thái|status/),
      product: col(/tên sản phẩm|item name/, /sản phẩm|product/),
      value: col(/giá trị đơn|giá trị mua|purchase value|order value|giá trị/),
      comm: col(/tổng hoa hồng/, /hoa hồng đơn/, /order commission|net commission/, /hoa hồng/),
      rate: col(/tỷ lệ|rate/),
      sub: col(/sub_id|sub id/),
    };
    const mapStatus = s => /hủy|huỷ|cancel|không hợp lệ|invalid/i.test(s) ? 'cancelled' : /đã thanh toán|paid|đã nhận/i.test(s) ? 'paid' : /hoàn thành|completed|đã xác nhận|confirmed/i.test(s) ? 'confirmed' : 'pending';
    const orders = await readJson(dataFile(ctx, 'orders'), []);
    let added = 0, updated = 0;
    for (const r of o.rows || []) {
      const all = r.join('\n');
      const oid = (c.id >= 0 && r[c.id]) || ((all.match(/(?:id đơn hàng|mã đơn hàng|order id|order sn)\s*[:：]?\s*([A-Z0-9]{8,})/i) || all.match(/\b(\d{6}[A-Z0-9]{6,})\b/) || [])[1]) || '';
      if (!oid) continue;
      const status = mapStatus(c.status >= 0 ? r[c.status] : all);
      const known = orders.find(x => x.shopeeOrderId === oid && x.product === ((c.product >= 0 ? r[c.product].split('\n')[0] : x.product)));
      if (known) { if (known.status !== status) { known.status = status; updated++; } continue; }
      const value = money(c.value >= 0 ? r[c.value] : ''), commission = money(c.comm >= 0 ? r[c.comm] : '');
      const d = String(c.time >= 0 ? r[c.time] : '').match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})|(\d{4})-(\d{2})-(\d{2})/);
      const date = d ? (d[4] ? `${d[4]}-${d[5]}-${d[6]}` : `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`) : nowIso().slice(0, 10);
      orders.push({ id: uid(), platform: 'shopee', shopeeOrderId: oid, date, product: (c.product >= 0 ? r[c.product].split('\n')[0].slice(0, 160) : '') || 'Đơn Shopee', orderValue: value,
        commissionRate: c.rate >= 0 ? pct(r[c.rate]) : (value ? Math.round(commission / value * 1000) / 10 : 0), commission, status, source: (c.sub >= 0 && r[c.sub]) || 'shopee-report' });
      added++;
    }
    await writeJson(dataFile(ctx, 'orders'), orders);
    const info = { at: nowIso(), rows: (o.rows || []).length, added, updated, headers: o.headers || [] };
    await ctx.store.set('lastSync', info);
    await ctx.events.emit('acc:changed', { what: 'orders' });
    ctx.job?.progress?.(1, `Thêm ${added} đơn, cập nhật ${updated}`);
    return info;
  },

  async setOrderStatus(args, ctx) {
    const orders = await readJson(dataFile(ctx, 'orders'), []);
    const o = orders.find(x => x.id === args.id);
    if (!o) throw new AppError('Không tìm thấy đơn.', 'not_found');
    o.status = args.status;
    await writeJson(dataFile(ctx, 'orders'), orders);
    await ctx.events.emit('acc:changed', { what: 'orders' });
    return o;
  },
  async deleteOrder(args, ctx) {
    const orders = (await readJson(dataFile(ctx, 'orders'), [])).filter(x => x.id !== args.id);
    await writeJson(dataFile(ctx, 'orders'), orders);
    await ctx.events.emit('acc:changed', { what: 'orders' });
    return { ok: true };
  },

  // Post a batch: code fetches every real link first, then the agent produces + publishes each item.
  async postBatch(args, ctx) {
    const cfg = await getConfig(ctx); requireConfig(cfg);
    if (!cfg.facebook.pageUrl) throw new AppError('Chưa khai báo Page Facebook ở mục Thiết lập.', 'no_facebook');
    const max = Math.min(10, Number(args.max) || cfg.content.maxPerBatch || 5);
    const items = (args.items || []).slice(0, max);
    if (!items.length) throw new AppError('Chưa chọn sản phẩm nào.', 'empty_batch');
    const batch = { id: uid(), startedAt: nowIso(), status: 'running', autoPublish: !!cfg.content.autoPublish,
      items: items.map(i => ({ ...i, status: 'queued', note: '' })) };
    const save = async () => { await ctx.store.set('batch', batch); await ctx.events.emit('acc:batch', batch); };
    await save();

    for (let k = 0; k < batch.items.length; k++) {
      ctx.throwIfCancelled?.();
      const it = batch.items[k];
      it.status = 'running'; it.note = it.link ? 'Dùng link trong Catalog…' : 'Lấy link affiliate…'; await save();
      if (it.catalogId) await updateCatalogQueue(ctx, it.catalogId, { queueStatus: 'posting', lastAttemptAt: nowIso(), lastError: '' });
      ctx.job?.progress?.(k / batch.items.length, `${k + 1}/${batch.items.length}: ${it.name.slice(0, 40)}`);
      try {
        if (!it.link) it.link = (await commands.getLink({ index: it.index }, ctx)).link;
        it.note = it.type === 'reel' ? 'Làm video & đăng reel…' : 'Làm poster & đăng bài…'; await save();
        const r = await ctx.agent.ask(buildPostPrompt(cfg, it), { json: true, timeoutMs: 1500000 });
        const res = r.json || {};
        if (res.ok === false || !res.ok && !res.postId && !res.postUrl) throw new Error(res.error || (r.text || 'Agent không xác nhận đã đăng').slice(0, 200));
        it.status = 'done'; it.note = res.published === false ? 'Đã soạn, chờ duyệt' : 'Đã đăng';
        it.postUrl = res.postUrl || ''; it.postId = res.postId || '';
        if (res.published !== false) {
          // Never count a claimed success without a Facebook URL/ID proof.
          await commands.recordPost({ platform: it.platform || 'shopee', sourceProductId: it.sourceProductId || '', productFingerprint: it.productFingerprint || productFingerprint(it.name), name: it.name, type: it.type, link: it.link, price: it.price, commission: it.commission,
            postUrl: it.postUrl, postId: it.postId, published: true, source: args.source || 'app' }, ctx);
          if (it.catalogId) await updateCatalogQueue(ctx, it.catalogId, {}, true); // remove only after verified publish
        } else if (it.catalogId) await updateCatalogQueue(ctx, it.catalogId, { queueStatus: 'ready', lastError: 'Đã soạn nhưng chưa xuất bản' });
      } catch (e) {
        it.status = 'error'; it.note = String(e.message || e).slice(0, 200);
        if (it.catalogId) await updateCatalogQueue(ctx, it.catalogId, { queueStatus: 'ready', retryCount: 'inc', lastAttemptAt: nowIso(), lastError: it.note });
        ctx.log?.info?.('batch item failed', { name: it.name, error: it.note });
      }
      await save();
    }
    batch.status = 'finished'; batch.finishedAt = nowIso(); await save();
    ctx.job?.progress?.(1, 'Xong lượt đăng');
    return batch;
  },

  // One-time import from the older file-based kit (ledger/catalog/KIT-CONFIG in the agent workspace).
  async importLegacy(args, ctx) {
    const ws = ctx.workspaceDir;
    const kit = await readJson(path.join(ws, 'KIT-CONFIG.json'), null);
    const ledger = await readJson(path.join(ws, 'ledger', 'ledger.json'), null);
    const cat = await readJson(path.join(ws, 'catalog', 'catalog.json'), null);
    let imported = { config: false, orders: 0, catalog: 0 };
    if (kit && !(await ctx.store.get('config'))) {
      await commands.saveConfig({ config: {
        brand: { name: kit.brand?.name || '', niche: kit.brand?.niche || '', audience: kit.brand?.audience || '', voice: kit.brand?.voice || '', address: kit.brand?.customerAddress || 'anh/chị' },
        facebook: { pageUrl: kit.channels?.facebookPageUrl || '', pageId: kit.channels?.facebookPageId || '', assetId: kit.channels?.metaAssetId || '' },
        shopee: { cdpPort: kit.shopee?.cdpPort || 9222, minCommission: kit.shopee?.minCommissionPercent || 0 },
        content: { linkPlacement: kit.content?.linkPlacement || 'comment' },
        finance: { taxMode: kit.finance?.taxMode || 'individual', pit: kit.finance?.individualPIT ?? 10 },
      } }, ctx);
      imported.config = true;
    }
    if (ledger?.orders?.length) {
      const orders = await readJson(dataFile(ctx, 'orders'), []);
      const have = new Set(orders.map(o => o.legacyId));
      // Only REAL Shopee orders (have an order id). Post logs with estimated commission are NOT orders.
      for (const o of ledger.orders) if (o.shopeeOrderId && !have.has(o.id)) { orders.push({ id: uid(), platform: o.platform || 'shopee', legacyId: o.id, shopeeOrderId: o.shopeeOrderId, date: String(o.date).slice(0, 10), product: o.product, orderValue: o.orderValue, commissionRate: o.commissionRate, commission: o.commission, status: o.status, source: o.source || 'import' }); imported.orders++; }
      await writeJson(dataFile(ctx, 'orders'), orders);
    }
    if (Array.isArray(cat) && cat.length) {
      const catalog = await readJson(dataFile(ctx, 'catalog'), []);
      const names = new Set(catalog.map(c => c.name));
      for (const c of cat) if (!names.has(c.name)) { catalog.push({ id: uid(), platform: c.platform || 'shopee', name: c.name, price: c.gia || '', commission: '', img: '', link: c.link || '', note: c.noiBat || '', addedAt: nowIso() }); imported.catalog++; }
      await writeJson(dataFile(ctx, 'catalog'), catalog);
    }
    await ctx.events.emit('acc:changed', { what: 'import' });
    return imported;
  },

  async resetAll(args, ctx) {
    if (args.confirm !== 'XOA') throw new AppError('Cần xác nhận.', 'confirm_required');
    for (const k of ['config', 'scan', 'batch']) await ctx.store.delete(k);
    for (const f of ['orders', 'catalog', 'posts']) await writeJson(dataFile(ctx, f), []);
    await ctx.events.emit('acc:changed', { what: 'reset' });
    return { ok: true };
  },

  async migrate(args, ctx) {
    const cfg = (await getConfig(ctx)) || structuredClone(DEFAULT_CONFIG); cfg.platforms = normalizePlatforms(cfg.platforms?.length ? cfg.platforms : DEFAULT_CONFIG.platforms); await ctx.store.set('config', cfg);
    const changed = {};
    for (const file of ['orders', 'catalog', 'posts']) { const rows = await readJson(dataFile(ctx, file), []); let n = 0; for (const x of rows) if (!x.platform) { x.platform = platformOf(x); n++; } if (n) await writeJson(dataFile(ctx, file), rows); changed[file] = n; }
    return { ok: true, from: args.from, to: args.to, changed };
  },
};

// Prompt for the agent: built only from the buyer's config + the chosen product.
function buildPostPrompt(cfg, it) {
  const isReel = it.type === 'reel';
  const linkRule = cfg.content.linkPlacement === 'caption' ? 'đặt link affiliate ngay trong caption' : (isReel ? 'đăng xong thì comment link affiliate dưới reel bằng tài khoản Page' : 'đặt link affiliate trong caption');
  return [
    `Nhiệm vụ: đăng 1 ${isReel ? 'REEL (video dọc 1080x1920)' : 'BÀI ẢNH (poster)'} quảng bá sản phẩm affiliate lên Facebook Page của shop "${cfg.brand.name}" (ngành: ${cfg.brand.niche}).`,
    `Page: ${cfg.facebook.pageUrl}${cfg.facebook.assetId ? ` · Meta asset_id: ${cfg.facebook.assetId}` : ''}.`,
    `Sản phẩm: ${it.name}`,
    `Giá: ${it.price || 'không rõ'} · Hoa hồng: ${it.commission || '?'} · Ảnh gốc: ${it.img || 'không có'}`,
    `Link affiliate (đã lấy thật, dùng đúng link này): ${it.link}`,
    `Khách hàng mục tiêu: ${cfg.brand.audience || 'người mua online tại Việt Nam'}. Giọng văn: ${cfg.brand.voice}. Xưng hô với khách: ${cfg.brand.address}.`,
    it.caption ? `Ghi chú của chủ shop cho caption: ${it.caption}` : '',
    '',
    'Quy tắc:',
    '- Mọi chữ tiếng Việt viết ĐỦ DẤU. Không bịa công dụng, chính hãng hay giá; chỉ dùng thông tin ở trên.',
    isReel
      ? '- Dùng skill shopee-affiliate-video để dựng video từ ảnh sản phẩm (có giọng đọc nếu được), kiểm tra file ra đúng 1080x1920, rồi dùng skill facebook-page-posting để đăng reel.'
      : '- Tạo poster từ ảnh sản phẩm (skill shopee-affiliate-video có script render-poster), kiểm tra chữ không đè sản phẩm, rồi dùng skill facebook-page-posting để đăng bài ảnh.',
    !isReel
      ? '- ẢNH BẮT BUỘC là .jpg hoặc .png (KHÔNG dùng .webp — Facebook hay hiểu nhầm là video và nhảy sang trình soạn Reel). Nếu ảnh gốc là .webp thì convert sang .jpg trước khi upload.'
      : '',
    !isReel
      ? '- Đây là BÀI ẢNH trên bảng feed, KHÔNG phải Reel. Nếu trình soạn mở ra "Tạo thước phim"/"Mô tả thước phim của bạn": đóng lại, xoá bản nháp treo (nút Đóng → Rời khỏi), rồi mở lại composer "Bạn đang nghĩ gì?" theo Flow A của skill facebook-page-posting.'
      : '',
    `- Link: ${linkRule}.`,
    cfg.content.autoPublish
      ? '- Chủ shop đã bật TỰ ĐĂNG: đăng công khai luôn, không chờ duyệt.'
      : '- Chủ shop CHƯA bật tự đăng: soạn sẵn tới bước cuối, KHÔNG bấm đăng; trả published=false.',
    '- Sau khi đăng phải mở lại bài để xác minh nội dung + link đã lên. Không xác minh được = coi là lỗi.',
    '- Facebook hoặc Shopee hiện đăng nhập/CAPTCHA: dừng và báo lỗi, không tự đăng nhập.',
    '',
    'Trả lời DUY NHẤT 1 JSON: {"ok":true|false,"published":true|false,"postUrl":"…","postId":"…","error":"… nếu lỗi"}',
  ].filter(Boolean).join('\n');
}
