/* Lets the shop open with no internet. The app page and its two scripts are fetched fresh whenever the
   network answers, and served from the saved copy when it does not. Database requests are never touched. */
const CACHE='bolo-dukaan-2',SHELL=['./','index.html','supabase.js','qrcode.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  const own=u.origin===self.location.origin,font=/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if(!own&&!font)return;
  /* our own files are saved under their address without any ?query, so there is one copy of each and it is always the newest */
  const key=own?u.origin+u.pathname:r;
  e.respondWith((async()=>{const cache=await caches.open(CACHE);
    const hit=await cache.match(key)||(r.mode==='navigate'?await cache.match('index.html'):undefined);
    const net=fetch(r).then(x=>{if(x.ok||x.type==='opaque')cache.put(key,x.clone()).catch(()=>{});return x});
    if(!hit)return net;
    if(font){net.catch(()=>{});return hit}                                   /* fonts never change: saved copy first */
    /* app files: the network wins if it answers within 4 seconds, otherwise the saved copy */
    return Promise.race([net.then(x=>x.ok?x:hit),new Promise(ok=>setTimeout(()=>ok(hit),4000))]).catch(()=>hit)})())});
