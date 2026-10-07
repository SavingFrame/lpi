import { AppError } from './errors.js';

export type Phase = 'unowned' | 'starting' | 'rpc' | 'stopping' | 'unknown';

export interface Ownership {
  phase: Phase;
  generation: number;
  pid?: number;
  interrupted: boolean;
}

export type OwnershipEvent =
  | 'claim'
  | 'spawned'
  | 'ready'
  | 'stop'
  | 'exit'
  | 'uncertain'
  | 'confirm-release';

export function transition(
  owner: Ownership,
  event: OwnershipEvent,
  expectedGeneration: number,
  pid?: number,
): Ownership {
  if (owner.generation !== expectedGeneration) {
    throw new AppError('Stale ownership generation');
  }
  const allowed: Record<OwnershipEvent, Phase[]> = {
    claim: ['unowned'],
    spawned: ['starting'],
    ready: ['starting'],
    stop: ['rpc', 'unknown'],
    exit: ['starting', 'rpc', 'stopping', 'unknown'],
    uncertain: ['starting', 'rpc', 'stopping'],
    'confirm-release': ['unknown'],
  };
  if (!allowed[event].includes(owner.phase)) {
    throw new AppError(`Cannot ${event} from ${owner.phase}`);
  }
  const phases: Record<OwnershipEvent, Phase> = {
    claim: 'starting',
    spawned: 'starting',
    ready: 'rpc',
    stop: 'stopping',
    exit: 'unowned',
    uncertain: 'unknown',
    'confirm-release': 'unowned',
  };
  return {
    phase: phases[event],
    generation: owner.generation + 1,
    pid: event === 'exit' || event === 'confirm-release' ? undefined : (pid ?? owner.pid),
    interrupted:
      event === 'uncertain' ||
      event === 'confirm-release' ||
      (event === 'exit' && owner.phase !== 'stopping') ||
      owner.interrupted,
  };
}
