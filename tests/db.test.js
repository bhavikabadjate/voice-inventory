// End-to-end database test: the app running as several phones against a real Postgres that has the
// shop's migrations applied (see pgfake.js). Covers saving, reading back, two phones, permissions,
// offline work, lost connections and expired sign-ins.
// Usage: npm i @electric-sql/pglite && node tests/db.test.js
const {makeBackend,Phone,wait,fakeArtifactDb}=require('./pgfake');
const J=JSON.stringify,r3=x=>Math.round(x*1000)/1000;
(async()=>{let fail=0,n=0;const ok=(name,c,d)=>{n++;if(!c){fail++;console.log('FAIL',name,d===undefined?'':J(d))}};
const NOW=Date.now();
const device=()=>({shop:J({shop:{name:'',upi:'me@okaxis'},moves:[],
  products:[{id:'sugar',name:'Sugar',names:['cheeni','चीनी'],unit:'kg',qty:20,cost:39,sell:44,low:5,expiry:''},{id:'milk',name:'Milk',names:['dudh'],unit:'L',qty:18,cost:48,sell:56,low:5,expiry:'2026-10-14',batches:[{qty:18,exp:'2026-10-14'}]},
    {id:'parle',name:'Parle-G',names:[],unit:'packet',qty:40,cost:8.5,sell:10,low:12,expiry:''},{id:'eggs',name:'Eggs',names:['anda'],unit:'pc',qty:90,cost:5.5,sell:7,low:24,expiry:''}],
  sales:[{items:[{name:'Sugar',qty:2,unit:'kg',rate:44,amount:88},{name:'Parle-G',qty:1,unit:'packet',rate:10,amount:10}],total:98,at:NOW-3*864e5},{items:[{name:'Milk',qty:0.5,unit:'L',rate:56,amount:28}],total:28,at:NOW-864e5}],
  customers:[{id:'c1',name:'Bhavika',phone:'919000000001'}],khata:[{id:'k1',cid:'c1',amount:500,note:'',at:NOW-5000},{id:'k2',cid:'c1',amount:42,note:'bill',at:NOW-1000}]})});
const pid=(ph,name)=>ph.ev(`(S.products.find(p=>p.name===${J(name)})||{}).id`);
const qty=(ph,name)=>ph.ev(`(S.products.find(p=>p.name===${J(name)})||{qty:null}).qty`);
const sell=(ph,name,q)=>ph.ev(`(()=>{const p=S.products.find(p=>p.name===${J(name)});return recordSale([{id:p.id,name:p.name,qty:${q},unit:p.unit,rate:p.sell,amount:Math.round(${q}*p.sell*100)/100}],true)})()`);
const signIn=async(ph,email)=>{ph.set('o-email',email);await ph.click('c-send');ph.set('o-code','123456');await ph.click('c-verify')};
const same=async(B,ph,label)=>{const sid=ph.ev('store.id'),rows=await B.sql('select p.id,(select coalesce(sum(delta),0) from stock_moves m where m.product_id=p.id)::float8 q from products p where p.store_id=$1 and not p.deleted',[sid]);
  const scr=ph.ev('S.products.map(p=>[p.id,p.qty])'),m=new Map(scr);ok(label+': screen stock matches the database',rows.length===scr.length&&rows.every(r=>r3(r.q)===m.get(r.id)),{db:rows.map(r=>r3(r.q)),screen:scr.map(x=>x[1])})};

/* ---- A. The in-app database check, against the real schema and against broken ones ---- */
{const B=await makeBackend(),ph=await new Phone(B,{}).open();const r=await ph.ev('runDbCheck()');const core=r.filter(x=>!/Claude function/.test(x.name));
 ok('A1 the check passes on the full schema',core.length>=22&&core.every(x=>x.ok),r.filter(x=>!x.ok));
 ok('A2 it reports Claude functions that are not deployed as optional, in plain words',r.filter(x=>/Claude function/.test(x.name)).every(x=>!x.ok&&x.opt&&/not deployed/.test(x.detail)),r.filter(x=>/Claude/.test(x.name)));
 ok('A3 it cleans up its product and staff member',(await B.sql("select count(*)::int n from products where not deleted"))[0].n===0&&(await B.sql("select count(*)::int n from members where role='staff'"))[0].n===0);
 ok('A4 it left the phone signed out and in no shop',!ph.ev('store')&&!ph.ev('session'));
 const r2=await ph.ev('runDbCheck()');ok('A5 it can be run again',r2.filter(x=>!/Claude function/.test(x.name)).every(x=>x.ok),r2.filter(x=>!x.ok));
 B.anonymous=false;const r3_=await ph.ev('runDbCheck()');ok('A6 anonymous sign-in off is named as the one problem, with where to fix it',r3_.filter(x=>!x.ok).length===1&&/Anonymous sign-in/.test(r3_.find(x=>!x.ok).name)&&/Authentication/.test(r3_.find(x=>!x.ok).detail)&&!r3_.some(x=>/test shop/.test(x.name)),r3_.filter(x=>!x.ok));B.anonymous=true;
 await B.pg.exec('alter table public.products disable row level security');const r4=await ph.ev('runDbCheck()');
 ok('A7 a hole in the access rules is caught',r4.some(x=>/stranger cannot read/.test(x.name)&&!x.ok)&&r4.some(x=>/stranger cannot write/.test(x.name)&&!x.ok),r4.filter(x=>!x.ok).map(x=>x.name));
 ph.net.offline=true;const r5=await ph.ev('runDbCheck()');ok('A8 no internet is reported as one clear line',r5.length===1&&!r5[0].ok,r5)}
{const B=await makeBackend({migrations:['1_shop_sync.sql']}),ph=await new Phone(B,{}).open();const r=await ph.ev('runDbCheck()');
 const bad=r.filter(x=>!x.ok&&!x.opt),opt=r.filter(x=>x.opt).map(x=>x.name);
 ok('A9 a missing khata setup is the one problem flagged, with what to run',bad.length===1&&/^Khata/.test(bad[0].name)&&/supabase-setup\.sql/.test(bad[0].detail)&&opt.some(x=>/batches/.test(x))&&r.filter(x=>x.ok).length>=18,r.filter(x=>!x.ok))}

/* ---- B. Two phones, one shop ---- */
const B=await makeBackend();
let owner=await new Phone(B,device()).open();
ok('B1 before sign-in the phone shows its own data',owner.ev('S.products.length')===4&&owner.ev("balance('c1')")===542&&!owner.ev('store'));
await signIn(owner,'owner@example.com');ok('B2 the email code signs the owner in',!!owner.ev('session')&&!owner.ev('store')&&owner.msg()==='',owner.msg());
owner.set('n-shop','Chintamani Kirana').set('n-owner','Bhavika');await owner.click('c-create');
const sid=owner.ev('store&&store.id'),code=owner.ev('store&&store.code');
ok('B3 the shop is created',!!sid&&/^\d{6}$/.test(code)&&owner.msg()==='',owner.msg());
{const ps=await B.sql('select * from products where store_id=$1',[sid]),cs=await B.sql('select * from product_costs where store_id=$1',[sid]),st=(await B.sql('select * from stores where id=$1',[sid]))[0];
 ok('B4 its products are in the database',ps.length===4&&ps.every(p=>!p.deleted)&&ps.find(p=>p.names[0]==='Sugar').sell_paise===4400&&ps.find(p=>p.names[0]==='Parle-G').unit==='custom:packet',ps.map(p=>[p.names[0],p.unit,p.sell_paise]));
 ok('B5 with cost prices',cs.length===4&&cs.some(c=>c.cost_paise===850),cs);
 ok('B6 expiry date and batches saved',ps.find(p=>p.names[0]==='Milk').expiry==='2026-10-14'&&(b=>b.length===1&&b[0].qty===18&&b[0].exp==='2026-10-14')(ps.find(p=>p.names[0]==='Milk').batches),ps.find(p=>p.names[0]==='Milk'));
 await same(B,owner,'B7');ok('B7 stock numbers are unchanged by signing in',qty(owner,'Sugar')===20&&qty(owner,'Milk')===18&&qty(owner,'Eggs')===90);
 ok('B8 khata and UPI ID came along',(await B.sql('select * from khata_entries where store_id=$1',[sid])).length===2&&st.upi_id==='me@okaxis'&&owner.ev("balance('c1')")===542,st);
 const sl=await B.sql('select * from sales where store_id=$1',[sid]);
 ok('B9 earlier sales came along too',sl.length===3&&new Set(sl.map(s=>s.bill_id)).size===2&&owner.ev('S.sales.length')===2&&owner.ev('S.sales.reduce((a,s)=>a+s.total,0)')===126,[sl.length,owner.ev('S.sales.length')]);
 ok('B10 nothing is left waiting',owner.ev('OB.length')===0)}

owner.ev(`(()=>{const a=S.products.find(p=>p.name==='Sugar'),b=S.products.find(p=>p.name==='Parle-G');recordSale([{id:a.id,name:a.name,qty:2.5,unit:'kg',rate:44,amount:110},{id:b.id,name:b.name,qty:3,unit:'packet',rate:10,amount:30}],true)})()`);await owner.settle();
{const sl=await B.sql("select * from sales where store_id=$1 and sold_at>now()-interval '1 minute'",[sid]);
 ok('B11 a sale lowers stock and is recorded',qty(owner,'Sugar')===17.5&&qty(owner,'Parle-G')===37&&sl.length===2&&sl[0].bill_id===sl[1].bill_id&&sl.map(s=>s.amount_paise).sort().join()==='11000,3000',sl);await same(B,owner,'B11')}

let staff=await new Phone(B,{}).open();staff.set('s-code',code).set('s-name','Ravi');await staff.click('c-join');
ok('B12 staff join with the shop code',staff.ev('store&&store.id')===sid&&staff.ev('member.role')==='staff'&&staff.msg()==='',staff.msg());
ok('B13 and see the same stock, sales and khata',staff.ev('S.products.length')===4&&staff.ev("S.products.find(p=>p.name==='Sugar').names.join()")==='cheeni,चीनी'&&qty(staff,'Sugar')===17.5&&staff.ev('S.sales.length')===3&&staff.ev("balance('c1')")===542,[qty(staff,'Sugar'),staff.ev('S.sales.length')]);
ok('B14 but not the cost prices',staff.ev('S.products.every(p=>p.cost==null)')&&staff.els.costOn.checked===false);
sell(staff,'Milk',1);await staff.settle();await owner.sync();
ok('B15 a sale by staff shows on the owner phone',qty(owner,'Milk')===17&&owner.ev('S.sales.length')===4,qty(owner,'Milk'));await same(B,owner,'B15');
const staffUid=staff.ls['sb-auth'];
await owner.ev('loadTeam()');await owner.els.teamBox.onchange({target:{dataset:{f:'can_see_cost',u:staffUid},checked:true}});await staff.sync();
ok('B16 the owner can let staff see cost prices',staff.ev("S.products.find(p=>p.name==='Sugar').cost")===39,staff.ev('S.products.map(p=>p.cost)'));
{const id=pid(staff,'Eggs');staff.ev(`deleteProduct(${J(id)})`);await staff.settle();await staff.sync();
 ok('B17 staff without permission cannot delete a product',(await B.sql('select deleted from products where id=$1',[id]))[0].deleted===false&&qty(staff,'Eggs')===90,staff.msg());
 ok('B18 and are told why',/ijazat|permission/i.test(staff.msg()+staff.log.join(' ')),staff.msg());
 await owner.els.teamBox.onchange({target:{dataset:{f:'can_delete',u:staffUid},checked:true}});await staff.sync();staff.ev(`deleteProduct(${J(id)})`);await staff.settle();await owner.sync();
 ok('B19 with permission the delete goes through everywhere',(await B.sql('select deleted from products where id=$1',[id]))[0].deleted===true&&owner.ev('S.products.length')===3&&staff.ev('S.products.length')===3)}
staff.ev("(()=>{const p=S.products.find(p=>p.name==='Sugar');saveProduct({...p,sell:46},'set',true)})()");await staff.settle();await owner.sync();
ok('B20 a price change by staff reaches the owner',owner.ev("S.products.find(p=>p.name==='Sugar').sell")===46&&owner.ev("S.products.find(p=>p.name==='Sugar').cost")===39&&qty(owner,'Sugar')===17.5);
staff.ev("(()=>{addKhata(S.customers.find(c=>c.id==='c1'),200,'',true);const c=addCustomer('Sita','919000000002');addKhata(c,150,'',true)})()");await staff.settle();await owner.sync();
ok('B21 khata written by staff reaches the owner',owner.ev("balance('c1')")===742&&owner.ev("balance(S.customers.find(c=>c.name==='Sita').id)")===150,owner.ev('S.khata.length'));
owner.ev("addKhata(S.customers.find(c=>c.id==='c1'),-100,'paid',true)");await owner.settle();await staff.sync();
ok('B22 a payment taken by the owner reaches staff',staff.ev("balance('c1')")===642&&(await B.sql('select sum(amount_paise)::int s from khata_entries where customer_id=$1',['c1']))[0].s===64200);
{const before=qty(owner,'Sugar'),bills=owner.ev('S.sales.length');owner.ev(`(()=>{const p=S.products.find(p=>p.name==='Sugar');recordSale([{id:p.id,name:p.name,qty:2,unit:'kg',rate:p.sell,amount:92}])})()`);await owner.settle();
 ok('B23 a sale is saved',qty(owner,'Sugar')===before-2);owner.ev('doUndo()');await owner.settle();await owner.sync();await staff.sync();
 const net=(await B.sql("select coalesce(sum(amount_paise),0)::int s, coalesce(sum(qty),0)::float8 q from sales where product_id=$1 and sold_at>now()-interval '1 minute' and sell_paise=4600",[pid(owner,'Sugar')]))[0];
 ok('B24 undo puts the stock back on every phone and cancels the money',qty(owner,'Sugar')===before&&qty(staff,'Sugar')===before&&net.s===0&&net.q===0,[qty(owner,'Sugar'),qty(staff,'Sugar'),net]);await same(B,owner,'B24')}

owner.ev("saveShop({name:'Chintamani Kirana Store',upi:'shop@ybl'})");owner.ev("(()=>{const c=S.customers.find(c=>c.id==='c1');c.name='Bhavika B';c.phone='919000000009';saveCustomer(c)})()");await owner.settle();await staff.sync();
ok('B25 a new UPI ID, shop name or customer phone number reaches the other phone',staff.ev('S.shop.upi')==='shop@ybl'&&staff.ev('S.shop.name')==='Chintamani Kirana Store'&&staff.ev("S.customers.find(c=>c.id==='c1').phone")==='919000000009'&&staff.ev("balance('c1')")===642,[staff.ev('J=JSON.stringify(S.shop)')]);
{const before=J(await B.sql('select (select count(*) from products where store_id=$1)::int p,(select count(*) from stock_moves where store_id=$1)::int m,(select count(*) from sales where store_id=$1)::int s,(select count(*) from khata_entries where store_id=$1)::int k,(select count(*) from members where store_id=$1)::int t',[sid]));
 const r=await owner.ev('runDbCheck()'),core=r.filter(x=>!/Claude function/.test(x.name));
 const after=J(await B.sql('select (select count(*) from products where store_id=$1)::int p,(select count(*) from stock_moves where store_id=$1)::int m,(select count(*) from sales where store_id=$1)::int s,(select count(*) from khata_entries where store_id=$1)::int k,(select count(*) from members where store_id=$1)::int t',[sid]));
 ok('B26 the database check passes on a signed-in phone, including its own shop',core.every(x=>x.ok)&&core.length>=27&&core.filter(x=>/Your own shop/.test(x.name)).length===3,r.filter(x=>!x.ok));
 ok('B27 and leaves the real shop and the sign-in untouched',before===after&&owner.ev('store.id')===sid&&!!owner.ev('session')&&owner.ls['sb-auth']&&(await owner.sync(),owner.ev('S.products.length')===3),[before,after])}

/* ---- C. No internet ---- */
owner.net.offline=true;
sell(owner,'Sugar',1);sell(owner,'Sugar',1);sell(owner,'Sugar',0.5);
owner.ev("(()=>{const p=S.products.find(p=>p.name==='Parle-G');saveProduct({...p,qty:p.qty+24},'restock',true);saveProduct({id:nid('p'),name:'Rice',names:['chawal'],unit:'kg',qty:50,cost:52,sell:62,low:10,expiry:''},'set',true);addKhata(S.customers.find(c=>c.id==='c1'),75,'',true)})()");await owner.settle();
ok('C1 offline changes show at once and wait in a queue',qty(owner,'Sugar')===15&&qty(owner,'Parle-G')===61&&qty(owner,'Rice')===50&&owner.ev('OB.length')>=10&&/waiting/.test(owner.els.status.textContent),[owner.ev('OB.length'),owner.els.status.textContent]);
owner=await owner.reload();
ok('C2 closing and reopening the app offline keeps them',owner.ev('store&&store.id')===sid&&qty(owner,'Sugar')===15&&qty(owner,'Rice')===50&&owner.ev("balance('c1')")===717&&owner.ev('OB.length')>=10,[owner.ev('!!store'),qty(owner,'Sugar'),owner.ev('OB.length')]);
sell(staff,'Sugar',2);await staff.settle();   /* meanwhile, on the other phone */
owner.net.offline=false;await owner.sync();await staff.sync();
ok('C3 back online everything is sent, and both phones agree',owner.ev('OB.length')===0&&qty(owner,'Sugar')===13&&qty(staff,'Sugar')===13&&qty(staff,'Rice')===50&&qty(staff,'Parle-G')===61&&staff.ev("balance('c1')")===717,[owner.ev('OB.length'),qty(owner,'Sugar'),qty(staff,'Sugar'),owner.msg()]);
await same(B,owner,'C3 owner');await same(B,staff,'C3 staff');
{const m0=(await B.sql('select count(*)::int n from stock_moves'))[0].n,s0=(await B.sql('select count(*)::int n from sales'))[0].n;
 owner.net.lostReply=3;sell(owner,'Milk',1);await owner.settle();for(let i=0;i<6&&owner.ev('OB.length');i++)await owner.sync();
 const m1=(await B.sql('select count(*)::int n from stock_moves'))[0].n,s1=(await B.sql('select count(*)::int n from sales'))[0].n;
 ok('C4 a dropped connection mid-save never counts a sale twice',owner.ev('OB.length')===0&&m1===m0+1&&s1===s0+1&&qty(owner,'Milk')===16,[m1-m0,s1-s0,qty(owner,'Milk')]);await same(B,owner,'C4')}
owner.net.down=true;sell(owner,'Milk',1);await owner.settle();await owner.sync();
ok('C5 a server error keeps the change waiting instead of dropping it',owner.ev('OB.length')>=3&&!/dropped/.test(owner.msg()),[owner.ev('OB.length'),owner.msg()]);
owner.net.down=false;await owner.sync();ok('C6 and it goes through once the server is back',owner.ev('OB.length')===0&&qty(owner,'Milk')===15);await same(B,owner,'C6');

/* ---- D. Sign-in problems ---- */
owner.net.offline=true;owner.net.expired=true;owner=await owner.reload();
ok('D1 opening the app offline with a stale sign-in still opens the shop',owner.ev('store&&store.id')===sid&&owner.ev('S.products.length')===4&&qty(owner,'Milk')===15,[owner.ev('!!store'),owner.ev('S.products.length')]);
sell(owner,'Parle-G',1);await owner.settle();
ok('D2 and a sale made then is queued for the shop, not lost in the old device copy',owner.ev('OB.length')>=2&&JSON.parse(owner.ls.shop).products.find(p=>p.name==='Parle-G').qty===40,owner.ev('OB.length'));
owner.net.offline=false;await owner.sync();
ok('D3 it syncs when the internet returns',owner.ev('OB.length')===0&&qty(owner,'Parle-G')===60&&!!owner.ev('session'),[owner.ev('OB.length'),qty(owner,'Parle-G')]);await same(B,owner,'D3');
owner.net.gone=true;owner=await owner.reload();sell(owner,'Parle-G',1);await owner.settle();await owner.sync();
ok('D4 if the sign-in was lost, the shop stays open and changes wait',owner.ev('store&&store.id')===sid&&owner.ev('OB.length')>=2&&qty(owner,'Parle-G')===59&&!/dropped/.test(owner.msg()),[owner.ev('!!store'),owner.ev('OB.length'),owner.msg()]);
ok('D5 and the Shop tab asks to sign in again',/sign in again/i.test(owner.msg()+owner.els.status.textContent),[owner.msg(),owner.els.status.textContent]);
owner.net.gone=false;await signIn(owner,'owner@example.com');await owner.sync();
ok('D6 signing in again sends what was waiting',owner.ev('OB.length')===0&&owner.ev('store&&store.id')===sid&&qty(owner,'Parle-G')===59&&(await B.sql('select sum(delta)::float8 s from stock_moves where product_id=$1',[pid(owner,'Parle-G')]))[0].s.toFixed(3)==='59.000',[owner.ev('OB.length'),owner.msg()]);

/* ---- E. Bigger data, units, batches ---- */
{const id=pid(owner,'Sugar'),q0=qty(owner,'Sugar');
 await B.pg.exec(`insert into stock_moves (id,store_id,product_id,delta,reason) select 'bulk'||g,'${sid}','${id}',case when g%2=0 then 1 else -1 end,'sale' from generate_series(1,2500) g; insert into stock_moves (id,store_id,product_id,delta,reason) values ('bulkx','${sid}','${id}',5,'restock');
   insert into sales (id,store_id,bill_id,product_id,qty,sell_paise,amount_paise,sold_at) select 'bs'||g,'${sid}','bb'||g,'${id}',1,4600,4600,now()-interval '2 days' from generate_series(1,1200) g;`);
 const bills=owner.ev('S.sales.length');await owner.sync();
 ok('E1 more than 1000 rows are read completely',qty(owner,'Sugar')===q0+5&&owner.ev('S.sales.length')===bills+1200,[qty(owner,'Sugar'),q0,owner.ev('S.sales.length')-bills]);await same(B,owner,'E1')}
{await B.pg.exec(`insert into products (id,store_id,names,unit,sell_paise) values ('boxy','${sid}','["Matchbox","machis"]','custom:box',200); insert into stock_moves (id,store_id,product_id,delta,reason) values ('boxm','${sid}','boxy',12,'create');`);await owner.sync();
 owner.ev("(()=>{const p=S.products.find(p=>p.id==='boxy');saveProduct({...p,sell:3},'set',true)})()");await owner.settle();const row=(await B.sql("select unit,sell_paise from products where id='boxy'"))[0];
 ok('E2 a unit this app does not know is kept as it was',qty(owner,'Matchbox')===12&&row.unit==='custom:box'&&row.sell_paise===300,row)}
{owner.ev("(()=>{const p=S.products.find(p=>p.name==='Milk');saveProduct({...p,qty:p.qty+12,addExp:'2026-10-20'},'restock',true)})()");await owner.settle();await staff.sync();
 const b=staff.ev("JSON.stringify(S.products.find(p=>p.name==='Milk').batches)");
 ok('E3 expiry batches reach the other phone',b===J([{qty:15,exp:'2026-10-14'},{qty:12,exp:'2026-10-20'}])&&staff.ev("S.products.find(p=>p.name==='Milk').expiry")==='2026-10-14',b)}
{for(let i=0;i<10;i++)sell(owner,'Rice',0.1);await owner.settle();await staff.sync();ok('E4 ten sales of 100 g take off exactly 1 kg',qty(owner,'Rice')===49&&qty(staff,'Rice')===49,[qty(owner,'Rice'),qty(staff,'Rice')]);await same(B,staff,'E4')}
{sell(owner,'Sugar',1);await owner.settle();owner.net.offline=true;sell(owner,'Sugar',1);await owner.settle();sell(staff,'Sugar',3);staff.ev("(()=>{const p=S.products.find(p=>p.name==='Sugar');saveProduct({...p,qty:p.qty+25},'restock',true)})()");await staff.settle();
 const want=r3((await B.sql('select sum(delta)::float8 s from stock_moves where product_id=$1',[pid(staff,'Sugar')]))[0].s-1);owner.net.offline=false;await owner.sync();await staff.sync();
 ok('E5 sales and a delivery on two phones at once add up',qty(owner,'Sugar')===want&&qty(staff,'Sugar')===want,[qty(owner,'Sugar'),qty(staff,'Sugar'),want]);await same(B,owner,'E5')}

/* ---- F. Leaving ---- */
await owner.ev(`sb.from('members').delete().eq('store_id',${J(sid)}).eq('user_id',${J(staffUid)})`);sell(staff,'Rice',1);await staff.settle();await staff.sync();
ok('F1 a removed staff member is shut out',!staff.ev('store')&&/no longer a member/.test(staff.msg())&&!staff.ls.cloudcache,[staff.msg(),!!staff.ls.cloudcache]);
ok('F2 and their late sale did not get in',(await B.sql('select sum(delta)::float8 s from stock_moves where product_id=$1',[pid(owner,'Rice')]))[0].s.toFixed(3)==='49.000');
staff=await staff.reload();ok('F3 their phone no longer opens the shop',!staff.ev('store'));
{sell(owner,'Rice',1);owner.net.offline=true;await owner.settle();owner.net.offline=false;await owner.click('c-out');
 ok('F4 sign out first sends what was waiting',(await B.sql('select sum(delta)::float8 s from stock_moves where product_id=$1',[pid(owner,'Rice')]))[0].s.toFixed(3)==='48.000'&&owner.reloads===1&&!owner.ls.cloudcache,[owner.reloads,!!owner.ls.cloudcache,owner.msg()]);
 owner=await owner.reload();ok('F5 after sign out the phone shows its own data again',!owner.ev('store')&&owner.ev('S.products.length')===4&&qty(owner,'Sugar')===20&&owner.ev("balance('c1')")===542,[owner.ev('!!store'),owner.ev('S.products.length')]);
 const k0=(await B.sql('select count(*)::int n from khata_entries where store_id=$1',[sid]))[0].n,p0=(await B.sql('select count(*)::int n from products where store_id=$1',[sid]))[0].n;
 await signIn(owner,'owner@example.com');await owner.sync();
 ok('F6 signing in again opens the same shop without duplicating anything',owner.ev('store&&store.id')===sid&&(await B.sql('select count(*)::int n from khata_entries where store_id=$1',[sid]))[0].n===k0&&(await B.sql('select count(*)::int n from products where store_id=$1',[sid]))[0].n===p0&&qty(owner,'Rice')===48,[owner.msg(),qty(owner,'Rice')]);await same(B,owner,'F6')}

/* ---- G. Older database setups ---- */
{const B2=await makeBackend({migrations:['1_shop_sync.sql']});let p=await new Phone(B2,device()).open();await signIn(p,'a@example.com');p.set('n-shop','Old Setup');await p.click('c-create');
 p.ev("addKhata(S.customers.find(c=>c.id==='c1'),58,'',true)");await p.settle();await p.sync();await p.sync();
 ok('G1 with no khata tables, khata stays safe on the phone',p.ev("balance('c1')")===600&&p.ev('S.products.length')===4&&/sirf is phone|phone only/.test(p.msg()),[p.ev("balance('c1')"),p.msg()]);
 p=await p.reload();await p.sync();ok('G2 through a reload too',p.ev("balance('c1')")===600&&!!p.ev('store'));
 {const r=await p.ev('runDbCheck()'),bad=r.filter(x=>!x.ok&&!x.opt);ok('G2b the check on that phone names the missing khata setup, twice, and nothing else',bad.length===2&&bad.every(x=>/[Kk]hata/.test(x.name)&&/supabase-setup\.sql/.test(x.detail))&&/2 entries are on this phone only|3 entries/.test(bad[1].detail),r.filter(x=>!x.ok))}
 const setup=require('fs').readFileSync(__dirname+'/../supabase-setup.sql','utf8');await B2.pg.exec(setup);await B2.pg.exec(setup);await p.sync();await p.sync();   /* the file she is told to run, twice */
 {const r=await p.ev('runDbCheck()');ok('G2c after running supabase-setup.sql (even twice) the check is clean',r.filter(x=>!x.ok&&!/Claude function/.test(x.name)).length===0,r.filter(x=>!x.ok))}
 ok('G3 and uploads by itself once the tables exist',(await B2.sql('select sum(amount_paise)::int s from khata_entries where store_id=$1',[p.ev('store.id')]))[0].s===60000&&p.ev("balance('c1')")===600,(await B2.sql('select count(*)::int n from khata_entries where store_id=$1',[p.ev('store.id')]))[0]);
 p.ev("(()=>{const m=S.products.find(p=>p.name==='Milk');saveProduct({...m,qty:m.qty+6,addExp:'2026-10-25'},'restock',true)})()");await p.settle();
 const q=await new Phone(B2,{}).open();q.set('s-code',p.ev('store.code')).set('s-name','Asha');await q.click('c-join');
 ok('G4 stock, expiry dates and batches sync once it is installed',qty(q,'Milk')===24&&q.ev("S.products.find(p=>p.name==='Milk').expiry")==='2026-10-14'&&q.ev("S.products.find(p=>p.name==='Milk').batches.length")===2&&p.ev('OB.length')===0&&!/dropped/.test(p.msg()),[qty(q,'Milk'),q.ev("JSON.stringify(S.products.find(p=>p.name==='Milk').batches)"),p.msg()])}
{const B3=await makeBackend({migrations:['1_shop_sync.sql','2_khata.sql']});const p=await new Phone(B3,device()).open();await signIn(p,'b@example.com');p.set('n-shop','No Batches');await p.click('c-create');
 p.ev("(()=>{const m=S.products.find(p=>p.name==='Milk');saveProduct({...m,qty:m.qty+6,addExp:'2026-10-25'},'restock',true)})()");await p.settle();
 const q=await new Phone(B3,{}).open();q.set('s-code',p.ev('store.code')).set('s-name','Asha');await q.click('c-join');
 ok('G5 with no batches column, stock and the earliest expiry date still sync and nothing is dropped',qty(q,'Milk')===24&&q.ev("S.products.find(p=>p.name==='Milk').expiry")==='2026-10-14'&&p.ev('OB.length')===0&&p.ev('S.hasBatchCol')===false&&!/dropped/.test(p.msg())&&(await B3.sql('select count(*)::int n from products'))[0].n===4,[qty(q,'Milk'),p.msg()])}

/* ---- H. Device storage (not signed in) ---- */
{let p=await new Phone(B,device()).open();sell(p,'Sugar',2);p.ev("addKhata(S.customers[0],30,'',true)");p=await p.reload();
 ok('H1 without sign-in, changes survive a reload',qty(p,'Sugar')===18&&p.ev("balance('c1')")===572&&p.ev('S.sales.length')===3);
 p.net.full=true;sell(p,'Sugar',1);ok('H2 a full or blocked browser storage is reported, not hidden',/not saved|not being saved/i.test(p.els.status.textContent),p.els.status.textContent)}

/* ---- I. The copy inside Claude, which has its own document database ---- */
{const data={'meta/shop':{name:'Artifact Shop',upi:'a@ybl'}};for(let i=0;i<150;i++)data['products/p'+String(i).padStart(3,'0')]={name:'Item '+i,names:[],unit:'kg',qty:10,cost:5,sell:8,low:1,expiry:''};
 for(let i=0;i<300;i++)data['sales/s'+i]={items:[{name:'Item 1',qty:1,unit:'kg',rate:8,amount:8}],total:8,at:NOW-i*36e5};
 data['customers/c1']={name:'Bhavika',phone:''};data['khata/k1']={cid:'c1',amount:500,note:'',at:NOW-1000};
 const ctl={},adb=fakeArtifactDb(data,ctl),claude={use:async n=>n==='db'?adb:null};let p=await new Phone(B,{},{},claude).open();await wait(30);
 ok('I1 every product and the full sales history load, not just the first 100',p.ev('S.products.length')===150&&p.ev('S.sales.length')===300&&p.ev('S.shop.upi')==='a@ybl'&&p.ev("balance('c1')")===500,[p.ev('S.products.length'),p.ev('S.sales.length')]);
 sell(p,'Item 7',2.5);p.ev("addKhata(S.customers[0],120,'',true)");await wait(30);
 ok('I2 a sale writes the new stock, the bill and the stock log',data['products/p007'].qty===7.5&&Object.keys(data).filter(k=>k.startsWith('sales/')).length===301&&Object.values(data).some(d=>d.pid==='p007'&&d.delta===-2.5&&d.reason==='sale'),data['products/p007']);
 p=await new Phone(B,{},{},claude).open();await wait(30);ok('I3 and is there when the page is opened again',qty(p,'Item 7')===7.5&&p.ev('S.sales.length')===301&&p.ev("balance('c1')")===620&&p.ev('S.sales[0].total')===20,[qty(p,'Item 7'),p.ev('S.sales.length')]);
 const r=await p.ev('runDbCheck()');ok('I4 the database check passes there too and removes its probe',r.length>=10&&r.every(x=>x.ok)&&!('diag/probe' in data),r.filter(x=>!x.ok));
 ctl.readonly=true;const said=p.log.length;sell(p,'Item 8',1);sell(p,'Item 9',1);await wait(30);
 ok('I5 a refused save is reported once, in plain words',/Not saved/.test(p.els.status.textContent)&&p.log.slice(said).filter(x=>/Not saved/.test(x)).length===1,[p.els.status.textContent,p.log.slice(said)])}

console.log(fail?`${fail} of ${n} failed`:`database: all ${n} checks passed (${B.requests} requests)`);process.exit(fail?1:0)})().catch(e=>{console.log('THREW',e&&e.stack||e);process.exit(1)});
