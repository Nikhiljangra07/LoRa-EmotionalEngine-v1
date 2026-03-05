import { extractFactAnchor } from '../factExtractor';
import { QUARANTINE_THRESHOLD } from '../factAnchorTypes';

const USER = 'u1';
const SESSION = 'sess-1';
const TS = 1000000;
const VEC = [0.1, 0.2, 0.3];

describe('factExtractor', () => {
  // -----------------------------------------------------------------------
  // Goal extraction
  // -----------------------------------------------------------------------

  describe('goal extraction', () => {
    it('extracts goal_active for "my goal is to learn piano"', () => {
      const a = extractFactAnchor(USER, 'my goal is to learn piano', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.type).toBe('goal');
      expect(a!.summary.template).toBe('goal_active');
      expect(a!.summary.slot).toBe('learning');
    });

    it('extracts goal_active for "i want to exercise more"', () => {
      const a = extractFactAnchor(USER, 'i want to exercise more', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.summary.slot).toBe('exercise');
    });

    it('extracts goal_active for "i am trying to change career"', () => {
      const a = extractFactAnchor(USER, 'i am trying to change career paths', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.summary.slot).toBe('career_change');
    });

    it('extracts goal_objective with value for unmapped goal phrase', () => {
      const a = extractFactAnchor(USER, 'my goal is to be happy', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.type).toBe('goal');
      expect(a!.summary.template).toBe('goal_objective');
      expect(a!.summary.slot).toBe('objective');
      expect(a!.value).toBe('be happy');
    });

    it('goal has confidence 0.75', () => {
      const a = extractFactAnchor(USER, 'i want to learn coding', SESSION, VEC, TS, 0);
      expect(a!.extractionConfidence).toBe(0.75);
    });
  });

  // -----------------------------------------------------------------------
  // Preference extraction
  // -----------------------------------------------------------------------

  describe('preference extraction', () => {
    it('extracts preference_positive for "i like this"', () => {
      const a = extractFactAnchor(USER, 'i like sunny weather', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.type).toBe('preference');
      expect(a!.summary.template).toBe('preference_positive');
      expect(a!.summary.slot).toBe('general_positive');
    });

    it('extracts preference_negative for "i hate mornings"', () => {
      const a = extractFactAnchor(USER, 'i hate mornings', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.summary.template).toBe('preference_negative');
      expect(a!.summary.slot).toBe('general_negative');
    });

    it('preference has confidence 0.70', () => {
      const a = extractFactAnchor(USER, 'i love coffee', SESSION, VEC, TS, 0);
      expect(a!.extractionConfidence).toBe(0.70);
    });
  });

  // -----------------------------------------------------------------------
  // Date event extraction
  // -----------------------------------------------------------------------

  describe('date event extraction', () => {
    it('extracts upcoming_event for "i have an interview tomorrow"', () => {
      const a = extractFactAnchor(USER, 'i have an interview tomorrow', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.type).toBe('date_event');
      expect(a!.summary.template).toBe('upcoming_event');
      expect(a!.summary.slot).toBe('job_interview');
    });

    it('extracts exam with date indicator', () => {
      const a = extractFactAnchor(USER, 'my exam is next week', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.summary.slot).toBe('exam');
    });

    it('returns null for event without date indicator', () => {
      const a = extractFactAnchor(USER, 'i had a meeting', SESSION, VEC, TS, 0);
      expect(a).toBeNull();
    });

    it('date_event has confidence 0.80', () => {
      const a = extractFactAnchor(USER, 'birthday party next week', SESSION, VEC, TS, 0);
      expect(a!.extractionConfidence).toBe(0.80);
    });
  });

  // -----------------------------------------------------------------------
  // Person role extraction
  // -----------------------------------------------------------------------

  describe('person role extraction', () => {
    it('extracts person_role for "my therapist said" with remember intent', () => {
      const a = extractFactAnchor(USER, 'remember that my therapist said to breathe', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.type).toBe('person');
      expect(a!.summary.template).toBe('person_role');
      expect(a!.summary.slot).toBe('therapist');
      expect(a!.entityRole).toBe('therapist');
    });

    it('extracts person without remember intent (no name stored)', () => {
      const a = extractFactAnchor(USER, 'my manager is being difficult', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.type).toBe('person');
      expect(a!.summary.slot).toBe('manager');
    });

    it('person has confidence 0.65', () => {
      const a = extractFactAnchor(USER, 'my friend told me something', SESSION, VEC, TS, 0);
      expect(a!.extractionConfidence).toBe(0.65);
    });
  });

  // -----------------------------------------------------------------------
  // Name storage rules
  // -----------------------------------------------------------------------

  describe('name storage', () => {
    it('does not store freeform names without remember intent', () => {
      const a = extractFactAnchor(USER, 'my friend John is great', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.summary.slot).toBe('friend');
      expect(JSON.stringify(a)).not.toContain('John');
    });

    it('extracts with remember intent present', () => {
      const a = extractFactAnchor(USER, "don't forget my partner is supportive", SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.summary.slot).toBe('partner');
    });
  });

  // -----------------------------------------------------------------------
  // Session cap
  // -----------------------------------------------------------------------

  describe('per-session cap', () => {
    it('returns null when sessionAnchorCount >= 3', () => {
      const a = extractFactAnchor(USER, 'i love coding', SESSION, VEC, TS, 3);
      expect(a).toBeNull();
    });

    it('returns null when sessionAnchorCount is 4', () => {
      const a = extractFactAnchor(USER, 'i love coding', SESSION, VEC, TS, 4);
      expect(a).toBeNull();
    });

    it('extracts when sessionAnchorCount is 2', () => {
      const a = extractFactAnchor(USER, 'i love coding', SESSION, VEC, TS, 2);
      expect(a).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Quarantine
  // -----------------------------------------------------------------------

  describe('quarantine logic', () => {
    it('person (confidence 0.65) is confirmed because 0.65 >= threshold', () => {
      const a = extractFactAnchor(USER, 'my mentor helped me', SESSION, VEC, TS, 0);
      expect(a).not.toBeNull();
      expect(a!.extractionConfidence).toBe(0.65);
      expect(a!.status).toBe('confirmed');
      expect(QUARANTINE_THRESHOLD).toBe(0.60);
    });

    it('all base confidences are >= QUARANTINE_THRESHOLD', () => {
      expect(0.65).toBeGreaterThanOrEqual(QUARANTINE_THRESHOLD);
      expect(0.70).toBeGreaterThanOrEqual(QUARANTINE_THRESHOLD);
      expect(0.75).toBeGreaterThanOrEqual(QUARANTINE_THRESHOLD);
      expect(0.80).toBeGreaterThanOrEqual(QUARANTINE_THRESHOLD);
    });
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  describe('determinism', () => {
    it('same input produces identical anchorId', () => {
      const a1 = extractFactAnchor(USER, 'i want to learn coding', SESSION, VEC, TS, 0);
      const a2 = extractFactAnchor(USER, 'i want to learn coding', SESSION, VEC, TS, 0);
      expect(a1!.anchorId).toBe(a2!.anchorId);
    });

    it('anchorId matches expected deterministic format', () => {
      const a = extractFactAnchor(USER, 'i want to exercise', SESSION, VEC, TS, 0);
      expect(a!.anchorId).toBe(`${USER}-${SESSION}-${TS}`);
    });

    it('emotionVec is a copy, not a reference', () => {
      const vec = [0.5, 0.6, 0.7];
      const a = extractFactAnchor(USER, 'i love reading', SESSION, vec, TS, 0);
      vec[0] = 999;
      expect(a!.emotionVecAtCreation[0]).toBe(0.5);
    });
  });

  // -----------------------------------------------------------------------
  // Returns null for unmatched
  // -----------------------------------------------------------------------

  describe('no match', () => {
    it('returns null for generic message', () => {
      const a = extractFactAnchor(USER, 'hello how are you', SESSION, VEC, TS, 0);
      expect(a).toBeNull();
    });

    it('returns null for empty string', () => {
      const a = extractFactAnchor(USER, '', SESSION, VEC, TS, 0);
      expect(a).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Initialization fields
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Structured extraction (dates, money, goals)
  // -----------------------------------------------------------------------

  describe('structured extraction', () => {
    it('extracts deployment_plan anchor with normalized launch_date', () => {
      const a = extractFactAnchor(
        USER,
        'I will deploy on March 23 2026',
        SESSION,
        VEC,
        TS,
        0,
      );
      expect(a).not.toBeNull();
      expect(a!.type).toBe('deployment_plan');
      expect(a!.summary.slot).toBe('launch_date');
      expect(a!.value).toBe('2026-03-23');
    });

    it('extracts financial_commitment anchor with money_amount', () => {
      const a = extractFactAnchor(
        USER,
        'Should I borrow $2000?',
        SESSION,
        VEC,
        TS,
        0,
      );
      expect(a).not.toBeNull();
      expect(a!.type).toBe('financial_commitment');
      expect(a!.summary.slot).toBe('money_amount');
      expect(a!.value).toBe(2000);
    });

    it('structured anchors do not contain transcript fields', () => {
      const forbidden = ['message', 'content', 'text', 'transcript', 'userText'];
      const a = extractFactAnchor(
        USER,
        'I will deploy on March 23 2026',
        SESSION,
        VEC,
        TS,
        0,
      );
      expect(a).not.toBeNull();
      const keys = Object.keys(a!);
      for (const k of forbidden) {
        expect(keys).not.toContain(k);
      }
    });
  });

  describe('anchor initialization', () => {
    it('sets reinforceCount=1, appearsInSessions=1, lastSeenSessionId=sessionId', () => {
      const a = extractFactAnchor(USER, 'my exam is next week', SESSION, VEC, TS, 0);
      expect(a!.reinforceCount).toBe(1);
      expect(a!.appearsInSessions).toBe(1);
      expect(a!.lastSeenSessionId).toBe(SESSION);
    });

    it('sets createdAt to timestamp', () => {
      const a = extractFactAnchor(USER, 'i love music', SESSION, VEC, TS, 0);
      expect(a!.createdAt).toBe(TS);
    });

    it('sets sessionId correctly', () => {
      const a = extractFactAnchor(USER, 'i love music', 'sess-xyz', VEC, TS, 0);
      expect(a!.sessionId).toBe('sess-xyz');
    });
  });
});
