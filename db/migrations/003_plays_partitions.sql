-- ============================================================
-- plays partitioning fix
-- ============================================================
-- schema.sql only ever created plays_2026_07 (covers up to, but not
-- including, 2026-08-01). Nothing has extended it since, so every INSERT
-- INTO plays fails once that boundary passes: "no partition of relation
-- plays found for row".

CREATE TABLE IF NOT EXISTS plays_2026_08 PARTITION OF plays
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- Permanent safety net: catches any row whose started_at doesn't fall in
-- an explicitly-created partition, so a missed month never hard-fails
-- inserts again. Both idx_plays_track_time and idx_plays_user_time are
-- declared on the parent as partitioned indexes, so matching local
-- indexes are created automatically on this table too -- no separate
-- CREATE INDEX needed.
--
-- Follow-up work (not built here): a scheduled job to pre-create next
-- month's partition ahead of time, same Cloud Scheduler + Cloud Run shape
-- services/royalties-job uses. That matters because attaching a later
-- named partition (e.g. plays_2026_09) requires Postgres to scan this
-- default partition to prove no existing row belongs in the new range --
-- a scan that gets more expensive the longer this table is relied on as
-- the catch-all instead of a real monthly partition existing ahead of time.
CREATE TABLE IF NOT EXISTS plays_default PARTITION OF plays DEFAULT;
