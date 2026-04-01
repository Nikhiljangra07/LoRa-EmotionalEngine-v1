import type { Express, Request, Response } from 'express';
import { parseOnboardingInput, type OnboardingPreferences } from '../../emotion-core/onboarding/onboardingQuiz';
import { getEffectiveUserId } from '../auth/supabaseAuth';

export interface OnboardingBody {
  userId: string;
  onboarding: {
    name?: string;
    preferredTone?: string;
    goalOrientation?: string;
  };
}

/**
 * Register POST /api/onboarding.
 * Accepts onboarding preferences and returns success.
 */
export function registerOnboardingRoute(app: Express): void {
  app.post('/api/onboarding', (req: Request, res: Response): void => {
    const body = req.body;
    if (body == null || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'Request body must be a JSON object.' });
      return;
    }
    const b = body as Record<string, unknown>;
    const userId = getEffectiveUserId(req, typeof b.userId === 'string' ? b.userId : undefined);
    if (!userId) {
      res.status(400).json({ ok: false, error: 'userId must be a non-empty string.' });
      return;
    }
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
    res.status(200).json({ ok: true });
  });
}
