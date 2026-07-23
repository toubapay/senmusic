-- ============================================================
-- Music Streaming Platform — PostgreSQL Schema (Cloud SQL)
-- Core domains: identity, catalog, media, playlists,
--               engagement, monetization, royalties
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";   -- users.email

-- ------------------------------------------------------------
-- 1. IDENTITY
-- ------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE NOT NULL,
    phone           VARCHAR(20) UNIQUE,           -- important for Wave/OM users
    password_hash   TEXT,                          -- NULL if social/Firebase auth
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      TEXT,
    country_code    CHAR(2) DEFAULT 'SN',
    tier            VARCHAR(10) NOT NULL DEFAULT 'free'
                    CHECK (tier IN ('free', 'premium')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An artist is a profile, optionally owned by a user account
CREATE TABLE artists (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    name            VARCHAR(150) NOT NULL,
    slug            VARCHAR(160) UNIQUE NOT NULL,  -- /artist/youssou-ndour
    bio             TEXT,
    image_url       TEXT,
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. CATALOG
-- ------------------------------------------------------------
CREATE TABLE albums (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(200) NOT NULL,
    album_type      VARCHAR(12) NOT NULL DEFAULT 'album'
                    CHECK (album_type IN ('album', 'single', 'ep', 'compilation')),
    cover_url       TEXT,
    release_date    DATE,
    status          VARCHAR(12) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'published', 'removed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: featured artists, collaborations
CREATE TABLE album_artists (
    album_id        UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    artist_id       UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    role            VARCHAR(10) NOT NULL DEFAULT 'primary'
                    CHECK (role IN ('primary', 'featured')),
    PRIMARY KEY (album_id, artist_id)
);

CREATE TABLE tracks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id        UUID REFERENCES albums(id) ON DELETE SET NULL,
    title           VARCHAR(200) NOT NULL,
    track_number    SMALLINT,
    duration_ms     INTEGER,                       -- filled by transcoder
    explicit        BOOLEAN NOT NULL DEFAULT FALSE,
    isrc            VARCHAR(15),                   -- standard rights code, if any
    genre           VARCHAR(60),
    access          VARCHAR(10) NOT NULL DEFAULT 'free'
                    CHECK (access IN ('free', 'premium')),   -- paid-only content
    status          VARCHAR(12) NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing', 'ready', 'failed', 'removed')),
    play_count      BIGINT NOT NULL DEFAULT 0,     -- denormalized, synced from plays
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE track_artists (
    track_id        UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    artist_id       UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    role            VARCHAR(10) NOT NULL DEFAULT 'primary'
                    CHECK (role IN ('primary', 'featured')),
    PRIMARY KEY (track_id, artist_id)
);

CREATE INDEX idx_tracks_album ON tracks(album_id);
CREATE INDEX idx_tracks_status ON tracks(status) WHERE status = 'ready';

-- ------------------------------------------------------------
-- 3. MEDIA ASSETS (output of the FFmpeg/HLS pipeline)
-- ------------------------------------------------------------
CREATE TABLE audio_assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id        UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    kind            VARCHAR(10) NOT NULL
                    CHECK (kind IN ('original', 'hls')),
    -- original: gs://bucket/originals/{track_id}.wav
    -- hls:      gs://bucket/hls/{track_id}/master.m3u8
    storage_path    TEXT NOT NULL,
    bitrates        INTEGER[],                     -- e.g. {64,128,256} for hls
    codec           VARCHAR(10),                   -- 'aac', 'flac', ...
    size_bytes      BIGINT,
    checksum_sha256 CHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (track_id, kind)
);

-- ------------------------------------------------------------
-- 4. PLAYLISTS & LIBRARY
-- ------------------------------------------------------------
CREATE TABLE playlists (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(150) NOT NULL,
    description     TEXT,
    cover_url       TEXT,
    is_public       BOOLEAN NOT NULL DEFAULT TRUE,
    is_editorial    BOOLEAN NOT NULL DEFAULT FALSE, -- curated by your team
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE playlist_tracks (
    playlist_id     UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id        UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,              -- ordering; use gaps (1000, 2000…)
    added_by        UUID REFERENCES users(id),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);

-- "Liked songs", saved albums, followed artists = the user library
CREATE TABLE library_items (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type       VARCHAR(10) NOT NULL
                    CHECK (item_type IN ('track', 'album', 'artist', 'playlist')),
    item_id         UUID NOT NULL,                 -- polymorphic reference
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_type, item_id)
);

-- ------------------------------------------------------------
-- 5. ENGAGEMENT / ANALYTICS
-- ------------------------------------------------------------
-- Append-only. This table gets BIG — partition by month.
CREATE TABLE plays (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    track_id        UUID NOT NULL REFERENCES tracks(id),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ms_played       INTEGER NOT NULL DEFAULT 0,
    counted         BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE once ms_played >= 30000
    source          VARCHAR(20),                   -- 'playlist', 'album', 'search'…
    device          VARCHAR(20),                   -- 'android', 'ios', 'web'
    PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

CREATE TABLE plays_2026_07 PARTITION OF plays
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- create next partitions via a scheduled job

CREATE INDEX idx_plays_track_time ON plays(track_id, started_at);
CREATE INDEX idx_plays_user_time  ON plays(user_id, started_at);

-- ------------------------------------------------------------
-- 6. MONETIZATION (PayDunya: Wave, Orange Money, cards)
-- ------------------------------------------------------------
CREATE TABLE plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(30) UNIQUE NOT NULL,   -- 'premium_monthly'
    name            VARCHAR(100) NOT NULL,
    price_xof       INTEGER NOT NULL,              -- store in whole francs CFA
    period_days     INTEGER NOT NULL,              -- 30, 7 (weekly plans work well)
    active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id         UUID NOT NULL REFERENCES plans(id),
    status          VARCHAR(12) NOT NULL
                    CHECK (status IN ('active', 'expired', 'cancelled', 'pending')),
    starts_at       TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,          -- entitlement check = now() < expires_at
    auto_renew      BOOLEAN NOT NULL DEFAULT FALSE, -- mobile money = manual renew usually
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subs_user_active ON subscriptions(user_id, expires_at DESC);

CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    subscription_id     UUID REFERENCES subscriptions(id),
    provider            VARCHAR(20) NOT NULL DEFAULT 'paydunya',
    provider_token      VARCHAR(100),              -- PayDunya invoice token
    amount_xof          INTEGER NOT NULL,
    status              VARCHAR(12) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    channel             VARCHAR(20),               -- 'wave', 'orange_money', 'card'
    webhook_payload     JSONB,                     -- raw IPN for audit/debug
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_payments_provider_token ON payments(provider_token)
    WHERE provider_token IS NOT NULL;              -- idempotent webhook handling

-- ------------------------------------------------------------
-- 7. ROYALTIES (model this from day one)
-- ------------------------------------------------------------
-- Who gets what share of a track's revenue
CREATE TABLE royalty_splits (
    track_id        UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    artist_id       UUID NOT NULL REFERENCES artists(id),
    share_percent   NUMERIC(5,2) NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),
    PRIMARY KEY (track_id, artist_id)
);
-- enforce SUM(share_percent) = 100 per track in application logic or a trigger

-- Monthly computed payouts (from counted plays)
CREATE TABLE royalty_statements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id       UUID NOT NULL REFERENCES artists(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    counted_plays   BIGINT NOT NULL,
    amount_xof      INTEGER NOT NULL,
    status          VARCHAR(12) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'disputed')),
    paid_at         TIMESTAMPTZ,
    UNIQUE (artist_id, period_start, period_end)
);
