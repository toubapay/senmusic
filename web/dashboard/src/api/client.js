/**
 * API client for the artist dashboard.
 * Token lives in localStorage under "token" — same key ArtistUpload.jsx
 * originally used directly, and the same key web/player uses, so a token
 * pasted in one app works in the other.
 */

// Unset (production consolidated build) means same-origin relative
// requests — correct once this app is served from the API's own Cloud Run
// service (see root Dockerfile). Local dev sets this explicitly via
// .env.local since the Vite dev server and API run on different ports.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

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

export const createTrack = (meta) => request("POST", "/v1/artist/tracks", meta);
export const listTracks = () => request("GET", "/v1/artist/tracks");
export const getTrack = (trackId) => request("GET", `/v1/artist/tracks/${trackId}`);

// GCS upload isn't a normal API call (goes straight to the signed URL, not
// through our origin), so it stays outside request() — XHR for onprogress.
export function uploadToGcs(uploadUrl, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`gcs_upload_${xhr.status}`));
    xhr.onerror = () => reject(new Error("gcs_upload_network_error"));
    xhr.send(file);
  });
}
