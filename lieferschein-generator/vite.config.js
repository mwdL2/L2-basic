import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// mode "standalone": Bausatz für die Einzeldatei (scripts/build-standalone.mjs)
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    // Relative Pfade: das Ergebnis in dist/ läuft in jedem Unterordner eines Webspace
    base: './',
    publicDir: standalone ? false : 'public',
    resolve: {
      alias: standalone
        ? [{ find: /^\.\/app\/runtime\.js$/, replacement: fileURLToPath(new URL('./src/app/runtime.standalone.js', import.meta.url)) }]
        : [],
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 8000,
      outDir: standalone ? 'dist-standalone' : 'dist',
      assetsInlineLimit: standalone ? 100_000_000 : undefined,
      cssCodeSplit: !standalone,
    },
  };
});
