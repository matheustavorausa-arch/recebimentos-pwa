const CACHE = 'recebimentos-v39';
const ASSETS = ['./','./index.html','./css/styles.css?v=39','./css/betting-theme.css?v=39','./js/payment-history-data.js?v=39','./js/app.js?v=39','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET') return;
  const request = event.request;
  const isPage = request.mode === 'navigate';
  event.respondWith(fetch(request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(request,copy));
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||(isPage ? caches.match('./index.html') : undefined))));
});
self.addEventListener('push', event => {
  const fallback = { title:'Recebimentos das 9h', body:'Abra o app para conferir os pagamentos de hoje.', icon:'./icons/icon-192.png', badge:'./icons/icon-192.png', tag:'daily-payments', data:{ url:'./' } };
  let payload = fallback;
  try { payload = event.data ? event.data.json() : fallback; } catch { payload = fallback; }
  const { title, ...options } = { ...fallback, ...payload };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(windows => {
    const openWindow = windows.find(client => 'focus' in client);
    const target = event.notification.data?.url || './';
    return openWindow ? openWindow.focus() : clients.openWindow(target);
  }));
});
