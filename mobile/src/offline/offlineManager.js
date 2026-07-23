/**
 * offlineManager.js — the client half of offline downloads.
 * ------------------------------------------------------------
 * Install:
 *   npm i react-native-blob-util react-native-quick-crypto react-native-mmkv
 *
 * Storage layout (all inside the app sandbox — invisible to other apps):
 *   {DocumentDir}/offline/{trackId}.enc      AES-256-CTR encrypted audio
 *   MMKV (encrypted instance):               keys + license expiry + metadata
 *
 * Enforcement contract with the backend:
 *   - every file is useless without its key
 *   - keys live only in encrypted MMKV, refreshed via /v1/offline/licenses
 *   - if renewal returns 403, or licenseExpiresAt passes while offline,
 *     purgeAllKeys() runs → files stay but can never be decrypted again
 *
 * Call refreshLicenses() on app launch + on network regain.
 */

import ReactNativeBlobUtil from "react-native-blob-util";
import Crypto from "react-native-quick-crypto";
import { MMKV } from "react-native-mmkv";
import { Platform } from "react-native";

const API = "https://api.yourdomain.sn";
const DIR = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/offline`;

// Encrypted at rest; encryptionKey should come from Keychain/Keystore
const store = new MMKV({ id: "offline", encryptionKey: "replace-with-keychain-derived-key" });

const K = {
  key: (trackId) => `key:${trackId}`,
  meta: (trackId) => `meta:${trackId}`,
  licenseExpiry: "licenseExpiresAt",
};

let authToken = null;
export const setOfflineAuthToken = (t) => { authToken = t; };
const authHeaders = () => ({ Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" });

// ------------------------------------------------------------
// Download + encrypt
// ------------------------------------------------------------
export async function downloadTrack(track /* {id,title,artistNames,coverUrl,durationMs} */) {
  // 1. Get authorization, signed URL, and the content key
  const res = await fetch(`${API}/v1/offline/downloads`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ trackId: track.id }),
  });
  if (res.status === 403) throw new Error("premium_required");
  if (!res.ok) throw new Error(`download_auth_failed_${res.status}`);
  const { downloadUrl, key, licenseExpiresAt } = await res.json();

  // 2. Download the m4a to a temp path
  await ReactNativeBlobUtil.fs.mkdir(DIR).catch(() => {});
  const tmpPath = `${DIR}/${track.id}.tmp`;
  const encPath = `${DIR}/${track.id}.enc`;

  await ReactNativeBlobUtil.config({ path: tmpPath }).fetch("GET", downloadUrl);

  // 3. Encrypt: AES-256-CTR, random 16-byte IV prepended to the file
  const plain = await ReactNativeBlobUtil.fs.readFile(tmpPath, "base64");
  const iv = Crypto.randomBytes(16);
  const cipher = Crypto.createCipheriv("aes-256-ctr", Buffer.from(key, "base64"), iv);
  const encrypted = Buffer.concat([iv, cipher.update(Buffer.from(plain, "base64")), cipher.final()]);
  await ReactNativeBlobUtil.fs.writeFile(encPath, encrypted.toString("base64"), "base64");
  await ReactNativeBlobUtil.fs.unlink(tmpPath);

  // 4. Persist key + metadata in the encrypted store
  store.set(K.key(track.id), key);
  store.set(K.meta(track.id), JSON.stringify({
    id: track.id,
    title: track.title,
    artistNames: track.artistNames,
    coverUrl: track.coverUrl,
    durationMs: track.durationMs,
    downloadedAt: Date.now(),
  }));
  store.set(K.licenseExpiry, licenseExpiresAt);

  return { trackId: track.id };
}

// ------------------------------------------------------------
// Playback — decrypt to a short-lived cache file for the player
// ------------------------------------------------------------
export async function getPlayableUri(trackId) {
  if (!isLicenseValid()) {
    purgeAllKeys();
    throw new Error("license_expired"); // UI: "Reconnectez-vous pour réactiver vos téléchargements"
  }
  const key = store.getString(K.key(trackId));
  if (!key) throw new Error("no_key_for_track");

  const encPath = `${DIR}/${trackId}.enc`;
  const cachePath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/np-${trackId}.m4a`;

  const encB64 = await ReactNativeBlobUtil.fs.readFile(encPath, "base64");
  const buf = Buffer.from(encB64, "base64");
  const iv = buf.subarray(0, 16);
  const decipher = Crypto.createDecipheriv("aes-256-ctr", Buffer.from(key, "base64"), iv);
  const plain = Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]);
  await ReactNativeBlobUtil.fs.writeFile(cachePath, plain.toString("base64"), "base64");

  return Platform.OS === "android" ? `file://${cachePath}` : cachePath;
  // Pass this as source.uri to <Video>; call releasePlayable() when the
  // track changes so decrypted audio never accumulates on disk.
}

export const releasePlayable = (trackId) =>
  ReactNativeBlobUtil.fs.unlink(`${ReactNativeBlobUtil.fs.dirs.CacheDir}/np-${trackId}.m4a`).catch(() => {});

// ------------------------------------------------------------
// License lifecycle
// ------------------------------------------------------------
export function isLicenseValid() {
  const exp = store.getString(K.licenseExpiry);
  return !!exp && new Date(exp).getTime() > Date.now();
}

/** Call on app launch and whenever connectivity returns. */
export async function refreshLicenses() {
  try {
    const res = await fetch(`${API}/v1/offline/licenses`, { headers: authHeaders() });

    if (res.status === 403) {
      purgeAllKeys(); // subscription lapsed → downloads go dark
      return { active: false };
    }
    if (!res.ok) return { active: isLicenseValid() }; // transient error: keep grace period

    const { licenseExpiresAt, keys } = await res.json();
    store.set(K.licenseExpiry, licenseExpiresAt);
    for (const { trackId, key } of keys) store.set(K.key(trackId), key);
    return { active: true, expiresAt: licenseExpiresAt };
  } catch {
    return { active: isLicenseValid() }; // fully offline: grace period rules
  }
}

export function purgeAllKeys() {
  for (const k of store.getAllKeys()) {
    if (k.startsWith("key:")) store.delete(k);
  }
  store.delete(K.licenseExpiry);
  // Encrypted .enc files remain but are now permanently unreadable.
  // If the user resubscribes, /v1/offline/licenses returns the same
  // stable keys, and every file works again without re-downloading.
}

// ------------------------------------------------------------
// Library management
// ------------------------------------------------------------
export function listDownloads() {
  return store.getAllKeys()
    .filter((k) => k.startsWith("meta:"))
    .map((k) => JSON.parse(store.getString(k)))
    .sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export async function removeDownload(trackId) {
  await fetch(`${API}/v1/offline/downloads/${trackId}`, {
    method: "DELETE", headers: authHeaders(),
  }).catch(() => {}); // best-effort server-side slot release
  await ReactNativeBlobUtil.fs.unlink(`${DIR}/${trackId}.enc`).catch(() => {});
  store.delete(K.key(trackId));
  store.delete(K.meta(trackId));
}
