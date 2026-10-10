// Checks the cloud sync logic against a fake Supabase: khata must never be wiped by a sync.
// Usage: node tests/cloud.test.js   (no dependencies)
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>(?!window\.SEED)([\s\S]*?)<\/script>/)[1];
const els={};const mk=()=>({hidden:false,checked:false,value:'',textContent:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},append(){},focus(){},setAttribute(){},abort(){},blur(){},contains(){return false},querySelectorAll(){return[]},closest(){return mk()},set innerHTML(v){}});
global.document={getElementById:id=>els[id]||(els[id]=mk()),createElement:()=>mk(),querySelectorAll:()=>[],head:mk(),addEventListener(){},documentElement:{}};
const store0={};global.localStorage={getItem:k=>k in store0?store0[k]:null,setItem:(k,v)=>{store0[k]=String(v)},removeItem:k=>{delete store0[k]}};
global.window={addEventListener(){}};global.location={protocol:'file:'};global.navigator={onLine:true};
// ---- fake Supabase ----
function fake(opts){const T={products:[],product_costs:[],stock_moves:[],sales:[],customers:[],khata_entries:[],stores:[{id:'S1',name:'Test Shop',code:'123456',upi_id:''}],members:[{store_id:'S1',user_id:'U1',role:'owner',name:'Owner',can_see_cost:true,can_delete:true}]};
  const missing=t=>opts.noKhata&&(t==='customers'||t==='khata_entries');
  const q=(t)=>{let rows=()=>T[t],res=null;const key=t==='product_costs'?'product_id':'id';
    const run=()=>{if(opts.offline)return{data:null,error:{message:'TypeError: Failed to fetch'}};if(missing(t))return{data:null,error:{code:'PGRST205',message:"Could not find the table 'public."+t+"' in the schema cache"}};return res||{data:rows().slice(),error:null}};
    const api={select(){return api},eq(c,v){const prev=rows;rows=()=>prev().filter(r=>r[c]===v);return api},order(){return api},gte(){return api},range(){return api},limit(){return api},
      single(){const r=run();return Promise.resolve(r.error?r:{data:r.data[0]||null,error:null})},maybeSingle(){return api.single()},
      upsert(row,o){if(!opts.offline&&!missing(t))[].concat(row).forEach(r=>{const i=T[t].findIndex(x=>x[key]===r[key]);if(i<0)T[t].push({...r});else if(!(o&&o.ignoreDuplicates))T[t][i]={...T[t][i],...r}});res={data:null,error:null};return api},
      update(patch){const prev=rows;if(!opts.offline)setTimeout(()=>0);api._patch=patch;const fin=api.eq;api.eq=(c,v)=>{T[t].filter(r=>r[c]===v).forEach(r=>Object.assign(r,patch));res={data:null,error:null};return api};return api},
      then(ok,no){return Promise.resolve(run()).then(ok,no)}};return api};
  return{T,from:q,auth:{getSession:async()=>({data:{session:{user:{id:'U1'}}}})},functions:{invoke:async()=>({data:null,error:{message:'none'}})}}}
const log=[];const patched=src.replace("function say(text,chips,spoken){","function say(text,chips,spoken){log.push(text);return;").replace("function me(text){","function me(text){return;");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
eval(patched+`
(async()=>{let fail=0;const ok=(n,c,d)=>{if(!c){fail++;console.log('FAIL',n,d===undefined?'':JSON.stringify(d))}};
const reset=async(opts,device)=>{for(const k in store0)delete store0[k];if(device)store0.shop=JSON.stringify(device);OB=[];S.customers=device?device.customers.map(c=>({...c})):[];S.khata=device?device.khata.map(e=>({...e})):[];S.products=[];S.sales=[];S.moves=[];S.seeded=0;S.khataCloud=undefined;S.shop=device&&device.shop||{name:'',upi:''};
  store=null;member=null;session=null;sb=fake(opts);await findStore();await queue;await wait(20);await queue;return sb};
const device={products:[],sales:[],moves:[],shop:{name:'My Shop',upi:'me@okaxis'},customers:[{id:'c1',name:'Bhavika',phone:'917249197118'},{id:'c2',name:'Ramesh Patil',phone:''}],khata:[{id:'k1',cid:'c1',amount:500,note:'',at:Date.now()-5000},{id:'k2',cid:'c1',amount:42,note:'bill',at:Date.now()-1000},{id:'k3',cid:'c2',amount:450,note:'',at:Date.now()-9000}]};

// 1. Signing in on a phone that already has khata, cloud khata tables present
let f=await reset({},device);
ok('1a khata from before sign-in is still on screen',S.khata.filter(e=>e.cid==='c1').length===2&&balance('c1')===542,S.khata);
ok('1b it was uploaded to the cloud',f.T.customers.some(c=>c.id==='c1')&&f.T.khata_entries.length===2,f.T.khata_entries);
ok('1c example customer was not uploaded',!f.T.customers.some(c=>c.id==='c2'),f.T.customers);
ok('1d UPI ID was carried over',f.T.stores[0].upi_id==='me@okaxis',f.T.stores[0]);
await sync();await wait(10);await queue;
ok('1e another sync keeps it',balance('c1')===542&&S.khata.filter(e=>e.cid==='c1').length===2,S.khata);
ok('1f nothing left waiting',OB.length===0&&!S.khata.some(e=>e.u),OB);

// 2. Cloud has no khata tables (migration not run)
f=await reset({noKhata:true},device);
ok('2a khata is kept when the cloud cannot store it',balance('c1')===542,S.khata);
const c=addCustomer('Asha');addKhata(c,100,'',true);await queue;await wait(10);await queue;await sync();await wait(10);await queue;await sync();await queue;
ok('2b new khata entries survive repeated syncs',balance(c.id)===100&&balance('c1')===542,[S.khata.length,S.khataCloud]);
ok('2c no khata operations pile up',OB.filter(o=>o.t==='cust'||o.t==='khata').length===0,OB);
ok('2d the phone copy has it for the next reload',JSON.parse(store0.cloudcache).khata.some(e=>e.cid===c.id));
// reload the page: start from the pre-sign-in device copy, as the real page does
S.customers=device.customers.map(x=>({...x}));S.khata=device.khata.map(x=>({...x}));S.seeded=0;store=null;await findStore();await queue;await wait(10);await queue;
ok('2e after a reload the phone-only khata is still there',balance(c.id)===100&&balance('c1')===542,S.khata.map(e=>e.cid+':'+e.amount));
// the tables appear later
f.T.customers.length=0;f.T.khata_entries.length=0;sb=Object.assign(f,fake({}),{T:f.T});const g=fake({});g.T.stores=f.T.stores;g.T.members=f.T.members;sb=g;
await sync();await wait(20);await queue;await wait(20);await queue;
ok('2f once the tables exist, the kept khata uploads',g.T.khata_entries.length>=3&&g.T.customers.some(x=>x.name==='Asha'),[g.T.customers.length,g.T.khata_entries.length]);
ok('2g and is still on screen',balance(c.id)===100&&balance('c1')===542);

// 3. Another phone added khata: it shows up, and local unsent entries are not lost
f=await reset({});f.T.customers.push({id:'cx',store_id:'S1',name:'Sita',phone:'',deleted:false});f.T.khata_entries.push({id:'kx',store_id:'S1',customer_id:'cx',amount_paise:30000,note:'',created_at:new Date().toISOString()});
await sync();await queue;ok('3a khata from another phone appears',balance('cx')===300,S.khata);
const d2=addCustomer('Deepak');addKhata(d2,75,'',true);await queue;await wait(10);await queue;await sync();await queue;
ok('3b both are present after syncing',balance('cx')===300&&balance(d2.id)===75&&f.T.khata_entries.length===2,f.T.khata_entries);

// 4. Offline while signed in
f=await reset({},device);sb=Object.assign(fake({offline:true}),{});const o2=addCustomer('Offline Om');addKhata(o2,60,'',true);await queue;await wait(10);
try{await sync()}catch(e){}await queue;
ok('4a an entry made offline is kept and waiting',balance(o2.id)===60&&OB.some(x=>x.t==='khata'),OB.length);

console.log(fail?fail+' failed':'cloud sync: all checks passed');process.exit(fail?1:0)})().catch(e=>{console.log('THREW',e&&e.stack||e);process.exit(1)})`);
