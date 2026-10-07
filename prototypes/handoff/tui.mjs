import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Run inside the private tmux pane. The harness supplies an isolated environment.
const root = process.env.PIM_HANDOFF_ROOT;
const { executable, args } = JSON.parse(readFileSync(join(root, 'tui-command.json'), 'utf8'));
const child = spawn(executable, args, { cwd: root, env: process.env, stdio: 'inherit' });
let killTimer;
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1_500);
  });
}
child.on('error', (error) => {
  writeFileSync(join(root, 'tui-exit.json'), JSON.stringify({ error: String(error) }));
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  clearTimeout(killTimer);
  writeFileSync(join(root, 'tui-exit.json'), JSON.stringify({ code, signal }));
  process.exitCode = code ?? 1;
});
