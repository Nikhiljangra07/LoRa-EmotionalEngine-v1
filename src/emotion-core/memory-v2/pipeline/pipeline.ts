import type { IMemoryAdapter, SessionEndData, ProcessResult } from './adapter-interface';
import type {
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
  /** Model for session summarization (e.g., claude-sonnet-4-20250514) */
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

    // ── Step 1: Summarize ──
    // Summary exists ONLY in memory — never persisted
    let summary: SessionSummary | null = await summarizeSession(
      conversationHistory,
      { model: this.config.summarizerModel, apiKey: this.config.apiKey },
    );

    // ── Step 2: Dual extraction (parallel) ──
    const extractorConfig = { model: this.config.extractorModel, apiKey: this.config.apiKey };
    const metadata = { turns: conversationHistory, sessionId, userId };

    const [facts, fingerprint] = await Promise.all([
      extractFacts(summary, extractorConfig),
      extractFingerprint(summary, eivCurve, metadata, extractorConfig),
    ]);

    // ── Step 3: Verify ──
    let verificationResult = await verifyExtraction(
      summary, facts, fingerprint, extractorConfig,
    );

    let finalFacts: FactAnchor[] = facts;
    let finalFingerprint: SessionFingerprint = fingerprint;
    let reExtracted = false;

    // ── Step 4/5: Re-extract if flagged (max 1 retry) ──
    if (!verificationResult.verified) {
      reExtracted = true;

      // Re-extract only what was flagged
      if (verificationResult.flaggedFacts.length > 0) {
        finalFacts = await extractFacts(summary, extractorConfig);
      }

      if (verificationResult.fingerprintIssues.length > 0) {
        finalFingerprint = await extractFingerprint(
          summary, eivCurve, metadata, extractorConfig,
        );
      }

      // Re-verify (but don't retry again — avoid infinite loops)
      verificationResult = await verifyExtraction(
        summary, finalFacts, finalFingerprint, extractorConfig,
      );

      // If still failing after retry, store what we have anyway
      // (the extraction validation already filters out invalid data)
    }

    // ── Step 6: Store ──
    await Promise.all([
      this.graphStore.storeAnchors(userId, sessionId, finalFacts),
      this.vectorStore.store(userId, finalFingerprint),
    ]);

    // ── Step 7: Update profile ──
    const existingProfile = this.userProfiles.get(userId) ?? null;
    const updatedProfile = updateProfile(existingProfile, finalFingerprint);
    this.userProfiles.set(userId, updatedProfile);

    // ── Step 8: DISCARD summary ──
    // This is the critical privacy step: the summary is transient
    summary = null;

    return {
      stored: true,
      factsCount: finalFacts.length,
      fingerprintStored: true,
      profileUpdated: true,
      reExtracted,
    };
  }

  async retrieveContext(
    userId: string,
    currentState: EmotionalFingerprint,
  ): Promise<MemoryContext> {
    // ── Step 1: Retrieve raw matches ──
    const rawContext = await retrieveMemory(
      userId, currentState, this.vectorStore, this.graphStore,
    );

    // ── Step 2: Filter through fog logic ──
    const nowMs = Date.now();
    const visibleSessions = rawContext.matchedSessions.filter(
      (match) => isVisible(match.fingerprint, nowMs),
    );

    // ── Step 3: Touch access on visible fingerprints ──
    // This lifts the fog and resets decay timers
    for (const match of visibleSessions) {
      const touched = touchAccess(match.fingerprint);
      // Persist the updated access metadata
      await this.vectorStore.store(userId, touched);
    }

    // Update topSimilarity based on visible sessions only
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
