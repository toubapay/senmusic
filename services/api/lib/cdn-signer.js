/**
 * Cloud CDN signed URLs — URLPrefix mode.
 *
 * Instead of signing every segment individually, we sign the prefix
 * https://cdn.yourdomain.sn/hls/{trackId}/ once. The same query-string
 * (URLPrefix + Expires + KeyName + Signature) is then appended to every
 * segment URL under that prefix, and Cloud CDN validates each request.
 *
 * Setup (once):
 *   gcloud compute backend-buckets create hls-backend --gcs-bucket-name=promusic-hls --enable-cdn
 *   gcloud compute backend-buckets add-signed-url-key hls-backend \
 *     --key-name=stream-key-1 --key-file=<(head -c 16 /dev/urandom | base64 | tr '+/' '-_')
 *
 * Env vars:
 *   CDN_BASE_URL      e.g. https://cdn.yourdomain.sn
 *   CDN_KEY_NAME      e.g. stream-key-1
 *   CDN_KEY_B64       the base64url key material (Secret Manager!)
 */

import crypto from "node:crypto";

const CDN_BASE_URL = process.env.CDN_BASE_URL;
const CDN_KEY_NAME = process.env.CDN_KEY_NAME;
const CDN_KEY = Buffer.from(process.env.CDN_KEY_B64 ?? "", "base64url");

const b64url = (buf) => buf.toString("base64url");

/**
 * Returns { params, expires } where `params` is the query string to append
 * to every URL under the prefix, valid for `ttlSeconds`.
 */
export function signPrefix(trackId, ttlSeconds = 6 * 3600) {
  const prefix = `${CDN_BASE_URL}/hls/${trackId}/`;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

  const toSign = `URLPrefix=${b64url(Buffer.from(prefix))}&Expires=${expires}&KeyName=${CDN_KEY_NAME}`;
  const signature = b64url(crypto.createHmac("sha1", CDN_KEY).update(toSign).digest());

  return {
    params: `${toSign}&Signature=${signature}`,
    expires,
    segmentBase: prefix,
  };
}
