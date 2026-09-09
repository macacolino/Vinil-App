import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// Caminho base do site. No GitHub Pages o app fica em /<nome-do-repo>/,
// então o workflow define VITE_BASE=/main/. Localmente é "/".
const base = process.env.VITE_BASE ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Vinil — coleção de LPs',
        short_name: 'Vinil',
        description: 'Catálogo pessoal de LPs, funciona offline.',
        lang: 'pt-BR',
        theme_color: '#18181b',
        background_color: '#18181b',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Capas de álbuns (iTunes / Cover Art Archive / Discogs): guarda em cache para
            // uso offline. Só imagens: chamadas de API (api.discogs.com, musicbrainz.org)
            // nunca podem cair aqui, senão ficariam congeladas no cache.
            urlPattern: ({ request, url }) =>
              request.destination === 'image' &&
              (/(^|\.)mzstatic\.com$/.test(url.hostname) ||
                /(^|\.)coverartarchive\.org$/.test(url.hostname) ||
                /(^|\.)archive\.org$/.test(url.hostname) ||
                /^i\.discogs\.com$/.test(url.hostname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'capas',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
})
