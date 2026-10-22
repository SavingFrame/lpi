import { type CommandEnvironment, SessionCommands } from '../../../src/client/commands.ts';
import { composerCommand, type DraftController } from '../../../src/client/drafts.ts';
import {
  type AskAnswer,
  askAnswer,
  validateAskAnswer,
} from '../../../src/extension-support/ask-user-question/contract.ts';

/** A session's durable draft and command lane outlive its mounted composer. */
export class MobileMessages {
  readonly commands: SessionCommands;
  readonly draft: DraftController;
  private readonly environment: CommandEnvironment;

  constructor(
    id: string,
    projectId: string,
    draft: DraftController,
    environment: CommandEnvironment,
  ) {
    this.commands = new SessionCommands(id, projectId, environment);
    this.draft = draft;
    this.environment = environment;
  }

  initialize = async (): Promise<void> => {
    await Promise.all([this.commands.initialize(), this.draft.initialize()]);
  };

  answer = async (value: AskAnswer): Promise<boolean> => {
    const answer = askAnswer(value);
    const prompt = this.environment
      .connection()
      .snapshot?.view.extensions['ask-user-question']?.find(
        (item) => item.toolCallId === answer.toolCallId,
      );
    if (!prompt) {
      throw new Error('This questionnaire is no longer open.');
    }
    validateAskAnswer(answer, prompt);
    return this.commands.submit({
      type: 'extension',
      extension: 'ask-user-question',
      action: answer,
    });
  };

  stopRuntime = (generation: number): Promise<boolean> => {
    return this.commands.stopRuntime(generation);
  };

  send = async (): Promise<boolean> => {
    const state = this.draft.getState();
    if (
      state.loading ||
      state.error ||
      (!state.draft.text.trim() && !state.draft.images.length) ||
      !this.commands.available()
    ) {
      return false;
    }
    const submitted = state.draft;
    await this.draft.flush();
    if (this.draft.getState().error) {
      return false;
    }
    const accepted = await this.commands.submit(
      composerCommand(submitted, this.environment.connection().snapshot?.view.running === true),
    );
    this.draft.settle(submitted, accepted);
    return accepted;
  };
}
