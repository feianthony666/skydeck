import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({command}) => {
  const rootDir = import.meta.dirname;
  if (command === 'build') {
    const tplPath = path.resolve(rootDir, 'index.template.html');
    const indexPath = path.resolve(rootDir, 'index.html');
    if (fs.existsSync(tplPath)) {
      fs.copyFileSync(tplPath, indexPath);
    }
  }

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: './',
          name: 'SkyDeck Flight Deck & Radar',
          short_name: 'SkyDeck',
          description: 'Live ADS-B radar, Chinese & global web feeds, ACARS stream, 3D flight deck & aircraft liveries, airport taxi feed, and weather-coupled flight planner.',
          theme_color: '#080D16',
          background_color: '#080D16',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            {
              src: './pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: './pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: './pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallbackDenylist: [/^\/api\//, /^\/\.netlify\//],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'skydeck-esri-tiles-v2',
                expiration: {
                  maxEntries: 600,
                  maxAgeSeconds: 60 * 60 * 24 * 14,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'skydeck-osm-tiles-v2',
                expiration: {
                  maxEntries: 400,
                  maxAgeSeconds: 60 * 60 * 24 * 14,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/tilecache\.rainviewer\.com\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'skydeck-rainviewer-radar-v2',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'skydeck-fonts-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'skydeck-dev-template-html',
        apply: 'serve',
        transformIndexHtml: {
          order: 'pre',
          handler(): string {
            const tplPath = path.resolve(rootDir, 'index.template.html');
            if (fs.existsSync(tplPath)) {
              return fs.readFileSync(tplPath, 'utf-8');
            }
            return '';
          },
        },
      },
      {
        name: 'skydeck-static-github-pages',
        apply: 'build',
        closeBundle: {
          order: 'post',
          handler(error?: Error): void {
            if (error) {
              return;
            }
            const distDir = path.resolve(rootDir, 'dist');
            const docsDir = path.resolve(rootDir, 'docs');
            const srcAssets = path.resolve(rootDir, 'src/assets');
            const distAssets = path.resolve(distDir, 'src/assets');
            if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
              fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
            }
            if (fs.existsSync(docsDir)) {
              fs.rmSync(docsDir, {recursive: true, force: true});
            }
            if (fs.existsSync(distDir)) {
              fs.writeFileSync(path.join(distDir, '.nojekyll'), '');

              // Clean stale workbox-*.js and assets/ at root before syncing compiled static bundle
              for (const entry of fs.readdirSync(rootDir)) {
                if (/^workbox-[a-f0-9]+\.js$/i.test(entry)) {
                  fs.rmSync(path.join(rootDir, entry), {force: true});
                }
              }
              const rootAssetsDir = path.join(rootDir, 'assets');
              if (fs.existsSync(rootAssetsDir)) {
                fs.rmSync(rootAssetsDir, {recursive: true, force: true});
              }

              // Mirror built static entry and assets directly to repo root so GitHub Pages serves at /skydeck/
              const staticFiles = [
                'index.html',
                '.nojekyll',
                'manifest.webmanifest',
                'sw.js',
                'icon.svg',
                'apple-touch-icon.png',
                'pwa-192x192.png',
                'pwa-512x512.png',
                'pwa-maskable-512x512.png',
              ];
              for (const file of staticFiles) {
                const srcFile = path.join(distDir, file);
                if (fs.existsSync(srcFile)) {
                  fs.copyFileSync(srcFile, path.join(rootDir, file));
                }
              }
              for (const entry of fs.readdirSync(distDir)) {
                if (/^workbox-[a-f0-9]+\.js$/i.test(entry)) {
                  fs.copyFileSync(path.join(distDir, entry), path.join(rootDir, entry));
                }
              }
              const distAssetsDir = path.join(distDir, 'assets');
              if (fs.existsSync(distAssetsDir)) {
                fs.cpSync(distAssetsDir, rootAssetsDir, {recursive: true, force: true});
              }
            }
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
