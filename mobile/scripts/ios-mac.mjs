import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, mkdirSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaults = {
  ssh: 'user@192.168.100.209',
  dir: '/Users/user/Projects/pim-mobile-test.VdZTqa',
  host: '192.168.100.209',
  socket: '/tmp/claude-tmux-sockets/pim-mobile.sock',
  session: 'pim-mobile-metro',
  expoGo: '58.0.5',
};
const commands = ['status', 'sync', 'start', 'open', 'run', 'screenshot', 'logs'];

export function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function selectDevice(devices, id) {
  const available = Object.values(devices)
    .flat()
    .filter((device) => device.isAvailable);
  const candidates = id
    ? available.filter((device) => device.udid === id)
    : available.filter((device) => device.state === 'Booted');
  if (candidates.length !== 1) {
    throw new Error('Select exactly one simulator: boot it in Device Hub or set PIM_IOS_DEVICE.');
  }
  return candidates[0];
}

export function syncArgs(root, destination) {
  return [
    '-az',
    ...['node_modules/', 'dist/', '.expo/', '.tools/', 'expo-env.d.ts', '.env', '.env.*'].map(
      (pattern) => `--exclude=${pattern}`,
    ),
    ...['package.json', 'package-lock.json', 'mobile/***', 'src/***', 'README.md', 'PLAN.md'].map(
      (pattern) => `--include=/${pattern}`,
    ),
    '--exclude=*',
    `${root}/`,
    destination,
  ];
}

function execute(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${program} failed (${result.status}): ${result.stderr || result.stdout || ''}`,
    );
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.stdout?.trim() || '';
}

async function metro(config) {
  const listener = spawnSync('lsof', ['-nP', '-iTCP:8081', '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (listener.status === 1) {
    return false;
  }
  if (listener.status !== 0) {
    throw new Error('Cannot inspect port 8081 with lsof.');
  }
  const response = await fetch('http://127.0.0.1:8081/', {
    headers: { 'expo-platform': 'ios', accept: 'application/expo+json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error('Port 8081 is occupied, but not serving the expected Expo project.');
  }
  const manifest = await response.json();
  const project = manifest.extra?.expoGo?.developer?.projectRoot;
  if (
    typeof project !== 'string' ||
    realpathSync(project) !== realpathSync(join(config.dir, 'mobile'))
  ) {
    throw new Error('Port 8081 belongs to a different project. Leave it running.');
  }
  return true;
}

async function remote(command, config) {
  process.env.PATH = `${config.dir}/.tools/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  process.chdir(config.dir);
  const tmux = ['-S', config.socket];
  if (command === 'check') {
    accessSync(join(config.dir, 'mobile/package.json'));
  } else if (command === 'status') {
    console.log(
      `Node ${process.version}\n${execute('xcrun', ['simctl', 'list', 'devices', 'booted'])}`,
    );
    console.log(
      (await metro(config)) ? 'Metro: expected Pim project on port 8081' : 'Metro: stopped',
    );
  } else if (command === 'start') {
    if (await metro(config)) {
      console.log('Reusing existing Pim Metro on port 8081.');
    } else {
      for (const file of ['node_modules', '.tools/npm-user.conf', '.tools/npm-global.conf']) {
        accessSync(join(config.dir, file));
      }
      if (spawnSync('tmux', [...tmux, 'has-session', '-t', config.session]).status === 0) {
        throw new Error(
          'Metro session exists but is not healthy. Inspect logs; no server was started.',
        );
      }
      mkdirSync(dirname(config.socket), { recursive: true });
      const launch = [
        'env',
        '-u',
        'EXPO_TOKEN',
        '-u',
        'CI',
        `PATH=${process.env.PATH}`,
        `NPM_CONFIG_USERCONFIG=${config.dir}/.tools/npm-user.conf`,
        `NPM_CONFIG_GLOBALCONFIG=${config.dir}/.tools/npm-global.conf`,
        `__UNSAFE_EXPO_HOME_DIRECTORY=${config.dir}/.tools/expo-home`,
        'EXPO_NO_TELEMETRY=1',
        'EXPO_NO_DOTENV=1',
        'npm',
        'run',
        'start',
        '--workspace',
        '@pim/mobile',
        '--',
        '--go',
        '--host',
        'lan',
        '--port',
        '8081',
      ]
        .map(quote)
        .join(' ');
      execute('tmux', [
        '-f',
        '/dev/null',
        ...tmux,
        'new-session',
        '-d',
        '-s',
        config.session,
        '-c',
        config.dir,
        launch,
      ]);
      console.log('Started Pim Metro.');
    }
    console.log(
      `Monitor: ssh -t ${config.ssh} ${quote(`tmux -S ${quote(config.socket)} attach -t ${quote(config.session)}`)}`,
    );
  } else if (command === 'logs') {
    console.log(
      execute('tmux', [
        ...tmux,
        'capture-pane',
        '-p',
        '-J',
        '-t',
        `${config.session}:0.0`,
        '-S',
        '-80',
      ]),
    );
  } else if (command === 'clean-screenshot') {
    unlinkSync(`/tmp/pim-ios-${config.token}.png`);
  } else {
    const listing = JSON.parse(
      execute('xcrun', ['simctl', 'list', 'devices', 'available', '--json']),
    );
    const device = selectDevice(listing.devices, config.device);
    if (command === 'screenshot') {
      if (device.state !== 'Booted') {
        throw new Error('The selected simulator is not booted.');
      }
      execute('xcrun', [
        'simctl',
        'io',
        device.udid,
        'screenshot',
        `/tmp/pim-ios-${config.token}.png`,
      ]);
      return;
    }
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await metro(config)) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) {
      throw new Error('Metro is not ready. Run start or inspect logs.');
    }
    if (device.state !== 'Booted') {
      execute('xcrun', ['simctl', 'boot', device.udid]);
    }
    execute('xcrun', ['simctl', 'bootstatus', device.udid, '-b']);
    const installed = spawnSync(
      'xcrun',
      ['simctl', 'get_app_container', device.udid, 'host.exp.Exponent', 'app'],
      { encoding: 'utf8' },
    );
    const sdk = JSON.parse(readFileSync('mobile/package.json', 'utf8')).dependencies.expo.split(
      '.',
    )[0];
    const version =
      installed.status === 0
        ? execute('plutil', [
            '-extract',
            'CFBundleShortVersionString',
            'raw',
            '-o',
            '-',
            `${installed.stdout.trim()}/Info.plist`,
          ])
        : '';
    if (version.split('.')[0] !== sdk) {
      if (config.expoGo.split('.')[0] !== sdk) {
        throw new Error(
          'The prepared Expo Go cache does not match this SDK. Update the test setup explicitly.',
        );
      }
      const app = join(
        config.dir,
        `.tools/expo-home/ios-simulator-app-cache/Expo-Go-${config.expoGo}.tar.app`,
      );
      accessSync(app);
      execute('xcrun', ['simctl', 'install', device.udid, app]);
    }
    execute('xcrun', [
      'simctl',
      'openurl',
      device.udid,
      `exp://${config.host}:8081?__expo_disable_fab=1&__expo_disable_auto_launch=1&__expo_disable_onboarding=1`,
    ]);
    execute('open', [`devices://device/open?id=${device.udid}`]);
    console.log(
      `Launch requested on ${device.name} (${device.udid}). Tap Open if iOS asks to open Expo Go.`,
    );
  }
}

async function main() {
  const [command = '--help', output] = process.argv.slice(2);
  if (command === '--help') {
    console.log(
      `Usage: node mobile/scripts/ios-mac.mjs <${commands.join('|')}> [screenshot.png]\nrun = sync + start + open. Uses the prepared Mac, not a provisioning workflow.\nOverrides: PIM_IOS_SSH, PIM_IOS_DIR, PIM_IOS_HOST, PIM_IOS_DEVICE.`,
    );
    return;
  }
  if (
    !commands.includes(command) ||
    (output && command !== 'screenshot') ||
    process.argv.length > 4
  ) {
    throw new Error('Invalid command or arguments. Use --help.');
  }
  const config = {
    ...defaults,
    ssh: process.env.PIM_IOS_SSH || defaults.ssh,
    dir: process.env.PIM_IOS_DIR || defaults.dir,
    host: process.env.PIM_IOS_HOST || defaults.host,
    device: process.env.PIM_IOS_DEVICE || '',
    token: randomUUID(),
  };
  if (
    !/^[\w.-]+@[\w.-]+$/.test(config.ssh) ||
    !/^\/[\w./-]+$/.test(config.dir) ||
    !/^[\w.-]+$/.test(config.host)
  ) {
    throw new Error('Use user@host, a simple absolute remote path, and a LAN hostname/IP.');
  }
  const self = fileURLToPath(import.meta.url);
  const source = readFileSync(self, 'utf8');
  const call = (action) => {
    const args = [
      `${config.dir}/.tools/node/bin/node`,
      '--input-type=module',
      '-',
      '--remote',
      action,
      JSON.stringify(config),
    ];
    const text = execute(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', config.ssh, args.map(quote).join(' ')],
      { input: source },
    );
    if (text) {
      console.log(text);
    }
  };
  if (command === 'sync' || command === 'run') {
    call('check');
    execute('rsync', syncArgs(resolve(dirname(self), '../..'), `${config.ssh}:${config.dir}/`));
    console.log(
      'Source synced without deletion. If dependencies changed, stop Metro and update the remote install explicitly.',
    );
  }
  if (command === 'run') {
    call('start');
    call('open');
  } else if (command === 'screenshot') {
    call('screenshot');
    const destination = resolve(output || join(tmpdir(), `pim-ios-${config.token}.png`));
    try {
      execute('scp', [
        '-q',
        '-o',
        'BatchMode=yes',
        `${config.ssh}:/tmp/pim-ios-${config.token}.png`,
        destination,
      ]);
      console.log(destination);
    } finally {
      call('clean-screenshot');
    }
  } else if (command !== 'sync') {
    call(command);
  }
}

if (process.argv[2] === '--remote') {
  await remote(process.argv[3], JSON.parse(process.argv[4]));
} else if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
