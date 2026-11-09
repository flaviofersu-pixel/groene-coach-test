/**
 * @file tokenService.js
 * @description Simulated Microsoft Entra ID tokens (the Teams SSO + On-Behalf-Of
 * pattern without contacting Microsoft).
 *
 * PRODUCTION PATTERN THIS SIMULATES
 *   1. The Teams client obtains an SSO token for our API (audience api://...)
 *      via `microsoftTeams.authentication.getAuthToken()`.
 *   2. The browser sends it to OUR backend as `Authorization: Bearer <token>`.
 *   3. The backend validates signature, issuer, audience, expiry and tenant,
 *      then exchanges it server-side (MSAL On-Behalf-Of) for a Graph token.
 *   4. The Graph token never reaches the browser, is cached in memory only,
 *      and is never logged or written to the database.
 *
 * In this PoC the signature is HMAC-SHA256 with an in-memory secret, and the
 * "Graph token" step is represented by the scopes (`scp`) inside the token,
 * which the Graph mock (graph/graphMock.js) enforces on every call.
 */

import crypto from 'node:crypto';
import { HttpError } from '../errors.js';

const b64url = (input) => Buffer.from(input).toString('base64url');
const fromB64url = (input) => Buffer.from(input, 'base64url').toString('utf8');

/**
 * @param {{ issuer: string, audience: string, tokenTtlSeconds: number, signingSecret: string, grantedScopes: string[] }} auth
 * @param {{ now?: () => Date }} [options]
 */
export function createTokenService(auth, { now = () => new Date() } = {}) {
  const sign = (data) => crypto.createHmac('sha256', auth.signingSecret).update(data).digest('base64url');

  return {
    /**
     * Issues a short-lived access token for a user (simulated SSO sign-in).
     * @param {{ id: string, display_name: string, department: string }} user
     * @returns {{ access_token: string, token_type: 'Bearer', expires_in: number, scope: string }}
     */
    issue(user) {
      const iat = Math.floor(now().getTime() / 1000);
      const header = { alg: 'HS256', typ: 'JWT' };
      const claims = {
        iss: auth.issuer,
        aud: auth.audience,
        sub: user.id,
        name: user.display_name,
        department: user.department,
        scp: auth.grantedScopes.join(' '),
        iat,
        exp: iat + auth.tokenTtlSeconds,
        jti: crypto.randomUUID(), // unique id, allows revocation lists in production
      };
      const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
      return {
        access_token: `${unsigned}.${sign(unsigned)}`,
        token_type: 'Bearer',
        expires_in: auth.tokenTtlSeconds,
        scope: claims.scp,
      };
    },

    /**
     * Validates a token and returns its claims. Any failure is a 401 with a
     * generic message (no hint about which check failed).
     * @param {string} token
     * @returns {{ sub: string, name: string, department: string, scopes: string[], exp: number }}
     */
    verify(token) {
      const unauthorized = () => new HttpError(401, 'Niet aangemeld of sessie verlopen.');
      const parts = typeof token === 'string' ? token.split('.') : [];
      if (parts.length !== 3) throw unauthorized();

      const [headerB64, claimsB64, signature] = parts;
      const expected = Buffer.from(sign(`${headerB64}.${claimsB64}`));
      const given = Buffer.from(signature);
      // Constant-time comparison prevents timing attacks on the signature.
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw unauthorized();

      let header;
      let claims;
      try {
        header = JSON.parse(fromB64url(headerB64));
        claims = JSON.parse(fromB64url(claimsB64));
      } catch {
        throw unauthorized();
      }
      const nowSec = Math.floor(now().getTime() / 1000);
      if (header.alg !== 'HS256') throw unauthorized();          // no "alg: none" downgrade
      if (claims.iss !== auth.issuer || claims.aud !== auth.audience) throw unauthorized();
      if (typeof claims.exp !== 'number' || claims.exp <= nowSec) throw unauthorized();

      return {
        sub: claims.sub,
        name: claims.name,
        department: claims.department,
        scopes: String(claims.scp ?? '').split(' ').filter(Boolean),
        exp: claims.exp,
      };
    },
  };
}
