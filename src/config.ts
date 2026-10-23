import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { DESKTOP_ORIGIN } from './shared/desktop.js';
import { object, text } from './shared/errors.js';
import type { Project } from './shared/sessions.js';

export interface HomeAssistantConfig {
  url: string;
  /** notify.mobile_app_* action name without the notify. prefix. */
  service: string;
}

export interface Config {
  host: string;
  port: number;
  origins: string[];
  projectRoots: string[];
  piSessionRoots: string[];
  projects: Project[];
  homeAssistant?: HomeAssistantConfig;
}

export function loadConfig(path: string, homeDirectory = homedir()): Config {
  const raw = object(JSON.parse(readFileSync(path, 'utf8')));
  if (raw.projects !== undefined) {
    throw new Error('Replace projects with projectRoots, for example ["~/Projects"]');
  }
  if (!Array.isArray(raw.projectRoots) || raw.projectRoots.length === 0) {
    throw new Error('Configure at least one project root in projectRoots');
  }
  const roots = new Set<string>();
  for (const value of raw.projectRoots) {
    const input = text(value, 'project root', 4096);
    const directory =
      input === '~'
        ? homeDirectory
        : input.startsWith('~/')
          ? join(homeDirectory, input.slice(2))
          : input;
    if (!isAbsolute(directory)) {
      throw new Error(`Project roots must be absolute or start with ~/: ${input}`);
    }
    try {
      const canonical = realpathSync(directory);
      if (!statSync(canonical).isDirectory()) {
        throw new Error('Not a directory');
      }
      roots.add(canonical);
    } catch (error) {
      throw new Error(`Project root is unavailable: ${input}`, { cause: error });
    }
  }
  const discovered = new Map<string, Project>();
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const path = join(root, entry.name);
      try {
        if (!statSync(path).isDirectory()) {
          continue;
        }
        const directory = realpathSync(path);
        // Configured roots are containers, not projects. Canonical aliases occur only once.
        if (!roots.has(directory) && !discovered.has(directory)) {
          discovered.set(directory, {
            id: createHash('sha256').update(directory).digest('hex'),
            name: basename(directory),
            directory,
          });
        }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue; // Ignore dangling links or folders removed during discovery.
        }
        throw new Error(`Cannot inspect project folder: ${path}`, { cause: error });
      }
    }
  }
  const projects = [...discovered.values()].sort((a, b) => a.directory.localeCompare(b.directory));
  const host = raw.host ?? '0.0.0.0';
  if (typeof host !== 'string' || !isIP(host)) {
    throw new Error('Host must be an IPv4 or IPv6 bind address');
  }
  const port = raw.port ?? 3141;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port');
  }
  const origins = raw.origins ?? [];
  if (!Array.isArray(origins) || origins.some((origin) => typeof origin !== 'string')) {
    throw new Error('Invalid origins');
  }
  for (const origin of origins) {
    if (
      origin !== DESKTOP_ORIGIN &&
      (new URL(origin).origin !== origin || !/^https?:/.test(origin))
    ) {
      throw new Error(`Origins must be exact HTTP(S) origins or ${DESKTOP_ORIGIN}`);
    }
  }
  const sessionRoots = raw.piSessionRoots ?? [join(homeDirectory, '.pi', 'agent', 'sessions')];
  if (!Array.isArray(sessionRoots)) {
    throw new Error('piSessionRoots must be an array of directory paths');
  }
  const piSessionRoots = new Set<string>();
  for (const value of sessionRoots) {
    const input = text(value, 'Pi session root', 4096);
    const directory =
      input === '~'
        ? homeDirectory
        : input.startsWith('~/')
          ? join(homeDirectory, input.slice(2))
          : input;
    if (!isAbsolute(directory)) {
      throw new Error('Pi session roots must be absolute or start with ~/');
    }
    try {
      const canonical = realpathSync(directory);
      if (!statSync(canonical).isDirectory()) {
        throw new Error('Pi session root is not a directory');
      }
      piSessionRoots.add(canonical);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        piSessionRoots.add(resolve(directory));
      } else {
        throw error;
      }
    }
  }
  let homeAssistant: HomeAssistantConfig | undefined;
  if (raw.homeAssistant !== undefined) {
    const settings = object(raw.homeAssistant);
    const url = new URL(text(settings.url, 'Home Assistant URL', 2048));
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error('Home Assistant URL must be an HTTP(S) origin without credentials');
    }
    const service = text(settings.service, 'Home Assistant notification service', 256);
    if (!/^mobile_app_[a-z0-9_]+$/.test(service)) {
      throw new Error('Home Assistant service must be a mobile_app_* notification service');
    }
    homeAssistant = { url: url.origin, service };
  }
  return {
    host,
    port,
    origins,
    projectRoots: [...roots].sort(),
    piSessionRoots: [...piSessionRoots].sort(),
    projects,
    ...(homeAssistant ? { homeAssistant } : {}),
  };
}
