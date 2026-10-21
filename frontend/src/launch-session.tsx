import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LoaderCircle, Plus } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { projects } from './api';
import { launches } from './client';
import { ConfirmButton } from './components/confirm-button';
import { Button } from './components/ui/button';

export function LaunchSession({
  projectId,
  resumeId,
  compact = false,
}: {
  projectId?: string;
  resumeId?: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const [selected, setSelected] = useState(projectId ?? '');
  const state = useSyncExternalStore(launches.subscribe, () => launches.getState(resumeId));
  const pending = state.status === 'pending';
  const uncertain = state.status === 'uncertain';
  async function start() {
    const session = await launches.start(projectId ?? selected, resumeId);
    if (session) {
      void navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
        params: { projectId: session.projectId, sessionId: session.id },
      });
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {!resumeId && !projectId && (
        <select
          aria-label="Project for new session"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={selected}
          disabled={pending}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose project</option>
          {projectQuery.data?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}
      {resumeId ? (
        <ConfirmButton
          key={resumeId}
          variant="outline"
          size="sm"
          disabled={state.status !== 'ready' || !(projectId ?? selected)}
          message="Resume this saved session? Confirm no Pi process outside Pim is still using it. Pim checks its own tmux runtimes, but cannot detect every external writer."
          confirmLabel="Resume session"
          onConfirm={() => void start()}
        >
          {pending ? 'Waiting for Pi…' : 'Resume session'}
        </ConfirmButton>
      ) : (
        <Button
          type="button"
          variant="outline"
          size={compact ? 'icon' : 'sm'}
          className={compact ? 'project-new-session' : undefined}
          aria-label={
            compact
              ? `New session in ${projectQuery.data?.find((project) => project.id === projectId)?.name ?? 'project'}`
              : undefined
          }
          title={compact ? 'New session in this project' : undefined}
          disabled={state.status !== 'ready' || !(projectId ?? selected)}
          onClick={() => void start()}
        >
          {compact ? (
            pending ? (
              <LoaderCircle size={15} className="working-icon" aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )
          ) : pending ? (
            'Waiting for Pi…'
          ) : (
            'New session'
          )}
        </Button>
      )}
      {state.error && (
        <p className="error text-xs" role="alert">
          {state.error.message}
        </p>
      )}
      {uncertain && !compact && (
        <div className="text-xs" role="status">
          <p>Launch outcome unknown. Inspect recent sessions and tmux -L pim list-sessions.</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => launches.review(resumeId)}>
            I inspected the runtimes
          </Button>
        </div>
      )}
    </div>
  );
}
