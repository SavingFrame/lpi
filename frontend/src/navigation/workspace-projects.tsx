import { Plus } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { Project } from '../../../src/shared/sessions';
import type { WorkspaceRelay } from '../client/controllers';
import { RelayProvider } from '../client/relay-context';
import { useWorkspaceInventory, workspaceKey } from '../client/workspace-inventory';
import { Button } from '../components/ui/button';
import { LaunchSession } from './launch-session';

export interface LaunchTarget {
  relay: WorkspaceRelay;
  project: Project;
  online: boolean;
}

export function ProjectLaunch({
  targets,
  compact,
  onStarted,
}: {
  targets: LaunchTarget[];
  compact?: boolean;
  onStarted?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [selection, setSelection] = useState('');
  const first = targets[0];
  if (!first) {
    return null;
  }
  const targetKey = ({ relay, project }: LaunchTarget) => workspaceKey(relay.profileId, project.id);
  if (targets.length === 1) {
    const { relay, project } = first;
    return (
      <RelayProvider relay={relay}>
        <LaunchSession
          key={targetKey(first)}
          projectId={project.id}
          compact={compact}
          onStarted={onStarted}
        />
      </RelayProvider>
    );
  }
  const target = targets.find((item) => targetKey(item) === selection);
  const chooser = (
    <div className="flex min-w-0 flex-wrap gap-2">
      <select
        aria-label="Project and device for new session"
        className="max-w-full rounded-md border border-input bg-background text-xs"
        value={target ? selection : ''}
        onChange={(event) => setSelection(event.target.value)}
      >
        <option value="">Choose device and project</option>
        {targets.map((item) => (
          <option key={targetKey(item)} value={targetKey(item)} disabled={!item.online}>
            {item.relay.name ? `${item.relay.name}: ` : ''}
            {item.project.directory}
            {!item.online ? ' (unavailable)' : ''}
          </option>
        ))}
      </select>
      {target && (
        <RelayProvider relay={target.relay}>
          <LaunchSession
            key={targetKey(target)}
            projectId={target.project.id}
            onStarted={() => {
              dialog.current?.close();
              setSelection('');
              onStarted?.();
            }}
          />
        </RelayProvider>
      )}
    </div>
  );
  if (!compact) {
    return chooser;
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="project-new-session"
        aria-label={`New session in ${first.project.name}`}
        aria-haspopup="dialog"
        disabled={!targets.some((item) => item.online)}
        onClick={() => dialog.current?.showModal()}
      >
        <Plus size={15} aria-hidden="true" />
      </Button>
      <dialog
        ref={dialog}
        className="keyboard-dialog"
        aria-labelledby={heading}
        onClose={() => setSelection('')}
      >
        <div className="keyboard-dialog-heading">
          <h2 id={heading}>New session in {first.project.name}</h2>
          <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        </div>
        {chooser}
      </dialog>
    </>
  );
}

export function WorkspaceLaunch({
  projectId,
  relay,
  onStarted,
}: {
  projectId?: string;
  relay: WorkspaceRelay;
  onStarted: () => void;
}) {
  const inventory = useWorkspaceInventory();
  if (!relay.profileId) {
    return <LaunchSession key={projectId} projectId={projectId} onStarted={onStarted} />;
  }
  const current = inventory
    .find((item) => item.relay === relay)
    ?.projects?.find((item) => item.id === projectId);
  const targets = inventory.flatMap((item) =>
    (item.projects ?? [])
      .filter((project) => !current || project.name === current.name)
      .map((project) => ({ relay: item.relay, project, online: item.online })),
  );
  return (
    <ProjectLaunch
      key={workspaceKey(relay.profileId, projectId ?? '')}
      targets={targets}
      onStarted={onStarted}
    />
  );
}
