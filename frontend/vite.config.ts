import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export function frontendConfig(target = process.env.LPI_DEV_SERVER ?? 'http://127.0.0.1:3141') {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/display': { target, changeOrigin: true },
        '/projects': { target, changeOrigin: true, ws: true },
        '/usage': { target, changeOrigin: true },
        '/sessions': { target, changeOrigin: true },
        '/events': { target, changeOrigin: true, ws: true },
      },
    },
  };
}

export default defineConfig(frontendConfig());
