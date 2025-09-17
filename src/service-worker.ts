/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope
declare const __BUILD_TIME__: string

const CACHE_NAME = `sequencer-cache-${__BUILD_TIME__}`
const FALLBACK_HTML_URL = '/index.html'

const buildAssetEntries = (self as unknown as {
  __WB_MANIFEST?: Array<{ url: string } | string>
}).__WB_MANIFEST

const precacheUrls = [
  '/',
  FALLBACK_HTML_URL,
  '/manifest.webmanifest',
  ...(buildAssetEntries
    ? buildAssetEntries.map((entry) =>
        typeof entry === 'string' ? entry : entry.url,
      )
    : []),
]

function normalizeUrl(url: string): string {
  const normalized = new URL(url, self.location.origin)
  return normalized.pathname + normalized.search
}

const PRECACHE_URLS = Array.from(new Set(precacheUrls.map(normalizeUrl)))

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      try {
        await cache.add(url)
      } catch (error) {
        console.warn('Failed to precache resource', url, error)
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await cacheAppShell()
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('sequencer-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

async function cachedFetch(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }

  try {
    const response = await fetch(request)
    if (response && response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    if (request.mode === 'navigate') {
      const fallbackResponse = await cache.match(FALLBACK_HTML_URL)
      if (fallbackResponse) {
        return fallbackResponse
      }
    }
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  const isSameOrigin = url.origin === self.location.origin

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const cache = await caches.open(CACHE_NAME)
          cache.put(request, response.clone())
          cache.put(FALLBACK_HTML_URL, response.clone())
          return response
        } catch {
          const cache = await caches.open(CACHE_NAME)
          const cached = await cache.match(request)
          if (cached) {
            return cached
          }
          const fallback = await cache.match(FALLBACK_HTML_URL)
          if (fallback) {
            return fallback
          }
          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
        }
      })(),
    )
    return
  }

  if (isSameOrigin) {
    event.respondWith(cachedFetch(request))
    return
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        return response
      } catch {
        const cache = await caches.open(CACHE_NAME)
        const cached = await cache.match(request)
        if (cached) {
          return cached
        }
        throw new Error('Network request failed and no cached response available.')
      }
    })(),
  )
})
