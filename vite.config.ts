import { defineConfig } from 'vite';
import { VitePWA }      from 'vite-plugin-pwa';
import pkg              from './package.json';

export default defineConfig({
  define: {
    // Makes __APP_VERSION__ available as a typed string at build time.
    // Usage in TS: declare const __APP_VERSION__: string;  (already in globals.d.ts)
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
        manualChunks: (id) => {
          if (
            id.includes('src/auth/passkey.ts') ||
            id.includes('src/auth/magic.ts') ||
            id.includes('src/auth/session.ts') ||
            id.includes('src/ui/account-passkeys.ts')
          ) {
            return 'auth';
          }
          if (id.includes('src/cards/store.ts') || id.includes('src/cards/sync.ts') || id.includes('src/cards/merge.ts')) {
            return 'cards';
          }
        },
      },
    },
  },
});