import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '../config.js';
import { AppError, generation, object, text } from '../errors.js';
import type { Ownership, OwnershipEvent, Phase } from '../ownership.js';
import { transition } from '../ownership.js';
import { atomicJson } from './files.js';

export interface Session {
  id: string;
  projectId: string;
  directory: string;
  file: string;
  createdAt: string;
  /** Read-only discovered Pi files are not registered in the ownership catalog. */
  source?: 'pi';
  piSessionId?: string;
  ownership: Ownership;
}

export class Catalog {
  private readonly path: string;
  private readonly root: string;
  private sessions: Session[] = [];

  constructor(root: string, projects: Project[]) {
    this.root = root;
    this.path = join(root, 'catalog.json');
    if (!existsSync(this.path)) {
      return;
    }
    const data = object(JSON.parse(readFileSync(this.path, 'utf8')));
    if (data.version !== 1 || !Array.isArray(data.sessions)) {
      throw new Error('Unsupported catalog');
    }
    const ids = new Set<string>();
    this.sessions = data.sessions.map((value): Session => {
      const raw = object(value);
      const id = text(raw.id, 'session ID', 64);
      const projectId = text(raw.projectId, 'project ID', 64);
      if (!/^[a-f0-9-]{36}$/.test(id) || ids.has(id)) {
        throw new Error('Invalid or duplicate session ID');
      }
      if (
        !projects.some((project) => project.id === projectId && project.directory === raw.directory)
      ) {
        throw new Error(`Missing or relocated configured project: ${projectId}`);
      }
      ids.add(id);
      const file = join(root, 'sessions', id, 'session.jsonl');
      if (raw.file !== file) {
        throw new Error('Catalog session path mismatch');
      }
      const owner = object(raw.ownership);
      const phase = text(owner.phase, 'ownership phase');
      if (
        !['unowned', 'starting', 'rpc', 'stopping', 'unknown'].includes(phase) ||
        typeof owner.interrupted !== 'boolean' ||
        (owner.pid !== undefined &&
          (typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid < 1))
      ) {
        throw new Error('Invalid ownership record');
      }
      return {
        id,
        projectId,
        directory: text(raw.directory, 'project directory'),
        file,
        createdAt: text(raw.createdAt, 'creation time'),
        ownership: {
          phase: phase as Phase,
          generation: generation(owner.generation),
          pid: owner.pid as number | undefined,
          interrupted: owner.interrupted,
        },
      };
    });
    // Restart is not evidence that an orphaned runtime exited.
    this.sessions = this.sessions.map((session) => ({
      ...session,
      ownership:
        session.ownership.phase === 'unowned' || session.ownership.phase === 'unknown'
          ? session.ownership
          : {
              ...session.ownership,
              phase: 'unknown',
              interrupted: true,
              generation: session.ownership.generation + 1,
            },
    }));
    this.persist(this.sessions);
  }

  list(): Session[] {
    return structuredClone(this.sessions);
  }

  get(id: string): Session {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) {
      throw new AppError('Session not found', 404);
    }
    return structuredClone(session);
  }

  create(project: Project): Session {
    if (this.sessions.length >= 10_000) {
      throw new AppError('Session catalog limit reached', 503);
    }
    const id = randomUUID();
    const directory = join(this.root, 'sessions', id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const session: Session = {
      id,
      projectId: project.id,
      directory: project.directory,
      file: join(directory, 'session.jsonl'),
      createdAt: new Date().toISOString(),
      ownership: { phase: 'unowned', generation: 0, interrupted: false },
    };
    // A normal v3 header avoids relying on deferred first-message persistence.
    atomicJson(session.file, {
      type: 'session',
      version: 3,
      id,
      timestamp: session.createdAt,
      cwd: project.directory,
    });
    const next = [...this.sessions, session];
    this.persist(next);
    this.sessions = next;
    return structuredClone(session);
  }

  change(id: string, event: OwnershipEvent, expected: number, pid?: number): Session {
    const current = this.get(id);
    const next = { ...current, ownership: transition(current.ownership, event, expected, pid) };
    const sessions = this.sessions.map((session) => (session.id === id ? next : session));
    this.persist(sessions);
    this.sessions = sessions;
    return structuredClone(next);
  }

  private persist(sessions: Session[]): void {
    atomicJson(this.path, { version: 1, sessions });
  }
}
