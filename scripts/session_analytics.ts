/**
 * Session Analytics — parses Railway logs (stdin or file) and outputs JSON analytics.
 *
 * Usage:
 *   npx ts-node scripts/session_analytics.ts < railway_logs.txt
 *   npx ts-node scripts/session_analytics.ts railway_logs.txt
 *   # Paste logs directly then press Ctrl+D
 *
 * Output: JSON file at scripts/analytics_output.json
 */

import * as fs from 'fs';
import * as path from 'path';

interface SessionRecord {
  sessionId: string;
  userId: string;
  startTs: number;
  endTs: number | null;
  messageCount: number;
  firstMessageTs: number | null;
  lastMessageTs: number | null;
  tier: string | null;
  band: string | null;
  anchorsRetrieved: number[];
}

interface UserSummary {
  userId: string;
  totalSessions: number;
  totalMessages: number;
  avgMessagesPerSession: number;
  avgSessionDurationMinutes: number;
  maxSessionDurationMinutes: number;
  sessionsWithData: number;
  currentTier: string;
  currentSessionCount: number;
  totalAnchorsInFalkor: number;
  returnDays: number[];
  avgDaysBetweenSessions: number;
}

function parseTimestamp(isoStr: string): number {
  return new Date(isoStr).getTime();
}

function run() {
  const inputFile = process.argv[2];
  let raw: string;

  if (inputFile) {
    raw = fs.readFileSync(inputFile, 'utf-8');
  } else {
    raw = fs.readFileSync(0, 'utf-8');
  }

  const lines = raw.split('\n');

  const sessions = new Map<string, SessionRecord>();
  const userTierInfo = new Map<string, { tier: string; sessionCount: number }>();
  const userAnchorCounts = new Map<string, number>();

  for (const line of lines) {
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
    const ts = tsMatch ? parseTimestamp(tsMatch[1]) : 0;

    // SESSION START
    const startMatch = line.match(/SESSION START:.*sessionId: '([^']+)'.*userId: '([^']+)'/s);
    if (startMatch) {
      const [, sessionId, userId] = startMatch;
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
          sessionId,
          userId,
          startTs: ts,
          endTs: null,
          messageCount: 0,
          firstMessageTs: null,
          lastMessageTs: null,
          tier: null,
          band: null,
          anchorsRetrieved: [],
        });
      }
    }

    // SESSION TERMINATE
    const termMatch = line.match(/SESSION TERMINATE:.*sessionId: '([^']+)'.*ended: (true|false)/);
    if (termMatch) {
      const [, sessionId, ended] = termMatch;
      const sess = sessions.get(sessionId);
      if (sess && ended === 'true') {
        sess.endTs = ts;
      }
    }

    // TIER CHECK — extract tier and sessionCount per userId
    const tierMatch = line.match(/TierCheck.*tierFromService: '([^']+)'.*sessionCount: (\d+).*etvBand: '([^']+)'/);
    if (tierMatch) {
      const [, tier, countStr, band] = tierMatch;
      // Find which session this belongs to by looking for ENGINE KEY on nearby lines
      // We use the most recent session for the userId
      const count = parseInt(countStr, 10);

      // Look for ENGINE KEY in the same log batch
      const engineMatch = line.match(/ENGINE KEY: ([^:]+)::/);
      if (engineMatch) {
        const userId = engineMatch[1];
        userTierInfo.set(userId, { tier, sessionCount: count });
      }
    }

    // ENGINE KEY — link userId to session context
    const engineKeyMatch = line.match(/ENGINE KEY: ([^:]+)::([^\s]+)/);
    if (engineKeyMatch) {
      const [, userId, sessionId] = engineKeyMatch;
      // Try to find matching session
      for (const [sid, sess] of sessions) {
        if (sess.userId === userId && !sess.tier) {
          const info = userTierInfo.get(userId);
          if (info) {
            sess.tier = info.tier;
          }
        }
      }
    }

    // MemoryServiceRetrieve — count messages and get anchor counts
    const retrieveMatch = line.match(/MemoryServiceRetrieve.*"userId":"([^"]+)".*"sessionId":"([^"]+)".*"messageId":"msg-(\d+)".*"tsMs":(\d+).*"anchorCount":(\d+)/);
    if (retrieveMatch) {
      const [, userId, rawSessionId, msgNum, tsMsStr, anchorCountStr] = retrieveMatch;
      const tsMs = parseInt(tsMsStr, 10);
      const anchorCount = parseInt(anchorCountStr, 10);

      // Find matching session by userId (rawSessionId is internal format)
      for (const [, sess] of sessions) {
        if (sess.userId === userId && sess.endTs === null) {
          sess.messageCount = Math.max(sess.messageCount, parseInt(msgNum, 10));
          if (!sess.firstMessageTs) sess.firstMessageTs = tsMs;
          sess.lastMessageTs = tsMs;
          sess.anchorsRetrieved.push(anchorCount);
          break;
        }
      }
    }

    // AnchorPoolSize — track totalAnchorsFromFalkor per user
    const anchorPoolMatch = line.match(/totalAnchorsFromFalkor: (\d+)/);
    if (anchorPoolMatch) {
      const total = parseInt(anchorPoolMatch[1], 10);
      // Associate with most recent ENGINE KEY user
      for (const line2 of lines) {
        // Just track the max across the whole log
        break;
      }
    }

    // Track anchor counts per user from MemoryServiceRetrieve
    const anchorUserMatch = line.match(/MemoryServiceRetrieve.*"userId":"([^"]+)".*"anchorCount":(\d+)/);
    if (anchorUserMatch) {
      const [, userId, countStr] = anchorUserMatch;
      const count = parseInt(countStr, 10);
      const current = userAnchorCounts.get(userId) ?? 0;
      if (count > current) userAnchorCounts.set(userId, count);
    }

    // TierCheck with userId from ENGINE KEY context
    const tierLineMatch = line.match(/TierCheck.*tierFromService: '([^']+)'.*sessionCount: (\d+)/);
    if (tierLineMatch) {
      const [, tier, countStr] = tierLineMatch;
      const count = parseInt(countStr, 10);

      // Find ENGINE KEY userId from nearby lines (within 5 lines before)
      const lineIdx = lines.indexOf(line);
      for (let i = Math.max(0, lineIdx - 5); i <= lineIdx; i++) {
        const ek = lines[i].match(/ENGINE KEY: ([^:]+)::/);
        if (ek) {
          userTierInfo.set(ek[1], { tier, sessionCount: count });
          break;
        }
      }
    }
  }

  // Build per-user summaries
  const userSessions = new Map<string, SessionRecord[]>();
  for (const [, sess] of sessions) {
    if (!userSessions.has(sess.userId)) userSessions.set(sess.userId, []);
    userSessions.get(sess.userId)!.push(sess);
  }

  const userSummaries: UserSummary[] = [];

  for (const [userId, sessArr] of userSessions) {
    sessArr.sort((a, b) => a.startTs - b.startTs);

    const sessionsWithMessages = sessArr.filter(s => s.messageCount > 0);
    const totalMessages = sessArr.reduce((sum, s) => sum + s.messageCount, 0);

    const durations: number[] = [];
    for (const s of sessionsWithMessages) {
      if (s.firstMessageTs && s.lastMessageTs && s.lastMessageTs > s.firstMessageTs) {
        durations.push((s.lastMessageTs - s.firstMessageTs) / 60000);
      }
    }

    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    // Return rate: days between session starts
    const sessionDays = sessArr.map(s => new Date(s.startTs).toISOString().slice(0, 10));
    const uniqueDays = [...new Set(sessionDays)].sort();
    const dayGaps: number[] = [];
    for (let i = 1; i < uniqueDays.length; i++) {
      const d1 = new Date(uniqueDays[i - 1]).getTime();
      const d2 = new Date(uniqueDays[i]).getTime();
      dayGaps.push((d2 - d1) / 86400000);
    }

    const tierInfo = userTierInfo.get(userId);

    userSummaries.push({
      userId,
      totalSessions: sessArr.length,
      totalMessages,
      avgMessagesPerSession: sessionsWithMessages.length > 0 ? Math.round((totalMessages / sessionsWithMessages.length) * 10) / 10 : 0,
      avgSessionDurationMinutes: Math.round(avgDuration * 10) / 10,
      maxSessionDurationMinutes: Math.round(maxDuration * 10) / 10,
      sessionsWithData: sessionsWithMessages.length,
      currentTier: tierInfo?.tier ?? 'TIER_1',
      currentSessionCount: tierInfo?.sessionCount ?? 0,
      totalAnchorsInFalkor: userAnchorCounts.get(userId) ?? 0,
      returnDays: dayGaps,
      avgDaysBetweenSessions: dayGaps.length > 0 ? Math.round((dayGaps.reduce((a, b) => a + b, 0) / dayGaps.length) * 10) / 10 : 0,
    });
  }

  userSummaries.sort((a, b) => b.totalMessages - a.totalMessages);

  const globalStats = {
    totalUniqueUsers: userSummaries.length,
    totalSessions: sessions.size,
    totalMessages: userSummaries.reduce((s, u) => s + u.totalMessages, 0),
    avgMessagesPerUser: userSummaries.length > 0
      ? Math.round((userSummaries.reduce((s, u) => s + u.totalMessages, 0) / userSummaries.length) * 10) / 10
      : 0,
    avgSessionsPerUser: userSummaries.length > 0
      ? Math.round((userSummaries.reduce((s, u) => s + u.totalSessions, 0) / userSummaries.length) * 10) / 10
      : 0,
    usersInTier1: userSummaries.filter(u => u.currentTier === 'TIER_1').length,
    usersInTier2: userSummaries.filter(u => u.currentTier === 'TIER_2').length,
    usersInTier3: userSummaries.filter(u => u.currentTier === 'TIER_3').length,
    usersWithMemory: userSummaries.filter(u => u.totalAnchorsInFalkor > 0).length,
    generatedAt: new Date().toISOString(),
  };

  const output = {
    global: globalStats,
    users: userSummaries,
  };

  const outPath = path.join(__dirname, 'analytics_output.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Analytics written to ${outPath}`);
  console.log(`\nGlobal: ${globalStats.totalUniqueUsers} users, ${globalStats.totalSessions} sessions, ${globalStats.totalMessages} messages`);
  console.log(`Tier distribution: T1=${globalStats.usersInTier1} T2=${globalStats.usersInTier2} T3=${globalStats.usersInTier3}`);
}

run();
