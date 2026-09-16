import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    open: true
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});
