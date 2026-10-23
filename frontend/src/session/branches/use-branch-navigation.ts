import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionCommands } from '../../../../src/client/commands';
import type { ComposerDraft } from '../../../../src/client/drafts';
import { previewBranch } from '../../client/api';
import { live, queryClient } from '../../client/controllers';
import { branchAction, branchSelections, navigateBranch } from './branch-navigation';

export function useBranchNavigation(
  id: string,
  projectId: string,
  branch: string | undefined,
  commands: Pick<SessionCommands, 'available' | 'submit'>,
) {
  const navigate = useNavigate();
  const [restoredDraft, setRestoredDraft] = useState<ComposerDraft | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const selectionRequest = useSyncExternalStore(
    branchSelections.subscribe,
    branchSelections.getState,
  );
  const selection = useRef({ branch, active: false });
  useEffect(() => {
    setNavigationPending(false);
    setNavigationError(null);
    const current = { branch, active: true };
    selection.current = current;
    return () => {
      current.active = false;
      queueMicrotask(() => {
        if (
          current.branch &&
          (!selection.current.active || selection.current.branch !== current.branch)
        ) {
          branchSelections.discard(id, current.branch);
        }
      });
    };
  }, [branch, id]);
  const preview = useQuery({
    queryKey: ['branch', id, branch],
    queryFn: ({ signal }) => previewBranch(id, branch ?? '', signal),
    enabled: Boolean(branch),
    retry: false,
  });
  const selectBranch = useCallback(
    (entryId?: string) => {
      if (entryId) {
        branchSelections.request(
          id,
          entryId,
          branchAction(live.getState(), id, projectId, entryId, commands.available()),
        );
      }
      return navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
        params: { projectId, sessionId: id },
        search: entryId ? { branch: entryId } : {},
      });
    },
    [id, projectId, commands.available, navigate],
  );
  useEffect(() => {
    if (!branch || selectionRequest?.sessionId !== id || selectionRequest.entryId !== branch) {
      return;
    }
    // Defer consuming click intent until StrictMode effect setup/cleanup has completed.
    queueMicrotask(() => {
      if (!selection.current.active || selection.current.branch !== branch) {
        return;
      }
      const intent = branchSelections.take(id, branch);
      if (!intent) {
        return;
      }
      const selected = selection.current;
      const current = () =>
        selected.active && selected === selection.current && branchSelections.isLatest(intent);
      setNavigationPending(true);
      setNavigationError(null);
      void navigateBranch(intent, projectId, {
        connection: live.getState,
        available: commands.available,
        current,
        preview: (sessionId, entryId) =>
          queryClient.fetchQuery({
            queryKey: ['branch', sessionId, entryId],
            queryFn: ({ signal }) => previewBranch(sessionId, entryId, signal),
            retry: false,
          }),
        submit: commands.submit,
      })
        .then((result) => {
          if (!current() || (result.type !== 'current' && result.type !== 'switched')) {
            return;
          }
          if (result.type === 'switched' && result.draft) {
            setRestoredDraft(result.draft);
          }
          void navigate({
            to: '/app/projects/$projectId/sessions/$sessionId',
            params: { projectId, sessionId: id },
            search: {},
            replace: true,
          });
        })
        .catch((error: unknown) => {
          if (current()) {
            setNavigationError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (current()) {
            setNavigationPending(false);
          }
        });
    });
  }, [branch, id, projectId, selectionRequest, commands.available, commands.submit, navigate]);
  return { preview, selectBranch, restoredDraft, navigationPending, navigationError };
}
