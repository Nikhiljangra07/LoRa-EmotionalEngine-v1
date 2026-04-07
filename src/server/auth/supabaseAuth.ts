/**
 * Supabase JWT verification middleware.
 *
 * Authenticated users: extracts userId from the JWT `sub` claim.
 * Guest users (no token): pass through — rate limiter is the defense.
 *
 * The verified userId is attached to `req.verifiedUserId`.
 * Routes should use this instead of trusting the body-provided userId.
 */

import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
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

// JWKS endpoints, cached by issuer URL. We support multiple sources:
//   1. Configured SUPABASE_URL env var (preferred when present).
//   2. The JWT's own `iss` claim (auto-derived per token, so verification
//      works even when the env var isn't set on Railway).
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKSForIssuer(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let keys = jwksByIssuer.get(issuer);
  if (!keys) {
    const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', issuer);
    keys = createRemoteJWKSet(jwksUrl);
    jwksByIssuer.set(issuer, keys);
  }
  return keys;
}

function getConfiguredJWKS(): ReturnType<typeof createRemoteJWKSet> | null {
  if (!SUPABASE_URL) return null;
  return getJWKSForIssuer(SUPABASE_URL);
}

/**
 * Verify a Supabase JWT.
 *
 * Tries HS256 with the symmetric JWT secret first (legacy projects, fastest).
 * If that fails (e.g. project switched to ES256/RS256 with JWKS), falls back
 * to verifying via the project's public JWKS endpoint. We must NOT collapse
 * the two paths into a single try/catch and bail on the first error — older
 * projects use HS256 and newer projects use asymmetric keys, and we want to
 * support both transparently.
 */
async function verifySupabaseToken(token: string): Promise<JWTPayload | null> {
  // Path 1: HS256 symmetric (legacy Supabase projects)
  if (SUPABASE_JWT_SECRET) {
    try {
      const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
      });
      return payload;
    } catch (err) {
      // Common case: project moved to asymmetric signing — fall through to JWKS.
      // Only log unusual failures once we've also tried JWKS.
    }
  }

  // Path 2: JWKS asymmetric (ES256 / RS256 — current Supabase default).
  // Resolve JWKS source: configured SUPABASE_URL, else the token's own iss claim.
  let keys = getConfiguredJWKS();
  if (!keys) {
    try {
      const claims = decodeJwt(token);
      const iss = typeof claims.iss === 'string' ? claims.iss : '';
      // Only trust supabase issuers — don't fetch JWKS from arbitrary URLs.
      if (iss && /^https:\/\/[a-z0-9-]+\.supabase\.co/i.test(iss)) {
        keys = getJWKSForIssuer(iss);
      }
    } catch {
      // decodeJwt is a parser, not a verifier — only fails on malformed tokens.
    }
  }

  if (keys) {
    try {
      const { payload } = await jwtVerify(token, keys);
      return payload;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[LoRa::Auth] JWT verification failed (JWKS):', msg);
      return null;
    }
  }

  // No verification path available — neither secret nor JWKS could verify.
  console.warn('[LoRa::Auth] JWT verification failed: no usable HS256 secret or JWKS source');
  return null;
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
