/**
 * HLS Transcoding Worker — Cloud Run service
 * ------------------------------------------------------------
 * Flow:
 *   1. Artist uploads original to:  gs://ORIGINALS_BUCKET/originals/{trackId}/{file}
 *   2. Eventarc fires on object.finalized → POSTs a CloudEvent here
 *   3. We download the original, run FFmpeg → multi-bitrate HLS (64/128/256 kbps AAC)
 *   4. Upload segments + playlists to: gs://HLS_BUCKET/hls/{trackId}/...
 *   5. Update Postgres: tracks.status='ready', duration_ms, audio_assets rows
 *
 * Env vars:
 *   ORIGINALS_BUCKET, HLS_BUCKET, DATABASE_URL
 */

import express from "express";
import { Storage } from "@google-cloud/storage";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const exec = promisify(execFile);
const storage = new Storage();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

const ORIGINALS_BUCKET = process.env.ORIGINALS_BUCKET;
const HLS_BUCKET = process.env.HLS_BUCKET;
const BITRATES = [64, 128, 256]; // kbps — free tier capped at 128 in the API layer

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// Eventarc entrypoint (GCS object.finalized CloudEvent)
// ------------------------------------------------------------
app.post("/", async (req, res) => {
  const { bucket, name } = req.body ?? {};

  // Only react to uploads in the originals/ prefix of the right bucket
  if (bucket !== ORIGINALS_BUCKET || !name?.startsWith("originals/")) {
    return res.status(200).send("ignored");
  }

  // Path convention: originals/{trackId}/{filename}
  const [, trackId] = name.split("/");
  if (!isUuid(trackId)) {
    console.error(`Cannot extract trackId from object name: ${name}`);
    return res.status(200).send("bad path — ignored"); // 200 so Eventarc doesn't retry forever
  }

  try {
    await transcodeTrack(trackId, name);
    return res.status(200).send("ok");
  } catch (err) {
    console.error(`Transcode failed for track ${trackId}:`, err);
    await markFailed(trackId, err.message);
    // 500 → Eventarc retries (transient errors: network, OOM…)
    return res.status(500).send("transcode failed");
  }
});

// ------------------------------------------------------------
// Core pipeline
// ------------------------------------------------------------
async function transcodeTrack(trackId, objectName) {
  // Idempotency: skip if this track already has an HLS asset
  const { rows } = await pool.query(
    `SELECT 1 FROM audio_assets WHERE track_id = $1 AND kind = 'hls'`,
    [trackId]
  );
  if (rows.length > 0) {
    console.log(`Track ${trackId} already transcoded — skipping`);
    return;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `tx-${trackId}-`));
  const inputPath = path.join(workDir, "input" + path.extname(objectName));
  const outDir = path.join(workDir, "hls");
  await fs.mkdir(outDir, { recursive: true });

  try {
    // 1. Download original
    await storage.bucket(ORIGINALS_BUCKET).file(objectName).download({ destination: inputPath });
    const { size } = await fs.stat(inputPath);
    console.log(`Downloaded ${objectName} (${(size / 1e6).toFixed(1)} MB)`);

    // 2. Probe duration + validate it's actually audio
    const durationMs = await probeDurationMs(inputPath);
    if (!durationMs || durationMs < 1000) {
      throw new Error("File is not valid audio or is under 1 second");
    }

    // 3. Transcode → multi-bitrate HLS + a single-file download rendition
    //    (HLS segments are awkward to store offline — see offline-migration.sql)
    await runFfmpegHls(inputPath, outDir);
    await runFfmpegDownload(inputPath, outDir);

    // 4. Upload all playlists + segments
    await uploadDir(outDir, `hls/${trackId}`);

    // 5. Record results in Postgres (single transaction)
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO audio_assets (track_id, kind, storage_path, codec, size_bytes)
         VALUES ($1, 'original', $2, $3, $4)
         ON CONFLICT (track_id, kind) DO NOTHING`,
        [trackId, `gs://${ORIGINALS_BUCKET}/${objectName}`, path.extname(objectName).slice(1), size]
      );

      await client.query(
        `INSERT INTO audio_assets (track_id, kind, storage_path, bitrates, codec)
         VALUES ($1, 'hls', $2, $3, 'aac')`,
        [trackId, `gs://${HLS_BUCKET}/hls/${trackId}/master.m3u8`, BITRATES]
      );

      await client.query(
        `UPDATE tracks SET duration_ms = $2, status = 'ready' WHERE id = $1`,
        [trackId, durationMs]
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    console.log(`Track ${trackId} ready — ${(durationMs / 1000).toFixed(0)}s, HLS at ${BITRATES.join("/")} kbps`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }); // always clean /tmp (it's RAM on Cloud Run)
  }
}

// ------------------------------------------------------------
// FFmpeg: one input → 3 AAC renditions → HLS with master playlist
// ------------------------------------------------------------
async function runFfmpegHls(inputPath, outDir) {
  for (const kbps of BITRATES) {
    await fs.mkdir(path.join(outDir, `v${kbps}`), { recursive: true });
  }

  const args = [
    "-hide_banner", "-y",
    "-i", inputPath,
    // 3 audio-only variant streams
    "-map", "0:a", "-map", "0:a", "-map", "0:a",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-b:a:0", "64k",
    "-b:a:1", "128k",
    "-b:a:2", "256k",
    // HLS muxing
    "-f", "hls",
    "-hls_time", "6",
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(outDir, "v%v/seg_%04d.ts"),
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", "a:0,name:64k a:1,name:128k a:2,name:256k",
    path.join(outDir, "v%v/playlist.m3u8"),
  ];

  const { stderr } = await exec("ffmpeg", args, { maxBuffer: 32 * 1024 * 1024 });
  if (stderr) console.log("ffmpeg:", stderr.slice(-500)); // last lines only
}

// Single AAC file for offline downloads — landing at hls/{trackId}/download.m4a,
// reachable only through the signed URL issued by /v1/offline/downloads.
async function runFfmpegDownload(inputPath, outDir) {
  const { stderr } = await exec("ffmpeg", [
    "-hide_banner", "-y",
    "-i", inputPath,
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
    path.join(outDir, "download.m4a"),
  ], { maxBuffer: 32 * 1024 * 1024 });
  if (stderr) console.log("ffmpeg (download):", stderr.slice(-500));
}

async function probeDurationMs(inputPath) {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const seconds = parseFloat(stdout.trim());
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
async function uploadDir(localDir, destPrefix) {
  const entries = await fs.readdir(localDir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile());

  // Upload in batches of 8 to keep memory sane
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(
      files.slice(i, i + 8).map((e) => {
        const localPath = path.join(e.parentPath ?? e.path, e.name);
        const rel = path.relative(localDir, localPath);
        return storage.bucket(HLS_BUCKET).upload(localPath, {
          destination: `${destPrefix}/${rel}`,
          metadata: {
            contentType: rel.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
            cacheControl: "public, max-age=31536000, immutable", // segments never change
          },
        });
      })
    );
  }
  console.log(`Uploaded ${files.length} files to gs://${HLS_BUCKET}/${destPrefix}/`);
}

async function markFailed(trackId, reason) {
  try {
    await pool.query(`UPDATE tracks SET status = 'failed' WHERE id = $1 AND status = 'processing'`, [trackId]);
    console.error(`Track ${trackId} marked failed: ${reason}`);
  } catch (e) {
    console.error("Could not mark track as failed:", e);
  }
}

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s ?? "");

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Transcoder listening on :${port}`));
