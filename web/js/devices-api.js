// Page-side helpers for the server's device actions.
// Each returns the server's answer, or throws an Error whose message is ready
// to show to the user (and whose .status / .errorKind say what went wrong).

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("Can't reach the local server. Is the start.bat window still open?"), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `The server answered ${res.status}.`), {
      status: res.status,
      errorKind: data.errorKind ?? null,
    });
  }
  return data;
}

const deviceUrl = (uid) => `/api/devices/${encodeURIComponent(uid)}`;

/**
 * Adds a device. The server first checks the ID with the online feed
 * (this can take 10+ seconds) and saves its games.
 * Errors: status 422 = the feed doesn't know this ID; 502 = the feed couldn't
 * be reached (retry with { skipCheck: true } to save it anyway); 409 = already added.
 * @returns {{ device, devices, check: { checked, games } }}
 */
export const addDevice = (uid, name, { skipCheck = false } = {}) =>
  call("POST", "/api/devices", { uid, name, skipCheck });

/** @returns {{ device, devices }} */
export const renameDevice = (uid, name) => call("PATCH", deviceUrl(uid), { name });

/**
 * Removes a device from the list. Its saved game history is kept unless
 * deleteHistory is true (that can't be undone).
 * @returns {{ devices, historyDeleted }}
 */
export const removeDevice = (uid, { deleteHistory = false } = {}) =>
  call("DELETE", deviceUrl(uid) + (deleteHistory ? "?history=delete" : ""));
