import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LoaderCircle, Plus } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { ApiError, launch, projects } from './api';
import { live, queryClient } from './client';
import { Button } from './components/ui/button';

const pendingLaunches = new Set<string>();
const launchListeners = new Set<() => void>();
const subscribeLaunch = (listener: () => void) => {
  launchListeners.add(listener);
  return () => launchListeners.delete(listener);
};
const notifyLaunch = () => {
  for (const listener of launchListeners) {
    listener();
  }
};

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
  const key = `launch-uncertain:${resumeId ?? 'new'}`;
  const launchState = useSyncExternalStore(subscribeLaunch, () =>
    pendingLaunches.has(key)
      ? 'pending'
      : sessionStorage.getItem(key) === 'true'
        ? 'uncertain'
        : 'ready',
  );
  const uncertain = launchState === 'uncertain';
  const mutation = useMutation({
    mutationFn: () => launch(projectId ?? selected, resumeId),
    onSuccess: (session) => {
      sessionStorage.removeItem(key);
      pendingLaunches.delete(key);
      notifyLaunch();
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
        params: { projectId: session.projectId, sessionId: session.id },
      });
      live.refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.outcome === 'rejected') {
        sessionStorage.removeItem(key);
      }
      pendingLaunches.delete(key);
      notifyLaunch();
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      live.refresh();
    },
  });
  return (
    <div className="flex flex-col gap-2">
      {!resumeId && !projectId && (
        <select
          aria-label="Project for new session"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={selected}
          disabled={mutation.isPending}
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
        disabled={launchState !== 'ready' || !(projectId ?? selected)}
        onClick={() => {
          if (
            resumeId &&
            !window.confirm(
              'Resume this saved session? Confirm no Pi process outside Pim is still using it. Pim checks its own tmux runtimes, but cannot detect every external writer.',
            )
          ) {
            return;
          }
          if (pendingLaunches.has(key) || sessionStorage.getItem(key) === 'true') {
            return;
          }
          pendingLaunches.add(key);
          sessionStorage.setItem(key, 'true');
          notifyLaunch();
          mutation.mutate();
        }}
      >
        {compact ? (
          mutation.isPending ? (
            <LoaderCircle size={15} className="working-icon" aria-hidden="true" />
          ) : (
            <Plus size={15} aria-hidden="true" />
          )
        ) : mutation.isPending ? (
          'Waiting for Pi…'
        ) : resumeId ? (
          'Resume session'
        ) : (
          'New session'
        )}
      </Button>
      {mutation.error && (
        <p className="error text-xs" role="alert">
          {mutation.error.message}
        </p>
      )}
      {uncertain && !compact && (
        <div className="text-xs" role="status">
          <p>Launch outcome unknown. Inspect recent sessions and tmux -L pim list-sessions.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              sessionStorage.removeItem(key);
              notifyLaunch();
              mutation.reset();
            }}
          >
            I inspected the runtimes
          </Button>
        </div>
      )}
    </div>
  );
}
