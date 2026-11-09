/**
 * @file errors.js
 * @description Small error/validation toolkit shared by services and routes.
 *
 * Services throw `HttpError`s; the central error middleware turns them into a
 * consistent JSON body: { "error": { "status": 404, "message": "..." } }.
 */

export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code (4xx/5xx).
   * @param {string} message Human-readable message (Dutch, shown in the UI).
   */
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Parses a positive integer identifier (e.g. a file id from a JSON body).
 * @param {unknown} value
 * @param {string} field Name used in the error message.
 * @returns {number}
 */
export function requirePositiveInt(value, field) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpError(400, `'${field}' moet een positief geheel getal zijn.`);
  }
  return n;
}

/**
 * Validates an optional user id ('u01' style). Returns undefined when absent.
 * @param {unknown} value
 * @param {string} field
 * @returns {string|undefined}
 */
export function optionalUserId(value, field = 'userId') {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(value)) {
    throw new HttpError(400, `'${field}' heeft een ongeldig formaat.`);
  }
  return value;
}
