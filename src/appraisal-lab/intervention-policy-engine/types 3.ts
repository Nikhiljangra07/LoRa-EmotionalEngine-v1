export type ToneMode =
  | "NEUTRAL"
  | "DE_ESCALATE"
  | "FIRM_CONTAIN"
  | "REFLECTIVE"
  | "STABILIZE"
  | "AFFIRM_BOUNDARIED";

export type PacingMode =
  | "NORMAL"
  | "SLOW"
  | "DELAYED_RESPONSE"
  | "SHORT_DIRECT";

export type ValidationMode =
  | "STANDARD"
  | "LIMITED"
  | "BOUNDARIED"
  | "SUPPORTIVE";

export type ActionMode =
  | "NONE"
  | "INTERRUPT_LOOP"
  | "SHIFT_TO_REFLECTION"
  | "ENCOURAGE_PAUSE";

export type InterventionPolicy = {
  toneMode: ToneMode;
  pacingMode: PacingMode;
  validationMode: ValidationMode;
  actionMode: ActionMode;
  interruptionLevel: 0 | 1 | 2 | 3;
  guardrails: string[];
  reasons: string[];
};

export type InterventionInputs = {
  escalationLevel: number;
  escalationScore: number;
  collapseEvent: boolean;
  collapseDirection: string;
  postModeActive: boolean;
  recoveryPath: "SPIRAL" | "SUBSTITUTE" | "UNKNOWN";
  agencyDeficit: number;
  moodCategory?: string;
};
