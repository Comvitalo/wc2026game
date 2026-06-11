# ⚽ WC 2026 Tippspiel

A small prediction game (Tippspiel) for the 2026 World Cup, for three players:
**Ali, Alex, and Will**. Each player predicts the score of every match; points
are awarded for accuracy. Bonus questions (winner, finalists, top scorer, …)
give extra points.

Built as a tiny **Node + Express + SQLite** app — one database file, no external
services. All kickoff/lock times are handled in **America/Mexico_City** time.

---

## How the game works

### Match tips
Each player tips an exact score (e.g. `3:2`) for every match.

| Outcome | Points |
|---|---|
| **Exact result** (tip `3:2`, actual `3:2`) | **3** |
| **Correct goal difference** (tip `2:1`, actual `3:2`) | **2** |
| **Correct tendency** (right winner or draw, wrong difference) | **1** |
| **Wrong tendency** | **0** |

Point values are configurable in the `settings` table (`points_exact`,
`points_diff`, `points_tendency`).

### Locking & privacy (per-match)
- Before a match's **kickoff**, a player can enter and change their own tip, and
  **nobody else can see it**.
- At kickoff the tip **locks** (no more edits) and all players' tips for that
  match are **revealed**.
- You can keep tipping later matches after the tournament has already started.

### Bonus questions
Season-long predictions worth extra points, locked at **tournament start**:

- Who will win the World Cup? (5 pts)
- Which four teams reach the semi-finals? (2 pts each, max 8)
- Who is the top scorer? (5 pts)
- Which team scores the most group-stage goals? (5 pts)

Multi-answer questions award the points **per correct pick**. The admin enters
the correct answer once it's known and points are awarded automatically.

---

## Running it

```bash
npm install      # install dependencies
npm run seed     # create + populate tippspiel.db (safe to re-run)
npm start        # http://localhost:3000
```

Other scripts:

```bash
npm test         # run scoring unit tests
npm run reset    # wipe all game data and re-seed from scratch
```

Open <http://localhost:3000> in a browser.

### Default PINs — change these!
Seeded for first use; change them before sharing the link.

| Who | Name | PIN |
|---|---|---|
| Player | Ali | `1111` |
| Player | Alex | `2222` |
| Player | Will | `3333` |
| **Admin panel** | — | `9999` |

To change PINs, update the hashes (see `auth.hashPin`) — e.g.:

```bash
node -e "const {db,init}=require('./db');init();const {hashPin}=require('./auth');
  db.prepare('UPDATE players SET pin_hash=? WHERE name=?').run(hashPin('NEWPIN'),'Ali');"
# admin PIN:
node -e "const {db,init}=require('./db');init();const {hashPin}=require('./auth');
  db.prepare('UPDATE settings SET value=? WHERE key=?').run(hashPin('NEWADMIN'),'admin_pin_hash');"
```

---

## Using the admin panel

Sign in with the **Admin PIN** on the login screen. From the Admin tab you can:

- **Enter match results** — type the real score and Save; points recompute and
  the leaderboard updates instantly.
- **Set knockout teams & kickoff times** — knockout matches start as `TBD`;
  fill in the actual teams and adjust dates/times as the bracket resolves.
- **Rename group teams** — placeholders are `Team A1 … Team L4`. Rename one and
  it updates across all of that team's group matches.
- **Resolve bonus questions** — enter the correct answer(s), comma-separated.

---

## The WC 2026 fixtures

The seed loads the **real 48-team / 104-match** tournament:

- **72** group-stage matches (12 groups A–L × 6),
- **16** Round of 32, **8** Round of 16, **4** quarter-finals,
  **2** semi-finals, **1** third-place match, **1** final.

Data lives in two files under `data/`:

- **`groups.json`** — the 12 groups with the actual teams from the December 2025
  final draw.
- **`schedule.json`** — every match with its real date, venue/stadium, matchup,
  and kickoff time. Local kickoff times are converted to UTC using each venue's
  summer offset (Mexican venues CST/UTC−6 with no DST; US & Canadian venues on
  daylight time). Per-match locking keys off each match's `kickoff_at`.

Knockout matches are seeded with the correct dates and venues but `TBD` teams
(and bracket-slot labels like *Winner A* / *Runner-up B*); the admin fills in
the real teams as the bracket resolves.

> Note: a few group-stage kickoff *times* may be off by an hour pending the
> final official confirmation — dates, venues and matchups are accurate. Adjust
> any time in the admin panel; it updates that match's lock instantly.

To re-import after editing `data/*.json`, run `npm run reset`.

---

## Project layout

```
server.js            Express app: auth, API, locking, scoring endpoints
db.js                SQLite connection + schema
scoring.js           Pure scoring logic (match tips + bonus)
auth.js              PIN hashing (scrypt) + session tokens
seed.js              Seeds teams, 104 fixtures, bonus questions, players
test/scoring.test.js Unit tests for the scoring rules
public/              Single-page frontend (index.html, app.js, styles.css)
```

### Data model (SQLite)
`players`, `teams`, `matches`, `tips`, `bonus_questions`, `bonus_answers`,
`sessions`, `settings`. The `tippspiel.db` file is git-ignored — back it up by
copying that one file.

---

## Deploying to Fly.io

The app ships with a `Dockerfile` and `fly.toml`. SQLite needs a **persistent
volume** and a **single instance**, both configured here. Database lives at
`/data/tippspiel.db` on a mounted volume that survives deploys and restarts.

**One-time setup** (with the [flyctl](https://fly.io/docs/flyctl/install/) CLI):

```bash
fly auth login

# 1. Create the app (pick a globally-unique name and set it as `app` in fly.toml)
fly apps create wc2026-tippspiel

# 2. Create the persistent volume for the SQLite file (1 GB is plenty)
fly volumes create wc2026_data --region qro --size 1

# 3. Set the PINs as secrets so defaults never ship publicly
fly secrets set ADMIN_PIN=xxxx PIN_ALI=xxxx PIN_ALEX=xxxx PIN_WILL=xxxx

# 4. Deploy, and pin to exactly one machine (SQLite can't be shared)
fly deploy
fly scale count 1

fly open
```

On first boot the container runs `node seed.js` (idempotent — creates the
schema and fills empty tables) and then starts the server. The PIN secrets are
applied on that first seed.

**Day-to-day:**

- **Back up the database:** `fly ssh console -C "cat /data/tippspiel.db" > backup.db`
  (or `fly sftp get /data/tippspiel.db`).
- **Change a PIN later:** `fly secrets set ...` only affects a *fresh* seed; to
  change an existing PIN, update the hash in the DB (see *Default PINs* above)
  via `fly ssh console`.
- **Re-import fixtures after editing `data/*.json`:** redeploy, then
  `fly ssh console -C "node /app/seed.js --reset"`. **Warning:** `--reset` wipes
  all tips, answers and results — only do this before the tournament starts.
- **Keep it single-instance:** never `fly scale count` above 1.

> The same `Dockerfile` runs anywhere (Railway, Render with a disk, a VPS via
> `docker run -v wc2026_data:/data -e DB_PATH=/data/tippspiel.db -p 3000:3000`).
> Just ensure one instance and a persistent `/data`.

## Notes
- Auth is intentionally lightweight (name + PIN) for a 3-player private game.
- The server enforces all privacy/locking rules; the browser never receives
  another player's tip before kickoff.
- For shared hosting, run the Node process on any host (or a service like
  Railway/Render/Fly) with a persistent disk for `tippspiel.db`.
