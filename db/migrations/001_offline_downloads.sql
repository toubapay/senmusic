-- ============================================================
-- Offline downloads — migration
-- ============================================================

-- Per-user, per-track content keys. The key never lives next to the
-- encrypted file on the device; the client must re-fetch it from
-- /v1/offline/licenses, which only answers while the subscription
-- (+ grace period) is valid.
CREATE TABLE offline_keys (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id    UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    key_b64     TEXT NOT NULL,          -- 32 random bytes, base64 (AES-256)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, track_id)
);

-- The transcoder also needs to produce a single-file download rendition
-- (HLS segments are awkward to store offline). Add this to
-- runFfmpegHls()'s caller in the transcoder, after the HLS pass:
--
--   await exec("ffmpeg", [
--     "-hide_banner", "-y",
--     "-i", inputPath,
--     "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
--     "-movflags", "+faststart",
--     path.join(outDir, "download.m4a"),
--   ]);
--
-- It uploads with the rest of outDir, landing at:
--   gs://HLS_BUCKET/hls/{trackId}/download.m4a
-- (the bucket is private, so this file is only reachable through the
--  signed URL issued by /v1/offline/downloads)
