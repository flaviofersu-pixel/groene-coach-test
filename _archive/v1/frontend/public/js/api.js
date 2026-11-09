/**
 * @file api.js
 * @description Thin client for the M365 Cloud Simulation REST API, shared by the
 * desktop widget and the Teams dashboard. All requests go to relative /api
 * URLs, which the frontend server proxies to the backend.
 */

const USER_STORAGE_KEY = 'klimaattool.simulatedUserId';
const DEFAULT_USER_ID = 'u01';

/**
 * Both pages broadcast changes on this channel so an open dashboard updates
 * the moment the widget migrates a file (same-origin tabs only).
 */
export const updates = 'BroadcastChannel' in window ? new BroadcastChannel('klimaattool-updates') : null;

/**
 * Performs a JSON request and turns API error bodies into thrown Errors.
 * @param {string} path e.g. '/api/users'
 * @param {RequestInit} [options]
 */
async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new Error('Geen verbinding met de Klimaattool-server.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Onverwachte fout (HTTP ${res.status}).`);
  return data;
}

const query = (params) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));
  return qs.toString() ? `?${qs}` : '';
};

export const api = {
  listUsers: () => request('/api/users'),
  scanOneDrive: (userId) => request(`/api/files/scan-onedrive${query({ user: userId })}`),
  migrate: (fileId, userId) =>
    request('/api/files/migrate-to-sharepoint', { method: 'POST', body: JSON.stringify({ fileId, userId }) }),
  decline: (fileId, userId) =>
    request('/api/files/decline', { method: 'POST', body: JSON.stringify({ fileId, userId }) }),
  co2Saved: (userId) => request(`/api/stats/co2-saved${query({ user: userId })}`),
};

/**
 * The "signed-in" user of the simulation, remembered per browser.
 * localStorage may be unavailable (private mode), so every access is guarded.
 */
export function getCurrentUserId() {
  try {
    return localStorage.getItem(USER_STORAGE_KEY) || DEFAULT_USER_ID;
  } catch {
    return DEFAULT_USER_ID;
  }
}

export function setCurrentUserId(userId) {
  try {
    localStorage.setItem(USER_STORAGE_KEY, userId);
  } catch {
    // Non-critical: the selection simply won't survive a reload.
  }
}

/**
 * Fills a <select> with the simulated users and wires up change handling.
 * @param {HTMLSelectElement} select
 * @param {(userId: string) => void} onChange
 */
export async function setupUserSelect(select, onChange) {
  const { users } = await api.listUsers();
  const current = getCurrentUserId();
  select.replaceChildren(
    ...users.map((u) => new Option(`${u.display_name} · ${u.department}`, u.id, false, u.id === current))
  );
  // Fall back to the first user if the stored id no longer exists.
  if (!users.some((u) => u.id === current)) {
    select.value = users[0]?.id ?? '';
    setCurrentUserId(select.value);
  }
  select.addEventListener('change', () => {
    setCurrentUserId(select.value);
    onChange(select.value);
  });
  return users;
}
