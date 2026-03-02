import type { Express, Request, Response } from 'express';
import { TierStorage } from '../../emotion-core/tier/TierState';
import { parseOnboardingInput, type OnboardingPreferences } from '../../emotion-core/onboarding/onboardingQuiz';

export interface OnboardingBody {
  userId: string;
  onboarding: {
    name?: string;
    preferredTone?: string;
    goalOrientation?: string;
  };
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

/**
 * Register POST /api/onboarding.
 * Persists onboarding preferences via TierStorage when LORA_TIER_MODEL=1.
 * When tier model is OFF, returns success but does not persist.
 */
export function registerOnboardingRoute(app: Express): void {
  app.post('/api/onboarding', (req: Request, res: Response): void => {
    const body = req.body;
    if (body == null || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'Request body must be a JSON object.' });
      return;
    }
    const b = body as Record<string, unknown>;
    if (!isNonEmptyString(b.userId)) {
      res.status(400).json({ ok: false, error: 'userId must be a non-empty string.' });
      return;
    }
    const userId = b.userId.trim();
    const rawOnboarding = b.onboarding;
    if (rawOnboarding == null || typeof rawOnboarding !== 'object') {
      res.status(400).json({ ok: false, error: 'onboarding must be an object.' });
      return;
    }
    const ob = rawOnboarding as Record<string, unknown>;
    const preferences: OnboardingPreferences = parseOnboardingInput({
      name: typeof ob.name === 'string' ? ob.name : undefined,
      preferredTone: typeof ob.preferredTone === 'string' ? ob.preferredTone : undefined,
      goalOrientation: typeof ob.goalOrientation === 'string' ? ob.goalOrientation : undefined,
    });
    if (process.env.LORA_TIER_MODEL === '1') {
      TierStorage.saveOnboarding(userId, preferences);
    }
    res.status(200).json({ ok: true });
  });
}
