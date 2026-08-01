/**
 * Internal-only routes — not part of the public API surface, called by
 * Cloud Scheduler rather than end users. Protected by a shared secret
 * (X-Internal-Secret header) rather than requireAuth's user JWTs, since
 * Cloud Run's --allow-unauthenticated applies to the whole service and
 * there's no per-route IAM layer to lean on instead.
 */

import express from "express";
import { computeRoyalties } from "../lib/compute-royalties.js";

export const internalRouter = express.Router();

const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

// Cloud Scheduler → monthly royalty run (replaces the old standalone
// services/royalties-job Cloud Run job; see lib/compute-royalties.js).
// Body: { period?: "YYYY-MM" } — omit to compute the previous calendar month.
internalRouter.post("/internal/royalties/run", async (req, res) => {
  if (!INTERNAL_SECRET) {
    return res.status(500).json({ error: "internal_secret_not_configured" });
  }
  if (req.get("X-Internal-Secret") !== INTERNAL_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  const summary = await computeRoyalties(req.body?.period);
  res.json(summary);
});
