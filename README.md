# Luistin — Yahoo Fantasy Hockey draft overlap

Personal hobby app for an H2H **category** league with **daily lineups**. During the Yahoo draft, it shows how a candidate’s NHL game nights overlap your current roster so you do not stack too many games on the same nights (active slots full → bench waste) while other nights leave slots empty.

UI is Finnish by default, with FI/EN toggle. Everything is local-first (no login). Roster and named league (“kimppa”) profiles live in `localStorage`.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). First load fetches the current NHL regular-season schedule and club rosters from the public NHL Web API (`api-web.nhle.com`). That can take a few seconds, then it is cached on the server.

```bash
npm test    # overlap scoring, name matching, luck classification, mock snake/bot, Yahoo OR rank, last-10, rooms
npm run lint
```

## Draft-night workflow (Yahoo)

Numbered in the Finnish UI (always visible):

1. **Kokoonpano** — search a player you already drafted, or paste a list.
2. **Yahoo-paikat** — mark C/LW/RW/D/G as in Yahoo. NHL primary is only a default.
3. **Vertailu** — add candidates you are considering (several at once).
4. **Hyöty / Penkki** — useful nights vs forced-bench nights vs the current roster. **Tyhjennä** clears the tray. Tap a card for the week calendar (on a phone this opens below Vertailu). **Frozen Tools -tyyliset mittarit** (5v5 SH%, IPP, PP-IPP, %PP, PTS/60, SOG/60, OZ Start%, xG% 5v5, A2% + Δ vs prior seasons) sit under those schedule numbers and do not replace them.

Default slots (Settings → named kimppa profiles): 2 C, 2 LW, 2 RW, 4 D, 2 G, bench 4, UTIL 0. H2H week start Monday (or Sunday).

If you draft them, **Lisää kokoonpanoon** copies those Yahoo positions onto the roster.

No Yahoo OAuth, no passwords. Category scoring projections are out of scope — schedule and slot utilization only.

## Mock draft (`/mock`)

Separate 20-team Yahoo **snake mock** (not the overlap helper). Solo + 19 ADP-aware bots, or a **shared room** so other humans can claim empty seats. Player pool, `average_pick` (ADP) and overall rank (`player_ranks` where `rank_type === "OR"`, shown as **YR**) come from Yahoo’s public fantasy endpoint (`out=draft_analysis,ranks`; NHL `game_key` verified at runtime, currently `477`) — no OAuth. Cached about a day; Finnish error if Yahoo is down.

During a mock: **Draft** tab has the board, available players (sort ADP or Yahoo-rank), and the last 10 picks. **Joukkueet** shows each of the 20 teams’ drafted players.

### Multiplayer rooms

Host picks a slot → **Luo jaettu huone** → share `/mock?room=XXXXXX`. Others open the link, tap an empty seat (**Liity**). Host **Aloita mock**; empty seats become bots. Seats lock after start. Clients poll `GET /api/mock/room/[id]` every ~1.5s.

Room JSON lives in **Upstash Redis** when env vars are set (Vercel KV / Upstash Marketplace). Otherwise it stays in the Node process (two local browsers on `next dev` work; Vercel serverless needs Redis).

Production env (either pair):

- `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel KV / Upstash on Marketplace)
- or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

Rooms expire after 6 hours. Solo mock and the draft helper do not need these vars.

### Paste / CSV (no Yahoo login)

Yahoo does not need to be connected. Copy names from the draft room, a watchlist, or an export and paste:

```
Auston Matthews
Connor McDavid
Cale Makar
```

Also accepted:

- `Matthews, Auston`
- `Auston Matthews (TOR - C)`
- CSV with a header row (`Player`, `Name`, …). Ambiguous last names (several Johnsons) are left unmatched so you can search them.

If you export from Yahoo (league → players / draft results → CSV when available), strip extra columns or paste the player column. Never put account passwords into this app.

## How overlap is scored

Each NHL **game date** (`gameDate` from the API — the hockey night Yahoo uses):

1. Players already on your roster who have a game that night fill active slots **greedily**: fewest eligible positions first, then the tightest remaining slot. UTIL is last.
2. The **candidate is placed after** the current roster. They get a useful night only if an eligible slot (or UTIL) is still open. They never bump someone you already drafted.
3. Regular season only (`gameType` 2). Preseason is ignored.

This matches the “don’t stack the same nights” question. It is not a lineup optimizer and does not predict scratches or goalie starts. For goalies, a “game night” is **the team’s game**, not a confirmed start.

Hypothesis check (in `lib/overlap.test.ts`): with two Toronto centers already rostered, a third Leaf is fully benched on shared nights; a Montreal center keeps the nights Toronto does not play. Frozen 2026–27 dates from the NHL API.

## Data

- Players: `GET https://api-web.nhle.com/v1/roster/{TEAM}/current`
- Schedule: `GET https://api-web.nhle.com/v1/club-schedule-season/{TEAM}/now`
- Season bounds: `GET https://api-web.nhle.com/v1/schedule/now`
- Last-season **Frozen Tools-style** skater rates + luck: MoneyPuck free season CSVs for **2022–23, 2023–24, 2024–25**, cached at `GET /api/luck` for 7 days
  - Skaters: `https://moneypuck.com/moneypuck/playerData/seasonSummary/{2022,2023,2024}/regular/skaters.csv`
  - Teams (PP ice for %PP): `https://moneypuck.com/moneypuck/playerData/seasonSummary/{2022,2023,2024}/regular/teams.csv`
  - Goalies: `https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/goalies.csv`
  - Data page / credit: [MoneyPuck.com data](https://moneypuck.com/data.htm) (free for non-commercial use)
  - Mapping: MoneyPuck `playerId` is the NHL id; unique-name fallback if needed
  - **Not Dobber data.** Frozen Tools is a DobberHockey product (report UI / paid DFS). This app does not scrape Frozen Tools. It computes the same *decision signals* (5v5 SH%, IPP, PP-IPP, %PP, PTS/60, SOG/60, OZ Start%, xG% 5v5, A2%, PDO, G vs xG, TOI) from MoneyPuck and labels them **Frozen Tools -tyyliset mittarit**.

No invented games. If the API is missing a team, the footer/status line lists it.

### Frozen Tools -tyyliset mittarit (Onni / epäonni)

On a Vertailu candidate (and the focused calendar), Luistin shows compact **Frozen Tools-style** rates for **NHL 2024–25** plus Δ vs the prior 1–2 seasons. Hyöty/Penkki stay first.

- **5v5 SH%** — even-strength shooting % (MoneyPuck `5on5` goals / shots), with a 22–23 → 23–24 → 24–25 trend.
- **IPP** — individual points % = player points / on-ice goals (all situations). **IPP 5v5** is the even-strength version; **PP-IPP** uses `5on4`.
- **%PP** — GP-normalized share of team 5-on-4 ice (`skaters.csv` `5on4` icetime / `teams.csv` `5on4` iceTime).
- **PTS/60** and **SOG/60** — all-situations rates (`I_F_points`, `I_F_shotsOnGoal` / `icetime`).
- **OZ Start%** — 5v5 offensive / (offensive + defensive) zone starts (`I_F_oZoneShiftStarts`, `I_F_dZoneShiftStarts`).
- **xG% 5v5** — on-ice expected-goals share (`onIce_xGoalsPercentage`; CF% `onIce_corsiPercentage` if xG% is missing).
- **A2%** — secondary assists / (primary + secondary) (`I_F_secondaryAssists`, `I_F_primaryAssists`).
- **PDO 5v5**, **maalit vs xG**, **on-ice SH%**, **TOI 5v5 / PP-TOI**.
- Short Finnish luck verdict when finishing/PDO supports it: *todennäköisesti onnekas / epäonnekas / neutraali*.

This is **not** a skill ranking and **not** Dobber Frozen Tools data. xG/SH% cannot see finishing talent. Unlucky last year can bounce; lucky can regress. Goalies use GA vs xGA (no IPP). Missing or tiny samples show an empty/thin state.

Yahoo eligibility is **manual** (not locked to NHL) and **fully used in scoring**. Search opens a **Yahoo-pelipaikat** sheet; each roster/compare row has a **Yahoo-kelpoisuus** box and **Muokkaa**. Nightly greedy fill may only start a player in a slot they marked (C/LW/RW/D/G). UTIL is used only if the kimppa profile still has UTIL. LW-only never takes a C slot.

## Stack

Next.js (App Router) + TypeScript + Tailwind. No auth. Switch kimppa profiles in the header/settings for different league slot configs.

## Deploy (phone / HTTPS)

Roster and kimppa profiles stay in **this browser’s `localStorage`**. HTTPS does not change that — no Yahoo OAuth, no server login. Data is per device and per origin (a new Vercel URL is a new empty roster).

This repo is not linked to a Vercel project from CI. One-click on the **bogiporssi-fi** Vercel account (GitHub already connected):

1. Open [Import this GitHub repo on Vercel](https://vercel.com/new/clone?repository-url=https://github.com/bogiporssi-fi/fantasy-hockey-draft).
2. Sign in as the same account that owns `bogiporssi-fi` (Google/GitHub/email — whatever you already use on Vercel).
3. Import **fantasy-hockey-draft**, Framework Preset **Next.js**, Root **./**
4. Deploy **Production** from `main`. Leave Deployment Protection / SSO **off** so the phone can open the URL without a Vercel login.
5. Open the `*.vercel.app` URL on the phone. First NHL load can take a few seconds.

CLI (if you have a token): `npm i -g vercel && vercel login && vercel --prod --yes`

No env vars are required for the draft helper or a **solo** mock. Shared mock rooms on Vercel need Upstash Redis / Vercel KV (`KV_REST_API_URL` + `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).
