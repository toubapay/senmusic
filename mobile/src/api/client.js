/**
 * Minimal API client for the streaming backend.
 * Swap getToken() for however you store the session (SecureStore, MMKV…).
 */

const API_BASE_URL = "https://api.yourdomain.sn";

let _token = null;
export const setAuthToken = (t) => { _token = t; };
const getToken = () => _token;

async function request(method, path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error ?? `http_${res.status}`);
    e.status = res.status;
    e.payload = err;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

// ------------------------------------------------------------
// Streaming
// ------------------------------------------------------------
export const streamUrl = (trackId) =>
  `${API_BASE_URL}/v1/tracks/${trackId}/stream/master.m3u8`;

// react-native-video needs the auth header for the master request;
// variant playlists + segments carry their own tokens/signatures.
export const streamHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

// ------------------------------------------------------------
// Catalog
// ------------------------------------------------------------
export const getTrack = (trackId) => request("GET", `/v1/tracks/${trackId}`);

// ------------------------------------------------------------
// Play tracking
// ------------------------------------------------------------
export const startPlay = (trackId, source, device) =>
  request("POST", "/v1/plays", { trackId, source, device });

export const heartbeatPlay = (playId, msPlayed) =>
  request("PATCH", `/v1/plays/${playId}`, { msPlayed });
