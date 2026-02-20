import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/dashboard',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/dashboard/ui/index.html'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3030',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3030',
        ws: true,
      },
    },
  },
});
