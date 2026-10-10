// The real page in a real browser, using the real supabase-js client, with its network calls to the
// Supabase project answered by a local Postgres that has the shop's migrations (see pgfake.js).
// Two browser profiles act as the owner's phone and a staff phone.
// Usage: serve this folder on port 8765, then: node tests/browser-db.test.js   (needs playwright and @electric-sql/pglite)
const {chromium}=require('playwright'),{makeBackend}=require('./pgfake');
const SB='https://pmtejfsuceusgzrgvmvp.supabase.co',URL0=process.env.URL||'http://localhost:8765/index.html',SHOTS=process.env.SHOTS||'';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
(async()=>{const B=await makeBackend(),R=[],ok=(n,c,d)=>R.push((c?'ok   ':'FAIL ')+n+(c?'':' → '+JSON.stringify(d)));const seen=new Set();
  /* ---- a small stand-in for Supabase's HTTP front: auth endpoints and the REST interface ---- */
  const sessionFor=(id,email)=>{const exp=Math.floor(Date.now()/1000)+3600,user={id,aud:'authenticated',role:'authenticated',email:email||'',is_anonymous:!email,app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
    return{access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,role:'authenticated',exp})}.sig`,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:'r-'+id,user}};
  const uidOf=h=>{const t=(h.authorization||'').replace(/^Bearer /,'').split('.');if(t.length!==3)return null;try{return JSON.parse(Buffer.from(t[1],'base64url').toString()).sub}catch(e){return null}};
  const handler=async route=>{const q=route.request(),u=new URL(q.url()),h=q.headers(),m=q.method();seen.add(m+' '+u.pathname.replace(/[0-9a-f-]{36}/g,':id'));
    const send=(status,body)=>route.fulfill({status,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'*'},body:body===undefined?'':JSON.stringify(body)});
    if(m==='OPTIONS')return send(204);
    let body=null;try{body=q.postData()?JSON.parse(q.postData()):null}catch(e){}
    const p=u.pathname;
    if(p==='/auth/v1/settings')return send(200,{external:{email:true,anonymous_users:B.anonymous,phone:false},disable_signup:false});
    if(p==='/auth/v1/signup'){if(body&&body.email)return send(400,{msg:'not used'});if(!B.anonymous)return send(422,{code:422,error_code:'anonymous_provider_disabled',msg:'Anonymous sign-ins are disabled'});const id=(await B.sql('insert into auth.users default values returning id'))[0].id;return send(200,sessionFor(id))}
    if(p==='/auth/v1/otp')return send(200,{});
    if(p==='/auth/v1/verify'){if(!body||body.token!=='123456')return send(403,{code:403,error_code:'otp_expired',msg:'Token has expired or is invalid'});const id=(await B.sql('insert into auth.users (email) values ($1) on conflict (email) do update set email=excluded.email returning id',[body.email]))[0].id;return send(200,sessionFor(id,body.email))}
    if(p==='/auth/v1/token'){const id=String(body&&body.refresh_token||'').slice(2);return send(200,sessionFor(id))}
    if(p==='/auth/v1/logout')return send(204);
    if(p==='/auth/v1/user'){const id=uidOf(h);return id?send(200,sessionFor(id).user):send(401,{msg:'no user'})}
    if(p.startsWith('/functions/v1/'))return send(404,{code:'NOT_FOUND',message:'Requested function was not found'});
    if(!p.startsWith('/rest/v1/'))return send(404,{message:'not handled by the test server: '+p});
    const cl=B.client({'sb-auth':uidOf(h)||undefined},{}),out=r=>r.error?send(r.status||400,{code:r.error.code||'',message:r.error.message,details:null,hint:null}):null;
    if(p.startsWith('/rest/v1/rpc/')){const r=await cl.rpc(p.slice(13),body||{});return out(r)||send(200,r.data)}
    const table=p.slice(9),prefer=h.prefer||'';let qb=cl.from(table);
    if(m==='POST')qb=/resolution=/.test(prefer)?qb.upsert(body,{ignoreDuplicates:/ignore-duplicates/.test(prefer)}):qb.insert(body);
    else if(m==='PATCH')qb=qb.update(body);else if(m==='DELETE')qb=qb.delete();else qb=qb.select((u.searchParams.get('select')||'*').replace(/["\s]/g,''));
    let lim=null,off=0;for(const [k,v] of u.searchParams){if(k==='select'||k==='on_conflict'||k==='columns')continue;
      if(k==='order'){const [c,d]=v.split('.');qb=qb.order(c,{ascending:d!=='desc'});continue}if(k==='limit'){lim=+v;continue}if(k==='offset'){off=+v;continue}
      const i=v.indexOf('.'),op=v.slice(0,i),val=v.slice(i+1);if(op==='eq')qb=qb.eq(k,val);else if(op==='gte')qb=qb.gte(k,val);else return send(400,{code:'TEST',message:'filter not supported by the test server: '+k+'='+v})}
    if(m==='GET'){if(lim!=null)qb=qb.range(off,off+lim-1);const one=/vnd\.pgrst\.object/.test(h.accept||'');if(one)qb=qb.single();const r=await qb;if(r.error&&r.error.code==='PGRST116')return send(406,{code:'PGRST116',message:r.error.message,details:'The result contains 0 rows',hint:null});return out(r)||send(200,r.data)}
    const r=await qb;return out(r)||send(m==='POST'?201:204)};

  const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'}).catch(()=>chromium.launch());const errs=[];
  const phone=async name=>{const ctx=await br.newContext({viewport:{width:390,height:800},serviceWorkers:'allow'});const net={offline:false};await ctx.route(SB+'/**',r=>net.offline?r.abort('internetdisconnected'):handler(r));   /* answered locally, so offline has to be applied here too */
    await ctx.addInitScript(()=>{try{if(!localStorage.getItem('guided')){localStorage.setItem('guided','1');localStorage.setItem('lang','en')}}catch(e){}});
    const pg=await ctx.newPage();pg.on('pageerror',e=>errs.push(name+': '+e.message));await pg.goto(URL0);await pg.waitForFunction(()=>window.__booted,null,{timeout:15000});await pg.waitForTimeout(300);return{ctx,pg,name,net,offline:async v=>{net.offline=v;await ctx.setOffline(v)}}};
  const idle=async ph=>{await ph.pg.waitForTimeout(150);await ph.pg.evaluate(async()=>{for(let i=0;i<6;i++){try{await queue}catch(e){}await new Promise(r=>setTimeout(r,60))}})};
  const ev=(ph,f,a)=>ph.pg.evaluate(f,a);
  const sellJS=([name,q])=>{const p=S.products.find(p=>p.name===name);recordSale([{id:p.id,name:p.name,qty:q,unit:p.unit,rate:p.sell,amount:Math.round(q*p.sell*100)/100}],true)};
  const qty=(ph,name)=>ev(ph,n=>(S.products.find(p=>p.name===n)||{qty:null}).qty,name);
  const status=ph=>ev(ph,()=>document.getElementById('status').textContent);
  const dbStock=async(sid,name)=>Math.round((await B.sql("select coalesce(sum(m.delta),0)::float8 s from stock_moves m join products p on p.id=m.product_id where p.store_id=$1 and p.names->>0=$2",[sid,name]))[0].s*1000)/1000;

  /* ---- owner: sell before signing in, then sign in and create the shop ---- */
  const owner=await phone('owner');
  ok('the page starts on device storage with the starter products',await ev(owner,()=>S.products.length)===7&&!(await ev(owner,()=>store)),await ev(owner,()=>S.products.length));
  await ev(owner,sellJS,['Sugar',2]);await ev(owner,()=>{const c=addCustomer('Bhavika','9000000001');addKhata(c,300,'',true)});const sugar0=await qty(owner,'Sugar');
  await owner.pg.click('[data-tab=shop]');await owner.pg.fill('#o-email','owner@example.com');await owner.pg.click('#c-send');await owner.pg.waitForSelector('#o-code');
  await owner.pg.fill('#o-code','000000');await owner.pg.click('#c-verify');await owner.pg.waitForTimeout(400);
  ok('a wrong code is refused with a message',/invalid|expired/i.test(await ev(owner,()=>document.getElementById('shopMsg').textContent))&&!(await ev(owner,()=>session)),await ev(owner,()=>document.getElementById('shopMsg').textContent));
  await owner.pg.fill('#o-code','123456');await owner.pg.click('#c-verify');await owner.pg.waitForSelector('#n-shop');
  await owner.pg.fill('#n-shop','Chintamani Kirana');await owner.pg.fill('#n-owner','Bhavika');await owner.pg.click('#c-create');await owner.pg.waitForSelector('.code',{timeout:15000});await idle(owner);
  const sid=await ev(owner,()=>store.id),code=await ev(owner,()=>store.code);
  ok('owner signs in with the emailed code and creates the shop',/^\d{6}$/.test(code)&&/Synced: Chintamani/.test(await status(owner))&&await ev(owner,()=>document.getElementById('shopMsg').textContent)==='',[await status(owner),await ev(owner,()=>document.getElementById('shopMsg').textContent)]);
  ok('products, stock, cost, the earlier sale and khata are all in the database',(await B.sql('select count(*)::int n from products where store_id=$1',[sid]))[0].n===7&&await dbStock(sid,'Sugar')===sugar0&&(await B.sql('select count(*)::int n from product_costs where store_id=$1',[sid]))[0].n===7
    &&(await B.sql('select count(*)::int n from sales where store_id=$1',[sid]))[0].n===1&&(await B.sql('select sum(amount_paise)::int s from khata_entries where store_id=$1',[sid]))[0].s===30000,
    [await dbStock(sid,'Sugar'),sugar0,await B.sql('select (select count(*) from sales)::int s,(select count(*) from khata_entries)::int k,(select count(*) from product_costs)::int c')]);
  ok('the screen is unchanged after the first sync',await qty(owner,'Sugar')===sugar0&&await ev(owner,()=>S.sales.length)===1&&await ev(owner,()=>balance(S.customers[0].id))===300);

  /* ---- the built-in database check, run from the Shop tab ---- */
  await owner.pg.click('#diagBtn');await owner.pg.waitForFunction(()=>!document.getElementById('diagBtn').disabled&&window.__diag,null,{timeout:30000});
  const diag=await ev(owner,()=>window.__diag),core=diag.filter(x=>!/Claude function/.test(x.name));
  ok('the Database check button passes every database step in the browser',core.length>=25&&core.every(x=>x.ok),diag.filter(x=>!x.ok));
  ok('and says the Claude functions are not deployed',diag.filter(x=>/Claude function/.test(x.name)).length===3&&diag.filter(x=>/Claude function/.test(x.name)).every(x=>!x.ok&&/not deployed/.test(x.detail)),diag.filter(x=>/Claude/.test(x.name)));
  ok('its results are drawn and the page still fits',await ev(owner,()=>document.querySelectorAll('#diagOut .drow').length)===diag.length&&await ev(owner,()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1&&document.getElementById('pane-shop').scrollHeight>document.getElementById('pane-shop').clientHeight));
  if(SHOTS){await owner.pg.evaluate(()=>document.getElementById('diagCard').scrollIntoView());await owner.pg.screenshot({path:SHOTS+'/diag.png'})}
  ok('the owner is still signed in to the real shop afterwards',await ev(owner,()=>store.id)===sid&&!!(await ev(owner,()=>session)));

  /* ---- staff phone ---- */
  const staff=await phone('staff');await staff.pg.click('[data-tab=shop]');await staff.pg.fill('#s-code','999999');await staff.pg.fill('#s-name','Ravi');await staff.pg.click('#c-join');await staff.pg.waitForTimeout(500);
  ok('a wrong shop code is refused with a message',/no shop with that code/.test(await ev(staff,()=>document.getElementById('shopMsg').textContent))&&!(await ev(staff,()=>store)),await ev(staff,()=>document.getElementById('shopMsg').textContent));
  await staff.pg.fill('#s-code',code);await staff.pg.fill('#s-name','Ravi');await staff.pg.click('#c-join');await staff.pg.waitForFunction(()=>store&&S.products.length===7,null,{timeout:15000});await idle(staff);
  ok('staff join and see the same stock and khata, without cost prices',await qty(staff,'Sugar')===sugar0&&await ev(staff,()=>S.products.every(p=>p.cost==null))&&await ev(staff,()=>balance(S.customers[0].id))===300&&await ev(staff,()=>member.role)==='staff');
  await ev(staff,sellJS,['Sugar',1.5]);await idle(staff);await owner.pg.click('#c-sync');await idle(owner);
  ok('a staff sale reaches the database and the owner phone',await dbStock(sid,'Sugar')===sugar0-1.5&&await qty(owner,'Sugar')===sugar0-1.5&&await ev(owner,()=>S.sales.length)===2,[await dbStock(sid,'Sugar'),await qty(owner,'Sugar')]);
  await owner.pg.waitForSelector('#teamBox label.tog');await owner.pg.locator('#teamBox label.tog').first().click();await owner.pg.waitForTimeout(300);await ev(staff,()=>enqueue(sync));await idle(staff);
  ok('the owner ticks "sees cost" and staff then see cost prices',await ev(staff,()=>S.products.every(p=>p.cost!=null))&&(await B.sql("select can_see_cost from members where role='staff' and store_id=$1",[sid]))[0].can_see_cost===true);
  await ev(staff,()=>{addKhata(S.customers[0],-100,'paid',true)});await idle(staff);await owner.pg.click('#c-sync');await idle(owner);
  ok('a khata payment taken by staff reaches the owner',await ev(owner,()=>balance(S.customers[0].id))===200);

  /* ---- no internet: keep selling, close and reopen the app, then reconnect ---- */
  await owner.offline(true);await ev(owner,sellJS,['Sugar',1]);await ev(owner,sellJS,['Milk',2]);await idle(owner);const milk=await qty(owner,'Milk');
  ok('offline sales show at once and the status says they are waiting',/Offline: \d+ waiting/.test(await status(owner))&&await qty(owner,'Sugar')===sugar0-2.5&&await dbStock(sid,'Sugar')===sugar0-1.5,await status(owner));
  let reopened=true;try{await owner.pg.reload({timeout:15000});await owner.pg.waitForFunction(()=>typeof S!=='undefined'&&window.__booted,null,{timeout:15000})}catch(e){reopened=false}
  ok('the app opens with no internet',reopened&&await ev(owner,()=>S.products.length)===7,reopened);
  ok('and still shows the shop with the offline sales and the queue',reopened&&await ev(owner,()=>store&&store.id)===sid&&await qty(owner,'Sugar')===sugar0-2.5&&await qty(owner,'Milk')===milk&&await ev(owner,()=>OB.length)>=6,[await ev(owner,()=>!!store),await qty(owner,'Sugar')]);
  await ev(staff,sellJS,['Sugar',0.5]);await idle(staff);
  await owner.offline(false);await owner.pg.waitForFunction(()=>OB.length===0&&/Synced/.test(document.getElementById('status').textContent),null,{timeout:20000}).catch(()=>{});await idle(owner);await ev(staff,()=>enqueue(sync));await idle(staff);
  ok('back online, everything syncs by itself and both phones match the database',await ev(owner,()=>OB.length)===0&&await qty(owner,'Sugar')===sugar0-3&&await qty(staff,'Sugar')===sugar0-3&&await dbStock(sid,'Sugar')===sugar0-3&&await qty(staff,'Milk')===milk&&await dbStock(sid,'Milk')===milk,
    [await ev(owner,()=>OB.length),await qty(owner,'Sugar'),await qty(staff,'Sugar'),await dbStock(sid,'Sugar'),await status(owner)]);

  /* ---- sign out and back in ---- */
  await owner.pg.click('[data-tab=shop]');await owner.pg.click('#c-out');await owner.pg.waitForFunction(()=>window.__booted&&typeof store!=='undefined'&&!store,null,{timeout:15000});await owner.pg.waitForTimeout(300);
  ok('sign out returns the phone to its own data',await ev(owner,()=>!session&&!store&&!localStorage.getItem('cloudcache')));
  await owner.pg.click('[data-tab=shop]');await owner.pg.fill('#o-email','owner@example.com');await owner.pg.click('#c-send');await owner.pg.waitForSelector('#o-code');await owner.pg.fill('#o-code','123456');await owner.pg.click('#c-verify');await owner.pg.waitForFunction(()=>store&&S.products.length===7,null,{timeout:15000});await idle(owner);
  ok('signing in again opens the same shop with nothing duplicated',await ev(owner,()=>store.id)===sid&&await qty(owner,'Sugar')===sugar0-3&&(await B.sql('select count(*)::int n from khata_entries where store_id=$1',[sid]))[0].n===2&&(await B.sql('select count(*)::int n from products where store_id=$1',[sid]))[0].n===7,
    [await qty(owner,'Sugar'),await B.sql('select (select count(*) from khata_entries where store_id=$1)::int k,(select count(*) from products where store_id=$1)::int p',[sid])]);
  ok('no script errors on either phone',errs.length===0,errs);
  const bad=R.filter(x=>x.startsWith('FAIL'));console.log(R.join('\n'));console.log('requests the real client made: '+[...seen].sort().join(', '));console.log(`${R.length} checks, ${bad.length} failed`);await br.close();process.exit(bad.length?1:0)})().catch(e=>{console.log('THREW',e&&e.stack||e);process.exit(1)});
