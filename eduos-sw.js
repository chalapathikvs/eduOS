// EduOS Service Worker
// Built: 2026-04-19
const CACHE_NAME = 'eduos-2026-04-19';

const CACHE_FILES = [
  './eduOS.html',
  './eduos-manifest.json',
  './eduos-icon-192.png',
  './eduos-icon-512.png',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Architects+Daughter&display=swap'
];

// ── Install: cache app shell ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_FILES).catch(() => cache.add('./eduOS.html')))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for app, network for fonts ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache AI API calls
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Handle share target POST (file shared from another app)
  if (event.request.method === 'POST' && url.pathname.includes('share-target')) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Handle share target GET (text/URL shared)
  if (event.request.method === 'GET' && url.searchParams.has('share_text')) {
    const text = url.searchParams.get('share_text') || '';
    const sharedUrl = url.searchParams.get('share_url') || '';

    // Store for app to pick up
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SHARE_RECEIVED',
            shareType: 'text',
            text: [text, sharedUrl].filter(Boolean).join(' ')
          });
        });
      })
    );

    event.respondWith(Response.redirect('./eduOS.html', 302));
    return;
  }

  // Google Fonts — network with cache fallback
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          return response;
        })
      )
    );
    return;
  }

  // App shell: cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (event.request.method === 'GET' && response.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => caches.match('./eduOS.html'));
    })
  );
});

// ── Share Target: handle POST file share ──────────
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();

    // Extract shared data
    const title = formData.get('title') || '';
    const text  = formData.get('text')  || '';
    const url   = formData.get('url')   || '';

    // Check for shared files (photos, PDFs)
    const fileEntry = formData.get('file');
    let shareData = { type: 'text', title, text, url };

    if (fileEntry && fileEntry instanceof File) {
      // Read file as base64 for passing to app
      const arrayBuffer = await fileEntry.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      bytes.forEach(b => binary += String.fromCharCode(b));
      const base64 = btoa(binary);

      shareData = {
        type:      'file',
        fileName:  fileEntry.name,
        fileType:  fileEntry.type,
        fileSize:  fileEntry.size,
        base64,
        title,
        text
      };
    }

    // Store in cache so app can retrieve it after redirect
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      '/_share_pending',
      new Response(JSON.stringify(shareData), {
        headers: { 'Content-Type': 'application/json' }
      })
    );

    // Notify any open clients
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'SHARE_RECEIVED', ...shareData }));

    // Redirect to app
    return Response.redirect('./eduOS.html', 303);

  } catch (err) {
    console.error('[EduOS SW] Share target error:', err);
    return Response.redirect('./eduOS.html', 303);
  }
}

// ── Push notifications ────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'EduOS', {
      body:    data.body || 'Time to log your learning!',
      icon:    './eduos-icon-192.png',
      badge:   './eduos-icon-192.png',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('./eduOS.html'));
});
