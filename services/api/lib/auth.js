/**
 * requireAuth — verifies the user's session JWT (issued at login/signup,
 * not part of this session's scope) and attaches req.user.
 *
 * Distinct from STREAM_TOKEN_SECRET in streaming.js: that token is a
 * short-lived, per-track playback credential; this one is the normal
 * app session credential sent as `Authorization: Bearer <token>`.
 *
 * Env: JWT_SECRET
 */

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing_token" });
  }

  try {
    const claims = jwt.verify(token, JWT_SECRET);
    req.user = { id: claims.sub };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
