/**
 * Subscription flow
 * ------------------------------------------------------------
 * POST /v1/subscriptions/checkout   { planCode } → { checkoutUrl }
 * POST /v1/webhooks/paydunya        IPN → confirm with PayDunya → activate
 * GET  /v1/subscriptions/me         → current entitlement status
 *
 * Mobile-money reality baked in:
 *   - no auto-renew: each renewal is a fresh checkout
 *   - renewals EXTEND from current expires_at (paying 2 days early
 *     doesn't cost the user 2 days)
 *   - idempotent webhook via the unique index on payments.provider_token
 */

import { Router } from "express";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { createInvoice, confirmInvoice } from "../lib/paydunya.js";

export const subscriptionsRouter = Router();

// ------------------------------------------------------------
// 1. Start a checkout
// ------------------------------------------------------------
subscriptionsRouter.post("/v1/subscriptions/checkout", requireAuth, async (req, res) => {
  const { planCode } = req.body ?? {};

  const { rows: planRows } = await pool.query(
    `SELECT id, code, name, price_xof, period_days FROM plans
     WHERE code = $1 AND active = TRUE`,
    [planCode]
  );
  const plan = planRows[0];
  if (!plan) return res.status(404).json({ error: "plan_not_found" });

  // pending payment row first — the IPN will complete it
  const { rows: payRows } = await pool.query(
    `INSERT INTO payments (user_id, amount_xof, status, provider)
     VALUES ($1, $2, 'pending', 'paydunya')
     RETURNING id`,
    [req.user.id, plan.price_xof]
  );
  const paymentId = payRows[0].id;

  const { token, checkoutUrl } = await createInvoice({
    amountXof: plan.price_xof,
    description: `ProMusic — ${plan.name}`,
    paymentId,
    userId: req.user.id,
    planCode: plan.code,
  });

  await pool.query(
    `UPDATE payments SET provider_token = $2 WHERE id = $1`,
    [paymentId, token]
  );

  res.json({ checkoutUrl, paymentId });
});

// ------------------------------------------------------------
// 2. IPN webhook
// ------------------------------------------------------------
subscriptionsRouter.post("/v1/webhooks/paydunya", async (req, res) => {
  // PayDunya posts form-encoded `data` — accept both shapes
  const ipn = req.body?.data ?? req.body ?? {};
  const token = ipn?.invoice?.token ?? ipn?.token;
  if (!token) return res.status(400).send("no token");

  // ALWAYS confirm server-side; the IPN body is just a doorbell
  const conf = await confirmInvoice(token);
  if (!conf.completed) {
    console.log(`IPN for ${token}: status=${conf.status} — not completing`);
    return res.status(200).send("noted");
  }

  const { payment_id: paymentId, user_id: userId, plan_code: planCode } = conf.customData;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotency: only the FIRST completion transition does any work
    const { rows: payRows } = await client.query(
      `UPDATE payments
       SET status = 'completed', channel = $2, webhook_payload = $3,
           completed_at = now()
       WHERE id = $1 AND provider_token = $4 AND status = 'pending'
       RETURNING id, user_id, amount_xof`,
      [paymentId, conf.channel, conf.raw, token]
    );

    if (payRows.length === 0) {
      // already processed, or token/payment mismatch (possible fraud probe)
      await client.query("ROLLBACK");
      return res.status(200).send("already processed");
    }
    const payment = payRows[0];

    // Defense in depth: amount must match what PayDunya says was paid
    if (payment.amount_xof !== conf.amountXof || payment.user_id !== userId) {
      throw new Error(`payment ${paymentId}: amount/user mismatch`);
    }

    const { rows: planRows } = await client.query(
      `SELECT id, period_days FROM plans WHERE code = $1`, [planCode]
    );
    const plan = planRows[0];
    if (!plan) throw new Error(`plan ${planCode} vanished`);

    // Extend from current expiry if still active, else from now
    const { rows: subRows } = await client.query(
      `SELECT id, expires_at FROM subscriptions
       WHERE user_id = $1 AND status = 'active' AND expires_at > now()
       ORDER BY expires_at DESC LIMIT 1`,
      [userId]
    );

    let subscriptionId;
    if (subRows.length > 0) {
      const upd = await client.query(
        `UPDATE subscriptions
         SET expires_at = expires_at + make_interval(days => $2)
         WHERE id = $1 RETURNING id`,
        [subRows[0].id, plan.period_days]
      );
      subscriptionId = upd.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO subscriptions (user_id, plan_id, status, starts_at, expires_at)
         VALUES ($1, $2, 'active', now(), now() + make_interval(days => $3))
         RETURNING id`,
        [userId, plan.id, plan.period_days]
      );
      subscriptionId = ins.rows[0].id;
    }

    await client.query(
      `UPDATE payments SET subscription_id = $2 WHERE id = $1`,
      [paymentId, subscriptionId]
    );
    await client.query(
      `UPDATE users SET tier = 'premium' WHERE id = $1`, [userId]
    );

    await client.query("COMMIT");
    console.log(`Subscription activated: user ${userId}, +${plan.period_days}d via ${conf.channel}`);
    // Hook: send confirmation SMS via the Promobile gateway here
    res.status(200).send("ok");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("IPN processing failed:", e);
    res.status(500).send("retry"); // PayDunya retries failed IPNs
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// 3. Current status (for the app's account screen)
// ------------------------------------------------------------
subscriptionsRouter.get("/v1/subscriptions/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.expires_at, p.name AS plan_name, p.code AS plan_code
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.status = 'active' AND s.expires_at > now()
     ORDER BY s.expires_at DESC LIMIT 1`,
    [req.user.id]
  );

  if (rows.length === 0) return res.json({ premium: false });
  res.json({
    premium: true,
    plan: rows[0].plan_code,
    planName: rows[0].plan_name,
    expiresAt: rows[0].expires_at,
  });
});
