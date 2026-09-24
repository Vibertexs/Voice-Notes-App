import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'frontend',
  build: {
    outDir: '../frontend-dist',
    emptyOutDir: true,
    // The mobile shell inlines exactly one JS file and one CSS file from
    // frontend-dist/assets (see mobile/scripts/bundle-web.mjs); anything
    // emitted beside them is silently dropped. The font has to become a
    // data: URI inside the CSS or it never reaches the phone.
    assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? true : undefined),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
});
