import { Circle, LoaderCircle, LockKeyhole, MessageCircleQuestion } from 'lucide-react';
import type { SessionActivity } from '../../../src/shared/session-activity';

export const statuses = {
  running: { label: 'Running', icon: LoaderCircle, description: 'Pi is working or compacting.' },
  blocked: {
    label: 'Needs input',
    icon: MessageCircleQuestion,
    description: 'Pi is waiting for input in the browser or terminal.',
  },
  idle: { label: 'Idle', icon: Circle, description: 'Connected and waiting for work.' },
  unknown: {
    label: 'Saved',
    icon: LockKeyhole,
    description: 'Read-only. Live activity is unavailable; Pi may still be running.',
  },
} satisfies Record<SessionActivity, { label: string; icon: typeof Circle; description: string }>;
