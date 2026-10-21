export interface ServerEvent {
  epoch: string;
  cursor: number;
  sessionId: string;
  generation: number;
  type: string;
  data: unknown;
}
