import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import { frontendConfig } from '../frontend/vite.config.ts';
import { desktopRelayOrigin } from '../src/shared/desktop.ts';

export default defineConfig(({ command }) => {
  const relay = desktopRelayOrigin(process.env.LPI_DESKTOP_SERVER);
  const port = Number(process.env.LPI_DESKTOP_DEV_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('LPI_DESKTOP_DEV_PORT must be a port between 1 and 65535.');
  }
  const frontend = frontendConfig(relay);
  return {
    main: {
      build: {
        outDir: fileURLToPath(new URL('../dist/desktop/main', import.meta.url)),
        emptyOutDir: true,
        rolldownOptions: {
          input: fileURLToPath(new URL('./main.ts', import.meta.url)),
          output: { format: 'es', entryFileNames: 'index.js' },
        },
      },
    },
    preload: {
      build: {
        outDir: fileURLToPath(new URL('../dist/desktop/preload', import.meta.url)),
        emptyOutDir: true,
        externalizeDeps: false,
        rolldownOptions: {
          input: fileURLToPath(new URL('./preload.ts', import.meta.url)),
          output: { format: 'cjs', entryFileNames: 'index.cjs' },
        },
      },
    },
    renderer: {
      ...frontend,
      root: fileURLToPath(new URL('../frontend', import.meta.url)),
      plugins: [
        frontend.plugins,
        {
          name: 'lpi-desktop-ui',
          enforce: 'post',
          // The custom protocol uses root-relative assets, including on deep-link reloads.
          config: () => ({ base: '/' }),
          // Production configuration is supplied by the local protocol handler at launch.
          transformIndexHtml: () =>
            command === 'serve'
              ? [
                  {
                    tag: 'meta',
                    attrs: { name: 'lpi-relay-origin', content: relay },
                    injectTo: 'head',
                  },
                ]
              : [],
        },
      ],
      server: { ...frontend.server, port, strictPort: true },
      build: {
        minify: command === 'build',
        outDir: fileURLToPath(new URL('../dist/desktop/renderer', import.meta.url)),
        emptyOutDir: true,
        rolldownOptions: {
          input: fileURLToPath(new URL('../frontend/index.html', import.meta.url)),
        },
      },
      clearScreen: command !== 'serve',
    },
  };
});
