/**
 * Postgres connection pool, shared by every route file.
 * Env: DATABASE_URL
 */

import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
