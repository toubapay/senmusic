-- ============================================================
-- play_count_applied — companion table for routes/plays.js
-- ============================================================
-- Small bookkeeping table guaranteeing each play increments
-- tracks.play_count exactly once, even with concurrent heartbeats.

CREATE TABLE play_count_applied (
    play_id BIGINT PRIMARY KEY
);
