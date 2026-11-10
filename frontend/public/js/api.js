/**
 * @file api.js
 * @description Client for the OpruimCoach API, shared by the Teams app and
 * the Outlook simulation.
 *
 * TOKEN HANDLING (mirrors production Teams SSO):
 *  - The access token lives in a module variable, i.e. in MEMORY only. It is
 *    never written to localStorage/sessionStorage/cookies, so it cannot leak
 *    through storage or survive the tab.
 *  - Shortly before expiry, or on a 401, the client silently signs in again
 *    (in production: `microsoftTeams.authentication.getAuthToken()`).
 *  - Only the SELECTED SIMULATED USER ID is remembered in localStorage, as a
 *    demo convenience. It is not a credential.
 */

const USER_STORAGE_KEY = 'groenecoach.simulatedUserId';
const DEFAULT_USER_ID = 'u01';
const REFRESH_MARGIN_MS = 60_000;

/** Same-origin tabs notify each other of changes (e.g. a file moved). */
export const updates = 'BroadcastChannel' in window ? new BroadcastChannel('groenecoach-updates') : null;

/** @type {{ token: string, expiresAt: number, user: { id: string, display_name: string, department: string } } | null} */
let session = null;

/** Low-level JSON fetch that turns API error bodies into thrown Errors. */
async function rawRequest(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Geen verbinding met de OpruimCoach-server.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message ?? `Onverwachte fout (HTTP ${res.status}).`), { status: res.status });
  }
  return data;
}

/** Simulated Teams SSO: obtains a short-lived token for the chosen user. */
export async function signIn(userId) {
  const data = await rawRequest('/api/auth/simulated-sso', { method: 'POST', body: { userId } });
  session = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000, user: data.user };
  return session.user;
}

export const currentUser = () => session?.user ?? null;

/** Authenticated request with silent re-authentication. */
async function request(path, options = {}) {
  if (!session) throw new Error('Niet aangemeld.');
  if (session.expiresAt - Date.now() < REFRESH_MARGIN_MS) await signIn(session.user.id);
  try {
    return await rawRequest(path, { ...options, token: session.token });
  } catch (err) {
    if (err.status !== 401) throw err;
    await signIn(session.user.id); // token rejected: one fresh attempt
    return rawRequest(path, { ...options, token: session.token });
  }
}

export const api = {
  simulatedUsers: () => rawRequest('/api/auth/simulated-users'),
  metrics: () => rawRequest('/api/co2-metrics'),
  me: () => request('/api/user/me'),
  scan: () => request('/api/files/scan-onedrive'),
  myFiles: () => request('/api/files/mine'),
  oneDrive: () => request('/api/files/onedrive'),
  actions: () => request('/api/files/actions'),
  chains: () => request('/api/files/duplicate-chains'),
  migrate: (fileId, siteId, folderId) =>
    request('/api/files/migrate-to-sharepoint', { method: 'POST', body: { fileId, siteId, folderId } }),
  sharePointTree: () => request('/api/user/sharepoint-tree'),
  snooze: (fileId) => request('/api/files/snooze', { method: 'POST', body: { fileId } }),
  consolidate: (contentHash) =>
    request('/api/files/consolidate-duplicates', { method: 'POST', body: { contentHash, confirmed: true } }),
  restore: (fileId) => request(`/api/files/${fileId}/restore`, { method: 'POST' }),
  mapShortcut: (siteId) => request('/api/user/map-sharepoint-shortcut', { method: 'POST', body: { siteId } }),
  explorer: () => request('/api/user/explorer-view'),
  impact: () => request('/api/stats/impact'),
  evaluateSend: (fileIds, recipientCount) =>
    request('/api/outlook/evaluate-send', { method: 'POST', body: { fileIds, recipientCount } }),
  resolveSend: (decision, fileIds, recipientCount) =>
    request('/api/outlook/resolve', { method: 'POST', body: { decision, fileIds, recipientCount } }),
};

function storedUserId() {
  try { return localStorage.getItem(USER_STORAGE_KEY) || DEFAULT_USER_ID; } catch { return DEFAULT_USER_ID; }
}
function storeUserId(id) {
  try { localStorage.setItem(USER_STORAGE_KEY, id); } catch { /* non-critical */ }
}

/**
 * Fills the "Simulatie: ingelogd als" picker, signs in, and re-signs in on change.
 * @param {HTMLSelectElement} select
 * @param {(user: object) => void} onSignedIn called after every (re)sign-in
 */
export async function setupUserSelect(select, onSignedIn) {
  const { users } = await api.simulatedUsers();
  let current = storedUserId();
  if (!users.some((u) => u.id === current)) current = users[0].id;
  select.replaceChildren(...users.map((u) => new Option(u.display_name, u.id, false, u.id === current)));

  select.addEventListener('change', async () => {
    storeUserId(select.value);
    onSignedIn(await signIn(select.value));
  });
  onSignedIn(await signIn(current));
}
