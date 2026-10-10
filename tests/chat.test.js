// Runs the chat logic from index.html against awkward sentences and data.
// Usage: node tests/chat.test.js   (no dependencies)
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>(?!window\.SEED)([\s\S]*?)<\/script>/)[1];
const els={};const mk=()=>({hidden:false,checked:false,value:'',textContent:'',dataset:{},style:{},classList:{add(){},remove(){}},append(){},focus(){},setAttribute(){},abort(){},blur(){},contains(){return false},querySelectorAll(){return[]},closest(){return mk()},set innerHTML(v){}});
global.document={getElementById:id=>els[id]||(els[id]=mk()),createElement:()=>mk(),querySelectorAll:()=>[],head:mk()};
global.window={addEventListener(){}};global.localStorage={getItem(){return null},setItem(){}};global.location={protocol:'file:'};
const log=[];
const patched=src.replace("function say(text,chips,spoken){","function say(text,chips,spoken){log.push(text);return;").replace("function me(text){","function me(text){return;");
const shop=()=>[
 {id:'milk',name:'Milk',names:['dudh','दूध','doodh'],unit:'L',qty:20,cost:48,sell:56,low:5},
 {id:'sugar',name:'Sugar',names:['cheeni','चीनी','sakhar'],unit:'kg',qty:12,cost:39,sell:44,low:5},
 {id:'pg',name:'Parle-G',names:['parle g','biscuit'],unit:'packet',qty:40,cost:8.5,sell:10,low:5}];
const cases=[
 ['price, Hinglish',[],['dudh kitne ka hai'],/₹56 per litre/],
 ['price, Devanagari',[],['दूध कितने का है'],/₹56 per litre/],
 ['part unit',[],['aadha kilo cheeni kitne ka'],/500 gram Sugar ₹22/],
 ['unit mismatch asks',[],['2 kilo milk kitne ka'],/litre/],
 ['"add" is not "aadha"',[],['milk add karo','10 litre','haan','haan'],/30 litre/,{milk:30}],
 ['one-line restock',[],['add 10 litre milk','yes','yes'],/30 litre/,{milk:30}],
 ['new product by steps',[],['besan add karo','5 kg','60','80','nahi','haan'],/jud gaya/],
 ['set stock',[],['sugar ka stock 25 kilo hai','haan'],/theek/,{sugar:25}],
 ['sell lowers stock',[],['2 litre dudh becha','haan'],/Sale save/,{milk:18}],
 ['oversell warns',[],['50 litre dudh becha'],/sirf 20 litre/],
 ['oversell can be refused',[],['50 litre dudh becha','nahi'],/kuch save nahi/,{milk:20}],
 ['huge price change warns',[],['dudh ka rate 560 kar do'],/bahut bada/],
 ['undo a sale',[],['2 litre dudh becha','haan','galat ho gaya'],/wapas/,{milk:20}],
 ['undo a restock',[],['add 10 litre milk','yes','yes','undo'],/Undid|wapas/,{milk:20}],
 ['undo with nothing',[],['undo'],/kuch nahi|nothing/],
 ['unknown sentence',[],['aaj mausam kaisa hai'],/Samajh nahi/],
 ['unknown product',[],['paneer kitne ka hai'],/Samajh nahi/],
 ['empty shop',['empty'],['dudh kitne ka hai'],/Samajh nahi/],
 ['ask tab quotes, no bill',[],['1 litre milk aur 2 kilo sugar ka kitna hua?'],/total ₹144/,{bill:0}],
 ['sell tab builds bill',['sales'],['2 kilo cheeni, 1 litre dudh','aur 1 kilo sugar'],/Total ₹188/,{bill:2}],
 ['sell tab confirm',['sales'],['2 kilo cheeni','haan'],/Bill pakka/,{sugar:10}],
 ['sell tab oversell stops',['sales'],['30 kilo cheeni','bill pakka karo'],/sirf 12 kg/,{sugar:12}],
 ['duplicate names: pick',['dup'],['milk kitna bacha hai','#pick:m2'],/3 litre/],
 ['duplicate names: merge',['dup'],['milk kitna bacha hai','#merge'],/23 litre/],
 ['voice add: new product, name step',['voiceadd'],['besan','5 kg','60','80','nahi','haan'],/jud gaya/,{moves:1}],
 ['voice add: existing product named',['voiceadd'],['dudh 10 litre','haan','haan'],/30 litre/,{milk:30,moves:1}],
 ['stock log records restock and sale',[],['add 10 litre milk','yes','yes','2 litre dudh becha','haan'],/Sale save/,{milk:28,moves:2}],
 ['khata: add credit by voice',[],['Ramesh ke khate mein 200 likho','haan'],/Ramesh ka ab ₹200 baki/,{khata:1}],
 ['khata: "likh do" is not the number 2',[],['Ramesh ke khate mein 200 likh do','haan'],/₹200 baki/,{khata:1}],
 ['khata: payment lowers balance',[],['Ramesh ke khate mein 200 likho','haan','Ramesh ne 50 jama kiye','haan'],/₹150 baki/,{khata:2}],
 ['khata: balance question',[],['Ramesh ke khate mein 200 likho','haan','Ramesh ka kitna baki hai'],/Ramesh ka ₹200 baki hai/],
 ['khata: unknown customer',[],['Suresh ka kitna baki hai'],/koi khata nahi/],
 ['khata: who owes most',[],['Ramesh ke khate mein 200 likho','haan','Sita ke khate mein 500 likho','haan','sabse zyada udhaar kiska hai'],/Sita ₹500[\s\S]*Ramesh ₹200[\s\S]*₹700/],
 ['khata: put the bill on credit',['sales'],['2 kilo cheeni','isko Ramesh ke khate mein daalo','haan'],/₹88 baki/,{sugar:10,khata:1,bill:0}],
 ['khata: undo an entry',[],['Ramesh ke khate mein 200 likho','haan','galat ho gaya','Ramesh ka kitna baki hai'],/kuch baki nahi/],
 ['hisaab: no sales',[],['aaj ka hisaab'],/koi bikri nahi/],
 ['hisaab: totals and top item',[],['2 litre dudh becha','haan','1 kilo cheeni becha','haan','aaj kitna bika'],/Aaj ₹156 bika, 2 bill.*Milk ₹112/],
 ['hisaab: undone sale nets out',[],['2 litre dudh becha','haan','undo','aaj ka hisaab'],/₹0 bika, 0 bill/],
 ['reorder: nothing low',[],['kya mangwana hai'],/zaroorat nahi/],
 ['reorder: lists low items',[],['sugar ka stock 3 kilo hai','haan','kya mangwana hai'],/Sugar: 3 kg bacha/],
 ['advice: no sales yet',[],['is hafte profit kaise badhayein'],/kaafi bikri ka data nahi/],
 ['advice: uses own numbers',[],['2 litre dudh becha','haan','Ramesh ke khate mein 200 likho','haan','bikri kaise badhayein'],/Milk \(₹112[\s\S]*Udhaar ₹200/],
 ['advice: does not hijack a price question',[],['dudh kitne ka hai'],/₹56 per litre/],
 ['batches: restock with a new date adds a batch',['exp'],['milk add karo','10 litre','haan','14 Oct','haan'],/30 litre/,{milk:30,batches:3}],
 ['batches: sale uses the earliest dates first',['exp'],['milk add karo','10 litre','haan','14 Oct','haan','12 litre dudh becha','haan'],/Sale save/,{milk:18,batches:2}],
 ['batches: untracked product is not asked for a date',[],['milk add karo','10 litre','haan','haan'],/30 litre/,{milk:30,batches:1}],
 ['batches: expiry list shows the batch quantity',['exp'],['kya expire hone wala hai'],/Milk: 5 litre/],
 ['marathi: price reply language-neutral',['mr'],['दूध कितीला आहे'],/₹56 per litre/],
 ['marathi: sale confirm and save',['mr'],['2 लिटर दूध विकले','हो'],/विकले[\s\S]*विक्री सेव्ह झाली/,{milk:18}],
 ['marathi: stock question',['mr'],['साखर किती शिल्लक आहे'],/Sugar: 12 kg शिल्लक आहे/],
 ['marathi: not understood',['mr'],['आज हवामान कसे आहे'],/समजले नाही/],
 ['samples: load adds products, sales and khata',['samples'],['aaj ka hisaab'],/Aaj ₹|koi bikri/,{khata:8}],
 ['names: built-in suggestions after a new product',[],['jeera add karo','2 kg','300','360','nahi','haan'],/kis naam se bolte/],
 ['names: add all suggested names',[],['jeera add karo','2 kg','300','360','nahi','haan','#nm:all','जीरा kitne ka hai'],/₹360 per kg/],
 ['names: nothing offered for an unknown item',[],['zzqx add karo','2 kg','300','360','nahi','haan'],/zzqx added\.|zzqx jud gaya\.$/],
 ['cancel mid-flow',[],['milk add karo','cancel'],/cancel/,{milk:20}],
];
eval(patched+`
(async()=>{let fail=0;
for(const [name,flags,says,want,end] of cases){
  S.products=flags.includes('empty')?[]:shop();if(flags.includes('dup'))S.products.push({id:'m2',name:'milk',names:[],unit:'L',qty:3,cost:null,sell:56,low:0});
  S.sales=[];S.moves=[];S.customers=[];S.khata=[];S.lastSale=null;S.bill=[];S.pending=null;S.undo=null;S.quote=null;S.lang=flags.includes('mr')?'mr':'hi';if(flags.includes('exp')){const d=new Date(Date.now()+2*864e5).toISOString().slice(0,10);S.products[0].batches=[{qty:5,exp:d},{qty:15,exp:''}];S.products[0].expiry=d}mode=flags.includes('sales')?'sales':'talk';log.length=0;
  if(flags.includes('voiceadd')){S.pending={type:'add',p:null,name:null,qty:null,unit:null,cost:null,sell:null,exp:undefined};advanceAdd()}
  if(flags.includes('samples'))loadSamples();
  for(const m of says){await handle(m);await new Promise(r=>setTimeout(r,5))}
  const all=log.join(' | '),q=id=>(S.products.find(p=>p.id===id)||{}).qty;let ok=want.test(all);
  if(end)for(const k in end)ok=ok&&(k==='bill'?S.bill.length===end[k]:k==='moves'?S.moves.length===end[k]:k==='khata'?S.khata.length===end[k]:k==='batches'?(S.products.find(p=>p.id==='milk').batches||[]).length===end[k]:q(k)===end[k]);
  if(!ok){fail++;console.log('FAIL',name,'\\n   got:',all,end?JSON.stringify({milk:q('milk'),sugar:q('sugar'),bill:S.bill.length,moves:S.moves.length,khata:S.khata.length}):'')}
}
console.log(fail?fail+' failed':'all '+cases.length+' passed');process.exit(fail?1:0)})()`);
