// A stand-in for the Supabase project, backed by a real Postgres (PGlite, in-process) that has the
// shop's actual migrations applied: same tables, same row-level security, same functions.
// It speaks just enough of the supabase-js client for the app's calls, and runs every request as the
// signed-in user's database role, the way PostgREST does. It also builds "phones": separate copies
// of the app page, each with its own browser storage, all talking to the one database.
const fs=require('fs'),path=require('path'),vm=require('vm');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'))}catch(e){try{({PGlite}=require('/home/claude/pgt/node_modules/@electric-sql/pglite'))}catch(x){console.log('This test needs PGlite:  npm i @electric-sql/pglite');process.exit(2)}}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const PK={product_costs:['product_id'],members:['store_id','user_id']};
const iso=v=>new Date(v.replace(' ','T').replace(/([+-]\d\d)$/,'$1:00')).toISOString();

async function makeBackend({migrations=['1_shop_sync.sql','2_khata.sql','3_product_batches.sql'],anonymous=true}={}){
  const pg=new PGlite({parsers:{1082:v=>v,1184:iso,1114:v=>v}});
  await pg.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;`);
  for(const m of migrations)await pg.exec(fs.readFileSync(path.join(__dirname,'schema',m),'utf8'));
  const B={pg,anonymous,requests:0,sql:(q,p)=>pg.query(q,p).then(r=>r.rows)};
  const mapErr=(e,uid)=>{const code=e.code||'';
    if(code==='42P01'){const t=(/relation "(?:public\.)?([^"]+)"/.exec(e.message)||[])[1]||'?';return{error:{code:'PGRST205',message:`Could not find the table 'public.${t}' in the schema cache`},status:404}}
    if(code==='42703')return{error:{code:'PGRST204',message:e.message},status:400};
    if(code==='42501')return{error:{code,message:e.message},status:uid?403:401};
    return{error:{code,message:e.message},status:/^23/.test(code)?409:400}};
  /* net: this phone's connection. offline = no internet; down = server answers 503; lostReply = the next write is applied but its answer never arrives. */
  B.client=(ls,net)=>{ls=ls||{};net=net||{};const uid=()=>ls['sb-auth']||null;
    const exec=async(fn,isWrite)=>{B.requests++;
      if(net.offline)return{data:null,error:{message:'TypeError: Failed to fetch'},status:0};
      if(net.down)return{data:null,error:{message:'upstream connect error or disconnect/reset before headers'},status:503};
      const u=uid();
      try{const data=await pg.transaction(async tx=>{await tx.query("select set_config('role',$1,true), set_config('request.jwt.claim.sub',$2,true)",[u?'authenticated':'anon',u||'']);return fn(tx)});
        if(isWrite&&net.lostReply){net.lostReply--;return{data:null,error:{message:'TypeError: Failed to fetch'},status:0}}
        return{data,error:null,status:200}}
      catch(e){return{data:null,...mapErr(e,u)}}};
    const val=(v,ps)=>{if(v!==null&&typeof v==='object'){ps.push(JSON.stringify(v));return`$${ps.length}::jsonb`}ps.push(v);return`$${ps.length}`};
    const where=(st,ps)=>st.filters.length?' where '+st.filters.map(([c,op,v])=>`"${c}" ${op} ${val(v,ps)}`).join(' and '):'';
    const go=async(tx,st)=>{const ps=[],T=`public."${st.t}"`;
      if(st.op==='select'){const cols=st.cols==='*'?'*':st.cols.split(',').map(c=>`"${c.trim()}"`).join(',');let q=`select ${cols} from ${T}`+where(st,ps);
        if(st.order)q+=` order by "${st.order[0]}" ${st.order[1]}`;
        let lim=1000,off=0;if(st.range){off=st.range[0];lim=Math.min(1000,st.range[1]-st.range[0]+1)}if(st.limit!=null)lim=Math.min(lim,st.limit);   /* Supabase never returns more than 1000 rows per request */
        q+=` limit ${lim} offset ${off}`;const rows=(await tx.query(q,ps)).rows;
        if(st.single){if(rows.length>1||(!rows.length&&st.single==='one'))throw Object.assign(new Error('JSON object requested, multiple (or no) rows returned'),{code:'PGRST116'});return rows[0]||null}
        return rows}
      if(st.op==='upsert'||st.op==='insert'){if(!st.rows.length)return null;const cols=Object.keys(st.rows[0]),pk=PK[st.t]||['id'];
        const vals=st.rows.map(r=>'('+cols.map(c=>val(r[c]===undefined?null:r[c],ps)).join(',')+')').join(',');
        const set=cols.filter(c=>!pk.includes(c)).map(c=>`"${c}"=excluded."${c}"`).join(',');
        await tx.query(`insert into ${T} (${cols.map(c=>`"${c}"`).join(',')}) values ${vals}`+(st.op==='insert'?'':` on conflict (${pk.map(c=>`"${c}"`).join(',')}) `+(st.ignore||!set?'do nothing':'do update set '+set)),ps);return null}
      if(st.op==='update'){const set=Object.keys(st.patch).map(c=>`"${c}"=${val(st.patch[c],ps)}`).join(',');await tx.query(`update ${T} set ${set}`+where(st,ps),ps);return null}
      if(st.op==='delete'){await tx.query(`delete from ${T}`+where(st,ps),ps);return null}};
    const from=t=>{const st={t,op:'select',cols:'*',filters:[]};const api={
      select(c){if(st.op==='select')st.cols=c||'*';return api},eq(c,v){st.filters.push([c,'=',v]);return api},gte(c,v){st.filters.push([c,'>=',v]);return api},
      order(c,o){st.order=[c,o&&o.ascending===false?'desc':'asc'];return api},range(a,b){st.range=[a,b];return api},limit(n){st.limit=n;return api},
      single(){st.single='one';return api},maybeSingle(){st.single='maybe';return api},
      upsert(rows,o){st.op='upsert';st.rows=[].concat(rows);st.ignore=!!(o&&o.ignoreDuplicates);return api},insert(rows){st.op='insert';st.rows=[].concat(rows);return api},
      update(p){st.op='update';st.patch=p;return api},delete(){st.op='delete';return api},
      then(ok,no){return exec(tx=>go(tx,st),st.op!=='select').then(ok,no)}};return api};
    const signIn=async email=>{if(net.offline)return{data:{user:null,session:null},error:{message:'TypeError: Failed to fetch'}};
      const r=email?await pg.query('insert into auth.users (email) values ($1) on conflict (email) do update set email=excluded.email returning id',[email]):await pg.query('insert into auth.users default values returning id');
      ls['sb-auth']=r.rows[0].id;const user={id:r.rows[0].id};return{data:{user,session:{user}},error:null}};
    return{from,
      rpc:(name,args)=>exec(async tx=>{const ks=Object.keys(args||{}),ps=ks.map(k=>args[k]);const rows=(await tx.query(`select * from public."${name}"(${ks.map((k,i)=>`"${k}" => $${i+1}`).join(',')})`,ps)).rows;return rows[0]},true),
      auth:{
        /* expired = the saved sign-in needs refreshing, which needs the internet; gone = the sign-in was revoked */
        getSession:async()=>{if(net.gone){delete ls['sb-auth']}const u=uid();if(u&&net.expired){if(net.offline)return{data:{session:null},error:{name:'AuthRetryableFetchError',message:'Failed to fetch'}};net.expired=false}
          return{data:{session:u?{user:{id:u}}:null},error:null}},
        signInAnonymously:async()=>B.anonymous?signIn():{data:{user:null,session:null},error:{message:'Anonymous sign-ins are disabled'}},
        signInWithOtp:async()=>net.offline?{data:null,error:{message:'TypeError: Failed to fetch'}}:{data:{},error:null},
        verifyOtp:async({email,token})=>token==='123456'?signIn(email):{data:null,error:{message:'Token has expired or is invalid'}},
        signOut:async()=>{delete ls['sb-auth'];return{error:null}}},
      functions:{invoke:async()=>({data:null,error:{message:'Edge Function returned a non-2xx status code',context:{status:404,json:async()=>({message:'Requested function was not found'})}}})}}};
  B.fetch=net=>async url=>{if(net&&net.offline)throw new TypeError('Failed to fetch');return{ok:true,status:200,json:async()=>({external:{email:true,anonymous_users:B.anonymous}})}};
  return B}

/* One phone: the page's script running with its own storage. reload() opens the page again on the same storage. */
const SRC=(()=>{const html=fs.readFileSync(process.env.SITE||path.join(__dirname,'..','index.html'),'utf8');
  return html.match(/<script>(?!window\.SEED)([\s\S]*?)<\/script>/)[1].replace("function say(text,chips,spoken){","function say(text,chips,spoken){__log.push(text);return;").replace("function me(text){","function me(text){return;")+"\n;if(typeof runDbCheck==='undefined')globalThis.runDbCheck=async()=>[];"})();   /* the last part lets this suite run against older builds: SITE=old.html node tests/db.test.js */
class Phone{
  constructor(backend,ls,net,claude){this.backend=backend;this.ls=ls||{};this.net=net||{};this.claude=claude;const els=this.els={},self=this;
    const mk=()=>({hidden:false,checked:false,disabled:false,value:'',textContent:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},append(){},insertAdjacentHTML(){},focus(){},setAttribute(){},abort(){},blur(){},contains(){return false},querySelectorAll(){return[]},closest(){return mk()},set innerHTML(v){},get innerHTML(){return''}});
    const head=mk();head.append=e=>setTimeout(()=>e.onload&&e.onload(),0);   /* "loads" supabase.js */
    this.log=[];this.reloads=0;
    const win={addEventListener(){},claude,supabase:{createClient:(u,k,o)=>backend.client(o&&o.auth&&o.auth.persistSession===false?{}:self.ls,self.net)}};
    this.ctx=vm.createContext({console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},__log:this.log,window:win,
      document:{getElementById:id=>els[id]||(els[id]=mk()),createElement:()=>mk(),querySelectorAll:()=>[],head,addEventListener(){},documentElement:{},visibilityState:'visible'},
      localStorage:{getItem:k=>k in self.ls?self.ls[k]:null,setItem:(k,v)=>{if(self.net.full)throw new Error('QuotaExceededError');self.ls[k]=String(v)},removeItem:k=>{delete self.ls[k]}},
      navigator:{get onLine(){return!self.net.offline}},location:{protocol:'https:',reload(){self.reloads++}},fetch:(...a)=>backend.fetch(self.net)(...a)});
    vm.runInContext(SRC,this.ctx)}
  ev(code){return vm.runInContext(code,this.ctx)}
  async settle(){for(let i=0;i<8;i++){await wait(4);try{await this.ev('queue')}catch(e){}}return this}
  async open(){for(let i=0;i<400&&!this.claude&&!this.ctx.window.__booted;i++)await wait(2);return this.settle()}
  set(id,v){this.ev(`document.getElementById(${JSON.stringify(id)})`).value=v;return this}
  async click(id){await this.ev(`document.getElementById(${JSON.stringify(id)}).onclick()`);return this.settle()}
  async sync(){try{await this.ev('enqueue(sync)')}catch(e){}return this.settle()}
  msg(){return this.ev("document.getElementById('shopMsg').textContent")}
  reload(){return new Phone(this.backend,this.ls,this.net,this.claude).open()}
}
/* The database a page gets inside Claude: documents at paths, live queries. Unless a query says how many it wants it returns 100, so the page must ask. */
function fakeArtifactDb(data,ctl){ctl=ctl||{};const subs=new Set(),clone=v=>JSON.parse(JSON.stringify(v)),fire=()=>setTimeout(()=>subs.forEach(f=>f()),0),rid=()=>Math.random().toString(36).slice(2,12)+Math.random().toString(36).slice(2,12);
  const chk=d=>{ctl.writes=(ctl.writes||0)+1;if(ctl.readonly)throw{code:'invalid_argument',message:'write refused'};if(d&&(typeof d!=='object'||Array.isArray(d)))throw{code:'invalid_argument',message:'body must be an object'}};
  const snap=p=>({id:p.split('/').pop(),exists:p in data,data:()=>p in data?clone(data[p]):undefined,metadata:{}});
  const doc=p=>{if(p.split('/').length%2)throw new TypeError('document path needs an even number of segments: '+p);return{id:p.split('/').pop(),path:p,get:async()=>snap(p),set:async d=>{chk(d);data[p]=clone(d);fire()},
    update:async d=>{chk(d);if(!(p in data))throw{code:'invalid_argument',message:'no such document'};Object.assign(data[p],clone(d));fire()},delete:async()=>{chk();delete data[p];fire()},
    onSnapshot(next){const f=()=>next(snap(p));subs.add(f);setTimeout(f,0);return()=>subs.delete(f)},collection:c=>coll(p+'/'+c)}};
  const coll=(c,q)=>{q=q||{};if(!(c.split('/').length%2))throw new TypeError('collection path needs an odd number of segments: '+c);const depth=c.split('/').length+1;
    const list=()=>{let ds=Object.keys(data).filter(k=>k.startsWith(c+'/')&&k.split('/').length===depth).sort().map(snap);
      (q.wh||[]).forEach(([f,op,v])=>{ds=ds.filter(d=>{const a=d.data()[f];return op==='<='?a<=v:op==='<'?a<v:op==='>='?a>=v:op==='>'?a>v:a===v})});if(q.order)ds.sort((a,b)=>((a.data()[q.order[0]]>b.data()[q.order[0]])-(a.data()[q.order[0]]<b.data()[q.order[0]]))*(q.order[1]==='desc'?-1:1));
      if(q.limit!=null&&(q.limit<1||q.limit>1000))throw{code:'invalid_argument',message:'limit must be 1-1000'};ds=ds.slice(0,q.limit||100);return{docs:ds,size:ds.length,empty:!ds.length,metadata:{},docChanges:()=>[]}};
    return{path:c,orderBy:(f,d)=>coll(c,{...q,order:[f,d||'asc']}),limit:n=>coll(c,{...q,limit:n}),where:(f,op,v)=>coll(c,{...q,wh:[...(q.wh||[]),[f,op,v]]}),get:async()=>list(),
      onSnapshot(next,err){const f=()=>{try{next(list())}catch(e){err&&err(e)}};subs.add(f);setTimeout(f,0);return()=>subs.delete(f)},doc:id=>doc(c+'/'+(id||rid())),add:async d=>{const r=doc(c+'/'+rid());await r.set(d);return r}}};
  return{doc,collection:c=>coll(c)}}
module.exports={makeBackend,Phone,wait,fakeArtifactDb};
