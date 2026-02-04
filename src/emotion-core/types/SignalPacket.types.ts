export interface SentenceData {
  readonly text: string;
  readonly position: number;
  readonly esScore: number;
  readonly arousalScore: number;
}

export interface SignalPacket {
  readonly messageText: string;
  readonly sentences: readonly SentenceData[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}
