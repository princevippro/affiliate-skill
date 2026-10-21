// Get an affiliate short link for a visible card by index. Usage: node getlink.mjs <pageId> <index> [port]
const pageId=process.argv[2],idx=Number(process.argv[3]),port=process.argv[4]||'9222';if(!pageId||!Number.isInteger(idx)){console.error('usage: getlink.mjs <pageId> <index> [port]');process.exit(1)}
const ws=new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${pageId}`);let id=0;const pending=new Map();const send=(method,params)=>new Promise(res=>{const mid=++id;pending.set(mid,res);ws.send(JSON.stringify({id:mid,method,params}))});ws.onmessage=e=>{const m=JSON.parse(e.data.toString());if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
ws.onopen=async()=>{await send('Runtime.enable',{});const r=await send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:`(async()=>{const cards=[...document.querySelectorAll('.AffiliateItemCard')];const card=cards[${idx}];if(!card)return{error:'card not found',total:cards.length};const b=[...card.querySelectorAll('button,[role=button]')].find(x=>(x.innerText||'').trim()==='Lấy link');if(!b)return{error:'button not found'};
// close any existing dialog first so we don't read a stale link
const closeAll=()=>{[...document.querySelectorAll('[aria-label*=close i],[aria-label*=Đóng i],.shopee-popup__close-btn,.eds-modal__close')].forEach(x=>{try{x.click()}catch{}})};
closeAll();await new Promise(r=>setTimeout(r,400));
const before=[...document.querySelectorAll('input,textarea')].map(i=>i.value).find(v=>(v||'').startsWith('https://s.shopee.vn/'))||null;
b.click();
let link=null;for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,400));link=[...document.querySelectorAll('input,textarea')].map(i=>i.value).find(v=>(v||'').startsWith('https://s.shopee.vn/'))||null;if(link&&link!==before)break;}
const href=card.closest('a')?.getAttribute('href')||card.querySelector('a')?.getAttribute('href')||'';const sourceProductId=(href.match(/product_offer\\/(\\d+)/)||[])[1]||'';
const name=(card.querySelector('.ItemCard__name')?.innerText||card.querySelector('.ItemCard__contentSection')?.innerText||'').trim().slice(0,180);
const commText=(card.querySelector('.commRate,[class*=commRate],[class*=commission]')?.innerText||'');const commission=(commText.match(/([\\d.,]+)\\s*%/)||[])[1];
closeAll();
return{index:${idx},sourceProductId,name,commission:commission?commission+'%':'',link,changed:link!==before}})()`});console.log(JSON.stringify(r.result?.result?.value??r.result));ws.close();process.exit(0)};setTimeout(()=>{console.log('TIMEOUT');process.exit(1)},12000);
