import { PostHog } from 'posthog-node';

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (client) return client;
  const key = process.env.POSTHOG_API_KEY;
  if (!key) return null;
  client = new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 10,
    flushInterval: 30_000,
  });
  return client;
}

export function trackSessionStarted(userId: string, sessionId: string): void {
  getClient()?.capture({
    distinctId: userId,
    event: 'session_started',
    properties: { sessionId, $set: { last_session_at: new Date().toISOString() } },
  });
}

export function trackMessageSent(
  userId: string,
  sessionId: string,
  props: {
    messageIndex: number;
    tier: string;
    etvBand: string;
    eiv: number;
    anchorsUsed: number;
    replyLengthChars: number;
    tokensEstimated: number;
  },
): void {
  getClient()?.capture({
    distinctId: userId,
    event: 'message_sent',
    properties: { sessionId, ...props },
  });
}

export function trackSessionEnded(
  userId: string,
  sessionId: string,
  props: {
    messagesCount: number;
    durationSeconds: number;
    tokensUsed: number;
    reason: 'new_session' | 'session_cap' | 'server_shutdown' | 'idle_timeout';
  },
): void {
  getClient()?.capture({
    distinctId: userId,
    event: 'session_ended',
    properties: { sessionId, ...props },
  });
}

export function trackTierChanged(
  userId: string,
  props: { previousTier: string; newTier: string; sessionCount: number },
): void {
  getClient()?.capture({
    distinctId: userId,
    event: 'tier_changed',
    properties: props,
  });
}

export async function shutdownPosthog(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
