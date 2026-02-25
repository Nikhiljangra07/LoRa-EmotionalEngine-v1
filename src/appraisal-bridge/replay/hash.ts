import { createHash } from 'crypto';

export function stableHash(data: unknown): string {
  const json = JSON.stringify(data);
  return createHash('sha256').update(json).digest('hex');
}
