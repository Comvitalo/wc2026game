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
| **Exact result** (tip `3:2`, actual `3:2`) | **5** |
| **Correct goal difference** (tip `2:1`, actual `3:2`) | **3** |
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

- Who will win the World Cup? (15 pts)
- Which two teams reach the final? (8 pts each)
- Which four teams reach the semi-finals? (5 pts each)
- Who is the top scorer? (10 pts)
- Which team scores the most group-stage goals? (6 pts)
- Which of us wins the Tippspiel? (5 pts)

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

## Notes
- Auth is intentionally lightweight (name + PIN) for a 3-player private game.
- The server enforces all privacy/locking rules; the browser never receives
  another player's tip before kickoff.
- For shared hosting, run the Node process on any host (or a service like
  Railway/Render/Fly) with a persistent disk for `tippspiel.db`.
