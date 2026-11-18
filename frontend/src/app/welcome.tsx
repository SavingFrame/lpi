import { useEffect } from 'react';
import { useRelay } from '../client/relay-context';

export function Welcome() {
  const {
    client: { live },
  } = useRelay();
  useEffect(() => live.select(null), [live]);
  return (
    <div className="welcome">
      <img className="welcome-mark" src="/assets/lpi-icon.svg" width={48} height={48} alt="" />
      <p className="eyebrow">LPI / WORKSPACE</p>
      <h1>
        Your sessions,
        <br />
        wherever you need them.
      </h1>
      <p>Create a session, resume saved history, or connect a running native Pi instance.</p>
      <p className="muted">Pi runs the agent. lpi relays history, events, and commands.</p>
    </div>
  );
}
