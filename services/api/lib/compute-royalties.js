/**
 * compute-royalties.js — royalty computation, callable from the API.
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
 * Formerly a standalone Cloud Run job (services/royalties-job); now
 * consolidated into the API process and invoked via POST
 * /internal/royalties/run (see routes/internal.js), on Cloud Scheduler's
 * monthly schedule — the formula/logic below is unchanged, only the
 * entry point moved. Uses the API's shared pg pool (lib/db.js) rather
 * than opening its own, since it now runs inside the same process.
 */

import { pool } from "./db.js";

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

/**
 * Runs the royalty computation for a period ("YYYY-MM", or the previous
 * calendar month if omitted). Returns a summary; never throws on "nothing
 * to distribute" (returns distributed: 0 instead).
 */
export async function computeRoyalties(periodArg) {
  const { start, end } = resolvePeriod(periodArg);
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
      return { periodStart, periodEnd, poolXof, totalPlays, statementsCreated: 0, distributedXof: 0 };
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

    const distributedXof = inserted.reduce((s, r) => s + r.amount_xof, 0);
    console.log(`Created ${inserted.length} statements, ${distributedXof} XOF distributed ` +
                `(${poolXof - distributedXof} XOF rounding remainder stays in the pool)`);
    if (inserted.length === 0) {
      console.log("0 new statements — period was likely already computed (idempotent skip)");
    }
    return { periodStart, periodEnd, poolXof, totalPlays, statementsCreated: inserted.length, distributedXof };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
