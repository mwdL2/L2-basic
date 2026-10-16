import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade: das Ergebnis in dist/ läuft in jedem Unterordner eines Webspace
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
