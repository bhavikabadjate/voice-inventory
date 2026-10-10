// Browser checks: forms, bill, khata, shop details, reload, dark mode, screen sizes.
// Usage: serve this folder on port 8765 (python3 -m http.server 8765), then: node tests/ui.test.js  (needs playwright)
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'}).catch(()=>chromium.launch());
const ctx=await b.newContext({viewport:{width:360,height:640}});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const R=[];const ok=(n,c,d)=>R.push((c?'ok   ':'FAIL ')+n+(c?'':' → '+JSON.stringify(d)));
const ev=f=>pg.evaluate(f);const over=async n=>ok('no sideways scroll: '+n,await ev(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1),await ev(()=>[document.documentElement.scrollWidth,innerWidth,document.documentElement.scrollHeight,innerHeight]));
await pg.goto('http://localhost:8765/index.html');await pg.waitForTimeout(2500);
await over('ask 360x640');
// --- stock form
await pg.click('[data-tab=stock]');await over('stock');
await pg.click('#newBtn');await pg.fill('#f-name','<img src=x onerror=window.__x=1> Very Long Product Name That Goes On And On For Testing Layout');await pg.fill('#f-sell','25');await pg.fill('#f-qty','3');await pg.click('#edit button[type=submit]');
ok('html in a name is shown as text, not run',await ev(()=>!window.__x&&[...document.querySelectorAll('#stockList b')].some(x=>x.textContent.includes('<img'))));await over('stock with a very long name');
await pg.click('#newBtn');await pg.fill('#f-name','Milk');await pg.fill('#f-sell','60');await pg.click('#edit button[type=submit]');
ok('adding an existing name opens the existing product',await ev(()=>S.products.filter(p=>p.name==='Milk').length===1&&/already exists/.test(document.getElementById('alerts').textContent)),await ev(()=>document.getElementById('alerts').textContent));
await pg.click('#f-cancel');
await pg.click('#newBtn');await pg.fill('#f-name','Negative Test');await pg.fill('#f-sell','-5').catch(()=>{});await pg.fill('#f-qty','-3').catch(()=>{});await pg.click('#edit button[type=submit]');
ok('negative price or quantity is not saved',await ev(()=>!S.products.some(p=>p.sell<0||p.qty<0)),await ev(()=>S.products.filter(p=>p.sell<0||p.qty<0)));
await ev(()=>{document.getElementById('edit').hidden=true});
await pg.click('#newBtn');await pg.fill('#f-name','');await pg.click('#edit button[type=submit]');ok('empty name is not saved',await ev(()=>!S.products.some(p=>!p.name)));await ev(()=>{document.getElementById('edit').hidden=true});
// edit qty and expiry, then delete with two taps
await ev(()=>openEdit(S.products.find(p=>p.name==='Sugar')));await pg.fill('#f-qty','20');await pg.fill('#f-exp','2026-12-01');await pg.click('#edit button[type=submit]');
ok('editing quantity logs a stock change and keeps batches',await ev(()=>{const p=S.products.find(p=>p.name==='Sugar');return p.qty===20&&p.batches.length>=1&&S.moves[0].name==='Sugar'}),await ev(()=>S.products.find(p=>p.name==='Sugar')));
const n0=await ev(()=>S.products.length);await ev(()=>openEdit(S.products.find(p=>p.name==='Haldi')));await pg.click('#f-del');ok('one tap on Delete does not delete',await ev(()=>S.products.some(p=>p.name==='Haldi')));await pg.click('#f-del');ok('second tap deletes',await ev(()=>!S.products.some(p=>p.name==='Haldi')));
// --- sell
await pg.click('[data-tab=sales]');await over('sell empty');await pg.click('#quick .chip');await pg.click('#quick .chip');ok('tapping an item twice makes quantity 2',await ev(()=>S.bill.length===1&&S.bill[0].qty===2),await ev(()=>S.bill));
await pg.click('[data-rm]');ok('× removes the line',await ev(()=>S.bill.length===0));
await pg.fill('#say','2 kilo cheeni, 1 litre dudh');await pg.click('#composer button');await pg.click('#b-ok');await pg.waitForTimeout(600);
ok('confirm sale records it and shows the amount to collect',await ev(()=>S.sales.length===1&&/₹144/.test(document.getElementById('payBox').textContent)),await ev(()=>document.getElementById('payBox').textContent));await over('sell with payment card');
await pg.fill('#p-cust','Test Customer');await pg.click('#p-khata');ok('bill moved to khata',await ev(()=>S.customers.length===1&&balance(S.customers[0].id)===144));
// --- khata
await pg.click('[data-tab=khata]');await over('khata');await pg.click('#k-form button[type=submit]');ok('empty khata form is refused',await ev(()=>S.khata.length===1&&/dono|both/.test(document.getElementById('k-msg').textContent)));
await pg.fill('#k-name','Asha');await pg.fill('#k-amt','100');await pg.fill('#k-phone','12345');await pg.click('#k-form button[type=submit]');ok('bad phone is refused',await ev(()=>!S.customers.some(c=>c.name==='Asha')));
await pg.fill('#k-phone','9876543210');await pg.click('#k-form button[type=submit]');ok('good phone is saved with +91',await ev(()=>(S.customers.find(c=>c.name==='Asha')||{}).phone==='919876543210'));
await pg.fill('#k-name','Asha');await pg.fill('#k-amt','150');await pg.click('#k-paid');ok('paying more than owed shows an advance, not a negative debt',await ev(()=>/advance|jama/.test(document.getElementById('khataList').textContent)),await ev(()=>document.getElementById('khataList').textContent.slice(0,120)));
// --- shop
await pg.click('[data-tab=shop]');await over('shop');await pg.fill('#i-name','Test Kirana');await pg.fill('#i-upi','not a upi');await pg.click('#i-form button[type=submit]');ok('bad UPI ID is refused',await ev(()=>!S.shop.upi));
await pg.fill('#i-upi','test@okaxis');await pg.click('#i-form button[type=submit]');ok('good UPI ID is saved',await ev(()=>S.shop.upi==='test@okaxis'));
await pg.click('[data-tab=sales]');await pg.fill('#say','1 kilo cheeni');await pg.click('#composer button');await pg.click('#b-ok');await pg.waitForTimeout(900);ok('QR is drawn once a UPI ID is set',await ev(()=>!!document.querySelector('#payBox .qr svg')));
// --- reload keeps everything
const before=await ev(()=>JSON.stringify([S.products.length,S.sales.length,S.khata.length,S.shop.upi,S.moves.length]));await pg.reload();await pg.waitForTimeout(2500);
ok('everything is still there after reloading the page',before===await ev(()=>JSON.stringify([S.products.length,S.sales.length,S.khata.length,S.shop.upi,S.moves.length])),before);
// --- dark mode, wide and tiny screens
await pg.emulateMedia({colorScheme:'dark'});await pg.click('[data-tab=talk]');await pg.fill('#say','aaj ka hisaab');await pg.click('#composer button');await pg.screenshot({path:'ui-dark.png'});
const contrast=await ev(()=>{const c=getComputedStyle(document.body);return[c.backgroundColor,c.color]});ok('dark mode has a dark page and light text',/rgb\((1?\d|2\d), /.test(contrast[0]),contrast);
for(const [w,h] of [[320,568],[1280,720],[768,1024]]){await pg.setViewportSize({width:w,height:h});await pg.waitForTimeout(150);for(const t of ['talk','stock','sales','khata','shop']){await pg.click(`[data-tab=${t}]`);await over(`${t} ${w}x${h}`)}}
ok('no script errors during the whole run',errs.length===0,errs);
console.log(R.filter(x=>x.startsWith('FAIL')).join('\n')||'no failures');console.log(R.length+' checks, '+R.filter(x=>x.startsWith('FAIL')).length+' failed');await b.close()})()
