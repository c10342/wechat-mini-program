import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        container: resolve(__dirname, 'src/container/index.js'),
        'page-view': resolve(__dirname, 'src/page-view/index.js'),
        worker: resolve(__dirname, 'src/worker/index.js'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
        manualChunks: undefined,
      },
      preserveEntrySignatures: 'strict',
    },
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
