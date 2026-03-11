import type { ProcessMessageInput, MemoryV1State } from './memoryV1EngineTypes';
import type { MemoryContext } from './memoryContextTypes';
import type { MemoryLogEvent } from './decisionLogs';

export type RuntimeMessage = {
  messageId: string;
  tsMs: number;
  input: ProcessMessageInput;
};

export type RuntimeScenario = {
  name: string;
  userId: string;
  sessionId: string;
  nowMs: number;
  messages: RuntimeMessage[];
  endSessionAtMs: number;
};

export type RuntimeRunResult = {
  finalState: MemoryV1State;
  savedPath: string;
  logs: MemoryLogEvent[];
  memoryContexts: Array<{ messageId: string; ctx: MemoryContext | null }>;
};
