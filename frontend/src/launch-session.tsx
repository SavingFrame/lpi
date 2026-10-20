import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError, launch, projects } from './api';
import { live, queryClient } from './client';
import { Button } from './components/ui/button';

export function LaunchSession({ projectId, resumeId }: { projectId?: string; resumeId?: string }) {
  const navigate = useNavigate();
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const [selected, setSelected] = useState(projectId ?? '');
  const key = `launch-uncertain:${resumeId ?? 'new'}`;
  const [uncertain, setUncertain] = useState(() => sessionStorage.getItem(key) === 'true');
  const mutation = useMutation({
    mutationFn: () => {
      sessionStorage.setItem(key, 'true');
      return launch(projectId ?? selected, resumeId);
    },
    onSuccess: (session) => {
      sessionStorage.removeItem(key);
      setUncertain(false);
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
      } else {
        setUncertain(true);
      }
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      live.refresh();
    },
  });
  return (
    <div className="flex flex-col gap-2">
      {!resumeId && (
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
        size="sm"
        disabled={mutation.isPending || uncertain || !(projectId ?? selected)}
        onClick={() => {
          if (
            resumeId &&
            !window.confirm(
              'Resume this saved session? Confirm no Pi process outside Pim is still using it. Pim checks its own tmux runtimes, but cannot detect every external writer.',
            )
          ) {
            return;
          }
          mutation.mutate();
        }}
      >
        {mutation.isPending ? 'Waiting for Pi…' : resumeId ? 'Resume session' : 'New session'}
      </Button>
      {mutation.error && (
        <p className="error text-xs" role="alert">
          {mutation.error.message}
        </p>
      )}
      {uncertain && (
        <div className="text-xs" role="status">
          <p>Launch outcome unknown. Inspect recent sessions and tmux -L pim list-sessions.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              sessionStorage.removeItem(key);
              setUncertain(false);
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
