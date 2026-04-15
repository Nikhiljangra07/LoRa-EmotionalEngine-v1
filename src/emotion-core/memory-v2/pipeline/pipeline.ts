import type { IMemoryAdapter, SessionEndData, ProcessResult } from './adapter-interface';
import type {
  ConversationTurn,
  EmotionalFingerprint,
  MemoryContext,
  SessionSummary,
  FactAnchor,
  SessionFingerprint,
  UserProfile,
} from '../types';
import type { IVectorStore, IGraphStore } from '../storage/interfaces';

import { summarizeSession } from '../summarizer';
import { extractFacts } from '../extractors/fact-extractor';
import { extractFingerprint } from '../extractors/fingerprint-extractor';
import { verifyExtraction } from '../verifier/verifier';
import { retrieveMemory } from '../retrieval/retriever';
import { isVisible, touchAccess } from '../decay/decay-engine';
import { updateProfile } from '../profile/profile-manager';

// ── Shadow debug logging (temporary scaffolding — remove after validation) ──
const V2_DEBUG = process.env.LORA_MEMORY_V2_DEBUG === '1' || process.env.LORA_MEMORY_V2_SHADOW === '1';
const v2log = (msg: string, data?: unknown) => {
  if (!V2_DEBUG) return;
  console.log(`[LoRa::MemoryV2] ${msg}`, data !== undefined ? data : '');
};

// ──────────────────────────────────────────────────────
// MemoryV2Pipeline — wires all components together
//
// processSessionEnd():
//   1. summarizeSession() → summary (in-memory)
//   2. extractFacts() + extractFingerprint() → parallel
//   3. verifyExtraction()
//   4. If verified: store to both DBs
//   5. If flagged: re-extract flagged items, re-verify (max 1 retry)
//   6. updateProfile()
//   7. DISCARD summary — set to null
//   8. Return ProcessResult
//
// retrieveContext():
//   1. retrieveMemory() → raw matches
//   2. Filter through isVisible() (fog logic)
//   3. touchAccess() on returned fingerprints
//   4. Return MemoryContext
// ──────────────────────────────────────────────────────

export interface PipelineConfig {
  /** Model for session summarization (e.g., claude-sonnet-4-6) */
  summarizerModel: string;
  /** Model for extraction + verification (e.g., claude-haiku-4-5-20251001) */
  extractorModel: string;
  /** Anthropic API key */
  apiKey: string;
}

export class MemoryV2Pipeline implements IMemoryAdapter {
  private vectorStore: IVectorStore;
  private graphStore: IGraphStore;
  private config: PipelineConfig;
  private userProfiles: Map<string, UserProfile> = new Map();

  constructor(
    vectorStore: IVectorStore,
    graphStore: IGraphStore,
    config: PipelineConfig,
  ) {
    this.vectorStore = vectorStore;
    this.graphStore = graphStore;
    this.config = config;
  }

  async processSessionEnd(sessionData: SessionEndData): Promise<ProcessResult> {
    const { userId, sessionId, conversationHistory, eivCurve } = sessionData;
    const t0 = Date.now();
    const uid = userId.slice(0, 8);
    const sid = sessionId.slice(0, 8);

    v2log(`begin`, { uid, sid, turns: conversationHistory.length, eivPoints: eivCurve.length });

    try {
      // Pipeline-level timeout: 45s max. Individual LLM calls have 15s timeout.
      // 45s accommodates: summary (~8s) + extraction (~8s) + verify (~5s) + re-extract (~8s) + storage (~2s)
      const PIPELINE_TIMEOUT_MS = 45_000;
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        this._processSessionEndInner(
          userId, sessionId, conversationHistory, eivCurve, uid, sid, t0,
        ),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Pipeline timeout after ${PIPELINE_TIMEOUT_MS}ms`)),
            PIPELINE_TIMEOUT_MS,
          );
        }),
      ]);
      clearTimeout(timeoutHandle!);
      return result;
    } catch (fatalErr) {
      // Absolute last resort — no session should silently vanish
      const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
      console.error(
        `[LoRa::MemoryV2] FATAL consolidation failure`,
        { uid, sid, ms: Date.now() - t0, error: errMsg },
      );
      return {
        stored: false,
        factsCount: 0,
        fingerprintStored: false,
        profileUpdated: false,
        reExtracted: false,
      };
    }
  }

  private async _processSessionEndInner(
    userId: string, sessionId: string,
    conversationHistory: ConversationTurn[], eivCurve: number[],
    uid: string, sid: string, t0: number,
  ): Promise<ProcessResult> {
    // ── Step 1: Summarize ──
    // Summary exists ONLY in memory — never persisted.
    // If summarization fails, we cannot extract anything — bail early.
    const t1 = Date.now();
    let summary: SessionSummary | null;
    try {
      summary = await summarizeSession(
        conversationHistory,
        { model: this.config.summarizerModel, apiKey: this.config.apiKey },
      );
    } catch (sumErr) {
      const errMsg = sumErr instanceof Error ? sumErr.message : String(sumErr);
      console.error(`[LoRa::MemoryV2] summarization failed — session lost`, { uid, sid, ms: Date.now() - t1, error: errMsg });
      return { stored: false, factsCount: 0, fingerprintStored: false, profileUpdated: false, reExtracted: false };
    }
    v2log(`summary`, {
      uid, ms: Date.now() - t1,
      primaryTopic: summary.primaryTopic,
      keyFacts: summary.keyFacts.length,
      direction: summary.currentDirection,
      unresolved: summary.unresolved.length,
    });

    // ── Step 2: Dual extraction (parallel, independent) ──
    // Use allSettled so one failure doesn't kill the other.
    const extractorConfig = { model: this.config.extractorModel, apiKey: this.config.apiKey };
    const metadata = { turns: conversationHistory, sessionId, userId };

    const t2 = Date.now();
    const [factsResult, fingerprintResult] = await Promise.allSettled([
      extractFacts(summary, extractorConfig),
      extractFingerprint(summary, eivCurve, metadata, extractorConfig),
    ]);

    const facts: FactAnchor[] = factsResult.status === 'fulfilled' ? factsResult.value : [];
    const fingerprint: SessionFingerprint | null = fingerprintResult.status === 'fulfilled' ? fingerprintResult.value : null;

    if (factsResult.status === 'rejected') {
      console.error(`[LoRa::MemoryV2] fact extraction failed`, { uid, error: factsResult.reason?.message ?? String(factsResult.reason) });
    }
    if (fingerprintResult.status === 'rejected') {
      console.error(`[LoRa::MemoryV2] fingerprint extraction failed`, { uid, error: fingerprintResult.reason?.message ?? String(fingerprintResult.reason) });
    }

    // If BOTH failed, bail — nothing to store
    if (facts.length === 0 && !fingerprint) {
      console.error(`[LoRa::MemoryV2] both extractions failed — session lost`, { uid, sid });
      return { stored: false, factsCount: 0, fingerprintStored: false, profileUpdated: false, reExtracted: false };
    }

    v2log(`extraction`, {
      uid, ms: Date.now() - t2,
      factsOk: factsResult.status === 'fulfilled', factsCount: facts.length,
      fingerprintOk: fingerprintResult.status === 'fulfilled',
    });
    if (facts.length > 0) {
      v2log(`facts`, { uid, items: facts.map(f => `${f.type}:${f.slot}=${f.value}`) });
    }
    if (fingerprint) {
      v2log(`fingerprint`, {
        uid,
        primary: fingerprint.emotionalFingerprint.primary,
        undertones: fingerprint.emotionalFingerprint.undertones,
        context: fingerprint.emotionalFingerprint.contextCategory,
        tension: fingerprint.decisionPattern.primaryTension,
        importance: fingerprint.importanceScore,
        peakEIV: fingerprint.peakIntensity,
        resolution: fingerprint.resolution,
      });
    }

    // ── Step 3: Verify ──
    // Verification is a safety net, not a gate. If it crashes,
    // we still store the extracted data. A broken verifier should
    // never prevent consolidation.
    let finalFacts: FactAnchor[] = facts;
    let finalFingerprint: SessionFingerprint | null = fingerprint;
    let reExtracted = false;

    if (fingerprint && facts.length > 0) {
      const t3 = Date.now();
      let verificationResult;
      try {
        verificationResult = await verifyExtraction(
          summary, facts, fingerprint, extractorConfig,
        );
        v2log(`verify`, {
          uid, ms: Date.now() - t3,
          verified: verificationResult.verified,
          flaggedFacts: verificationResult.flaggedFacts.length,
          fingerprintIssues: verificationResult.fingerprintIssues,
        });
      } catch (verifyErr) {
        console.error(`[LoRa::MemoryV2] verifier crashed — storing unverified`, {
          uid, error: (verifyErr as Error).message,
        });
        verificationResult = null;
      }

      // ── Step 4/5: Re-extract if flagged (max 1 retry) ──
      if (verificationResult && !verificationResult.verified) {
        reExtracted = true;
        v2log(`re-extracting`, { uid, flaggedFacts: verificationResult.flaggedFacts.length, fingerprintIssues: verificationResult.fingerprintIssues.length });

        try {
          if (verificationResult.flaggedFacts.length > 0) {
            finalFacts = await extractFacts(summary, extractorConfig);
          }
          if (verificationResult.fingerprintIssues.length > 0) {
            finalFingerprint = await extractFingerprint(
              summary, eivCurve, metadata, extractorConfig,
            );
          }

          // Re-verify (but don't retry again — avoid infinite loops)
          const reVerify = await verifyExtraction(
            summary, finalFacts, finalFingerprint!, extractorConfig,
          );
          v2log(`re-verify`, { uid, verified: reVerify.verified });
        } catch (reExtractErr) {
          v2log(`re-extract failed, using original extraction`, {
            uid, error: (reExtractErr as Error).message,
          });
          finalFacts = facts;
          finalFingerprint = fingerprint;
        }
      }
    }

    // ── Step 6: Store (independent — one failure doesn't block the other) ──
    let factsStored = false;
    let fingerprintStored = false;

    const storeOps: Promise<void>[] = [];

    if (finalFacts.length > 0) {
      storeOps.push(
        this._storeWithRetry(
          () => this.graphStore.storeAnchors(userId, sessionId, finalFacts),
          'facts', uid,
        ).then(() => { factsStored = true; }),
      );
    }

    if (finalFingerprint) {
      storeOps.push(
        this._storeWithRetry(
          () => this.vectorStore.store(userId, finalFingerprint!),
          'fingerprint', uid,
        ).then(() => { fingerprintStored = true; }),
      );
    }

    await Promise.allSettled(storeOps);

    // ── Step 7: Update profile (only if fingerprint stored) ──
    let profileUpdated = false;
    if (fingerprintStored && finalFingerprint) {
      const existingProfile = this.userProfiles.get(userId) ?? null;
      const updatedProfile = updateProfile(existingProfile, finalFingerprint);
      this.userProfiles.set(userId, updatedProfile);
      profileUpdated = true;
    }

    // ── Step 8: DISCARD summary ──
    summary = null;

    v2log(`complete`, {
      uid, sid,
      totalMs: Date.now() - t0,
      factsCount: finalFacts.length,
      factsStored,
      fingerprintStored,
      reExtracted,
    });

    return {
      stored: factsStored || fingerprintStored,
      factsCount: factsStored ? finalFacts.length : 0,
      fingerprintStored,
      profileUpdated,
      reExtracted,
    };
  }

  /**
   * Store with 1 retry after 500ms backoff.
   * DB connections can hiccup on Railway — one retry catches transients.
   */
  private async _storeWithRetry(
    op: () => Promise<void>,
    label: string,
    uid: string,
  ): Promise<void> {
    try {
      await op();
    } catch (firstErr) {
      console.warn(`[LoRa::MemoryV2] ${label} store failed, retrying in 500ms`, {
        uid, error: (firstErr as Error).message,
      });
      await new Promise((r) => setTimeout(r, 500));
      try {
        await op();
      } catch (retryErr) {
        console.error(`[LoRa::MemoryV2] ${label} store FAILED after retry`, {
          uid, error: (retryErr as Error).message,
        });
        throw retryErr;
      }
    }
  }

  async retrieveContext(
    userId: string,
    currentState: EmotionalFingerprint,
  ): Promise<MemoryContext> {
    const EMPTY_CONTEXT: MemoryContext = {
      matchedSessions: [],
      relatedFacts: [],
      responseMode: 'silent',
      topSimilarity: 0,
    };

    // ── Step 1: Retrieve raw matches ──
    let rawContext;
    try {
      rawContext = await retrieveMemory(
        userId, currentState, this.vectorStore, this.graphStore,
      );
    } catch (retrieveErr) {
      console.error(`[LoRa::MemoryV2] retrieval failed — returning empty context`, {
        uid: userId.slice(0, 8), error: (retrieveErr as Error).message,
      });
      return EMPTY_CONTEXT;
    }

    // ── Step 2: Filter through fog logic ──
    const nowMs = Date.now();
    const visibleSessions = rawContext.matchedSessions.filter((match) => {
      try {
        return isVisible(match.fingerprint, nowMs);
      } catch {
        return false; // Malformed timestamp — hide rather than crash
      }
    });

    // ── Step 3: Touch access on visible fingerprints ──
    for (const match of visibleSessions) {
      try {
        const touched = touchAccess(match.fingerprint);
        await this.vectorStore.store(userId, touched);
      } catch {
        // Non-critical: access metadata update failed, memory still returned
      }
    }

    const topSimilarity = visibleSessions.length > 0
      ? visibleSessions[0]!.similarity
      : 0;

    return {
      matchedSessions: visibleSessions,
      relatedFacts: rawContext.relatedFacts,
      responseMode: rawContext.responseMode,
      topSimilarity,
    };
  }

  async purgeUser(userId: string): Promise<void> {
    await Promise.all([
      this.vectorStore.purgeUser(userId),
      this.graphStore.purgeUser(userId),
    ]);
    this.userProfiles.delete(userId);
  }

  /** Get the current profile for a user (in-memory) */
  getProfile(userId: string): UserProfile | undefined {
    return this.userProfiles.get(userId);
  }
}
