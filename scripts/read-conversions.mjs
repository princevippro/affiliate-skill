// Read REAL orders from Shopee Affiliate conversion report in a temporary tab.
// Usage: node read-conversions.mjs [port]  → JSON {headers, rows, url} or {error}
const port = process.argv[2] || '9222';
const URL = 'https://affiliate.shopee.vn/report/conversion_report';
const base = `http://127.0.0.1:${port}`;
const out = o => { console.log(JSON.stringify(o)); setTimeout(() => process.exit(0), 100); };
setTimeout(() => out({ error: 'timeout đọc báo cáo' }), 75000);

let tab;
try {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
  tab = await r.json();
} catch (e) { out({ error: 'không mở được tab báo cáo: ' + e.message }); }

const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise(res => { const m = ++id; pend.set(m, res); ws.send(JSON.stringify({ id: m, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const close = async () => { try { await fetch(`${base}/json/close/${tab.id}`); } catch {} };

ws.onopen = async () => {
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 7000)); // let the SPA finish its first navigation
  const expr = `(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<40;i++){ // wait up to ~20s for table or empty state
      if(/login|signin/i.test(location.href)) return {error:'login'};
      const t=document.querySelector('table tbody tr'); const txt=document.body.innerText||'';
      if(t||/không có dữ liệu|no data|chưa có/i.test(txt)) break; await sleep(500);
    }
    const table=document.querySelector('table');
    const headers=table?[...table.querySelectorAll('thead th, thead td')].map(x=>(x.innerText||'').trim()):[];
    const rows=table?[...table.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td,th')].map(td=>(td.innerText||'').trim())).filter(r=>r.length>2):[];
    return {url:location.href, headers, rows:rows.slice(0,500)};
  })()`;
  let r;
  for (let k = 0; k < 3; k++) { r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.result?.value) break; await new Promise(x => setTimeout(x, 3000)); }
  await close();
  try { ws.close(); } catch {}
  const v = r.result?.result?.value;
  if (!v) out({ error: 'không đọc được trang báo cáo: ' + JSON.stringify(r.result?.exceptionDetails?.text || r.error || '').slice(0, 120) });
  if (!v) out({ error: 'không đọc được trang báo cáo' });
  if (v.error === 'login') out({ error: 'Shopee Affiliate yêu cầu đăng nhập lại' });
  out(v);
};
ws.onerror = async () => { await close(); out({ error: 'lỗi kết nối Chrome' }); };
