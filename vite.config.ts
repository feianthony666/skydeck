import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';

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
      viteSingleFile(),
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
        transform(code: string, id: string) {
          if (id.includes('vite/dist/client/client.mjs') || id.endsWith('/@vite/client')) {
            const patched = code
              .replace(/else throw new SendBeforeConnectError\("send was called before connect"\);?/g, 'else return;')
              .replace(/transport\.connect\(createHMRHandler\(handleMessage\)\);?/g, '/* hmr disabled */')
              .replace(/setupForwardConsoleHandler\(transport,\s*forwardConsole\);?/g, '/* console forward disabled */');
            if (patched !== code) {
              return {code: patched, map: null};
            }
          }
          return null;
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
            if (fs.existsSync(docsDir)) {
              fs.rmSync(docsDir, {recursive: true, force: true});
            }

            // Remove old multi-file static artifacts at root so single-file static output stays clean
            for (const entry of fs.readdirSync(rootDir)) {
              if (/^workbox-[a-f0-9]+\.js$/i.test(entry)) {
                fs.rmSync(path.join(rootDir, entry), {force: true});
              }
            }
            for (const stale of [
              'assets',
              'manifest.webmanifest',
              'sw.js',
              'icon.svg',
              'apple-touch-icon.png',
              'pwa-192x192.png',
              'pwa-512x512.png',
              'pwa-maskable-512x512.png',
            ]) {
              const p = path.join(rootDir, stale);
              if (fs.existsSync(p)) {
                fs.rmSync(p, {recursive: true, force: true});
              }
            }

            if (fs.existsSync(distDir)) {
              fs.writeFileSync(path.join(distDir, '.nojekyll'), '');
              fs.writeFileSync(path.join(rootDir, '.nojekyll'), '');
              const distIndex = path.join(distDir, 'index.html');
              if (fs.existsSync(distIndex)) {
                fs.copyFileSync(distIndex, path.join(rootDir, 'index.html'));
              }
            }
          },
        },
      },
    ],
    build: {
      assetsInlineLimit: 100000000,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      hmr: false,
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
