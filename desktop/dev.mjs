import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createServer } from 'vite';
import { desktopRelayOrigin } from '../dist/src/shared/desktop.js';

const relay = desktopRelayOrigin(process.env.PIM_DESKTOP_SERVER);
// Keep Vite's existing visual/API proxies on the same relay as the desktop transport.
process.env.PIM_DEV_SERVER = relay;

// Vite alone is owned by this launcher. The relay and native Pi are never child processes.
const vite = await createServer({
  configFile: fileURLToPath(new URL('../frontend/vite.config.ts', import.meta.url)),
  root: fileURLToPath(new URL('../frontend', import.meta.url)),
  plugins: [
    {
      name: 'pim-desktop-connection',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: { name: 'pim-relay-origin', content: relay },
          injectTo: 'head',
        },
      ],
    },
  ],
});
let child;
let stopping = false;
async function stop(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  process.exitCode ??= 0;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
  await vite.close();
}
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

try {
  await vite.listen();
  if (stopping) {
    await vite.close();
  } else {
    vite.printUrls();
    launchElectron();
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await stop('SIGTERM');
}

function launchElectron() {
  const env = { ...process.env, PIM_DESKTOP_SERVER: relay, PIM_DESKTOP_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [fileURLToPath(new URL('../dist/desktop/main.js', import.meta.url))], {
    env,
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
    void stop('SIGTERM');
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
    }
    void stop('SIGTERM');
  });
}
