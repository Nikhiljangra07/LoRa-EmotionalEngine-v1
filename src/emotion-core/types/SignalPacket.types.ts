export interface SentenceData {
  readonly text: string;
  readonly position: number;
  readonly esScore: number;
  readonly arousalScore: number;
}

export interface Layer1Health {
  readonly degraded: boolean;
  readonly reason: string;
  readonly failingAnalyzer?: string;
}

export interface SignalPacket {
  readonly messageText: string;
  readonly sentences: readonly SentenceData[];
  readonly layer1Health: Layer1Health;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
