const CACHE_NAME = 'akkoc-lojistik-v7-production';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './mobile.css',
    './supabase-client.js',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap'
];

// 1. KURULUM (Install)
self.addEventListener('install', (event) => {
    // Service Worker hemen aktif olsun
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📦 [SW] Dosyalar önbelleğe alınıyor...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. AKTİFLEŞTİRME (Activate)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(
                keyList.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('🧹 [SW] Eski önbellek temizleniyor:', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    // Tüm client'ları hemen ele al
    return self.clients.claim();
});

// 3. İSTEKLERİ YAKALAMA (Fetch)
self.addEventListener('fetch', (event) => {
    // A. Supabase API isteklerini (Network Only)
    if (event.request.url.includes('supabase.co')) {
        return; // Direkt ağa git, cache karışma
    }

    // B. Diğer istekler (Stale-While-Revalidate)
    // Önce cache'den ver, arka planda ağı kontrol et ve cache'i güncelle
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Geçerli yanıt ise cache güncelle
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Ağ hatası (Offline)
                // Eğer offline.html varsa burada döndürülebilir
            });

            // Cache varsa onu döndür, yoksa ağ isteğini bekle
            return cachedResponse || fetchPromise;
        })
    );
});
