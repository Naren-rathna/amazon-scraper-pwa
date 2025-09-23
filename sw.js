// ===== SERVICE WORKER FOR AMAZON PRODUCT SCRAPER PWA =====

const CACHE_NAME = 'amazon-scraper-v1.0.0';
const RUNTIME_CACHE = 'amazon-scraper-runtime';
const API_CACHE = 'amazon-scraper-api';

// Static assets to cache immediately
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/manifest.json',
    // Add any additional static assets here
];

// API routes to cache
const API_ROUTES = [
    '/api/scrape',
    '/health'
];

// URLs that should not be cached
const EXCLUDE_FROM_CACHE = [
    '/api/download-image' // Images are handled separately
];

// ===== SERVICE WORKER EVENTS =====

// Install event - cache static resources
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('Service Worker: Static assets cached successfully');
                // Skip waiting to activate immediately
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('Service Worker: Failed to cache static assets:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        // Delete old caches that don't match current version
                        if (cacheName !== CACHE_NAME && 
                            cacheName !== RUNTIME_CACHE && 
                            cacheName !== API_CACHE) {
                            console.log('Service Worker: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('Service Worker: Activated successfully');
                // Claim all clients immediately
                return self.clients.claim();
            })
            .catch((error) => {
                console.error('Service Worker: Activation failed:', error);
            })
    );
});

// Fetch event - handle all network requests
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        // For POST requests to scraping API, apply network-first strategy
        if (url.pathname === '/api/scrape') {
            event.respondWith(handleApiRequest(request));
        }
        return;
    }
    
    // Skip chrome-extension requests
    if (url.protocol === 'chrome-extension:') {
        return;
    }
    
    // Handle different types of requests
    if (isStaticAsset(url.pathname)) {
        event.respondWith(handleStaticAsset(request));
    } else if (isApiRequest(url.pathname)) {
        event.respondWith(handleApiRequest(request));
    } else if (url.pathname === '/') {
        event.respondWith(handleMainPage(request));
    } else {
        event.respondWith(handleRuntimeRequest(request));
    }
});

// ===== REQUEST HANDLERS =====

// Handle static assets (CSS, JS, manifest, etc.)
async function handleStaticAsset(request) {
    try {
        // Cache first strategy for static assets
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // If not in cache, fetch and cache
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        
        return response;
        
    } catch (error) {
        console.error('Service Worker: Failed to handle static asset:', error);
        
        // Return offline fallback for critical assets
        if (request.url.includes('styles.css')) {
            return new Response('/* Offline - styles unavailable */', {
                headers: { 'Content-Type': 'text/css' }
            });
        }
        
        if (request.url.includes('script.js')) {
            return new Response('// Offline - script unavailable', {
                headers: { 'Content-Type': 'application/javascript' }
            });
        }
        
        throw error;
    }
}

// Handle main page requests
async function handleMainPage(request) {
    try {
        // Network first strategy for main page
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
            return response;
        }
        throw new Error('Network response not ok');
        
    } catch (error) {
        console.log('Service Worker: Network failed, serving cached main page');
        
        // Fall back to cached version
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Final fallback - offline page
        return new Response(getOfflinePageHtml(), {
            headers: { 'Content-Type': 'text/html' }
        });
    }
}

// Handle API requests
async function handleApiRequest(request) {
    const url = new URL(request.url);
    
    // Don't cache image downloads
    if (shouldExcludeFromCache(url.pathname)) {
        return fetch(request);
    }
    
    try {
        // Network first strategy for API calls
        const response = await fetch(request);
        
        if (response.ok) {
            // Cache successful API responses (except POST requests)
            if (request.method === 'GET') {
                const cache = await caches.open(API_CACHE);
                cache.put(request, response.clone());
            }
            return response;
        }
        
        throw new Error(`API response not ok: ${response.status}`);
        
    } catch (error) {
        console.log('Service Worker: API network failed, checking cache');
        
        // For GET requests, try to serve from cache
        if (request.method === 'GET') {
            const cachedResponse = await caches.match(request);
            if (cachedResponse) {
                return cachedResponse;
            }
        }
        
        // Return offline error response
        return new Response(JSON.stringify({
            error: 'Service unavailable offline',
            offline: true,
            message: 'Please check your internet connection and try again.'
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle runtime requests (images, fonts, etc.)
async function handleRuntimeRequest(request) {
    try {
        // Network first, cache on success
        const response = await fetch(request);
        
        if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
        }
        
        return response;
        
    } catch (error) {
        // Try to serve from cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return 404 for missing runtime resources
        return new Response('Resource not found', { status: 404 });
    }
}

// ===== UTILITY FUNCTIONS =====

function isStaticAsset(pathname) {
    return pathname.endsWith('.css') || 
           pathname.endsWith('.js') || 
           pathname.endsWith('.json') ||
           pathname === '/manifest.json';
}

function isApiRequest(pathname) {
    return pathname.startsWith('/api/') || pathname === '/health';
}

function shouldExcludeFromCache(pathname) {
    return EXCLUDE_FROM_CACHE.some(excludePath => pathname.startsWith(excludePath));
}

function getOfflinePageHtml() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Amazon Product Scraper - Offline</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #232f3e, #37475a);
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
                padding: 2rem;
            }
            .offline-container {
                max-width: 500px;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                padding: 3rem;
                border-radius: 20px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            }
            .offline-icon {
                font-size: 4rem;
                margin-bottom: 1rem;
                opacity: 0.8;
            }
            h1 {
                font-size: 2rem;
                margin-bottom: 1rem;
                color: #ff9900;
            }
            p {
                font-size: 1.1rem;
                line-height: 1.6;
                margin-bottom: 1.5rem;
                opacity: 0.9;
            }
            .retry-btn {
                background: #ff9900;
                color: white;
                border: none;
                padding: 1rem 2rem;
                border-radius: 10px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                margin: 0.5rem;
            }
            .retry-btn:hover {
                background: #e88a00;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(255, 153, 0, 0.3);
            }
            .features {
                margin-top: 2rem;
                text-align: left;
                opacity: 0.8;
            }
            .feature-item {
                margin: 0.5rem 0;
                display: flex;
                align-items: center;
            }
            .feature-item::before {
                content: "✓";
                color: #ff9900;
                font-weight: bold;
                margin-right: 0.5rem;
            }
        </style>
    </head>
    <body>
        <div class="offline-container">
            <div class="offline-icon">📱</div>
            <h1>You're Offline</h1>
            <p>
                Don't worry! Your previously scraped products are still available locally. 
                Connect to the internet to scrape new products.
            </p>
            
            <button class="retry-btn" onclick="window.location.reload()">
                🔄 Try Again
            </button>
            
            <button class="retry-btn" onclick="window.location.href='/'">
                🏠 Go Home
            </button>
            
            <div class="features">
                <div class="feature-item">Your saved products are still accessible</div>
                <div class="feature-item">Search and filter your local data</div>
                <div class="feature-item">Export your product data</div>
                <div class="feature-item">Full offline PWA functionality</div>
            </div>
        </div>
    </body>
    </html>
    `;
}

// ===== BACKGROUND SYNC (Future Enhancement) =====

// Handle background sync for offline actions
self.addEventListener('sync', (event) => {
    console.log('Service Worker: Background sync event:', event.tag);
    
    if (event.tag === 'background-scrape') {
        event.waitUntil(handleBackgroundScrape());
    }
});

async function handleBackgroundScrape() {
    try {
        // Get pending scrape requests from IndexedDB
        const pendingRequests = await getPendingScrapeRequests();
        
        for (const request of pendingRequests) {
            try {
                const response = await fetch('/api/scrape', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request)
                });
                
                if (response.ok) {
                    // Remove from pending requests
                    await removePendingScrapeRequest(request.id);
                    
                    // Notify the client
                    await notifyClients({
                        type: 'SCRAPE_COMPLETED',
                        data: await response.json()
                    });
                }
            } catch (error) {
                console.error('Background scrape failed:', error);
            }
        }
    } catch (error) {
        console.error('Background sync failed:', error);
    }
}

// ===== PUSH NOTIFICATIONS (Future Enhancement) =====

self.addEventListener('push', (event) => {
    console.log('Service Worker: Push notification received');
    
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Amazon Product Scraper';
    const options = {
        body: data.body || 'New notification',
        icon: '/android-chrome-192x192.png',
        badge: '/android-chrome-72x72.png',
        tag: data.tag || 'general',
        requireInteraction: data.requireInteraction || false,
        actions: data.actions || []
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    console.log('Service Worker: Notification click received');
    
    event.notification.close();
    
    const action = event.action;
    const notification = event.notification;
    
    if (action === 'view-product') {
        // Open the app and navigate to product
        event.waitUntil(
            clients.openWindow(`/?product=${notification.tag}`)
        );
    } else {
        // Default action - open the app
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// ===== CLIENT COMMUNICATION =====

// Handle messages from client
self.addEventListener('message', (event) => {
    console.log('Service Worker: Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(clearAllCaches());
    }
});

// Notify all clients
async function notifyClients(message) {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage(message);
    });
}

// ===== CACHE MANAGEMENT =====

async function clearAllCaches() {
    try {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames.map(cacheName => caches.delete(cacheName))
        );
        console.log('Service Worker: All caches cleared');
        return true;
    } catch (error) {
        console.error('Service Worker: Failed to clear caches:', error);
        return false;
    }
}

// ===== INDEXEDDB HELPERS (Future Enhancement) =====

async function getPendingScrapeRequests() {
    // Implementation would use IndexedDB to store offline requests
    // For now, return empty array
    return [];
}

async function removePendingScrapeRequest(requestId) {
    // Implementation would remove request from IndexedDB
    console.log('Removing pending request:', requestId);
}

// ===== PERIODIC BACKGROUND SYNC (Future Enhancement) =====

self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'content-sync') {
        event.waitUntil(doPeriodicSync());
    }
});

async function doPeriodicSync() {
    try {
        // Sync cached data, update prices, etc.
        console.log('Service Worker: Performing periodic sync');
        
        // Check for updated product prices
        const cachedProducts = await getAllCachedProducts();
        for (const product of cachedProducts) {
            if (shouldUpdateProduct(product)) {
                await updateProductData(product);
            }
        }
    } catch (error) {
        console.error('Periodic sync failed:', error);
    }
}

async function getAllCachedProducts() {
    // Would get products from IndexedDB
    return [];
}

function shouldUpdateProduct(product) {
    // Check if product data is stale (e.g., older than 24 hours)
    const lastUpdated = new Date(product.updatedAt || product.extractedAt);
    const dayInMs = 24 * 60 * 60 * 1000;
    return Date.now() - lastUpdated.getTime() > dayInMs;
}

async function updateProductData(product) {
    try {
        const response = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: product.url })
        });
        
        if (response.ok) {
            const updatedData = await response.json();
            // Update cached data
            console.log('Product updated:', product.title);
            
            // Notify clients of update
            await notifyClients({
                type: 'PRODUCT_UPDATED',
                data: { ...product, ...updatedData }
            });
        }
    } catch (error) {
        console.error('Failed to update product:', error);
    }
}

// ===== ERROR HANDLING =====

self.addEventListener('error', (event) => {
    console.error('Service Worker: Uncaught error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Service Worker: Unhandled promise rejection:', event.reason);
});

// ===== DEBUGGING HELPERS =====

// Add debugging information to console
console.log('Service Worker: Amazon Product Scraper PWA');
console.log('Cache Name:', CACHE_NAME);
console.log('Static Assets:', STATIC_ASSETS);
console.log('API Routes:', API_ROUTES);

// Expose debugging functions
self.debug = {
    clearCache: clearAllCaches,
    getCacheNames: () => caches.keys(),
    getCacheSize: async (cacheName) => {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        return keys.length;
    },
    version: CACHE_NAME
};