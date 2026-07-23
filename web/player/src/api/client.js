/**
 * API client for the listener web app.
 * Token lives in localStorage under "token" — same key ArtistUpload.jsx
 * already uses, so a token pasted in one app works in the other.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://api.yourdomain.sn";

export const getToken = () => localStorage.getItem("token") ?? "";
export const setToken = (t) => localStorage.setItem("token", t);
export const clearToken = () => localStorage.removeItem("token");

async function request(method, path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(payload.error ?? `http_${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// ------------------------------------------------------------
// Search / browse
// ------------------------------------------------------------
export const search = (q, limit = 10) =>
  request("GET", `/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`);

export const searchByGenre = (genre, limit = 20) =>
  request("GET", `/v1/search/genre/${encodeURIComponent(genre)}?limit=${limit}`);

// ------------------------------------------------------------
// Streaming
// ------------------------------------------------------------
export const streamUrl = (trackId) =>
  `${API_BASE_URL}/v1/tracks/${trackId}/stream/master.m3u8`;

// hls.js needs this only on the master-playlist request itself — variant
// playlists and segments carry their own token/signature in the URL.
export const streamAuthHeader = () => ({ Authorization: `Bearer ${getToken()}` });

// ------------------------------------------------------------
// Play tracking
// ------------------------------------------------------------
export const startPlay = (trackId, source, device) =>
  request("POST", "/v1/plays", { trackId, source, device });

export const heartbeatPlay = (playId, msPlayed) =>
  request("PATCH", `/v1/plays/${playId}`, { msPlayed });

// ------------------------------------------------------------
// Subscriptions
// ------------------------------------------------------------
export const getSubscription = () => request("GET", "/v1/subscriptions/me");

export const checkout = (planCode) =>
  request("POST", "/v1/subscriptions/checkout", { planCode });
