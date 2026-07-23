# First prompt to give Claude Code

Copy the block below as your first message once Claude Code is open in
the project folder (after following the setup steps above it).

---

## Setup (do this once, before opening Claude Code)

1. Create your project folder and `cd` into it:
   ```bash
   mkdir promusic && cd promusic
   git init
   ```
2. Copy every already-built piece in, preserving structure:
   ```bash
   cp ~/Downloads/CLAUDE.md .
   cp ~/Downloads/music_streaming_schema.sql ./db_schema.sql
   cp -r ~/Downloads/hls-transcoder ./pieces/hls-transcoder
   cp -r ~/Downloads/streaming-api    ./pieces/streaming-api
   cp -r ~/Downloads/mobile-player    ./pieces/mobile-player
   cp -r ~/Downloads/monetization     ./pieces/monetization
   cp -r ~/Downloads/phase3           ./pieces/phase3
   cp -r ~/Downloads/offline          ./pieces/offline
   ```
   (adjust source paths to wherever you saved the downloads)
3. Run `claude` in that folder. It auto-loads `CLAUDE.md`.

## The prompt itself

```
I'm assembling a music streaming platform (ProMusic) from pieces I
designed in a separate planning session. CLAUDE.md has the target repo
layout, stack, and known gaps — read it first.

Everything under /pieces/ is already-designed, working code (schema,
transcoder, streaming API routes, mobile player, PayDunya subscription
flow, artist upload dashboard, royalty job, search, offline downloads).
Nothing there is a stub or placeholder — treat it as correct business
logic to preserve, not a draft to rewrite.

Your job this session:

1. Read every file under /pieces/ and db_schema.sql before writing
   anything, so you understand how they reference each other
   (imports like `../lib/db.js` and `../lib/auth.js` that don't
   exist yet — see "Known gaps" in CLAUDE.md).

2. Reorganize /pieces/ into the target layout in CLAUDE.md — move,
   don't rewrite the logic inside each file.

3. Build the missing shared pieces so the routes actually run:
   - lib/db.js (pg.Pool, reads DATABASE_URL)
   - lib/auth.js (requireAuth middleware — JWT verify, attaches req.user)
   - the migration for play_count_applied (referenced in routes/plays.js)
   - one Express app bootstrap that mounts all six routers

4. Write .env.example covering every process.env.* referenced across
   all the pieces.

5. Get it running locally with docker-compose (Postgres + the API) and
   tell me what you needed to stub or fake to do that (e.g. GCS
   credentials, PayDunya sandbox keys) versus what's genuinely ready.

Do NOT change the royalty formula in compute-royalties.js or the
entitlement/signing flow in streaming.js + cdn-signer.js without
flagging it to me first — those were deliberately designed and
security/financial-sensitive.

Start by reading everything and giving me a short plan before you
touch any files.
```
