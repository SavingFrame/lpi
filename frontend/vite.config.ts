import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = process.env.PIM_DEV_SERVER ?? 'http://127.0.0.1:3141';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/projects': { target, changeOrigin: true },
      '/sessions': { target, changeOrigin: true },
      '/events': { target, changeOrigin: true, ws: true },
    },
  },
});
