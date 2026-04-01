/**
 * Supabase JWT verification middleware.
 *
 * Authenticated users: extracts userId from the JWT `sub` claim.
 * Guest users (no token): pass through — rate limiter is the defense.
 *
 * The verified userId is attached to `req.verifiedUserId`.
 * Routes should use this instead of trusting the body-provided userId.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Request, Response, NextFunction } from 'express';

// Extend Express Request to carry verified auth info
declare global {
  namespace Express {
    interface Request {
      /** Verified Supabase userId (from JWT sub claim). Undefined for guests. */
      verifiedUserId?: string;
      /** Whether this request has a verified auth token */
      isAuthenticated?: boolean;
    }
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

// JWKS endpoint for Supabase — used when JWT secret is not available
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks && SUPABASE_URL) {
    const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', SUPABASE_URL);
    jwks = createRemoteJWKSet(jwksUrl);
  }
  return jwks;
}

/**
 * Verify a Supabase JWT using the project's JWT secret (symmetric HS256).
 * Falls back to JWKS if secret is not configured.
 */
async function verifySupabaseToken(token: string): Promise<JWTPayload | null> {
  try {
    // Prefer symmetric verification with JWT secret (faster, no network call)
    if (SUPABASE_JWT_SECRET) {
      const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
      });
      return payload;
    }

    // Fallback: JWKS verification
    const keys = getJWKS();
    if (!keys) return null;

    const { payload } = await jwtVerify(token, keys);
    return payload;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[LoRa::Auth] JWT verification failed:', msg);
    return null;
  }
}

/**
 * Express middleware that:
 * 1. Checks for Authorization: Bearer <token> header
 * 2. If present, verifies the Supabase JWT and extracts userId
 * 3. If absent, marks request as guest (no error — guests are allowed)
 *
 * After this middleware runs:
 * - req.verifiedUserId = Supabase user UUID (if authenticated)
 * - req.isAuthenticated = true/false
 */
export function supabaseAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // No auth header → guest request, pass through
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.isAuthenticated = false;
    next();
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  if (!token) {
    req.isAuthenticated = false;
    next();
    return;
  }

  // Verify async, then continue
  verifySupabaseToken(token)
    .then((payload) => {
      if (payload?.sub) {
        req.verifiedUserId = payload.sub;
        req.isAuthenticated = true;
      } else {
        req.isAuthenticated = false;
      }
      next();
    })
    .catch(() => {
      // Verification error — treat as guest, don't block
      req.isAuthenticated = false;
      next();
    });
}

/**
 * Get the effective userId for a request.
 * - Authenticated: use verifiedUserId from JWT (ignore body)
 * - Guest: use body-provided userId (rate-limited)
 *
 * Returns null if no valid userId can be determined.
 */
export function getEffectiveUserId(req: Request, bodyUserId?: string): string | null {
  // Authenticated user: always use the verified JWT userId
  if (req.isAuthenticated && req.verifiedUserId) {
    return req.verifiedUserId;
  }

  // Guest: trust body userId (defended by rate limiter)
  if (bodyUserId && typeof bodyUserId === 'string' && bodyUserId.trim()) {
    return bodyUserId.trim();
  }

  return null;
}
