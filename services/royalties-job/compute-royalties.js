/**
 * compute-royalties.js — monthly Cloud Run JOB (not a server).
 * ------------------------------------------------------------
 * Model: pro-rata revenue pool, like the major platforms.
 *
 *   pool          = SUM(completed payments in period) × ARTIST_SHARE
 *   perPlayValue  = pool / total counted plays in period
 *   artistAmount  = Σ over their tracks:
 *                     trackCountedPlays × perPlayValue × splitPercent/100
 *
 * Idempotent: the UNIQUE (artist_id, period_start, period_end) constraint
 * on royalty_statements means re-running a month is a no-op (ON CONFLICT
 * DO NOTHING), so a crashed or double-triggered run can't double-pay.
 *
 * Run for the PREVIOUS calendar month by default, or pass an explicit
 * period:  node compute-royalties.js 2026-06
 *
 * Deploy:
 *   gcloud run jobs create compute-royalties \
 *     --source . --region europe-west1 \
 *     --set-secrets DATABASE_URL=music-db-url:latest \
 *     --set-env-vars ARTIST_SHARE=0.60
 *
 *   gcloud scheduler jobs create http royalties-monthly \
 *     --schedule "0 4 2 * *" --time-zone "Africa/Dakar" \
 *     --uri "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/europe-west1/jobs/compute-royalties:run" \
 *     --oauth-service-account-email scheduler@$PROJECT_ID.iam.gserviceaccount.com
 *   (runs at 04:00 on the 2nd of each month, for the month just ended)
 */

import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const ARTIST_SHARE = parseFloat(process.env.ARTIST_SHARE ?? "0.60");

function resolvePeriod(arg) {
  if (arg) {
    const [y, m] = arg.split("-").map(Number);
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end };
}

async function main() {
  const { start, end } = resolvePeriod(process.argv[2]);
  const periodStart = start.toISOString().slice(0, 10);
  const periodEnd = new Date(end.getTime() - 86400000).toISOString().slice(0, 10); // inclusive last day
  console.log(`Computing royalties for ${periodStart} → ${periodEnd} (artist share ${ARTIST_SHARE * 100}%)`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ------------------------------------------------------------
    // 1. The revenue pool for the period
    // ------------------------------------------------------------
    const { rows: [rev] } = await client.query(
      `SELECT COALESCE(SUM(amount_xof), 0) AS total
       FROM payments
       WHERE status = 'completed'
         AND completed_at >= $1 AND completed_at < $2`,
      [start, end]
    );
    const poolXof = Math.floor(Number(rev.total) * ARTIST_SHARE);

    // ------------------------------------------------------------
    // 2. Total counted plays (denominator)
    // ------------------------------------------------------------
    const { rows: [tot] } = await client.query(
      `SELECT COUNT(*) AS n FROM plays
       WHERE counted = TRUE AND started_at >= $1 AND started_at < $2`,
      [start, end]
    );
    const totalPlays = Number(tot.n);

    if (totalPlays === 0 || poolXof === 0) {
      console.log(`Nothing to distribute (pool=${poolXof} XOF, plays=${totalPlays})`);
      await client.query("ROLLBACK");
      return;
    }
    console.log(`Pool: ${poolXof} XOF across ${totalPlays} counted plays ` +
                `(≈ ${(poolXof / totalPlays).toFixed(4)} XOF/play)`);

    // ------------------------------------------------------------
    // 3. One statement per artist: plays × per-play value × split
    //    (numeric math in SQL, floor to whole francs at the end)
    // ------------------------------------------------------------
    const { rows: inserted } = await client.query(
      `WITH track_plays AS (
         SELECT track_id, COUNT(*)::numeric AS plays
         FROM plays
         WHERE counted = TRUE AND started_at >= $1 AND started_at < $2
         GROUP BY track_id
       ),
       artist_earnings AS (
         SELECT rs.artist_id,
                SUM(tp.plays)::bigint AS counted_plays,
                FLOOR(SUM(
                  tp.plays * ($3::numeric / $4::numeric) * (rs.share_percent / 100)
                ))::int AS amount_xof
         FROM track_plays tp
         JOIN royalty_splits rs ON rs.track_id = tp.track_id
         GROUP BY rs.artist_id
       )
       INSERT INTO royalty_statements
         (artist_id, period_start, period_end, counted_plays, amount_xof, status)
       SELECT artist_id, $5, $6, counted_plays, amount_xof, 'pending'
       FROM artist_earnings
       WHERE amount_xof > 0
       ON CONFLICT (artist_id, period_start, period_end) DO NOTHING
       RETURNING artist_id, counted_plays, amount_xof`,
      [start, end, poolXof, totalPlays, periodStart, periodEnd]
    );

    await client.query("COMMIT");

    const distributed = inserted.reduce((s, r) => s + r.amount_xof, 0);
    console.log(`Created ${inserted.length} statements, ${distributed} XOF distributed ` +
                `(${poolXof - distributed} XOF rounding remainder stays in the pool)`);
    if (inserted.length === 0) {
      console.log("0 new statements — period was likely already computed (idempotent skip)");
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Royalty run failed:", e);
  process.exit(1); // non-zero → Cloud Run job marked failed → alerting
});
