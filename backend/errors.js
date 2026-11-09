/**
 * @file errors.js
 * @description Error type and input validators shared by routes and services.
 *
 * Services throw `HttpError`s; the central error middleware turns them into
 * one consistent JSON body: { "error": { "status": 404, "message": "..." } }.
 * Validators reject anything unexpected (allow-list approach) before it can
 * reach SQL or business logic.
 */

export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code.
   * @param {string} message Human-readable message (Dutch, shown in the UI).
   */
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Positive integer (accepts numeric strings). */
export function requirePositiveInt(value, field) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `'${field}' moet een positief geheel getal zijn.`);
  return n;
}

/** Integer within [min, max]. */
export function requireIntInRange(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `'${field}' moet een geheel getal tussen ${min} en ${max} zijn.`);
  }
  return value;
}

/** Simple identifier such as 'u01' or 's01'. */
export function requireId(value, field) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/i.test(value)) {
    throw new HttpError(400, `'${field}' heeft een ongeldig formaat.`);
  }
  return value;
}

/** Optional identifier: undefined when absent. */
export const optionalId = (value, field) => (value === undefined || value === null || value === '' ? undefined : requireId(value, field));

/** Value must be one of `allowed`. */
export function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, `'${field}' moet een van ${allowed.join(', ')} zijn.`);
  return value;
}

/** Non-empty array of distinct positive integers, at most `max` long. */
export function requireIdList(value, field, max = 10) {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new HttpError(400, `'${field}' moet een lijst van 1 tot ${max} id's zijn.`);
  }
  const ids = value.map((v) => requirePositiveInt(v, field));
  if (new Set(ids).size !== ids.length) throw new HttpError(400, `'${field}' bevat dubbele id's.`);
  return ids;
}

/** Simulated quickXorHash: base64, 28 characters. */
export function requireContentHash(value, field = 'contentHash') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{27}=$/.test(value)) {
    throw new HttpError(400, `'${field}' heeft een ongeldig formaat.`);
  }
  return value;
}
