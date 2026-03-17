import { defineConfig } from 'vite';
import { VitePWA }      from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name:             'Cardex — Loyalty Wallet',
        short_name:       'Cardex',
        description:      'Store and access your loyalty cards offline',
        theme_color:      '#0a0a0f',
        background_color: '#0a0a0f',
        display:          'standalone',
        orientation:      'portrait',
        start_url:        '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Cache CDN barcode libs so they work offline
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler:    'CacheFirst',
            options: {
              cacheName:  'cdn-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler:    'CacheFirst',
            options: {
              cacheName:  'font-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // Never cache Worker API calls
        navigateFallbackDenylist: [/^\/auth\//, /^\/cards/],
      },
    }),
  ],
  build: {
    target:   'es2022',
    outDir:   'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          auth:  ['./src/auth/passkey.ts', './src/auth/magic.ts', './src/auth/session.ts'],
          cards: ['./src/cards/store.ts',  './src/cards/sync.ts', './src/cards/merge.ts'],
        },
      },
    },
  },
});
