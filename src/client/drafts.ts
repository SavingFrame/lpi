import { type ImageAttachment, imageAttachments } from '../shared/attachments.ts';
import { record } from '../shared/client-state.ts';
import type { BridgeCommand } from '../shared/commands.ts';
import { type ClientStorage, clientStorageKey, serializedStorage } from './storage.ts';

export interface ComposerDraft {
  text: string;
  images: ImageAttachment[];
}

export function composerCommand(draft: ComposerDraft, running: boolean): BridgeCommand {
  return {
    type: running ? 'steer' : 'prompt',
    message: draft.text.trim() ? draft.text : '',
    images: draft.images,
  };
}

/** Navigation may fill an empty composer, but never replaces an unsent draft. */
export function restoreComposerDraft(
  current: ComposerDraft,
  restored: ComposerDraft,
): ComposerDraft {
  return current.text.length > 0 || current.images.length > 0 ? current : restored;
}

/** Clear only accepted content, preserving edits made while acceptance was pending. */
export function settleComposerDraft(
  current: ComposerDraft,
  submitted: ComposerDraft,
  accepted: boolean,
): ComposerDraft {
  if (!accepted) {
    return current;
  }
  return {
    text: current.text === submitted.text ? '' : current.text,
    images: current.images === submitted.images ? [] : current.images,
  };
}

export interface DraftState {
  draft: ComposerDraft;
  loading: boolean;
  saving: boolean;
  error: Error | null;
}

export interface DraftEnvironment {
  server: string;
  storage: ClientStorage;
  persistImages: boolean;
}

export class DraftController {
  private current: DraftState = {
    draft: { text: '', images: [] },
    loading: true,
    saving: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly storage: ClientStorage;
  private readonly key: string;
  private readonly persistImages: boolean;
  private initialization: Promise<void> | null = null;
  private write: Promise<void> = Promise.resolve();
  private revision = 0;
  private writeVersion = 0;
  private loaded = false;
  private restored: { draft: ComposerDraft; revision: number } | null = null;

  constructor(id: string, environment: DraftEnvironment) {
    this.key = clientStorageKey(environment.server, 'draft', id);
    this.storage = serializedStorage(environment.storage);
    this.persistImages = environment.persistImages;
  }

  getState = (): DraftState => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(state: DraftState): void {
    this.current = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  initialize = (): Promise<void> => {
    if (!this.initialization) {
      this.notify({ ...this.current, loading: true, error: null });
      this.initialization = this.load();
    }
    return this.initialization;
  };

  private async load(): Promise<void> {
    try {
      const value = await this.storage.getItem(this.key);
      let draft: ComposerDraft = { text: '', images: [] };
      if (value !== null) {
        const raw = record(JSON.parse(value));
        if (typeof raw.text !== 'string') {
          throw new Error('Invalid saved draft');
        }
        draft = { text: raw.text, images: this.persistImages ? imageAttachments(raw.images) : [] };
      }
      // A user edit, including intentional deletion, wins over delayed storage hydration.
      if (this.revision > 0) {
        draft = this.current.draft;
      }
      if (this.restored && this.restored.revision === this.revision) {
        draft = restoreComposerDraft(draft, this.restored.draft);
      }
      this.loaded = true;
      this.notify({ draft, loading: false, saving: false, error: null });
      if (this.revision > 0 || this.restored) {
        this.persist();
      }
      this.restored = null;
    } catch (error) {
      this.initialization = null;
      this.notify({
        ...this.current,
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  update = (change: (current: ComposerDraft) => ComposerDraft): void => {
    const draft = change(this.current.draft);
    if (draft === this.current.draft) {
      return;
    }
    this.revision++;
    this.notify({ ...this.current, draft });
    if (this.loaded) {
      this.persist();
    }
  };

  restore = (draft: ComposerDraft): void => {
    if (!this.loaded) {
      this.restored = { draft, revision: this.revision };
      return;
    }
    this.update((current) => restoreComposerDraft(current, draft));
  };

  settle = (submitted: ComposerDraft, accepted: boolean): void => {
    this.update((current) => settleComposerDraft(current, submitted, accepted));
  };

  private persist(): void {
    const version = ++this.writeVersion;
    const draft = this.current.draft;
    this.notify({ ...this.current, saving: true, error: null });
    this.write = Promise.resolve(
      this.storage.setItem(
        this.key,
        JSON.stringify({ text: draft.text, images: this.persistImages ? draft.images : [] }),
      ),
    ).then(
      () => {
        if (version === this.writeVersion) {
          this.notify({ ...this.current, saving: false, error: null });
        }
      },
      (error: unknown) => {
        if (version === this.writeVersion) {
          this.notify({
            ...this.current,
            saving: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
  }

  retry = async (): Promise<void> => {
    if (!this.loaded) {
      await this.initialize();
    } else {
      this.persist();
      await this.write;
    }
  };

  flush = (): Promise<void> => this.write;
}

/** Keep one registry per server so remounts and late verdicts use the latest draft. */
export class SessionDrafts {
  private readonly drafts = new Map<string, DraftController>();
  private readonly environment: DraftEnvironment;

  constructor(environment: DraftEnvironment) {
    this.environment = environment;
  }

  get = (id: string): DraftController => {
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = new DraftController(id, this.environment);
      this.drafts.set(id, draft);
    }
    return draft;
  };
}
