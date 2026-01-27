import type { ExpressionStrengthResult } from "../types/ExpressionStrength";

export type LogExpressionStrengthOptions = {
  logger?: (message: string) => void;
};

const formatNumber = (value: number): string => {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return "0";
  }
  return value.toFixed(3);
};

export function logExpressionStrength(
  text: string,
  result: ExpressionStrengthResult,
  options: LogExpressionStrengthOptions = {}
): void {
  const logger = options.logger ?? console.log;
  const safeText = text ?? "";
  const breakdownEntries = Object.entries(result.breakdown ?? {})
    .map(([key, value]) => `${key}=${formatNumber(value)}`)
    .join(", ");

  const message = `[ES] score=${formatNumber(result.es)} text="${safeText}" breakdown={${breakdownEntries}}`;
  logger(message);
}
