import { Terminal } from 'lucide-react';
import { useEffect } from 'react';
import { live } from '../client/controllers';

export function Welcome() {
  useEffect(() => live.select(null), []);
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <Terminal size={24} aria-hidden="true" />
      </div>
      <p className="eyebrow">PIM / WORKSPACE</p>
      <h1>
        Your sessions,
        <br />
        on your PC.
      </h1>
      <p>Create a session, resume saved history, or connect a running native Pi instance.</p>
      <p className="muted">Pi runs the agent. Pim relays history, events, and commands.</p>
    </div>
  );
}
