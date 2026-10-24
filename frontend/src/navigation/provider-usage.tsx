import { Clock3 } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { resetLabel, UsageController, usagePresentation } from '../../../src/client/provider-usage';
import { openAiIconPath } from '../../../src/shared/provider-icon';
import type { UsageAccount } from '../../../src/shared/provider-usage';
import { usage } from '../client/api';

function AccountBadge({
  account,
  online,
  now,
}: {
  account: UsageAccount;
  online: boolean;
  now: number;
}) {
  const view = usagePresentation(account, online, now);
  return (
    <span
      className={`usage-badge usage-${view.tone}`}
      title={`${view.compact}. ${view.rings.map((ring, index) => `${index === 0 ? 'Outer' : 'Inner'}: ${ring.label}, ${ring.usedPercent ?? '?'}% used`).join('. ')}`}
    >
      <span className="usage-gauge" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          {view.rings.map((ring, index) => (
            <g key={index === 0 ? 'short' : 'long'} transform="rotate(-90 24 24)">
              <circle
                cx="24"
                cy="24"
                r={index === 0 ? 21 : 16.5}
                className="usage-ring-track"
                strokeDasharray={ring.usedPercent === null ? '2 3' : undefined}
              />
              <circle
                cx="24"
                cy="24"
                r={index === 0 ? 21 : 16.5}
                className={`usage-ring usage-${ring.tone}`}
                pathLength="100"
                opacity={ring.usedPercent ? 1 : 0}
                strokeDasharray={`${ring.usedPercent ?? 0} 100`}
              />
            </g>
          ))}
          <path
            d={openAiIconPath}
            transform="translate(14 14) scale(.8333333)"
            className="usage-provider-icon"
          />
        </svg>
        {view.outdated && <Clock3 className="usage-outdated-icon" size={13} />}
      </span>
      <span className="usage-badge-copy">
        <strong>{view.used === null ? '?' : `${Number(view.used.toFixed(1))}%`}</strong>
        <small>{account.label}</small>
      </span>
    </span>
  );
}

export function ProviderUsagePanel() {
  const [controller] = useState(() => new UsageController(usage));
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  const now = Date.now();
  return (
    <details className="usage-panel">
      <summary
        aria-label={`Provider usage, used allowance. ${state.accounts.map((account) => usagePresentation(account, state.online, now).compact).join('. ')}`}
      >
        {state.accounts.map((account) => (
          <AccountBadge key={account.id} account={account} online={state.online} now={now} />
        ))}
        {!state.accounts.length && <span>{state.loading ? 'Loading…' : 'Unavailable'}</span>}
      </summary>
      <section className="usage-details" aria-label="Codex account allowances">
        <div className="usage-heading">
          <strong>Provider usage</strong>
          <button type="button" disabled={state.loading} onClick={() => void controller.refresh()}>
            {state.loading ? 'Updating…' : 'Refresh'}
          </button>
        </div>
        <small>Used allowance · outer: short window · inner: weekly</small>
        {state.message && <p>{state.message}</p>}
        {state.accounts.map((account) => {
          const view = usagePresentation(account, state.online, now);
          return (
            <article key={account.id} className={`usage-account usage-${view.tone}`}>
              <AccountBadge account={account} online={state.online} now={now} />
              {view.outdated && <small>Outdated</small>}
              {view.windows.map((window) => (
                <div className="usage-window" key={window.label}>
                  <div className="usage-heading">
                    <span>{window.label} window</span>
                    <span>{Number(window.usedPercent.toFixed(1))}% used</span>
                  </div>
                  <progress
                    max={100}
                    value={window.usedPercent}
                    aria-label={`${account.label} ${window.label} used allowance`}
                  />
                  <small
                    title={window.resetsAt ? new Date(window.resetsAt).toLocaleString() : undefined}
                  >
                    {resetLabel(window, now)}
                  </small>
                </div>
              ))}
              {account.message && <p>{account.message}</p>}
              <small>
                {account.fetchedAt
                  ? `Updated ${new Date(account.fetchedAt).toLocaleString()}`
                  : 'No successful update yet'}
              </small>
            </article>
          );
        })}
        <small>Read-only Pi credentials. Tokens are never refreshed here.</small>
      </section>
    </details>
  );
}
